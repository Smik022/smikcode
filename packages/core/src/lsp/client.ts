export * as LspClient from "./client.js"

import { Cause, Duration, Effect, Queue, Stream } from "effect"
import { ChildProcess } from "effect/process"
import path from "path"
import { pathToFileURL } from "url"
import { Environment } from "../environment/index.js"

/** One language server problem, with 1-based line and column. */
export interface Diagnostic {
  readonly line: number
  readonly column: number
  /** LSP severity: 1 error, 2 warning, 3 information, 4 hint. */
  readonly severity: number
  readonly message: string
  readonly source?: string
  readonly code?: string
}

export interface Options {
  /** Server name; only used to attribute logs. */
  readonly server: string
  readonly command: readonly string[]
  readonly cwd: string
  readonly environment: Record<string, string>
  readonly initialization?: Record<string, unknown>
}

export interface Interface {
  /**
   * Opens the document, or sends its new full text, then waits up to `wait` for the server to publish
   * diagnostics for it. Returns undefined when the server stays silent or has exited.
   */
  readonly sync: (file: string, text: string, wait: Duration.Input) => Effect.Effect<readonly Diagnostic[] | undefined>
}

const INITIALIZE_TIMEOUT = Duration.seconds(20)
// Servers often publish twice per change (syntax first, then semantic); wait this long for a follow-up.
const SETTLE = Duration.millis(300)
const OUTGOING_CAPACITY = 256
const MAX_FRAME_BYTES = 32 * 1024 * 1024
const FORCE_KILL_AFTER = Duration.seconds(2)

type Message = {
  readonly id?: number | string
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

/**
 * A stdio language server spawned through the location's `Environment`, so workspace-backed
 * locations run it next to the code. The process lives in the calling scope and is killed with it.
 */
export const make = Effect.fnUntraced(function* (options: Options) {
  const environment = yield* Environment.Service
  const outgoing = yield* Queue.bounded<string, Cause.Done>(OUTGOING_CAPACITY)
  const pending = new Map<number, PromiseWithResolvers<unknown>>()
  const published = new Map<string, readonly Diagnostic[]>()
  const listeners = new Set<(uri: string) => void>()
  const versions = new Map<string, number>()
  const state = { alive: true, nextID: 1, buffer: Buffer.alloc(0) }

  const send = (message: Record<string, unknown>) => {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message })
    return Queue.offer(outgoing, `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`).pipe(
      Effect.asVoid,
    )
  }

  const request = (method: string, params: unknown, timeout: Duration.Input) => {
    const id = state.nextID++
    const waiter = Promise.withResolvers<unknown>()
    pending.set(id, waiter)
    return send({ id, method, params }).pipe(
      Effect.andThen(Effect.promise(() => waiter.promise)),
      Effect.timeoutOption(timeout),
      Effect.ensuring(Effect.sync(() => pending.delete(id))),
    )
  }

  const notify = (method: string, params: unknown) => send({ method, params })

  const executable = options.command[0]
  if (executable === undefined) return yield* Effect.fail(new Error(`Language server ${options.server} has no command`))
  const handle = yield* environment.spawner.spawn(
    ChildProcess.make(executable, [...options.command.slice(1)], {
      cwd: options.cwd,
      env: options.environment,
      extendEnv: true,
      stdin: { stream: Stream.encodeText(Stream.fromQueue(outgoing)), endOnDone: true },
      stdout: "pipe",
      stderr: "pipe",
      forceKillAfter: FORCE_KILL_AFTER,
    }),
  )

  const dispatch = (message: Message) => {
    if (message.method === undefined && typeof message.id === "number") {
      pending.get(message.id)?.resolve(message.error ? undefined : message.result)
      return
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri: string; diagnostics: readonly RawDiagnostic[] }
      published.set(params.uri, params.diagnostics.map(toDiagnostic))
      listeners.forEach((listener) => listener(params.uri))
      return
    }
    // Answer every server request so none of them blocks the server waiting on us.
    if (message.method !== undefined && message.id !== undefined) {
      const result =
        message.method === "workspace/configuration"
          ? ((message.params as { items?: unknown[] }).items ?? []).map(() => options.initialization ?? null)
          : null
      Effect.runFork(send({ id: message.id, result }))
    }
  }

  const receive = (chunk: Uint8Array) =>
    Effect.sync(() => {
      state.buffer = Buffer.concat([state.buffer, chunk])
      while (true) {
        const end = state.buffer.indexOf("\r\n\r\n")
        if (end === -1) return
        const length = Number(/content-length:\s*(\d+)/i.exec(state.buffer.subarray(0, end).toString("ascii"))?.[1])
        if (!Number.isFinite(length) || length > MAX_FRAME_BYTES) {
          // Unrecoverable framing: drop what we have and wait for the server to resync or exit.
          state.buffer = Buffer.alloc(0)
          return
        }
        if (state.buffer.length < end + 4 + length) return
        const body = state.buffer.subarray(end + 4, end + 4 + length).toString("utf8")
        state.buffer = state.buffer.subarray(end + 4 + length)
        const message = parse(body)
        if (message) dispatch(message)
      }
    })

  yield* Effect.forkScoped(
    handle.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((output) =>
        output.trim() === "" ? Effect.void : Effect.logDebug("lsp server stderr", { server: options.server, output }),
      ),
      Effect.ignore,
    ),
  )
  yield* Effect.forkScoped(
    Stream.runForEach(handle.stdout, receive).pipe(
      Effect.ignore,
      Effect.ensuring(
        Effect.sync(() => {
          state.alive = false
          pending.forEach((waiter) => waiter.resolve(undefined))
          listeners.forEach((listener) => listener(""))
        }),
      ),
    ),
  )
  yield* Effect.addFinalizer(() => Queue.shutdown(outgoing))

  const root = pathToFileURL(options.cwd).href
  const initialized = yield* request(
    "initialize",
    {
      processId: process.pid,
      clientInfo: { name: "smikcode" },
      rootUri: root,
      rootPath: options.cwd,
      workspaceFolders: [{ uri: root, name: path.basename(options.cwd) }],
      initializationOptions: options.initialization,
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false, versionSupport: true },
        },
        window: { workDoneProgress: false },
      },
    },
    INITIALIZE_TIMEOUT,
  )
  if (initialized._tag === "None" || !state.alive)
    return yield* Effect.fail(new Error(`Language server ${options.server} did not initialize`))
  yield* notify("initialized", {})

  const sync = Effect.fnUntraced(function* (file: string, text: string, wait: Duration.Input) {
    if (!state.alive) return undefined
    const uri = pathToFileURL(file).href
    const version = (versions.get(uri) ?? 0) + 1
    // Register before notifying so a fast publish is not missed.
    const update = waitForPublish(listeners, uri)
    published.delete(uri)
    yield* versions.has(uri)
      ? notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] })
      : notify("textDocument/didOpen", { textDocument: { uri, languageId: languageID(file), version, text } })
    versions.set(uri, version)
    yield* notify("textDocument/didSave", { textDocument: { uri }, text })

    const first = yield* Effect.promise(() => update.promise).pipe(Effect.timeoutOption(wait))
    update.cancel()
    if (first._tag === "None" || !state.alive) return published.get(uri)
    // Take later publishes for the same document until the server goes quiet.
    while (true) {
      const next = waitForPublish(listeners, uri)
      const more = yield* Effect.promise(() => next.promise).pipe(Effect.timeoutOption(SETTLE))
      next.cancel()
      if (more._tag === "None" || !state.alive) break
    }
    return published.get(uri)
  })

  return { sync } satisfies Interface
})

type RawDiagnostic = {
  range: { start: { line: number; character: number } }
  severity?: number
  message: string
  source?: string
  code?: string | number
}

function toDiagnostic(raw: RawDiagnostic): Diagnostic {
  return {
    line: raw.range.start.line + 1,
    column: raw.range.start.character + 1,
    severity: raw.severity ?? 1,
    message: raw.message,
    source: raw.source,
    code: raw.code === undefined ? undefined : String(raw.code),
  }
}

function parse(body: string): Message | undefined {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function waitForPublish(listeners: Set<(uri: string) => void>, uri: string) {
  const waiter = Promise.withResolvers<void>()
  // An empty uri means the server exited.
  const listener = (published: string) => {
    if (published === uri || published === "") waiter.resolve()
  }
  listeners.add(listener)
  return { promise: waiter.promise, cancel: () => listeners.delete(listener) }
}

const languages: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
}

function languageID(file: string) {
  const extension = path.extname(file).toLowerCase()
  return languages[extension] ?? extension.slice(1)
}

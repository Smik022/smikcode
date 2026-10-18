export * as Lsp from "./lsp.js"

import { Context, Duration, Effect, Layer, Scope, Semaphore } from "effect"
import path from "path"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Environment } from "./environment/index.js"
import { Location } from "./location.js"
import { LspClient } from "./lsp/client.js"
import { State } from "./state.js"

export interface Server {
  readonly name: string
  readonly extensions: readonly string[]
  /** Resolves the command to launch, or false when the server is unavailable. */
  readonly command: Effect.Effect<readonly string[] | false>
  readonly environment?: Record<string, string>
  readonly initialization?: Record<string, unknown>
}

export interface Report {
  readonly server: string
  readonly diagnostics: readonly LspClient.Diagnostic[]
}

type Data = {
  servers: Server[]
}

export type Editor = {
  set: (server: Server) => void
  remove: (name: string) => void
}

export interface Interface extends State.Transformable<Editor> {
  /**
   * Sends a file's new contents to every language server registered for its extension and returns
   * what they report. Servers that are missing, fail to start or stay silent are skipped.
   */
  readonly diagnostics: (file: string, text: string) => Effect.Effect<readonly Report[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Lsp") {}

// The first request to a fresh server includes its project load, so it gets longer.
const FIRST_WAIT = Duration.seconds(8)
const WAIT = Duration.seconds(3)
const MAX_REPORTED = 20

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const environment = yield* Environment.Service
    const scope = yield* Effect.scope
    const starting = Semaphore.makeUnsafe(1)
    // A server that failed to start is remembered as undefined so it is not retried on every edit.
    const clients = new Map<string, { client: LspClient.Interface; used: boolean } | undefined>()
    const state = State.create<Data, Editor>({
      name: "lsp",
      initial: () => ({ servers: [] }),
      editor: (editor) => ({
        set: (server) => {
          const index = editor.servers.findIndex((item) => item.name === server.name)
          if (index === -1) editor.servers.push(server)
          else editor.servers[index] = server
        },
        remove: (name) => {
          editor.servers = editor.servers.filter((server) => server.name !== name)
        },
      }),
    })

    const client = (server: Server) =>
      starting.withPermit(
        Effect.gen(function* () {
          if (clients.has(server.name)) return clients.get(server.name)
          const command = yield* server.command
          if (command === false) {
            clients.set(server.name, undefined)
            return undefined
          }
          yield* Effect.logInfo("starting language server", { server: server.name, command })
          const started = yield* LspClient.make({
            server: server.name,
            command,
            cwd: location.directory,
            environment: server.environment ?? {},
            initialization: server.initialization,
          }).pipe(
            Effect.provideService(Environment.Service, environment),
            Scope.provide(scope),
            Effect.map((client) => ({ client, used: false })),
            Effect.catch((error) =>
              Effect.logWarning("language server failed to start", { server: server.name, error: error.message }).pipe(
                Effect.as(undefined),
              ),
            ),
          )
          clients.set(server.name, started)
          return started
        }),
      )

    const diagnostics = Effect.fn("Lsp.diagnostics")(function* (file: string, text: string) {
      const extension = path.extname(file).toLowerCase()
      const matching = state.get().servers.filter((server) => server.extensions.includes(extension))
      const reports = yield* Effect.forEach(
        matching,
        (server) =>
          Effect.gen(function* () {
            const entry = yield* client(server)
            if (!entry) return undefined
            const wait = entry.used ? WAIT : FIRST_WAIT
            entry.used = true
            const found = yield* entry.client.sync(file, text, wait)
            return found ? { server: server.name, diagnostics: found } : undefined
          }),
        { concurrency: "unbounded" },
      )
      return reports.filter((report): report is Report => report !== undefined)
    })

    return Service.of({ transform: state.transform, reload: state.reload, diagnostics })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, Environment.node],
})

/**
 * Renders the errors from `reports` as a short block for the model, or undefined when there are
 * none. Warnings and hints are left out so the agent is not distracted by style noise.
 */
export function format(file: string, reports: readonly Report[]) {
  const errors = reports.flatMap((report) =>
    report.diagnostics
      .filter((diagnostic) => diagnostic.severity === 1)
      .map((diagnostic) => ({ ...diagnostic, server: report.server })),
  )
  if (errors.length === 0) return undefined
  const lines = errors
    .toSorted((a, b) => a.line - b.line || a.column - b.column)
    .slice(0, MAX_REPORTED)
    .map((error) => {
      const code = error.code ? ` ${error.source ?? error.server}(${error.code})` : ""
      return `  ${error.line}:${error.column}${code} ${error.message.replaceAll("\n", " ")}`
    })
  const more = errors.length > MAX_REPORTED ? `\n  … and ${errors.length - MAX_REPORTED} more` : ""
  return `Language server errors in ${file} after this change (fix them if they are caused by it):\n${lines.join("\n")}${more}`
}

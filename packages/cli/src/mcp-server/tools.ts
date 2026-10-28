import { PermissionMode } from "@opencode/schema/permission-mode"
import { text, type Content, type Tool, type ToolResult } from "./protocol"

/** The slice of SmikCode's backend the MCP server needs. `backend.ts` implements it over the HTTP client. */
export type Message =
  | { readonly type: "idle"; readonly outcome?: string; readonly error?: { readonly message?: string } }
  | {
      readonly type: "assistant"
      readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string; readonly name?: string }>
    }
  | { readonly type: string }

export type BridgeContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }

export interface Backend {
  readonly url: string
  location(directory: string): Promise<{ readonly directory: string; readonly project?: { readonly id: string } }>
  listSessions(input: { directory: string; limit: number }): Promise<
    ReadonlyArray<{
      readonly id: string
      readonly title?: string
      readonly time: { readonly updated: number }
      readonly location: { readonly directory: string }
    }>
  >
  createSession(input: {
    directory: string
    title: string
    agent: string
    model?: { providerID: string; id: string }
    metadata?: Record<string, string>
  }): Promise<{ readonly id: string }>
  prompt(input: { sessionID: string; text: string }): Promise<void>
  /** Newest first. */
  messages(sessionID: string, limit: number): Promise<ReadonlyArray<Message>>
  pendingPermissions(sessionID: string): Promise<ReadonlyArray<{ readonly id: string; readonly action: string }>>
  rejectPermission(input: { sessionID: string; requestID: string; message: string }): Promise<void>
  interrupt(sessionID: string): Promise<void>
  exportMarkdown(sessionID: string, thinking: boolean): Promise<string>
  bridgeTools(directory: string): Promise<
    ReadonlyArray<{
      readonly name: string
      readonly description: string
      readonly inputSchema: Record<string, unknown>
    }>
  >
  bridgeCall(input: {
    directory: string
    sessionID: string
    name: string
    input: Record<string, unknown>
  }): Promise<{ readonly isError: boolean; readonly content: ReadonlyArray<BridgeContent> }>
}

/**
 * Which of SmikCode's own tools the client may use. SmikCode's default permission rules allow every action, so
 * this is the real gate: `safe` is read-only, `edits` adds file changes and memory, `all` adds shell commands,
 * CodeMode and any tool a plugin provides.
 */
export type Tier = "safe" | "edits" | "all"

const SAFE = ["read", "glob", "grep", "webfetch", "websearch", "todo", "skill"]
const EDITS = [...SAFE, "edit", "write", "patch", "memory"]

export const allowed = (tier: Tier, name: string) => tier === "all" || (tier === "edits" ? EDITS : SAFE).includes(name)

export type Options = {
  readonly backend: Backend
  /** Where tools run by default: the folder the client started this server in. */
  readonly directory: string
  /** How much the bridge session may do without asking, which a headless server cannot do. */
  readonly permission: PermissionMode.Mode
  /** Offer SmikCode's own tools to the client as well. */
  readonly bridge: boolean
  /** Which of those tools. */
  readonly tools: Tier
  /** Milliseconds between checks while a delegated task runs. */
  readonly pollInterval?: number
}

const DEFAULT_TIMEOUT_SECONDS = 600
const MAX_TIMEOUT_SECONDS = 1800
const EXPORT_LIMIT = 200_000

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
})

const optionalString = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)

export function createTools(options: Options) {
  const backend = options.backend
  const pollInterval = options.pollInterval ?? 1000
  let bridgeSession: Promise<string> | undefined

  const ensureBridgeSession = () =>
    (bridgeSession ??= backend
      .createSession({
        directory: options.directory,
        title: "MCP bridge",
        agent: "build",
        ...(options.permission === "default"
          ? {}
          : { metadata: PermissionMode.write<string>(undefined, options.permission) }),
      })
      .then((session) => session.id)
      .catch((error: unknown) => {
        bridgeSession = undefined
        throw error
      }))

  // Nothing here can ask a person, so a request that needs approval is declined with a reason the model can act on.
  const declineMessage = (action: string, delegated: boolean) =>
    delegated
      ? `This delegated run cannot ask for approval, so "${action}" was not allowed.`
      : `"${action}" needs approval and this MCP server cannot ask. Restart it with --permission ${
          options.permission === "default" ? "edits (file edits) or --permission auto" : "auto"
        } to allow it.`

  function watchPermissions(sessionID: string, delegated: boolean) {
    const handled = new Set<string>()
    let stopped = false
    let running = Promise.resolve()
    const tick = () => {
      running = running.then(async () => {
        if (stopped) return
        const pending = await backend.pendingPermissions(sessionID).catch(() => [])
        await Promise.all(
          pending
            .filter((request) => !handled.has(request.id))
            .map((request) => {
              handled.add(request.id)
              return backend
                .rejectPermission({
                  sessionID,
                  requestID: request.id,
                  message: declineMessage(request.action, delegated),
                })
                .catch(() => undefined)
            }),
        )
      })
    }
    const timer = setInterval(tick, Math.min(400, pollInterval))
    return async () => {
      stopped = true
      clearInterval(timer)
      await running
    }
  }

  const status: Tool = {
    name: "status",
    description:
      "Show which SmikCode backend and folder this server is connected to, its permission setting and the bridged tools.",
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    call: async () => {
      const location = await backend.location(options.directory)
      const tools = options.bridge ? await backend.bridgeTools(options.directory).catch(() => []) : []
      return text(
        [
          "SmikCode MCP server",
          `Backend: ${backend.url}`,
          `Folder: ${location.directory}${location.project ? ` (project ${location.project.id})` : ""}`,
          `Permission for bridged tools: ${options.permission}`,
          options.bridge
            ? `Bridged tools (${options.tools}): ${tools.filter((tool) => allowed(options.tools, tool.name)).length}`
            : "Bridged tools: off",
        ].join("\n"),
      )
    },
  }

  const sessionsList: Tool = {
    name: "sessions_list",
    description: "List recent SmikCode sessions for a folder, newest first, with their ids.",
    inputSchema: object({
      limit: { type: "number", description: "How many sessions to list (1 to 50, default 20)" },
      directory: { type: "string", description: "Folder to list sessions for. Defaults to the server's folder." },
    }),
    annotations: { readOnlyHint: true },
    call: async (args) => {
      const limit = typeof args.limit === "number" ? Math.min(50, Math.max(1, Math.floor(args.limit))) : 20
      const sessions = await backend.listSessions({
        directory: optionalString(args.directory) ?? options.directory,
        limit,
      })
      if (sessions.length === 0) return text("No sessions found.")
      return text(
        sessions
          .map(
            (session) =>
              `${session.id} | ${new Date(session.time.updated).toISOString()} | ${session.title ?? "(untitled)"}`,
          )
          .join("\n"),
      )
    },
  }

  const sessionExport: Tool = {
    name: "session_export",
    description: "Read a SmikCode session as Markdown: the prompts, answers, tool calls and shell output.",
    inputSchema: object(
      {
        sessionID: { type: "string", description: "Session id, from sessions_list" },
        include_thinking: { type: "boolean", description: "Include the model's reasoning (default false)" },
      },
      ["sessionID"],
    ),
    annotations: { readOnlyHint: true },
    call: async (args) => {
      const sessionID = optionalString(args.sessionID)
      if (!sessionID) return text("sessionID is required.", true)
      const markdown = await backend.exportMarkdown(sessionID, args.include_thinking === true)
      return text(
        markdown.length > EXPORT_LIMIT
          ? `${markdown.slice(0, EXPORT_LIMIT)}\n\n[Truncated: the session is ${markdown.length} characters long.]`
          : markdown,
      )
    },
  }

  const delegate: Tool = {
    name: "delegate_task",
    description:
      "Hand a self-contained task to a SmikCode agent, which can run on any model you have connected in SmikCode (including free ones), and get its answer back. By default the agent can only read; set allow_edits to let it edit files. It cannot run shell commands.",
    inputSchema: object(
      {
        task: { type: "string", description: "What to do, with all the context the agent needs" },
        model: { type: "string", description: 'Model as "provider/model". Defaults to the model SmikCode uses.' },
        allow_edits: { type: "boolean", description: "Let the agent edit files in the folder (default false)" },
        directory: { type: "string", description: "Folder to work in. Defaults to the server's folder." },
        timeout_seconds: {
          type: "number",
          description: `Give up after this long (default ${DEFAULT_TIMEOUT_SECONDS}, max ${MAX_TIMEOUT_SECONDS})`,
        },
      },
      ["task"],
    ),
    annotations: { destructiveHint: true },
    call: async (args, signal) => {
      const task = optionalString(args.task)
      if (!task) return text("task is required.", true)
      const modelText = optionalString(args.model)
      const separator = modelText?.indexOf("/") ?? -1
      if (modelText && (separator < 1 || separator === modelText.length - 1))
        return text('model must look like "provider/model".', true)
      const model = modelText
        ? { providerID: modelText.slice(0, separator), id: modelText.slice(separator + 1) }
        : undefined
      const allowEdits = args.allow_edits === true
      const seconds = typeof args.timeout_seconds === "number" ? args.timeout_seconds : DEFAULT_TIMEOUT_SECONDS
      const timeout = Math.min(MAX_TIMEOUT_SECONDS, Math.max(10, seconds)) * 1000

      const session = await backend.createSession({
        directory: optionalString(args.directory) ?? options.directory,
        title: `Delegated: ${task.slice(0, 60)}`,
        agent: allowEdits ? "build" : "plan",
        ...(model ? { model } : {}),
        ...(allowEdits ? { metadata: PermissionMode.write<string>(undefined, "edits") } : {}),
      })
      const stop = watchPermissions(session.id, true)
      const started = Date.now()
      try {
        await backend.prompt({ sessionID: session.id, text: task })
        for (;;) {
          if (signal.aborted) {
            await backend.interrupt(session.id).catch(() => undefined)
            return text("Cancelled.", true)
          }
          if (Date.now() - started > timeout) {
            await backend.interrupt(session.id).catch(() => undefined)
            return text(
              `The task did not finish within ${Math.round(timeout / 1000)} seconds and was stopped. Session ${session.id}.`,
              true,
            )
          }
          await new Promise((resolve) => setTimeout(resolve, pollInterval))
          const recent = await backend.messages(session.id, 100)
          if (recent.some((message) => message.type === "idle")) return summarize(session.id, recent)
        }
      } finally {
        await stop()
      }
    },
  }

  return {
    async list(): Promise<readonly Tool[]> {
      const curated = [status, sessionsList, sessionExport, delegate]
      if (!options.bridge) return curated
      const taken = new Set(curated.map((tool) => tool.name))
      // A bridge that cannot reach the backend still leaves the curated tools usable.
      const bridged = await backend.bridgeTools(options.directory).catch(() => [])
      return [
        ...curated,
        ...bridged
          .filter((tool) => !taken.has(tool.name) && allowed(options.tools, tool.name))
          .map(
            (tool): Tool => ({
              name: tool.name,
              description: tool.description,
              inputSchema: { type: "object", ...tool.inputSchema },
              call: async (args, signal) => {
                const sessionID = await ensureBridgeSession()
                const stop = watchPermissions(sessionID, false)
                try {
                  const call = backend.bridgeCall({
                    directory: options.directory,
                    sessionID,
                    name: tool.name,
                    input: args,
                  })
                  const aborted = new Promise<never>((_, reject) =>
                    signal.addEventListener("abort", () => reject(new Error("Cancelled."))),
                  )
                  return toResult(await Promise.race([call, aborted]))
                } finally {
                  await stop()
                }
              },
            }),
          ),
      ]
    },
  }
}

function toResult(result: { readonly isError: boolean; readonly content: ReadonlyArray<BridgeContent> }): ToolResult {
  const content = result.content.flatMap((item): Content[] => {
    if (item.type === "text") return [{ type: "text", text: item.text }]
    const image = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(item.uri)
    if (image) return [{ type: "image", data: image[2], mimeType: image[1] }]
    return [{ type: "text", text: `[file${item.name ? ` ${item.name}` : ""}: ${item.mime}] ${item.uri.slice(0, 200)}` }]
  })
  return {
    content: content.length ? content : [{ type: "text", text: "(no output)" }],
    ...(result.isError ? { isError: true } : {}),
  }
}

function summarize(sessionID: string, newestFirst: ReadonlyArray<Message>): ToolResult {
  const idle = newestFirst.find((message) => message.type === "idle")
  const chronological = newestFirst.toReversed()
  const answers = chronological.flatMap((message) =>
    message.type === "assistant" && "content" in message
      ? [
          message.content
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text ?? "")
            .join("\n"),
        ]
      : [],
  )
  const finalAnswer = answers.findLast((answer) => answer.trim() !== "")
  const counts = new Map<string, number>()
  chronological.forEach((message) => {
    if (message.type !== "assistant" || !("content" in message)) return
    message.content.forEach((part) => {
      if (part.type === "tool" && part.name) counts.set(part.name, (counts.get(part.name) ?? 0) + 1)
    })
  })
  const used = Array.from(counts, ([name, count]) => `${name} x${count}`).join(", ")
  const failed = idle && "outcome" in idle && idle.outcome === "failed"
  const reason = idle && "error" in idle ? idle.error?.message : undefined
  const lines = [
    failed ? `The delegated task failed${reason ? `: ${reason}` : "."}` : "The delegated task finished.",
    ...(finalAnswer ? ["", finalAnswer.trim()] : []),
    "",
    `Session: ${sessionID}${used ? ` | Tools used: ${used}` : ""}`,
  ]
  return text(lines.join("\n"), failed || undefined)
}

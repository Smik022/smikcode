/**
 * A small MCP server for tools over newline-delimited JSON-RPC (the stdio transport). It implements only what a
 * tools server needs: initialize, ping, tools/list, tools/call and cancellation.
 */

export type Content =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }

export type ToolResult = { readonly content: readonly Content[]; readonly isError?: boolean }

export type Annotations = {
  readonly readOnlyHint?: boolean
  readonly destructiveHint?: boolean
  readonly openWorldHint?: boolean
}

export type Tool = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations?: Annotations
  /** `signal` aborts when the client cancels the request. */
  readonly call: (args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolResult>
}

export type ServerOptions = {
  readonly name: string
  readonly version: string
  readonly instructions?: string
  /** Read on every list and call, so a server whose tools change never serves a stale list. */
  readonly tools: () => Promise<readonly Tool[]> | readonly Tool[]
}

export const text = (value: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError } : {}),
})

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

const DEFAULT_PROTOCOL = "2025-06-18"

type Id = string | number

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is Id => typeof value === "string" || typeof value === "number"

const failure = (id: Id | null, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } })

export function createServer(options: ServerOptions) {
  const running = new Map<Id, AbortController>()

  async function request(id: Id, method: string, params: Record<string, unknown>) {
    if (method === "initialize") {
      const requested = params.protocolVersion
      return {
        jsonrpc: "2.0",
        id,
        result: {
          // Tool listing and calling are the same across published versions, so the client's version is echoed.
          protocolVersion:
            typeof requested === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: options.name, version: options.version },
          ...(options.instructions ? { instructions: options.instructions } : {}),
        },
      }
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} }
    if (method === "tools/list") {
      const tools = await options.tools()
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })),
        },
      }
    }
    if (method === "tools/call") {
      const name = params.name
      if (typeof name !== "string") return failure(id, INVALID_PARAMS, "tools/call needs a tool name")
      const args = params.arguments === undefined ? {} : params.arguments
      if (!isRecord(args)) return failure(id, INVALID_PARAMS, "Tool arguments must be an object")
      const tool = (await options.tools()).find((item) => item.name === name)
      if (!tool) return failure(id, INVALID_PARAMS, `Unknown tool: ${name}`)
      const controller = new AbortController()
      running.set(id, controller)
      try {
        const result = await tool.call(args, controller.signal)
        // A cancelled request gets no response.
        if (controller.signal.aborted) return undefined
        return { jsonrpc: "2.0", id, result }
      } catch (error) {
        if (controller.signal.aborted) return undefined
        // A tool that throws is reported to the model as a failed call, not as a broken server.
        return {
          jsonrpc: "2.0",
          id,
          result: text(error instanceof Error ? error.message : String(error), true),
        }
      } finally {
        running.delete(id)
      }
    }
    return failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`)
  }

  function notification(method: string, params: Record<string, unknown>) {
    if (method === "notifications/cancelled" && isId(params.requestId)) running.get(params.requestId)?.abort()
  }

  async function one(message: unknown) {
    if (!isRecord(message) || typeof message.method !== "string")
      return isRecord(message) && isId(message.id) && "result" in message
        ? undefined // A response to a request we never send.
        : failure(null, INVALID_REQUEST, "Invalid request")
    const params = isRecord(message.params) ? message.params : {}
    if (!isId(message.id)) return notification(message.method, params)
    try {
      return await request(message.id, message.method, params)
    } catch (error) {
      return failure(message.id, INTERNAL_ERROR, error instanceof Error ? error.message : String(error))
    }
  }

  return {
    /** Handles one parsed message (or a batch). Resolves to the response to send, if there is one. */
    async handle(message: unknown): Promise<unknown> {
      if (!Array.isArray(message)) return one(message)
      const responses = (await Promise.all(message.map(one))).filter((item) => item !== undefined)
      return responses.length === 0 ? undefined : responses
    },
    /** Handles one line of input: parse errors become a response, blank lines are ignored. */
    async handleLine(line: string): Promise<unknown> {
      if (line.trim() === "") return undefined
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return failure(null, PARSE_ERROR, "Parse error")
      }
      return this.handle(parsed)
    },
    /** Aborts every running call, for when the transport closes. */
    abortAll() {
      running.forEach((controller) => controller.abort())
    },
  }
}

/** Runs a server over a stream of input chunks. `write` gets one JSON message per call and must add the newline. */
export async function serveLines(
  server: ReturnType<typeof createServer>,
  input: AsyncIterable<string | Uint8Array>,
  write: (line: string) => void,
) {
  const decoder = new TextDecoder()
  const pending = new Set<Promise<void>>()
  const dispatch = (line: string) => {
    const task = server.handleLine(line).then((response) => {
      if (response !== undefined) write(JSON.stringify(response) + "\n")
    })
    const tracked = task.finally(() => pending.delete(tracked))
    pending.add(tracked)
  }
  let buffer = ""
  for await (const chunk of input) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    lines.forEach(dispatch)
  }
  if (buffer.trim() !== "") dispatch(buffer)
  // The client hung up: stop work it can no longer see, then let the last responses drain.
  server.abortAll()
  await Promise.all(pending)
}

import { describe, expect, test } from "bun:test"
import { createServer, serveLines, text, type Tool } from "../../src/mcp-server/protocol"

const echo: Tool = {
  name: "echo",
  description: "Echoes its text",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  annotations: { readOnlyHint: true },
  call: async (args) => text(`echo: ${String(args.text)}`),
}

const boom: Tool = {
  name: "boom",
  description: "Always throws",
  inputSchema: { type: "object" },
  call: async () => {
    throw new Error("kaput")
  },
}

const server = (tools: readonly Tool[] = [echo, boom]) =>
  createServer({ name: "smikcode", version: "9.9.9", instructions: "Use me.", tools: () => tools })

const rpc = (id: number, method: string, params?: unknown) => ({ jsonrpc: "2.0", id, method, params })

describe("MCP server protocol", () => {
  test("answers initialize with the client's protocol version and its own identity", async () => {
    const response = await server().handle(rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {} }))
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "smikcode", version: "9.9.9" },
        instructions: "Use me.",
      },
    })
  })

  test("falls back to a known protocol version when the client sends none", async () => {
    const response = await server().handle(rpc(1, "initialize", {}))
    expect(response).toMatchObject({ result: { protocolVersion: "2025-06-18" } })
  })

  test("lists tools with their schemas and hints", async () => {
    const response = await server().handle(rpc(2, "tools/list"))
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echoes its text",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
            annotations: { readOnlyHint: true },
          },
          { name: "boom", description: "Always throws", inputSchema: { type: "object" } },
        ],
      },
    })
  })

  test("reads the tool list again on every request", async () => {
    let tools: readonly Tool[] = [echo]
    const live = createServer({ name: "x", version: "1", tools: () => tools })
    expect(await live.handle(rpc(1, "tools/list"))).toMatchObject({ result: { tools: [{ name: "echo" }] } })
    tools = [echo, boom]
    expect(await live.handle(rpc(2, "tools/list"))).toMatchObject({
      result: { tools: [{ name: "echo" }, { name: "boom" }] },
    })
  })

  test("calls a tool and returns its content", async () => {
    const response = await server().handle(rpc(3, "tools/call", { name: "echo", arguments: { text: "hi" } }))
    expect(response).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "echo: hi" }] } })
  })

  test("reports a throwing tool as a failed call the model can read", async () => {
    const response = await server().handle(rpc(4, "tools/call", { name: "boom" }))
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: { content: [{ type: "text", text: "kaput" }], isError: true },
    })
  })

  test("rejects an unknown tool, a missing name and non-object arguments", async () => {
    expect(await server().handle(rpc(5, "tools/call", { name: "nope" }))).toMatchObject({ error: { code: -32602 } })
    expect(await server().handle(rpc(6, "tools/call", {}))).toMatchObject({ error: { code: -32602 } })
    expect(await server().handle(rpc(7, "tools/call", { name: "echo", arguments: [1] }))).toMatchObject({
      error: { code: -32602 },
    })
  })

  test("answers ping and refuses unknown methods", async () => {
    expect(await server().handle(rpc(8, "ping"))).toEqual({ jsonrpc: "2.0", id: 8, result: {} })
    expect(await server().handle(rpc(9, "resources/list"))).toMatchObject({ error: { code: -32601 } })
  })

  test("never answers a notification", async () => {
    const s = server()
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined()
    expect(await s.handle({ jsonrpc: "2.0", method: "anything/else" })).toBeUndefined()
  })

  test("reports malformed JSON and invalid requests", async () => {
    expect(await server().handleLine("{nope")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    })
    expect(await server().handle({ jsonrpc: "2.0", id: 1 })).toMatchObject({ error: { code: -32600 } })
    expect(await server().handleLine("   ")).toBeUndefined()
  })

  test("answers every request in a batch and skips the notifications", async () => {
    const response = await server().handle([
      rpc(1, "ping"),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      rpc(2, "ping"),
    ])
    expect(response).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
    ])
  })

  test("aborts a running call when the client cancels it and sends no response for it", async () => {
    let seen: AbortSignal | undefined
    const slow: Tool = {
      name: "slow",
      description: "Waits for cancellation",
      inputSchema: { type: "object" },
      call: (_args, signal) =>
        new Promise((resolve) => {
          seen = signal
          signal.addEventListener("abort", () => resolve(text("stopped")))
        }),
    }
    const s = server([slow])
    const pending = s.handle(rpc(10, "tools/call", { name: "slow" }))
    await Bun.sleep(5)
    await s.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 10 } })
    expect(await pending).toBeUndefined()
    expect(seen?.aborted).toBe(true)
  })
})

describe("MCP stdio loop", () => {
  const run = async (chunks: string[], tools: readonly Tool[] = [echo]) => {
    const written: string[] = []
    await serveLines(
      server(tools),
      (async function* () {
        yield* chunks
      })(),
      (line) => written.push(line),
    )
    return written
  }

  test("handles messages split across chunks and writes one line per response", async () => {
    const message = JSON.stringify(rpc(1, "ping"))
    const written = await run([message.slice(0, 10), message.slice(10) + "\n", JSON.stringify(rpc(2, "ping")) + "\n"])
    expect(written.map((line) => JSON.parse(line).id).toSorted()).toEqual([1, 2])
    expect(written.every((line) => line.endsWith("\n") && line.indexOf("\n") === line.length - 1)).toBe(true)
  })

  test("handles a final message that has no trailing newline", async () => {
    const written = await run([JSON.stringify(rpc(1, "ping"))])
    expect(written).toHaveLength(1)
  })

  test("answers a parse error without stopping the loop", async () => {
    const written = await run(["not json\n", JSON.stringify(rpc(2, "ping")) + "\n"])
    expect(written.map((line) => JSON.parse(line).error?.code ?? JSON.parse(line).id)).toEqual([-32700, 2])
  })
})

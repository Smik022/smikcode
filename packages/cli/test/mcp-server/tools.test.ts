import { describe, expect, setSystemTime, test } from "bun:test"
import type { Backend, BridgeContent, Message } from "../../src/mcp-server/tools"
import { allowed, createTools } from "../../src/mcp-server/tools"
import type { Tool } from "../../src/mcp-server/protocol"

type Calls = {
  created: Array<Parameters<Backend["createSession"]>[0]>
  prompts: string[]
  bridged: Array<{ name: string; input: Record<string, unknown>; sessionID: string }>
  rejected: Array<{ requestID: string; message: string }>
  interrupted: string[]
}

/** A backend that records what it was asked and answers from the fields below. */
function fake(
  overrides: Partial<{
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
    toolsFail: boolean
    messages: ReadonlyArray<Message>
    pending: Array<{ id: string; action: string }>
    result: { isError: boolean; content: ReadonlyArray<BridgeContent> }
    bridgeDelay: number
  }> = {},
) {
  const calls: Calls = { created: [], prompts: [], bridged: [], rejected: [], interrupted: [] }
  let sessions = 0
  const backend: Backend = {
    url: "http://127.0.0.1:1",
    location: async (directory) => ({ directory, project: { id: "prj_1" } }),
    listSessions: async () => [
      { id: "ses_a", title: "Fix tests", time: { updated: 0 }, location: { directory: "/p" } },
      { id: "ses_b", time: { updated: 1000 }, location: { directory: "/p" } },
    ],
    createSession: async (input) => {
      calls.created.push(input)
      return { id: `ses_new${++sessions}` }
    },
    prompt: async (input) => void calls.prompts.push(input.text),
    messages: async () => overrides.messages ?? [{ type: "idle", outcome: "succeeded" }],
    pendingPermissions: async () => overrides.pending ?? [],
    rejectPermission: async (input) => void calls.rejected.push({ requestID: input.requestID, message: input.message }),
    interrupt: async (sessionID) => void calls.interrupted.push(sessionID),
    exportMarkdown: async () => "x".repeat(250_000),
    bridgeTools: async () => {
      if (overrides.toolsFail) throw new Error("backend down")
      return overrides.tools ?? []
    },
    bridgeCall: async (input) => {
      calls.bridged.push({ name: input.name, input: input.input, sessionID: input.sessionID })
      if (overrides.bridgeDelay) await Bun.sleep(overrides.bridgeDelay)
      return overrides.result ?? { isError: false, content: [{ type: "text", text: "ok" }] }
    },
  }
  return { backend, calls }
}

const options = (backend: Backend, extra: Partial<Parameters<typeof createTools>[0]> = {}) => ({
  backend,
  directory: "/work",
  permission: "default" as const,
  bridge: true,
  tools: "all" as const,
  pollInterval: 5,
  ...extra,
})

const named = (tools: readonly Tool[], name: string) => {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`no tool ${name}`)
  return tool
}

const run = (tool: Tool, args: Record<string, unknown> = {}, signal = new AbortController().signal) =>
  tool.call(args, signal)

const textOf = (result: Awaited<ReturnType<Tool["call"]>>) =>
  result.content.map((item) => (item.type === "text" ? item.text : `<${item.type}>`)).join("\n")

describe("MCP tools: listing", () => {
  test("offers the curated tools plus every bridged tool, with an object schema", async () => {
    const { backend } = fake({
      tools: [
        { name: "read", description: "Read a file", inputSchema: { properties: { path: { type: "string" } } } },
        { name: "status", description: "Collides with a curated tool", inputSchema: {} },
      ],
    })
    const tools = await createTools(options(backend)).list()
    expect(tools.map((tool) => tool.name)).toEqual([
      "status",
      "sessions_list",
      "session_export",
      "delegate_task",
      "read",
    ])
    expect(named(tools, "read").inputSchema).toEqual({ type: "object", properties: { path: { type: "string" } } })
  })

  test("leaves out bridged tools when the bridge is off or the backend cannot list them", async () => {
    const off = fake({ tools: [{ name: "read", description: "", inputSchema: {} }] })
    expect((await createTools(options(off.backend, { bridge: false })).list()).map((tool) => tool.name)).not.toContain(
      "read",
    )
    const down = fake({ toolsFail: true })
    expect(await createTools(options(down.backend)).list()).toHaveLength(4)
  })
})

describe("MCP tools: tiers", () => {
  test("safe is read-only, edits adds file changes and memory, all adds the rest", () => {
    const names = ["read", "grep", "edit", "write", "memory", "shell", "execute", "plugin_tool"]
    const offered = (tier: "safe" | "edits" | "all") => names.filter((name) => allowed(tier, name))
    expect(offered("safe")).toEqual(["read", "grep"])
    expect(offered("edits")).toEqual(["read", "grep", "edit", "write", "memory"])
    expect(offered("all")).toEqual(names)
  })

  test("a tier hides the tools above it from the list and from status", async () => {
    const tools = ["read", "write", "shell"].map((name) => ({ name, description: "", inputSchema: {} }))
    const { backend } = fake({ tools })
    const safe = createTools(options(backend, { tools: "safe" }))
    expect((await safe.list()).map((tool) => tool.name)).toEqual([
      "status",
      "sessions_list",
      "session_export",
      "delegate_task",
      "read",
    ])
    expect(textOf(await run(named(await safe.list(), "status")))).toContain("Bridged tools (safe): 1")
    const edits = createTools(options(backend, { tools: "edits" }))
    expect((await edits.list()).map((tool) => tool.name)).toContain("write")
    expect((await edits.list()).map((tool) => tool.name)).not.toContain("shell")
  })
})

describe("MCP tools: curated tools", () => {
  test("status reports the backend, folder and permission", async () => {
    const { backend } = fake({ tools: [{ name: "read", description: "", inputSchema: {} }] })
    const tools = await createTools(options(backend, { permission: "edits" })).list()
    const result = textOf(await run(named(tools, "status")))
    expect(result).toContain("Backend: http://127.0.0.1:1")
    expect(result).toContain("project prj_1")
    expect(result).toContain("Permission for bridged tools: edits")
    expect(result).toContain("Bridged tools (all): 1")
  })

  test("sessions_list prints one line per session", async () => {
    const { backend } = fake()
    const result = textOf(await run(named(await createTools(options(backend)).list(), "sessions_list")))
    expect(result.split("\n")).toEqual([
      "ses_a | 1970-01-01T00:00:00.000Z | Fix tests",
      "ses_b | 1970-01-01T00:00:01.000Z | (untitled)",
    ])
  })

  test("session_export truncates very long sessions and needs a session id", async () => {
    const { backend } = fake()
    const tool = named(await createTools(options(backend)).list(), "session_export")
    const long = textOf(await run(tool, { sessionID: "ses_a" }))
    expect(long).toContain("[Truncated: the session is 250000 characters long.]")
    expect((await run(tool, {})).isError).toBe(true)
  })
})

describe("MCP tools: bridged calls", () => {
  const read = { name: "read", description: "Read a file", inputSchema: {} }

  test("runs a tool in one shared bridge session created with the chosen permission", async () => {
    const { backend, calls } = fake({ tools: [read] })
    const tools = await createTools(options(backend, { permission: "edits" })).list()
    await run(named(tools, "read"), { path: "a.ts" })
    await run(named(tools, "read"), { path: "b.ts" })
    expect(calls.created).toEqual([
      { directory: "/work", title: "MCP bridge", agent: "build", metadata: { permission_mode: "edits" } },
    ])
    expect(calls.bridged.map((call) => [call.name, call.input, call.sessionID])).toEqual([
      ["read", { path: "a.ts" }, "ses_new1"],
      ["read", { path: "b.ts" }, "ses_new1"],
    ])
  })

  test("creates the bridge session without metadata when asking is the permission", async () => {
    const { backend, calls } = fake({ tools: [read] })
    await run(named(await createTools(options(backend)).list(), "read"))
    expect(calls.created[0]).toEqual({ directory: "/work", title: "MCP bridge", agent: "build" })
  })

  test("returns text, inlines images and marks failures", async () => {
    const png = "data:image/png;base64,AAAA"
    const { backend } = fake({
      tools: [read],
      result: {
        isError: true,
        content: [
          { type: "text", text: "boom" },
          { type: "file", uri: png, mime: "image/png" },
          { type: "file", uri: "file:///x.pdf", mime: "application/pdf", name: "x.pdf" },
        ],
      },
    })
    const result = await run(named(await createTools(options(backend)).list(), "read"))
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: "text", text: "boom" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "text", text: "[file x.pdf: application/pdf] file:///x.pdf" },
    ])
  })

  test("declines a request that needs approval and says how to allow it", async () => {
    const { backend, calls } = fake({
      tools: [read],
      bridgeDelay: 60,
      pending: [{ id: "perm_1", action: "shell" }],
    })
    await run(named(await createTools(options(backend)).list(), "read"))
    expect(calls.rejected).toHaveLength(1)
    expect(calls.rejected[0]?.message).toContain('"shell" needs approval')
    expect(calls.rejected[0]?.message).toContain("--permission edits")
  })
})

describe("MCP tools: delegate_task", () => {
  const finished: Message[] = [
    { type: "idle", outcome: "succeeded" },
    { type: "assistant", content: [{ type: "text", text: "The answer is 42." }] },
    {
      type: "assistant",
      content: [
        { type: "tool", name: "read" },
        { type: "tool", name: "read" },
        { type: "tool", name: "grep" },
      ],
    },
  ]

  test("runs a read-only plan agent by default and returns its answer with the tools it used", async () => {
    const { backend, calls } = fake({ messages: finished })
    const delegate = named(await createTools(options(backend)).list(), "delegate_task")
    const result = await run(delegate, { task: "What is the answer?", model: "google/gemini-3.1-flash-lite" })
    expect(calls.created).toEqual([
      {
        directory: "/work",
        title: "Delegated: What is the answer?",
        agent: "plan",
        model: { providerID: "google", id: "gemini-3.1-flash-lite" },
      },
    ])
    expect(calls.prompts).toEqual(["What is the answer?"])
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toContain("The delegated task finished.")
    expect(textOf(result)).toContain("The answer is 42.")
    expect(textOf(result)).toContain("Tools used: read x2, grep x1")
  })

  test("lets the build agent edit files only when asked", async () => {
    const { backend, calls } = fake({ messages: finished })
    await run(named(await createTools(options(backend)).list(), "delegate_task"), { task: "Fix it", allow_edits: true })
    expect(calls.created[0]).toMatchObject({ agent: "build", metadata: { permission_mode: "edits" } })
  })

  test("reports a failed run as an error", async () => {
    const { backend } = fake({ messages: [{ type: "idle", outcome: "failed", error: { message: "quota exceeded" } }] })
    const result = await run(named(await createTools(options(backend)).list(), "delegate_task"), { task: "x" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("The delegated task failed: quota exceeded")
  })

  test("declines approval requests from the delegated agent", async () => {
    const { backend, calls } = fake({ messages: finished, pending: [{ id: "perm_9", action: "shell" }] })
    await run(named(await createTools(options(backend, { pollInterval: 30 })).list(), "delegate_task"), { task: "x" })
    expect(calls.rejected[0]?.message).toBe('This delegated run cannot ask for approval, so "shell" was not allowed.')
  })

  test("validates its input", async () => {
    const { backend, calls } = fake()
    const delegate = named(await createTools(options(backend)).list(), "delegate_task")
    expect((await run(delegate, {})).isError).toBe(true)
    expect(textOf(await run(delegate, { task: "x", model: "nonsense" }))).toContain('"provider/model"')
    expect(calls.created).toHaveLength(0)
  })

  test("stops the run when the client cancels", async () => {
    const { backend, calls } = fake({ messages: [{ type: "assistant", content: [] }] })
    const delegate = named(await createTools(options(backend)).list(), "delegate_task")
    const controller = new AbortController()
    const pending = run(delegate, { task: "x" }, controller.signal)
    await Bun.sleep(20)
    controller.abort()
    expect(textOf(await pending)).toBe("Cancelled.")
    expect(calls.interrupted).toEqual(["ses_new1"])
  })

  test("stops the run when it takes longer than the timeout", async () => {
    const { backend, calls } = fake({ messages: [{ type: "assistant", content: [] }] })
    const delegate = named(await createTools(options(backend)).list(), "delegate_task")
    // The shortest allowed timeout is ten seconds, so the clock is moved instead of waited out.
    const start = Date.now()
    try {
      const pending = run(delegate, { task: "x", timeout_seconds: 1 })
      await Bun.sleep(20)
      setSystemTime(new Date(start + 11_000))
      const result = await pending
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain("did not finish within 10 seconds")
      expect(calls.interrupted).toEqual(["ses_new1"])
    } finally {
      setSystemTime()
    }
  })
})

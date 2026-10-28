import { describe, expect, test } from "bun:test"
import { claudeArgs, mcpConfig, needsShell, quoteForCmd, serverArgs } from "../../src/mcp-server/launch"

describe("starting Claude Code with SmikCode attached", () => {
  test("builds the command that runs this SmikCode as an MCP server", () => {
    const server = serverArgs({
      self: ["C:/Apps/smikcode.exe"],
      directory: "C:/Work/app",
      tools: "edits",
      permission: "auto",
    })
    expect(server).toEqual({
      command: "C:/Apps/smikcode.exe",
      args: ["mcp", "serve", "--directory", "C:/Work/app", "--tools", "edits", "--permission", "auto"],
    })
  })

  test("keeps the interpreter and script when SmikCode runs from source, and passes a remote server on", () => {
    const server = serverArgs({
      self: ["bun", "src/index.ts"],
      directory: "/w",
      tools: "safe",
      permission: "default",
      server: "http://127.0.0.1:4096",
    })
    expect(server.command).toBe("bun")
    expect(server.args.slice(0, 3)).toEqual(["src/index.ts", "mcp", "serve"])
    expect(server.args.slice(-2)).toEqual(["--server", "http://127.0.0.1:4096"])
  })

  test("refuses to build a command with nothing to run", () => {
    expect(() => serverArgs({ self: [], directory: "/w", tools: "safe", permission: "default" })).toThrow()
  })

  test("describes the server in the shape Claude Code's --mcp-config reads", () => {
    expect(mcpConfig({ command: "smikcode", args: ["mcp", "serve"] })).toEqual({
      mcpServers: { smikcode: { command: "smikcode", args: ["mcp", "serve"] } },
    })
  })

  test("puts its config first and leaves the user's own arguments untouched", () => {
    expect(claudeArgs("/tmp/mcp.json", ["--model", "opus", "fix the bug"])).toEqual([
      "--mcp-config",
      "/tmp/mcp.json",
      "--model",
      "opus",
      "fix the bug",
    ])
  })

  test("uses a shell only for Windows script shims", () => {
    expect(needsShell("C:\\bin\\claude.cmd", "win32")).toBe(true)
    expect(needsShell("C:\\bin\\claude.BAT", "win32")).toBe(true)
    expect(needsShell("C:\\bin\\claude.exe", "win32")).toBe(false)
    expect(needsShell("/usr/local/bin/claude", "linux")).toBe(false)
    expect(needsShell("/x/claude.cmd", "darwin")).toBe(false)
  })

  test("quotes arguments for cmd.exe", () => {
    expect(quoteForCmd("C:\\My Files\\mcp.json")).toBe('"C:\\My Files\\mcp.json"')
    expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""')
  })
})

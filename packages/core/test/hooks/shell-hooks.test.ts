import { describe, expect, test } from "bun:test"
import { ShellHooks } from "../../src/hooks/shell-hooks"

const result = (exitCode: number, stdout = "", stderr = "") => ({ exitCode, stdout, stderr })

describe("ShellHooks.matches", () => {
  test("matches everything without a matcher", () => {
    expect(ShellHooks.matches(undefined, "shell")).toBe(true)
    expect(ShellHooks.matches("", "shell")).toBe(true)
    expect(ShellHooks.matches("*", "shell")).toBe(true)
  })

  test("accepts SmikCode tool ids and Claude Code names", () => {
    expect(ShellHooks.matches("shell", "shell")).toBe(true)
    expect(ShellHooks.matches("Bash", "shell")).toBe(true)
    expect(ShellHooks.matches("Edit|Write", "write")).toBe(true)
    expect(ShellHooks.matches("Edit|Write", "read")).toBe(false)
  })

  test("anchors the expression so a short name does not match a longer tool", () => {
    expect(ShellHooks.matches("edit", "multiedit")).toBe(false)
  })

  test("compares literally when the expression is invalid", () => {
    expect(ShellHooks.matches("mcp_(", "mcp_(")).toBe(true)
    expect(ShellHooks.matches("mcp_(", "shell")).toBe(false)
  })
})

describe("ShellHooks.outcome", () => {
  test("exit 2 blocks with stderr, falling back to stdout", () => {
    expect(ShellHooks.outcome(result(2, "", "no force pushes\n"))).toEqual({ type: "block", reason: "no force pushes" })
    expect(ShellHooks.outcome(result(2, "stdout reason"))).toEqual({ type: "block", reason: "stdout reason" })
    expect(ShellHooks.outcome(result(2))).toEqual({ type: "block", reason: "Blocked by hook" })
  })

  test("other failures do not block", () => {
    expect(ShellHooks.outcome(result(1, "", "boom"))).toEqual({ type: "continue" })
  })

  test("plain stdout is output, not structured context", () => {
    expect(ShellHooks.outcome(result(0, "formatted\n"))).toEqual({ type: "continue", output: "formatted" })
  })

  test("reads JSON decisions", () => {
    expect(ShellHooks.outcome(result(0, JSON.stringify({ decision: "block", reason: "tests fail" })))).toEqual({
      type: "block",
      reason: "tests fail",
    })
    expect(
      ShellHooks.outcome(
        result(
          0,
          JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "nope" } }),
        ),
      ),
    ).toEqual({ type: "block", reason: "nope" })
    expect(ShellHooks.outcome(result(0, JSON.stringify({ continue: false, stopReason: "halt" })))).toEqual({
      type: "block",
      reason: "halt",
    })
  })

  test("reads additional context from either JSON shape", () => {
    expect(ShellHooks.outcome(result(0, JSON.stringify({ additionalContext: "a" })))).toEqual({
      type: "continue",
      context: "a",
    })
    expect(ShellHooks.outcome(result(0, JSON.stringify({ hookSpecificOutput: { additionalContext: "b" } })))).toEqual({
      type: "continue",
      context: "b",
    })
  })

  test("treats malformed JSON as plain output", () => {
    expect(ShellHooks.outcome(result(0, "{not json"))).toEqual({ type: "continue", output: "{not json" })
  })
})

describe("ShellHooks.select", () => {
  const entries = [
    { matcher: "shell", hooks: [{ command: "a" }, { command: "b", timeout: 5 }] },
    { matcher: "Edit", hooks: [{ command: "c" }] },
    { hooks: [{ command: "a" }] },
  ]

  test("filters by tool and runs a repeated command once", () => {
    expect(ShellHooks.select(entries, "shell").map((hook) => hook.command)).toEqual(["a", "b"])
    expect(ShellHooks.select(entries, "edit").map((hook) => hook.command)).toEqual(["c", "a"])
  })

  test("ignores matchers for events that have no tool", () => {
    expect(ShellHooks.select(entries, undefined).map((hook) => hook.command)).toEqual(["a", "b", "c"])
  })
})

describe("ShellHooks.claudeSettings", () => {
  const settings = JSON.stringify({
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "check.sh", timeout: 5 }] },
        { hooks: [{ type: "prompt", prompt: "ask the model" }] },
        {
          matcher: "Edit",
          hooks: [
            { type: "prompt", prompt: "x" },
            { type: "command", command: "lint.sh" },
          ],
        },
      ],
      Notification: [{ hooks: [{ type: "command", command: "notify.sh" }] }],
    },
  })

  test("keeps runnable command hooks and skips the rest", () => {
    expect(ShellHooks.claudeSettings(settings, "PreToolUse")).toMatchObject([
      { matcher: "Bash", hooks: [{ command: "check.sh", timeout: 5 }] },
      { matcher: "Edit", hooks: [{ command: "lint.sh" }] },
    ])
  })

  test("ignores events SmikCode does not have and events that are absent", () => {
    expect(ShellHooks.claudeSettings(settings, "Stop")).toEqual([])
  })

  test("treats malformed settings as having no hooks", () => {
    expect(ShellHooks.claudeSettings("{not json", "PreToolUse")).toEqual([])
    expect(ShellHooks.claudeSettings(JSON.stringify({ hooks: { PreToolUse: "nope" } }), "PreToolUse")).toEqual([])
  })
})

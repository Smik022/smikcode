export * as ShellHooks from "./shell-hooks.js"

import { Schema } from "effect"

export type Event = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | "SessionStart"

/**
 * What a hook asked for, after reading its exit code and output. `context` is structured
 * `additionalContext` meant for the model; `output` is plain stdout, which only prompt and
 * session-start hooks forward because tool hooks would otherwise add noise to every call.
 */
export type Outcome =
  | { readonly type: "continue"; readonly context?: string; readonly output?: string }
  | { readonly type: "block"; readonly reason: string }

// Hooks written for Claude Code match on its tool names, so each built-in tool also answers to that name.
const claudeNames: Record<string, string> = {
  shell: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  patch: "MultiEdit",
  glob: "Glob",
  grep: "Grep",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  subagent: "Task",
  todo: "TodoWrite",
}

export function matches(matcher: string | undefined, tool: string) {
  if (matcher === undefined || matcher === "" || matcher === "*") return true
  const names = [tool, claudeNames[tool]].filter((name) => name !== undefined)
  const pattern = compile(matcher)
  return names.some((name) => (pattern ? pattern.test(name) : name === matcher))
}

// A matcher is user input, so an invalid expression falls back to a literal comparison instead of failing the call.
function compile(matcher: string) {
  try {
    return new RegExp(`^(?:${matcher})$`)
  } catch {
    return undefined
  }
}

const Output = Schema.Struct({
  decision: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  continue: Schema.optional(Schema.Boolean),
  stopReason: Schema.optional(Schema.String),
  additionalContext: Schema.optional(Schema.String),
  hookSpecificOutput: Schema.optional(
    Schema.Struct({
      permissionDecision: Schema.optional(Schema.String),
      permissionDecisionReason: Schema.optional(Schema.String),
      additionalContext: Schema.optional(Schema.String),
    }),
  ),
})

const decodeOutput = Schema.decodeUnknownOption(Schema.fromJsonString(Output))

/**
 * Exit 2 blocks and sends stderr to the model. Exit 0 may print JSON (`decision: "block"`,
 * `continue: false` or a denying `permissionDecision`) or plain text, which becomes context.
 * Any other exit code is a non-blocking failure.
 */
export function outcome(result: { exitCode: number; stdout: string; stderr: string }): Outcome {
  const stdout = result.stdout.trim()
  if (result.exitCode === 2) return { type: "block", reason: result.stderr.trim() || stdout || "Blocked by hook" }
  if (result.exitCode !== 0) return { type: "continue" }
  if (stdout === "") return { type: "continue" }

  const parsed = stdout.startsWith("{") ? decodeOutput(stdout) : undefined
  if (parsed === undefined || parsed._tag === "None") return { type: "continue", output: stdout }

  const output = parsed.value
  const specific = output.hookSpecificOutput
  if (output.decision === "block" || output.decision === "deny")
    return { type: "block", reason: output.reason ?? "Blocked by hook" }
  if (specific?.permissionDecision === "deny")
    return { type: "block", reason: specific.permissionDecisionReason ?? output.reason ?? "Blocked by hook" }
  if (output.continue === false)
    return { type: "block", reason: output.stopReason ?? output.reason ?? "Blocked by hook" }
  const context = specific?.additionalContext ?? output.additionalContext
  return context === undefined ? { type: "continue" } : { type: "continue", context }
}

/** Distinct hook commands for one event; the same command listed twice runs once. */
export function select<
  Entry extends {
    readonly matcher?: string
    readonly hooks: ReadonlyArray<{ readonly command: string; readonly timeout?: number }>
  },
>(entries: ReadonlyArray<Entry>, tool: string | undefined) {
  const unique = new Map<string, { readonly command: string; readonly timeout?: number }>()
  entries
    .filter((entry) => tool === undefined || matches(entry.matcher, tool))
    .flatMap((entry) => entry.hooks)
    .forEach((hook) => unique.has(hook.command) || unique.set(hook.command, hook))
  return Array.from(unique.values())
}

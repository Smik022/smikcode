export * as ConfigHooks from "./hooks.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"

export class Command extends Schema.Class<Command>("Config.Hooks.Command")({
  type: Schema.Literal("command").pipe(optional),
  /** Shell command. It receives the event as JSON on stdin. */
  command: Schema.String,
  /** Seconds before the command is killed. Defaults to 60. */
  timeout: PositiveInt.pipe(optional),
}) {}

export class Matcher extends Schema.Class<Matcher>("Config.Hooks.Matcher")({
  /** Regular expression matched against the tool name. Omit, "" or "*" to match every tool. */
  matcher: Schema.String.pipe(optional),
  hooks: Command.pipe(Schema.Array),
}) {}

/**
 * Lifecycle hooks that run shell commands, using the same shape as Claude Code's `hooks` setting.
 * Exit code 2 blocks the action and feeds stderr back to the model.
 */
export class Info extends Schema.Class<Info>("Config.Hooks")({
  PreToolUse: Matcher.pipe(Schema.Array, optional),
  PostToolUse: Matcher.pipe(Schema.Array, optional),
  UserPromptSubmit: Matcher.pipe(Schema.Array, optional),
  Stop: Matcher.pipe(Schema.Array, optional),
  SessionStart: Matcher.pipe(Schema.Array, optional),
}) {}

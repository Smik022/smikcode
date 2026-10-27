export * as ConfigHooksPlugin from "./hooks.js"

import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Brand } from "@opencode/util/brand"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Duration, Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import path from "path"
import { Config } from "../../config.js"
import { ShellHooks } from "../../hooks/shell-hooks.js"
import { Location } from "../../location.js"
import { ShellSelect } from "../../shell/select.js"
import { normalizeContent } from "../../tool/runtime.js"
import { ConfigEntryObserver } from "./entry-observer.js"

const DEFAULT_TIMEOUT = 60
const OUTPUT_LIMIT = 64 * 1024
// A Stop hook that keeps blocking would otherwise run the agent forever.
const MAX_STOP_CONTINUATIONS = 3

export const Plugin = define({
  id: "opencode.config.hooks",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const selector = yield* ShellSelect.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, Effect.void)
    const stops = new Map<string, number>()

    // Claude Code's settings files, from lowest to highest priority. They are read on use so edits apply at once.
    const claudeFiles = [
      path.join(global.home, ".claude", "settings.json"),
      path.join(location.project.directory, ".claude", "settings.json"),
      path.join(location.project.directory, ".claude", "settings.local.json"),
    ]

    // Every configured document contributes, from lowest to highest priority, then Claude Code's files when enabled.
    const configured = Effect.fnUntraced(function* (event: ShellHooks.Event, tool?: string) {
      const native = loaded.entries.flatMap((entry) =>
        entry.type === "document" ? (entry.info.hooks?.[event] ?? []) : [],
      )
      if (Config.latest(loaded.entries, "claude_hooks") !== true) return ShellHooks.select(native, tool)
      const texts = yield* Effect.forEach(claudeFiles, (file) =>
        fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined)),
      )
      const claude = texts.flatMap((text) => (text === undefined ? [] : ShellHooks.claudeSettings(text, event)))
      return ShellHooks.select([...native, ...claude], tool)
    })

    const execute = Effect.fn("ConfigHooksPlugin.execute")(function* (
      commands: ReadonlyArray<{ readonly command: string; readonly timeout?: number }>,
      input: Record<string, unknown>,
    ) {
      if (commands.length === 0) return []
      const shell = yield* selector.resolve({ priority: "config" })
      const stdin = JSON.stringify({ ...input, cwd: location.directory })
      return yield* Effect.forEach(
        commands,
        (hook) =>
          processes
            .run(
              ChildProcess.make(shell, ShellSelect.args(shell, hook.command), {
                cwd: location.directory,
                env: {
                  [`${Brand.envPrefix}PROJECT_DIR`]: location.project.directory,
                  CLAUDE_PROJECT_DIR: location.project.directory,
                },
                extendEnv: true,
              }),
              {
                stdin,
                timeout: Duration.seconds(hook.timeout ?? DEFAULT_TIMEOUT),
                maxOutputBytes: OUTPUT_LIMIT,
                maxErrorBytes: OUTPUT_LIMIT,
              },
            )
            .pipe(
              Effect.map((result) =>
                ShellHooks.outcome({
                  exitCode: result.exitCode,
                  stdout: result.stdout.toString("utf8"),
                  stderr: result.stderr.toString("utf8"),
                }),
              ),
              // A hook that cannot run must not break the session.
              Effect.catch((error) =>
                Effect.logWarning("hook failed", { command: hook.command, error: error.message }).pipe(
                  Effect.as({ type: "continue" } as ShellHooks.Outcome),
                ),
              ),
            ),
        { concurrency: "unbounded" },
      )
    })

    const blocked = (outcomes: readonly ShellHooks.Outcome[]) => outcomes.find((item) => item.type === "block")
    // Text a hook wants the model to see: block reasons and structured context, plus plain stdout when `plain` is set.
    const notes = (outcomes: readonly ShellHooks.Outcome[], plain = false) =>
      outcomes.flatMap((item) =>
        item.type === "block"
          ? [item.reason]
          : [item.context, plain ? item.output : undefined].filter((text): text is string => !!text),
      )

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const outcomes = yield* execute(yield* configured("PreToolUse", event.tool), {
          hook_event_name: "PreToolUse",
          session_id: event.sessionID,
          tool_name: event.tool,
          tool_input: event.input,
          tool_use_id: event.id,
        })
        const stop = blocked(outcomes)
        if (stop) return yield* new ToolFailure({ message: `Blocked by PreToolUse hook: ${stop.reason}` })
      }),
    )

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        const response =
          event.status === "completed"
            ? normalizeContent(event.result.content, event.result.output).flatMap((item) =>
                item.type === "text" ? [item.text] : [],
              )
            : [event.error.message]
        const outcomes = yield* execute(yield* configured("PostToolUse", event.tool), {
          hook_event_name: "PostToolUse",
          session_id: event.sessionID,
          tool_name: event.tool,
          tool_input: event.input,
          tool_response: { status: event.status, text: response.join("\n") },
          tool_use_id: event.id,
        })
        const feedback = notes(outcomes)
        if (feedback.length === 0 || event.status !== "completed") return
        event.result = {
          ...event.result,
          content: [
            ...normalizeContent(event.result.content, event.result.output),
            { type: "text", text: `\n<hook-feedback>\n${feedback.join("\n")}\n</hook-feedback>` },
          ],
        }
      }),
    )

    // Context from a hook lands as a synthetic message so it stays in history without editing what the user typed.
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        stops.delete(event.sessionID)
        const outcomes = yield* execute(yield* configured("UserPromptSubmit"), {
          hook_event_name: "UserPromptSubmit",
          session_id: event.sessionID,
          prompt: event.prompt.text,
        })
        const text = notes(outcomes, true).join("\n")
        if (text === "") return
        yield* ctx.session
          .synthetic({
            sessionID: event.sessionID,
            text: `<hook-context event="UserPromptSubmit">\n${text}\n</hook-context>`,
            resume: false,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to persist hook context", { sessionID: event.sessionID, cause }),
            ),
          )
      }),
    )

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event): event is SessionEvent.Created | SessionEvent.Execution.Succeeded =>
          event.type === "session.created" || event.type === "session.execution.succeeded",
      ),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const sessionID = event.data.sessionID
          if (event.type === "session.created") {
            if (event.data.parentID !== undefined) return
            const outcomes = yield* execute(yield* configured("SessionStart"), {
              hook_event_name: "SessionStart",
              session_id: sessionID,
              source: "startup",
            })
            const text = notes(outcomes, true).join("\n")
            if (text === "") return
            yield* ctx.session.synthetic({
              sessionID,
              text: `<hook-context event="SessionStart">\n${text}\n</hook-context>`,
              resume: false,
            })
            return
          }

          const commands = yield* configured("Stop")
          if (commands.length === 0) return
          const session = yield* ctx.session.get({ sessionID })
          if (session.parentID !== undefined) return
          const continuations = stops.get(sessionID) ?? 0
          const outcomes = yield* execute(commands, {
            hook_event_name: "Stop",
            session_id: sessionID,
            stop_hook_active: continuations > 0,
          })
          const stop = blocked(outcomes)
          if (!stop || continuations >= MAX_STOP_CONTINUATIONS) return void stops.delete(sessionID)
          stops.set(sessionID, continuations + 1)
          yield* ctx.session.synthetic({
            sessionID,
            text: `<system-reminder>A Stop hook asked you to keep going: ${stop.reason}</system-reminder>`,
            resume: true,
          })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to run lifecycle hook", { cause }))),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

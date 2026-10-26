export * as MemoryTool from "./memory.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { Memory } from "../../memory.js"

export const name = "memory"

export const description = `Save or remove a fact that should carry over to future sessions.

Use "save" when the user asks you to remember something, or states a lasting preference or project convention (for example "always use pnpm" or "the staging API is at ..."). Write each fact as one short, self-contained sentence. Do not save secrets, one-off task details or anything you can learn by reading the code.

Scope "user" applies to every project; scope "project" applies only to the current one. Saved facts appear in your instructions from the next step on. Use "forget" with a distinctive phrase from the fact to remove it.`

export const Input = Schema.Struct({
  action: Schema.Literals(["save", "forget"]),
  scope: Schema.Literals(Memory.Scopes).annotate({ description: "user: every project. project: this project only" }),
  text: Schema.String.annotate({ description: "The fact to save, or a phrase that identifies the fact to forget" }),
})

export const Output = Schema.Struct({
  action: Schema.Literals(["save", "forget"]),
  scope: Schema.Literals(Memory.Scopes),
  file: Schema.String,
  changed: Schema.Number,
})
export type Output = typeof Output.Type

// Shorter phrases would delete unrelated facts.
const MIN_FORGET_LENGTH = 4

export const Plugin = {
  id: "opencode.tool.memory",
  effect: Effect.fn("MemoryTool.Plugin")(function* (ctx: Context) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const target = Memory.file(
                { config: global.config, data: global.data, projectID: location.project.id },
                input.scope,
              )
              const current = yield* fs.readFileStringSafe(target)
              if (input.action === "save") {
                if (input.text.trim() === "")
                  return yield* new ToolFailure({ message: "Nothing to save: text is empty." })
                const next = Memory.add(current, input.text)
                if (next.added) yield* fs.writeWithDirs(target, next.content)
                return {
                  output: { action: input.action, scope: input.scope, file: target, changed: next.added ? 1 : 0 },
                  content: next.added
                    ? `Saved to ${input.scope} memory: ${input.text.trim()}`
                    : `Already in ${input.scope} memory: ${input.text.trim()}`,
                }
              }
              if (input.text.trim().length < MIN_FORGET_LENGTH)
                return yield* new ToolFailure({
                  message: `Use a phrase of at least ${MIN_FORGET_LENGTH} characters so only the intended fact is removed.`,
                })
              const next = Memory.remove(current ?? "", input.text)
              if (next.removed.length > 0) yield* fs.writeWithDirs(target, next.content)
              return {
                output: { action: input.action, scope: input.scope, file: target, changed: next.removed.length },
                content:
                  next.removed.length === 0
                    ? `No ${input.scope} memory matched "${input.text.trim()}".`
                    : `Removed from ${input.scope} memory:\n${next.removed.map((fact) => `- ${fact}`).join("\n")}`,
              }
            }).pipe(
              Effect.mapError((error) =>
                error._tag === "Tool.Error"
                  ? error
                  : new ToolFailure({ message: `Unable to update memory: ${error.message}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

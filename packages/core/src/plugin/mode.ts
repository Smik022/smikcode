export * as ModePlugin from "./mode.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { PermissionMode } from "../permission-mode.js"

const usage = `Usage: /mode [${PermissionMode.Modes.join("|")}]`

export const Plugin = define({
  id: "opencode.mode",
  effect: Effect.fn(function* (ctx) {
    // Runs only for requests that would ask, so a deny rule (Plan mode, managed policy) always wins.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        if (event.effect !== "ask") return
        const session = yield* ctx.session.get({ sessionID: event.sessionID })
        if (PermissionMode.approves(PermissionMode.read(session.metadata), event.action)) event.effect = "allow"
      }).pipe(
        // An unreadable session leaves the request to the user.
        Effect.catchCause(() => Effect.void),
      ),
    )

    yield* ctx.command.transform((editor) =>
      editor.add({
        name: "mode",
        description: "permission mode for this session: default, edits (auto-approve edits) or auto",
        execute: (input) =>
          Effect.gen(function* () {
            const session = yield* ctx.session.get({ sessionID: input.sessionID })
            const current = PermissionMode.read(session.metadata)
            const requested = input.prompt.text.trim()
            const text = yield* Effect.gen(function* () {
              if (requested === "")
                return `Permission mode: ${current}. ${PermissionMode.descriptions[current]}\n${usage}`
              const next = PermissionMode.parse(requested)
              if (next === undefined) return `Unknown mode "${requested}". ${usage}`
              if (next === current) return `Permission mode is already ${next}.`
              yield* ctx.session.update({
                sessionID: input.sessionID,
                metadata: PermissionMode.write(session.metadata, next),
              })
              return `Permission mode: ${next}. ${PermissionMode.descriptions[next]}`
            })
            yield* ctx.session.synthetic({ sessionID: input.sessionID, text, resume: false })
          }),
      }),
    )
  }),
})

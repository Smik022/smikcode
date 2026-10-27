import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { Agent } from "@opencode/core/agent"
import { ModePlugin } from "@opencode/core/plugin/mode"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_mode_test")

/** Runs the mode plugin against a stubbed host that keeps one session's metadata in memory. */
const run = Effect.fnUntraced(function* (initial?: SessionMetadata) {
  const state = { metadata: initial, notes: new Array<string>() }
  let evaluate: ((event: PermissionEvaluation) => Effect.Effect<void>) | undefined
  let command: CommandDefinition | undefined
  yield* ModePlugin.Plugin.effect(
    host({
      permission: {
        hook: (name, callback) => {
          // Hook names and callbacks are correlated, but TypeScript does not narrow this generic registration API.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "evaluate") evaluate = callback as unknown as typeof evaluate
          return Effect.succeed({ dispose: Effect.void })
        },
        list: () => Effect.die("unused"),
        get: () => Effect.die("unused"),
        reply: () => Effect.die("unused"),
        assert: () => Effect.die("unused"),
      },
      command: {
        list: () => Effect.die("unused"),
        reload: () => Effect.die("unused"),
        transform: (callback) => {
          callback({
            add: (definition) => {
              command = definition
            },
          })
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      session: {
        // The plugin reads only `metadata`; the rest of a session is irrelevant here.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        get: () => Effect.sync(() => ({ id: sessionID, metadata: state.metadata }) as unknown as Session.Info),
        update: (input) =>
          Effect.sync(() => {
            state.metadata = input.metadata
          }),
        synthetic: (input) =>
          Effect.sync(() => {
            state.notes.push(input.text)
            return SessionInbox.Synthetic.make({
              id: SessionMessage.ID.make("msg_mode_test"),
              sessionID,
              time: { created: DateTime.makeUnsafe(0) },
              type: "synthetic",
              payload: { text: input.text },
              delivery: "steer",
            })
          }),
      },
    }),
  )
  if (!evaluate) return yield* Effect.die("mode plugin did not register an evaluate hook")
  if (!command) return yield* Effect.die("mode plugin did not register /mode")
  const hook = evaluate
  const mode = command
  const say = (text: string) => mode.execute({ sessionID, prompt: { text }, delivery: "steer" })
  const ask = (action: string, effect: PermissionEvaluation["effect"] = "ask") => {
    const event: PermissionEvaluation = { sessionID, agent: Agent.ID.make("build"), action, resources: ["*"], effect }
    return hook(event).pipe(Effect.map(() => event.effect))
  }
  return { state, say, ask }
})

describe("mode plugin", () => {
  it.effect("asks as usual until a mode is chosen", () =>
    Effect.gen(function* () {
      const { ask } = yield* run()
      expect(yield* ask("edit")).toBe("ask")
      expect(yield* ask("shell")).toBe("ask")
    }),
  )

  it.effect("edits mode approves edit requests only", () =>
    Effect.gen(function* () {
      const { ask, say, state } = yield* run()
      yield* say("edits")
      expect(state.metadata).toEqual({ permission_mode: "edits" })
      expect(state.notes.at(-1)).toContain("File edits are approved automatically")
      expect(yield* ask("edit")).toBe("allow")
      expect(yield* ask("shell")).toBe("ask")
    }),
  )

  it.effect("never turns a deny into an allow", () =>
    Effect.gen(function* () {
      const { ask, say } = yield* run()
      yield* say("auto")
      expect(yield* ask("edit", "deny")).toBe("deny")
      expect(yield* ask("shell", "deny")).toBe("deny")
    }),
  )

  it.effect("auto mode approves every request that would ask", () =>
    Effect.gen(function* () {
      const { ask, say } = yield* run()
      yield* say("auto")
      expect(yield* ask("shell")).toBe("allow")
      expect(yield* ask("external_directory")).toBe("allow")
    }),
  )

  it.effect("returns to default and keeps other metadata", () =>
    Effect.gen(function* () {
      const { ask, say, state } = yield* run({ permission_mode: "edits", ticket: "SMK-1" })
      expect(yield* ask("edit")).toBe("allow")
      yield* say("default")
      expect(state.metadata).toEqual({ ticket: "SMK-1" })
      expect(yield* ask("edit")).toBe("ask")
    }),
  )

  it.effect("reports the current mode, an unchanged mode and unknown input", () =>
    Effect.gen(function* () {
      const { say, state } = yield* run({ permission_mode: "edits" })
      yield* say("")
      expect(state.notes.at(-1)).toContain("Permission mode: edits.")
      yield* say("accept-edits")
      expect(state.notes.at(-1)).toBe("Permission mode is already edits.")
      yield* say("constructor")
      expect(state.notes.at(-1)).toContain('Unknown mode "constructor"')
      expect(state.metadata).toEqual({ permission_mode: "edits" })
    }),
  )
})

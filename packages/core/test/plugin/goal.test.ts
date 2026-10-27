import { describe, expect } from "bun:test"
import { DateTime, Effect, Queue, Stream } from "effect"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import type { SessionContext } from "@opencode/plugin/effect/session"
import type { Tool } from "@opencode/schema/tool"
import { Goal } from "@opencode/core/goal"
import { GoalPlugin } from "@opencode/core/plugin/goal"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Event } from "@opencode/schema/event"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = Session.ID.make("ses_goal_test")

const base = {
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
}
const succeeded: SessionEvent.Execution.Succeeded = {
  ...base,
  type: "session.execution.succeeded",
  data: { sessionID },
}
const interrupted = (reason: "user" | "shutdown"): SessionEvent.Execution.Interrupted => ({
  ...base,
  type: "session.execution.interrupted",
  data: { sessionID, reason },
})

type Note = { readonly text: string; readonly resume: boolean | undefined }

/** Runs the goal plugin against a stubbed host that keeps one session's metadata in memory. */
const run = Effect.fnUntraced(function* (initial?: SessionMetadata) {
  const state = {
    metadata: initial,
    notes: new Array<Note>(),
    prompts: new Array<string>(),
    parentID: undefined as Session.ID | undefined,
  }
  const events = yield* Queue.unbounded<SessionEvent.Execution.Succeeded | SessionEvent.Execution.Interrupted>()
  let command: CommandDefinition | undefined
  let tool: Tool.Info | undefined
  let context: ((input: SessionContext) => Effect.Effect<void>) | undefined

  yield* GoalPlugin.Plugin.effect(
    host({
      command: {
        list: () => Effect.die("unused"),
        reload: () => Effect.die("unused"),
        transform: (callback) => {
          callback({ add: (definition) => (command = definition) })
          return Effect.succeed({ dispose: Effect.void })
        },
      },
      tool: {
        transform: (callback) => {
          callback({
            list: () => [],
            get: () => undefined,
            namespace: () => {},
            add: (definition) => (tool = definition),
            update: () => {},
            remove: () => {},
          })
          return Effect.succeed({ dispose: Effect.void })
        },
        reload: () => Effect.die("unused"),
        list: () => Effect.die("unused"),
        hook: () => Effect.succeed({ dispose: Effect.void }),
      },
      event: { subscribe: () => Stream.fromQueue(events) },
      session: {
        // The plugin reads only `metadata` and `parentID` from a session.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        get: () =>
          Effect.sync(
            () => ({ id: sessionID, metadata: state.metadata, parentID: state.parentID }) as unknown as Session.Info,
          ),
        update: (input) =>
          Effect.sync(() => {
            state.metadata = input.metadata
          }),
        prompt: (input) =>
          Effect.sync(() => {
            state.prompts.push(input.text)
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            return {} as never
          }),
        synthetic: (input) =>
          Effect.sync(() => {
            state.notes.push({ text: input.text, resume: input.resume })
            return SessionInbox.Synthetic.make({
              id: SessionMessage.ID.make("msg_goal_test"),
              sessionID,
              time: { created: DateTime.makeUnsafe(0) },
              type: "synthetic",
              payload: { text: input.text },
              delivery: "steer",
            })
          }),
        hook: (name, callback) => {
          // Hook names and callbacks are correlated, but TypeScript does not narrow this generic registration API.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "context") context = callback as unknown as typeof context
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  )
  if (!command || !tool || !context) return yield* Effect.die("goal plugin did not register everything")
  const goalCommand = command
  const goalTool = tool
  const contextHook = context

  const say = (text: string) => goalCommand.execute({ sessionID, prompt: { text }, delivery: "steer" })
  const finish = (event: SessionEvent.Execution.Succeeded | SessionEvent.Execution.Interrupted) =>
    Queue.offer(events, event).pipe(
      // The subscriber runs in a forked fiber, so wait until it has done its work.
      Effect.andThen(Effect.promise(() => Bun.sleep(30))),
    )
  const report = (status: "complete" | "blocked", summary = "done") =>
    // The plugin reads only `sessionID` from the tool context.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    goalTool.execute({ status, summary }, { sessionID } as unknown as Tool.Context)
  const toolsFor = (names: string[]) => {
    const request = { sessionID, tools: Object.fromEntries(names.map((name) => [name, {}])) }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return contextHook(request as unknown as SessionContext).pipe(Effect.map(() => Object.keys(request.tools)))
  }
  return { state, say, finish, report, toolsFor }
})

describe("goal plugin", () => {
  it.effect("sets a goal and starts working on it", () =>
    Effect.gen(function* () {
      const { say, state } = yield* run({ ticket: "SMK-1" })
      yield* say("make the tests pass")
      expect(Goal.read(state.metadata)).toEqual({ text: "make the tests pass", status: "active", turns: 0 })
      expect(state.metadata).toMatchObject({ ticket: "SMK-1" })
      expect(state.prompts).toHaveLength(1)
      expect(state.prompts[0]).toContain("make the tests pass")
      expect(state.prompts[0]).toContain('status "complete"')
    }),
  )

  it.effect("nudges the agent to continue when a run ends with the goal unfinished", () =>
    Effect.gen(function* () {
      const { say, finish, state } = yield* run()
      yield* say("ship it")
      yield* finish(succeeded)
      expect(state.notes).toHaveLength(1)
      expect(state.notes[0]?.resume).toBe(true)
      expect(state.notes[0]?.text).toContain("ship it")
      expect(Goal.read(state.metadata)?.turns).toBe(1)
    }),
  )

  it.effect("stops nudging once the agent reports the goal complete", () =>
    Effect.gen(function* () {
      const { say, finish, report, state } = yield* run()
      yield* say("ship it")
      yield* report("complete", "all shipped")
      expect(Goal.read(state.metadata)).toEqual({ text: "ship it", status: "complete", turns: 0, note: "all shipped" })
      yield* finish(succeeded)
      expect(state.notes).toHaveLength(0)
    }),
  )

  it.effect("refuses a report when no goal is active", () =>
    Effect.gen(function* () {
      const { report } = yield* run()
      expect(yield* report("complete").pipe(Effect.flip)).toMatchObject({ message: "No goal is active." })
    }),
  )

  it.effect("offers the goal tool only while a goal is active", () =>
    Effect.gen(function* () {
      const { say, toolsFor } = yield* run()
      expect(yield* toolsFor(["read", "goal"])).toEqual(["read"])
      yield* say("ship it")
      expect(yield* toolsFor(["read", "goal"])).toEqual(["read", "goal"])
    }),
  )

  it.effect("pauses when the user stops the agent but not on shutdown", () =>
    Effect.gen(function* () {
      const { say, finish, state } = yield* run()
      yield* say("ship it")
      yield* finish(interrupted("shutdown"))
      expect(Goal.read(state.metadata)?.status).toBe("active")
      yield* finish(interrupted("user"))
      expect(Goal.read(state.metadata)?.status).toBe("paused")
      expect(state.notes.at(-1)?.resume).toBe(false)
      yield* finish(succeeded)
      expect(state.notes.filter((note) => note.resume)).toHaveLength(0)
    }),
  )

  it.effect("pauses after too many automatic continuations and resumes on request", () =>
    Effect.gen(function* () {
      const { say, finish, state } = yield* run({
        goal: { text: "ship it", status: "active", turns: Goal.MAX_CONTINUATIONS },
      })
      yield* finish(succeeded)
      expect(Goal.read(state.metadata)?.status).toBe("paused")
      expect(state.notes.at(-1)?.text).toContain(`${Goal.MAX_CONTINUATIONS} automatic continuations`)

      yield* say("resume")
      expect(Goal.read(state.metadata)).toEqual({ text: "ship it", status: "active", turns: 0 })
      expect(state.notes.at(-1)?.resume).toBe(true)
    }),
  )

  it.effect("ignores subagent sessions", () =>
    Effect.gen(function* () {
      const { finish, state } = yield* run({ goal: { text: "ship it", status: "active", turns: 0 } })
      state.parentID = Session.ID.make("ses_parent")
      yield* finish(succeeded)
      expect(state.notes).toHaveLength(0)
    }),
  )

  it.effect("reports, pauses and clears from the command", () =>
    Effect.gen(function* () {
      const { say, state } = yield* run()
      yield* say("")
      expect(state.notes.at(-1)?.text).toContain("No goal is set")
      yield* say("ship it")
      yield* say("pause")
      expect(Goal.read(state.metadata)?.status).toBe("paused")
      yield* say("")
      expect(state.notes.at(-1)?.text).toContain("Goal (paused): ship it")
      yield* say("clear")
      expect(Goal.read(state.metadata)).toBeUndefined()
      expect(state.metadata).toEqual({})
    }),
  )
})

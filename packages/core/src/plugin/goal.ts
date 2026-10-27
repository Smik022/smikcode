export * as GoalPlugin from "./goal.js"

import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import type { SessionEvent } from "@opencode/schema/session-event"
import { Effect, Schema, Stream } from "effect"
import { Goal } from "../goal.js"

const TOOL = "goal"

const description = `Report the outcome of the active goal. Call it only when a goal is active.

Use status "complete" once the goal is fully met and you have checked the result. Use status "blocked" when you cannot go on without the user, and say what you need in the summary. Until you call it, the session keeps asking you to continue.`

const Input = Schema.Struct({
  status: Schema.Literals(["complete", "blocked"]),
  summary: Schema.String.annotate({ description: "What was done, or what you need from the user" }),
})

const Output = Schema.Struct({ status: Schema.Literals(["complete", "blocked"]) })

export const Plugin = define({
  id: "opencode.goal",
  effect: Effect.fn(function* (ctx) {
    const save = Effect.fn("GoalPlugin.save")(function* (session: Session.Info, goal: Goal.Info | undefined) {
      yield* ctx.session.update({ sessionID: session.id, metadata: Goal.write(session.metadata, goal) })
    })
    const failed = (error: unknown) => new ToolFailure({ message: "Unable to update the goal.", error })
    const say = (sessionID: Session.ID, text: string) => ctx.session.synthetic({ sessionID, text, resume: false })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: TOOL,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const session = yield* ctx.session.get({ sessionID: context.sessionID }).pipe(Effect.mapError(failed))
              const goal = Goal.read(session.metadata)
              if (goal?.status !== "active") return yield* new ToolFailure({ message: "No goal is active." })
              yield* save(session, { ...goal, status: input.status, note: input.summary }).pipe(Effect.mapError(failed))
              return {
                output: { status: input.status },
                content:
                  input.status === "complete"
                    ? "Goal marked complete."
                    : "Goal marked blocked. Tell the user what you need.",
              }
            }),
        }),
      )
      .pipe(Effect.orDie)

    // The tool only makes sense while a goal is running, so other sessions never see it.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!(TOOL in event.tools)) return
        const session = yield* ctx.session.get({ sessionID: event.sessionID })
        if (!Goal.isActive(session.metadata)) delete event.tools[TOOL]
      }).pipe(Effect.catchCause(() => Effect.void)),
    )

    yield* ctx.command.transform((editor) =>
      editor.add({
        name: "goal",
        description: "set a goal and keep working until it is done (/goal <goal>, or clear, pause, resume)",
        execute: (input) =>
          Effect.gen(function* () {
            const sessionID = input.sessionID
            const session = yield* ctx.session.get({ sessionID })
            const goal = Goal.read(session.metadata)
            const action = Goal.parse(input.prompt.text)

            if (action.type === "status") return yield* say(sessionID, Goal.describe(goal))
            if (action.type === "clear") {
              if (goal === undefined) return yield* say(sessionID, "No goal to clear.")
              yield* save(session, undefined)
              return yield* say(sessionID, "Goal cleared.")
            }
            if (action.type === "pause") {
              if (goal?.status !== "active") return yield* say(sessionID, "No active goal to pause.")
              yield* save(session, { ...goal, status: "paused", note: "Paused. Use /goal resume to continue." })
              return yield* say(sessionID, "Goal paused. Use /goal resume to continue.")
            }
            if (action.type === "resume") {
              if (goal === undefined || goal.status === "complete") return yield* say(sessionID, "No goal to resume.")
              yield* save(session, Goal.start(goal.text))
              yield* ctx.session.synthetic({ sessionID, text: Goal.nudge(goal.text), resume: true })
              return
            }
            yield* save(session, Goal.start(action.text))
            yield* ctx.session.prompt({
              ...input.prompt,
              sessionID,
              text: Goal.kickoff(action.text),
              delivery: input.delivery,
            })
          }).pipe(Effect.asVoid),
      }),
    )

    // A finished run is where an unfinished goal gets nudged on. Subagent sessions never carry a goal.
    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (
          event,
        ): event is
          | SessionEvent.Execution.Succeeded
          | SessionEvent.Execution.Interrupted
          | SessionEvent.Execution.Failed =>
          event.type === "session.execution.succeeded" ||
          event.type === "session.execution.interrupted" ||
          event.type === "session.execution.failed",
      ),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const sessionID = event.data.sessionID
          const session = yield* ctx.session.get({ sessionID })
          const goal = Goal.read(session.metadata)
          if (session.parentID !== undefined || goal?.status !== "active") return

          const pause = Effect.fnUntraced(function* (note: string) {
            yield* save(session, { ...goal, status: "paused", note })
            yield* say(sessionID, `Goal paused. ${note}`)
          })
          if (event.type === "session.execution.failed") return yield* pause("The run stopped with an error.")
          if (event.type === "session.execution.interrupted") {
            // Shutdown and recovery interruptions leave the goal running.
            if (event.data.reason !== "user") return
            return yield* pause("You stopped the agent. Use /goal resume to continue.")
          }
          if (goal.turns >= Goal.MAX_CONTINUATIONS)
            return yield* pause(
              `It stopped after ${Goal.MAX_CONTINUATIONS} automatic continuations. Use /goal resume to keep going.`,
            )
          yield* save(session, { ...goal, turns: goal.turns + 1 })
          yield* ctx.session.synthetic({ sessionID, text: Goal.nudge(goal.text), resume: true })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to continue goal", { cause }))),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

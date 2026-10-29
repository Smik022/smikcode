import { describe, expect } from "bun:test"
import { DateTime, Effect, Queue, Stream } from "effect"
import type { CommandDefinition } from "@opencode/plugin/effect/command"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import type { SessionContext, SessionPrompt } from "@opencode/plugin/effect/session"
import type { Tool } from "@opencode/schema/tool"
import { WorkflowPlugin } from "@opencode/core/plugin/workflow"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionMessage } from "@opencode/core/session/message"
import { Workflow } from "@opencode/core/workflow"
import { Event } from "@opencode/schema/event"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { it } from "../lib/effect"
import { host } from "./host"

const main = Session.ID.make("ses_workflow_main")

type Ended = SessionEvent.Execution.Succeeded | SessionEvent.Execution.Interrupted | SessionEvent.Execution.Failed

const base = (sessionID: Session.ID) => ({
  id: Event.ID.create(),
  created: 0,
  durable: { aggregateID: sessionID, seq: Event.Seq.make(0), version: Event.Version.make(1) },
})
const succeeded = (sessionID: Session.ID): Ended => ({
  ...base(sessionID),
  type: "session.execution.succeeded",
  data: { sessionID },
})
const interrupted = (sessionID: Session.ID, reason: "user" | "shutdown"): Ended => ({
  ...base(sessionID),
  type: "session.execution.interrupted",
  data: { sessionID, reason },
})

type FakeSession = {
  id: Session.ID
  metadata: SessionMetadata | undefined
  parentID: Session.ID | undefined
  agent: string | undefined
  model: { providerID: string; id: string }
}

const stages = (...list: Workflow.Stage[]): WorkflowPlugin.Loaded => ({ id: "demo", name: "Demo", source: "global", stages: list })

// Build, then a fresh review that sends failures to fix and finishes on a pass.
const reviewed = stages(
  { id: "build", title: "Build", instructions: "Build it." },
  {
    id: "review",
    title: "Review",
    instructions: "Review it.",
    context: "fresh",
    agent: "plan",
    onPass: Workflow.DONE,
    onFail: { goto: "fix", max: 2 },
  },
  { id: "fix", title: "Fix", instructions: "Fix it.", onPass: "review" },
)

/** Runs the workflow engine against a stubbed host that keeps sessions in memory. */
const run = Effect.fnUntraced(function* (options: { workflow?: WorkflowPlugin.Loaded; passing?: () => boolean; noAgent?: boolean } = {}) {
  const workflow = options.workflow ?? reviewed
  const sessions = new Map<Session.ID, FakeSession>([
    [main, { id: main, metadata: undefined, parentID: undefined, agent: options.noAgent ? undefined : "build", model: { providerID: "p", id: "m" } }],
  ])
  const log = {
    notes: new Array<{ sessionID: Session.ID; text: string; resume: boolean | undefined }>(),
    prompts: new Array<{ sessionID: Session.ID; text: string }>(),
    switched: new Array<string>(),
    interrupted: new Array<Session.ID>(),
    created: new Array<FakeSession>(),
  }
  const events = yield* Queue.unbounded<Ended>()
  let command: CommandDefinition | undefined
  let tool: Tool.Info | undefined
  let context: ((input: SessionContext) => Effect.Effect<void>) | undefined
  let promptHook: ((input: SessionPrompt) => Effect.Effect<void>) | undefined
  let evaluate: ((input: PermissionEvaluation) => Effect.Effect<void>) | undefined
  let rpc: { list: () => Effect.Effect<{ workflows: ReadonlyArray<unknown> }> } | undefined

  const get = (id: Session.ID) => {
    const found = sessions.get(id)
    // The plugin reads only these fields of a session.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return found === undefined ? Effect.die(`no session ${id}`) : Effect.succeed(found as unknown as Session.Info)
  }
  const edit = (id: Session.ID, change: (found: FakeSession) => void) =>
    Effect.sync(() => {
      const found = sessions.get(id)
      if (found) change(found)
    })

  yield* WorkflowPlugin.install(
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
      permission: {
        hook: (_name, callback) => {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          evaluate = callback as unknown as typeof evaluate
          return Effect.succeed({ dispose: Effect.void })
        },
        list: () => Effect.die("unused"),
        get: () => Effect.die("unused"),
        reply: () => Effect.die("unused"),
        assert: () => Effect.die("unused"),
      },
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      rpc: Object.assign(
        () => {
          throw new Error("unused rpc.client")
        },
        {
          register: (_definition: unknown, handlers: unknown) => {
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            rpc = handlers as typeof rpc
            return Effect.void
          },
        },
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      ) as never,
      session: {
        get: (input) => get(input.sessionID),
        update: (input) =>
          edit(input.sessionID, (found) => {
            found.metadata = input.metadata
          }),
        create: (input) =>
          Effect.sync(() => {
            const created: FakeSession = {
              id: Session.ID.make(`ses_child_${log.created.length + 1}`),
              metadata: input?.metadata,
              parentID: input?.parentID,
              agent: String(input?.agent),
              model: { providerID: "p", id: "m" },
            }
            log.created.push(created)
            sessions.set(created.id, created)
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            return created as never
          }),
        prompt: (input) =>
          Effect.sync(() => {
            log.prompts.push({ sessionID: input.sessionID, text: input.text })
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            return {} as never
          }),
        switchAgent: (input) =>
          edit(input.sessionID, (found) => {
            found.agent = String(input.agent)
            log.switched.push(String(input.agent))
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          }).pipe(Effect.as({} as never)),
        interrupt: (input) =>
          Effect.sync(() => {
            log.interrupted.push(input.sessionID)
            // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
            return {} as never
          }),
        synthetic: (input) =>
          Effect.sync(() => {
            log.notes.push({ sessionID: input.sessionID, text: input.text, resume: input.resume })
            return SessionInbox.Synthetic.make({
              id: SessionMessage.ID.make("msg_workflow_test"),
              sessionID: input.sessionID,
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
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          if (name === "prompt") promptHook = callback as unknown as typeof promptHook
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
    {
      load: Effect.succeed([workflow]),
      check: () => {
        const passed = options.passing?.() ?? true
        return Effect.succeed({ passed, output: passed ? "ok" : "2 failed" })
      },
    },
  )
  if (!command || !tool || !context || !promptHook || !evaluate || !rpc)
    return yield* Effect.die("workflow plugin did not register everything")
  const workflowCommand = command
  const stageTool = tool
  const contextHook = context
  const onPrompt = promptHook
  const onEvaluate = evaluate
  const handlers = rpc

  const state = (id: Session.ID = main) => sessions.get(id)
  const runOf = (id: Session.ID = main) => Workflow.read(state(id)?.metadata)
  const say = (text: string) => workflowCommand.execute({ sessionID: main, prompt: { text }, delivery: "steer" })
  const end = (event: Ended) =>
    Queue.offer(events, event).pipe(
      // Each event is handled in its own fiber, so wait until it has done its work.
      Effect.andThen(Effect.promise(() => Bun.sleep(40))),
    )
  const report = (sessionID: Session.ID, outcome: "pass" | "fail" | "blocked", summary = "done") =>
    // The plugin reads only `sessionID` from the tool context.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    stageTool.execute({ outcome, summary }, { sessionID } as unknown as Tool.Context)
  // Reports a stage and lets the run end, which is how the engine hears about it.
  const finish = (sessionID: Session.ID, outcome: "pass" | "fail" | "blocked", summary = "done") =>
    report(sessionID, outcome, summary).pipe(Effect.andThen(end(succeeded(sessionID))))
  const toolsFor = (sessionID: Session.ID) => {
    const request = { sessionID, tools: { read: {}, [Workflow.TOOL]: {} } }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return contextHook(request as unknown as SessionContext).pipe(Effect.map(() => Object.keys(request.tools)))
  }
  const typed = (text: string) => {
    const event = { sessionID: main, prompt: { text }, delivery: "steer" }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return onPrompt(event as unknown as SessionPrompt).pipe(Effect.as(event.prompt))
  }
  const ask = (action: string, resources: string[], effect: "allow" | "ask" | "deny" = "allow", sessionID = main) => {
    const event = { sessionID, action, resources, effect }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return onEvaluate(event as unknown as PermissionEvaluation).pipe(Effect.as(event))
  }
  return { sessions, log, state, runOf, say, end, report, finish, toolsFor, typed, ask, handlers }
})

describe("workflow plugin", () => {
  it.effect("starts from the command at the first stage with the task in the prompt", () =>
    Effect.gen(function* () {
      const { say, runOf, log } = yield* run()
      yield* say("demo add dark mode")
      expect(runOf()).toMatchObject({ stage: "build", status: "running", task: "add dark mode", origin: "build" })
      expect(log.prompts).toHaveLength(1)
      expect(log.prompts[0]?.text).toContain("Task: add dark mode")
      expect(log.prompts[0]?.text).toContain("Stage 1/3: Build")
    }),
  )

  it.effect("explains itself for an unknown name, a missing task, and a second start", () =>
    Effect.gen(function* () {
      const { say, log, runOf } = yield* run()
      yield* say("nope do something")
      expect(log.notes.at(-1)?.text).toContain('There is no workflow called "nope"')
      yield* say("demo")
      expect(log.notes.at(-1)?.text).toContain("Say what Demo should work on")
      expect(runOf()).toBeUndefined()
      yield* say("demo task")
      yield* say("demo another")
      expect(log.notes.at(-1)?.text).toContain("already running")
      yield* say("")
      expect(log.notes.at(-1)?.text).toContain("demo - Demo")
    }),
  )

  it.effect("refuses to run a workflow whose definition is broken", () =>
    Effect.gen(function* () {
      const broken = stages({ id: "a", title: "A", instructions: "x", onPass: "nowhere" })
      const { say, log, runOf } = yield* run({ workflow: broken })
      yield* say("demo task")
      expect(log.notes.at(-1)?.text).toContain('goes on to "nowhere"')
      expect(runOf()).toBeUndefined()
    }),
  )

  it.effect("moves on to a fresh stage in a child session that does not inherit the run", () =>
    Effect.gen(function* () {
      const { say, finish, state, log, runOf } = yield* run()
      yield* say("demo add dark mode")
      const session = state()
      if (session) session.metadata = { ...session.metadata, permission_mode: "auto", goal: { text: "x", status: "active", turns: 0 } }
      yield* finish(main, "pass", "built the toggle")
      const child = log.created[0]
      expect(runOf()).toMatchObject({ stage: "review", status: "running", child: child?.id })
      expect(child).toMatchObject({ parentID: main, agent: "plan" })
      expect(Workflow.read(child?.metadata)).toBeUndefined()
      expect(Workflow.readChild(child?.metadata)).toEqual({ parent: main, stage: "review", nudges: 0, reported: null })
      // Keeps the user's other session settings, but not another feature's state.
      expect(child?.metadata?.permission_mode).toBe("auto")
      expect(child?.metadata?.goal).toBeUndefined()
      expect(log.prompts.at(-1)?.sessionID).toBe(child?.id)
      expect(log.prompts.at(-1)?.text).toContain("clean context")
      expect(log.prompts.at(-1)?.text).toContain("built the toggle")
      expect(log.notes.at(-1)?.text).toContain("fresh session")
    }),
  )

  it.effect("sends a failed review back to the fix stage with the findings, then to a new review", () =>
    Effect.gen(function* () {
      const { say, finish, runOf, log, state } = yield* run()
      yield* say("demo add dark mode")
      yield* finish(main, "pass")
      const first = log.created[0]!.id
      yield* finish(first, "fail", "parse() drops the last token")
      expect(runOf()).toMatchObject({ stage: "fix", status: "running", child: null, retries: { review: 1 } })
      expect(log.notes.at(-1)).toMatchObject({ sessionID: main, resume: true })
      expect(log.notes.at(-1)?.text).toContain("parse() drops the last token")
      yield* finish(main, "pass", "fixed parse()")
      expect(runOf()).toMatchObject({ stage: "review", child: "ses_child_2" })
      expect(state(Session.ID.make("ses_child_2"))?.parentID).toBe(main)
      yield* finish(Session.ID.make("ses_child_2"), "pass", "looks right")
      expect(runOf()).toMatchObject({ status: "done" })
    }),
  )

  it.effect("stops after a stage fails more often than it allows", () =>
    Effect.gen(function* () {
      const { say, finish, runOf, log } = yield* run()
      yield* say("demo task")
      yield* finish(main, "pass")
      yield* finish(log.created[0]!.id, "fail", "one")
      yield* finish(main, "pass")
      yield* finish(log.created[1]!.id, "fail", "two")
      yield* finish(main, "pass")
      yield* finish(log.created[2]!.id, "fail", "three")
      expect(runOf()).toMatchObject({ status: "blocked" })
      expect(log.notes.at(-1)?.text).toContain("failed 2 times")
    }),
  )

  it.effect("nudges an agent that ends without reporting, then pauses", () =>
    Effect.gen(function* () {
      const { say, end, runOf, log } = yield* run()
      yield* say("demo add dark mode")
      for (let index = 0; index < Workflow.MAX_NUDGES; index++) yield* end(succeeded(main))
      expect(log.notes.filter((note) => note.resume === true)).toHaveLength(Workflow.MAX_NUDGES)
      expect(runOf()?.status).toBe("running")
      yield* end(succeeded(main))
      expect(runOf()).toMatchObject({ status: "paused" })
      expect(log.notes.at(-1)?.text).toContain("/workflow resume")
    }),
  )

  it.effect("nudges a fresh session that ends without reporting, and ignores it once the run moved on", () =>
    Effect.gen(function* () {
      const { say, finish, end, runOf, log, sessions } = yield* run()
      yield* say("demo task")
      yield* finish(main, "pass")
      const childID = log.created[0]!.id
      yield* end(succeeded(childID))
      expect(log.notes.at(-1)).toMatchObject({ sessionID: childID, resume: true })
      expect(Workflow.readChild(sessions.get(childID)?.metadata)?.nudges).toBe(1)
      yield* finish(childID, "pass", "fine")
      expect(runOf()?.status).toBe("done")
      const before = log.notes.length
      yield* end(succeeded(childID))
      expect(log.notes).toHaveLength(before)
    }),
  )

  it.effect("switches the agent for a stage and puts it back at the end", () =>
    Effect.gen(function* () {
      const only = stages(
        { id: "a", title: "A", instructions: "x", agent: "plan" },
        { id: "b", title: "B", instructions: "y" },
      )
      const { say, finish, state, log, runOf } = yield* run({ workflow: only })
      yield* say("demo task")
      expect(state()?.agent).toBe("plan")
      yield* finish(main, "pass")
      expect(state()?.agent).toBe("build")
      yield* finish(main, "pass")
      expect(runOf()?.status).toBe("done")
      expect(log.switched).toEqual(["plan", "build"])
    }),
  )

  it.effect("takes a session that never picked an agent back to the default agent", () =>
    Effect.gen(function* () {
      const only = stages(
        { id: "a", title: "A", instructions: "x", agent: "plan" },
        { id: "b", title: "B", instructions: "y" },
      )
      const { say, finish, state, log } = yield* run({ workflow: only, noAgent: true })
      yield* say("demo task")
      expect(state()?.agent).toBe("plan")
      yield* finish(main, "pass")
      expect(state()?.agent).toBe("build")
      expect(log.switched).toEqual(["plan", "build"])
    }),
  )

  it.effect("runs a stage's check command and sends a failing check back with its output", () =>
    Effect.gen(function* () {
      let passing = false
      const checked = stages(
        { id: "ship", title: "Ship", instructions: "Ship it.", exit: "command", command: "make test" },
        { id: "after", title: "After", instructions: "Then this." },
      )
      const { say, finish, runOf, log } = yield* run({ workflow: checked, passing: () => passing })
      yield* say("demo task")
      yield* finish(main, "pass", "shipped")
      expect(runOf()).toMatchObject({ stage: "ship", retries: { ship: 1 } })
      expect(log.notes.at(-1)?.text).toContain("`make test` failed:\n2 failed")
      passing = true
      yield* finish(main, "pass", "now green")
      expect(runOf()?.stage).toBe("after")
    }),
  )

  it.effect("holds an approval stage until the user approves", () =>
    Effect.gen(function* () {
      const approval = stages(
        { id: "draft", title: "Draft", instructions: "Draft it.", exit: "approval" },
        { id: "send", title: "Send", instructions: "Send it." },
      )
      const { say, finish, runOf, log } = yield* run({ workflow: approval })
      yield* say("demo task")
      yield* finish(main, "pass", "here is the draft")
      expect(runOf()).toMatchObject({ stage: "draft", status: "waiting", waiting: "finish" })
      expect(log.notes.at(-1)?.text).toContain("/workflow approve")
      expect(log.notes.at(-1)?.text).toContain("here is the draft")
      yield* say("approve")
      expect(runOf()).toMatchObject({ stage: "send", status: "running" })
      expect(log.notes.at(-1)).toMatchObject({ resume: true })
    }),
  )

  it.effect("waits for approval before a stage marked approveFirst", () =>
    Effect.gen(function* () {
      const gated = stages(
        { id: "a", title: "A", instructions: "x" },
        { id: "b", title: "B", instructions: "y", approveFirst: true },
      )
      const { say, finish, runOf, log } = yield* run({ workflow: gated })
      yield* say("demo task")
      yield* finish(main, "pass")
      expect(runOf()).toMatchObject({ stage: "b", status: "waiting", waiting: "start" })
      expect(log.notes.at(-1)?.text).toContain("/workflow approve")
      expect(log.notes.at(-1)?.resume).toBe(false)
      yield* say("approve")
      expect(runOf()).toMatchObject({ stage: "b", status: "running", waiting: null })
      expect(log.notes.at(-1)?.resume).toBe(true)
      expect(log.notes.at(-1)?.text).toContain("Stage 2/2: B")
    }),
  )

  it.effect("stops for the user when the agent is blocked, and resumes the same stage on request", () =>
    Effect.gen(function* () {
      const { say, finish, runOf, log } = yield* run()
      yield* say("demo task")
      yield* finish(main, "blocked", "which database?")
      expect(runOf()).toMatchObject({ status: "blocked", note: "which database?" })
      expect(log.notes.at(-1)?.text).toContain("which database?")
      yield* say("resume")
      expect(runOf()).toMatchObject({ stage: "build", status: "running", note: "" })
      expect(log.notes.at(-1)?.resume).toBe(true)
    }),
  )

  it.effect("pauses when the user stops the agent but not on shutdown", () =>
    Effect.gen(function* () {
      const { say, end, runOf } = yield* run()
      yield* say("demo task")
      yield* end(interrupted(main, "shutdown"))
      expect(runOf()?.status).toBe("running")
      yield* end(interrupted(main, "user"))
      expect(runOf()?.status).toBe("paused")
    }),
  )

  it.effect("stops a run, interrupting its fresh session", () =>
    Effect.gen(function* () {
      const { say, finish, runOf, log, state } = yield* run()
      yield* say("demo task")
      yield* finish(main, "pass")
      yield* say("stop")
      expect(runOf()).toBeUndefined()
      expect(log.interrupted).toEqual([log.created[0]!.id])
      expect(state()?.metadata).toEqual({})
      yield* say("stop")
      expect(log.notes.at(-1)?.text).toContain("No workflow to stop")
    }),
  )

  it.effect("only offers the stage tool to a session that has a stage to report on", () =>
    Effect.gen(function* () {
      const { say, report, finish, toolsFor, log } = yield* run()
      expect(yield* toolsFor(main)).toEqual(["read"])
      expect(yield* report(main, "pass").pipe(Effect.flip)).toMatchObject({ message: "No workflow stage is active." })
      yield* say("demo task")
      expect(yield* toolsFor(main)).toEqual(["read", Workflow.TOOL])
      yield* finish(main, "pass")
      expect(yield* toolsFor(log.created[0]!.id)).toEqual(["read", Workflow.TOOL])
    }),
  )

  it.effect("ignores ordinary subagent sessions", () =>
    Effect.gen(function* () {
      const { say, end, sessions, log } = yield* run()
      yield* say("demo task")
      const subagent = Session.ID.make("ses_sub")
      sessions.set(subagent, {
        id: subagent,
        metadata: undefined,
        parentID: main,
        agent: "general",
        model: { providerID: "p", id: "m" },
      })
      const before = log.notes.length
      yield* end(succeeded(subagent))
      expect(log.notes).toHaveLength(before)
    }),
  )

  it.effect("turns the next message into the task when a workflow was picked in the prompt box", () =>
    Effect.gen(function* () {
      const { sessions, typed, runOf, state } = yield* run()
      const session = sessions.get(main)
      if (session) session.metadata = Workflow.writePending({ ticket: "SMK-1" }, "demo")
      const prompt = yield* typed("add dark mode")
      expect(runOf()).toMatchObject({ stage: "build", task: "add dark mode", status: "running" })
      expect(prompt.text).toContain("Task: add dark mode")
      expect(prompt.text).toContain("Stage 1/3: Build")
      expect(Workflow.pending(state()?.metadata)).toBeUndefined()
      expect(state()?.metadata?.ticket).toBe("SMK-1")
      // A later message is an ordinary message.
      expect((yield* typed("and make it blue")).text).toBe("and make it blue")
    }),
  )

  it.effect("drops a picked workflow that no longer exists, leaving the message alone", () =>
    Effect.gen(function* () {
      const { sessions, typed, runOf, state } = yield* run()
      const session = sessions.get(main)
      if (session) session.metadata = Workflow.writePending(undefined, "gone")
      expect((yield* typed("add dark mode")).text).toBe("add dark mode")
      expect(runOf()).toBeUndefined()
      expect(Workflow.pending(state()?.metadata)).toBeUndefined()
    }),
  )

  it.effect("makes pushing and publishing ask during a workflow, whatever the mode says", () =>
    Effect.gen(function* () {
      const { say, ask, finish, log } = yield* run()
      expect((yield* ask("shell", ["git push origin main"])).effect).toBe("allow")
      yield* say("demo task")
      expect((yield* ask("shell", ["git push origin main"])).effect).toBe("ask")
      expect((yield* ask("shell", ["git -C ../repo push --force"])).effect).toBe("ask")
      expect((yield* ask("shell", ["gh pr create --fill"])).effect).toBe("ask")
      expect((yield* ask("shell", ["git status"])).effect).toBe("allow")
      expect((yield* ask("edit", ["git push"])).effect).toBe("allow")
      expect((yield* ask("shell", ["git push"], "deny")).effect).toBe("deny")
      // The fresh session of a stage belongs to the run too.
      yield* finish(main, "pass")
      expect((yield* ask("shell", ["git push"], "allow", log.created[0]!.id)).effect).toBe("ask")
    }),
  )

  it.effect("lists the workflows over RPC", () =>
    Effect.gen(function* () {
      const { handlers } = yield* run()
      const listed = yield* handlers.list()
      expect(listed.workflows).toEqual([reviewed])
    }),
  )
})

export * as WorkflowPlugin from "./workflow.js"

import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { Rpc } from "@opencode/schema/rpc"
import { Session } from "@opencode/schema/session"
import type { SessionEvent } from "@opencode/schema/session-event"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { Brand } from "@opencode/util/brand"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Duration, Effect, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import path from "path"
import { Goal } from "../goal.js"
import { Location } from "../location.js"
import { Model } from "../model.js"
import { ShellSelect } from "../shell/select.js"
import { Workflow } from "../workflow.js"
import { WorkflowPresets } from "../workflow-presets.js"

const GATE_TIMEOUT_SECONDS = 600
const OUTPUT_LIMIT = 256 * 1024
const OUTPUT_SHOWN = 4_000

// A session that never picked an agent runs the default one, so that is what a run goes back to.
const DEFAULT_AGENT = "build"

// Pushing and publishing leave the machine, so inside a workflow they always ask, whatever the permission mode says.
const OUTWARD = [/\bgit\b[^|;&]*\bpush\b/u, /\bgh\s+pr\s+(?:create|merge)\b/u, /\bgh\s+release\s+create\b/u]

const Input = Schema.Struct({
  outcome: Workflow.Outcome,
  summary: Schema.String.annotate({ description: "What you did, what you found, or what you need from the user" }),
})

const Output = Schema.Struct({ outcome: Workflow.Outcome })

const description = `Report how the current workflow stage went. Call it when the stage's work is finished, and only while a workflow stage is active.

Use outcome "pass" when the stage's goal is met and you have checked it. Use "fail" when it is not met and the work needs another attempt. Use "blocked" when you cannot go on without the user, and say what you need. The workflow moves on once your reply ends.`

// Where a user's own workflows are saved: for every project, or in this project's folder.
const Scope = Schema.Literals(["global", "project"])

export const Definition = Rpc.define({
  id: "smikcode.workflow",
  methods: {
    list: {
      input: Schema.Struct({}),
      output: Schema.Struct({ workflows: Schema.Array(Workflow.Listed) }),
    },
    // Writes the workflow as a file. A workflow with problems is not written, and the problems come back instead.
    save: {
      input: Schema.Struct({ workflow: Workflow.Definition, scope: Scope }),
      output: Schema.Struct({ problems: Schema.Array(Schema.String) }),
    },
    // Deletes the files in one scope that define the workflow. A prebuilt workflow of the same id comes back.
    remove: {
      input: Schema.Struct({ id: Schema.String, scope: Scope }),
      output: Schema.Struct({ removed: Schema.Int }),
    },
  },
  events: {},
})

export type Source = Workflow.Source

export interface Loaded extends Workflow.Definition {
  readonly source: Source
}

/** What the engine needs from the outside world: the saved workflows and a way to run a check command. */
export interface Deps {
  readonly load: Effect.Effect<ReadonlyArray<Loaded>>
  readonly check: (command: string) => Effect.Effect<{ readonly passed: boolean; readonly output: string }>
  readonly save: (scope: typeof Scope.Type, workflow: Workflow.Definition) => Effect.Effect<ReadonlyArray<string>>
  readonly remove: (scope: typeof Scope.Type, id: string) => Effect.Effect<number>
}

export const Plugin = define({
  id: "opencode.workflow",
  effect: Effect.fn(function* (ctx) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const selector = yield* ShellSelect.Service

    const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(Workflow.Definition))

    const directory = (source: "global" | "project") =>
      source === "global"
        ? path.join(global.config, "workflows")
        : path.join(location.project.directory, Brand.configDirectory, "workflows")

    // A file that cannot be read or does not describe a usable workflow is skipped, not fatal.
    const read = Effect.fnUntraced(function* (source: "global" | "project") {
      const folder = directory(source)
      const entries = yield* fs.readDirectoryEntries(folder).pipe(Effect.orElseSucceed(() => []))
      const files = entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".json"))
      const loaded = yield* Effect.forEach(files, (entry) =>
        fs.readFileStringSafe(path.join(folder, entry.name)).pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.map((text) => {
            const parsed = text === undefined ? undefined : decodeFile(text)
            if (parsed === undefined || parsed._tag === "None" || Workflow.problems(parsed.value).length > 0) return []
            return [{ file: path.join(folder, entry.name), workflow: { ...parsed.value, source } }]
          }),
        ),
      )
      return loaded.flat()
    })

    const load = Effect.gen(function* () {
      const builtin = WorkflowPresets.all.map((item): Loaded => ({ ...item, source: "builtin" }))
      const saved = [...(yield* read("global")), ...(yield* read("project"))].map((entry) => entry.workflow)
      // A later source replaces an earlier workflow of the same id, so a project can adjust a prebuilt one.
      return [...new Map([...builtin, ...saved].map((item) => [item.id, item])).values()]
    })

    // A workflow keeps the file it came from, so editing one never leaves two files with the same id.
    const save = Effect.fnUntraced(function* (scope: typeof Scope.Type, workflow: Workflow.Definition) {
      const issues = Workflow.problems(workflow)
      if (issues.length > 0) return issues
      const existing = (yield* read(scope)).find((entry) => entry.workflow.id === workflow.id)
      yield* fs
        .writeWithDirs(existing?.file ?? path.join(directory(scope), `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`)
        .pipe(Effect.orDie)
      return []
    })

    const remove = Effect.fnUntraced(function* (scope: typeof Scope.Type, id: string) {
      const files = (yield* read(scope)).filter((entry) => entry.workflow.id === id)
      yield* Effect.forEach(files, (entry) => fs.remove(entry.file)).pipe(Effect.orDie)
      return files.length
    })

    const check = Effect.fnUntraced(function* (command: string) {
      const shell = yield* selector.resolve({ priority: "config" })
      return yield* processes
        .run(
          ChildProcess.make(shell, ShellSelect.args(shell, command), {
            cwd: location.directory,
            env: { [`${Brand.envPrefix}PROJECT_DIR`]: location.project.directory },
            extendEnv: true,
          }),
          {
            timeout: Duration.seconds(GATE_TIMEOUT_SECONDS),
            maxOutputBytes: OUTPUT_LIMIT,
            maxErrorBytes: OUTPUT_LIMIT,
          },
        )
        .pipe(
          Effect.map((result) => ({
            passed: result.exitCode === 0,
            output: `${result.stdout.toString("utf8")}${result.stderr.toString("utf8")}`.trim().slice(-OUTPUT_SHOWN),
          })),
          Effect.catch((error) => Effect.succeed({ passed: false, output: `The check could not run: ${error.message}` })),
        )
    })

    yield* install(ctx, { load, check, save, remove })
  }),
})

/** Registers the workflow tool, command, hooks and event handling. Kept apart from `Plugin` so tests can supply `Deps`. */
export const install = Effect.fnUntraced(function* (ctx: Context, deps: Deps) {
  const patch = Effect.fnUntraced(function* (
    sessionID: Session.ID,
    change: (metadata: SessionMetadata | undefined) => SessionMetadata,
  ) {
    const session = yield* ctx.session.get({ sessionID })
    yield* ctx.session.update({ sessionID, metadata: change(session.metadata) })
  })
  const save = (sessionID: Session.ID, run: Workflow.Run | undefined) =>
    patch(sessionID, (metadata) => Workflow.write(metadata, run))
  const say = (sessionID: Session.ID, text: string) => ctx.session.synthetic({ sessionID, text, resume: false })
  const failed = (error: unknown) => new ToolFailure({ message: "Unable to update the workflow.", error })

  // Puts the session back on the agent it had before a stage asked for another one.
  const restoreAgent = Effect.fnUntraced(function* (sessionID: Session.ID, run: Workflow.Run) {
    const session = yield* ctx.session.get({ sessionID })
    if (run.origin === null || session.agent === run.origin) return
    yield* ctx.session.switchAgent({ sessionID, agent: Agent.ID.make(run.origin) })
  })

  const finish = Effect.fnUntraced(function* (sessionID: Session.ID, run: Workflow.Run, text: string) {
    yield* save(sessionID, run)
    yield* restoreAgent(sessionID, run).pipe(Effect.catchCause(() => Effect.void))
    yield* say(sessionID, text)
  })

  // A run that cannot continue on its own waits for the user, who can say /workflow resume.
  const pause = Effect.fnUntraced(function* (sessionID: Session.ID, run: Workflow.Run, note: string) {
    yield* save(sessionID, { ...run, status: "paused", waiting: null, note })
    yield* say(sessionID, `Workflow paused. ${note} Use /workflow resume to continue.`)
  })

  type Send = (text: string) => Effect.Effect<unknown, unknown>

  // Starts the run's current stage: in this chat, or in a session of its own for a fresh stage.
  const begin = Effect.fnUntraced(function* (sessionID: Session.ID, run: Workflow.Run, send: Send) {
    const stage = Workflow.stageOf(run)
    if (stage === undefined) return yield* pause(sessionID, run, "Its stage is missing.")
    if (run.status === "waiting") {
      yield* save(sessionID, run)
      return yield* say(
        sessionID,
        `Next stage "${stage.title}" is waiting for your go-ahead. Use /workflow approve to start it.`,
      )
    }
    const index = run.workflow.stages.findIndex((item) => item.id === stage.id)
    const session = yield* ctx.session.get({ sessionID })
    // The first stage has no earlier work to be fresh from, so it always runs in this chat.
    if (stage.context === "fresh" && index > 0) {
      const override = stage.model === undefined ? undefined : Model.Ref.parse(stage.model)
      const child = yield* ctx.session.create({
        parentID: sessionID,
        title: `${run.workflow.name}: ${stage.title}`,
        agent: Agent.ID.make(stage.agent ?? session.agent ?? DEFAULT_AGENT),
        model: override ?? session.model,
        // A fresh session inherits the parent's metadata unless told otherwise; it must not inherit the run itself.
        metadata: Workflow.writeChild(
          Goal.write(Workflow.write(Workflow.writePending(session.metadata, undefined), undefined), undefined),
          { parent: sessionID, stage: stage.id, nudges: 0, reported: null },
        ),
      })
      yield* save(sessionID, { ...run, child: child.id })
      yield* say(sessionID, Workflow.handoff(run))
      yield* ctx.session.prompt({ sessionID: child.id, text: Workflow.stagePrompt(run) })
      return
    }
    const wanted = stage.agent ?? run.origin
    if (wanted !== null && session.agent !== wanted)
      yield* ctx.session.switchAgent({ sessionID, agent: Agent.ID.make(wanted) })
    yield* save(sessionID, run)
    yield* send(Workflow.stagePrompt(run))
  })

  const nextStage = (sessionID: Session.ID): Send => (text) => ctx.session.synthetic({ sessionID, text, resume: true })

  // Acts on where routing went after a stage ended.
  const proceed = Effect.fnUntraced(function* (sessionID: Session.ID, step: Workflow.Step) {
    if (step.type === "done")
      return yield* finish(sessionID, step.run, `Workflow "${step.run.workflow.name}" is done.`)
    if (step.type === "blocked") return yield* finish(sessionID, step.run, `Workflow stopped. ${step.run.note}`)
    yield* begin(sessionID, step.run, nextStage(sessionID)).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("workflow stage could not start", { cause }).pipe(
          Effect.andThen(pause(sessionID, step.run, "The next stage could not start.")),
        ),
      ),
    )
  })

  // The agent of a stage has said how it went; the run it belonged to ended.
  const settle = Effect.fnUntraced(function* (sessionID: Session.ID, run: Workflow.Run, report: Workflow.Report) {
    const stage = Workflow.stageOf(run)
    if (stage === undefined) return
    if (report.outcome === "blocked")
      return yield* finish(sessionID, { ...run, status: "blocked", reported: null, child: null, note: report.summary }, `Workflow stopped. The agent needs you: ${report.summary}`)
    if (report.outcome === "fail") return yield* proceed(sessionID, Workflow.route(run, "fail", report.summary))
    if (stage.exit === "approval") {
      yield* save(sessionID, { ...run, status: "waiting", waiting: "finish", reported: report, child: null })
      return yield* say(
        sessionID,
        `Stage "${stage.title}" is done: ${report.summary}\nUse /workflow approve to go on, or tell the agent what to change.`,
      )
    }
    if (stage.exit === "command" && stage.command !== undefined) {
      const result = yield* deps.check(stage.command)
      if (!result.passed)
        return yield* proceed(
          sessionID,
          Workflow.route(run, "fail", `The check \`${stage.command}\` failed:\n${result.output}`),
        )
    }
    yield* proceed(sessionID, Workflow.route(run, "pass", report.summary))
  })

  yield* ctx.tool
    .transform((editor) =>
      editor.add({
        name: Workflow.TOOL,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input, context) =>
          Effect.gen(function* () {
            const session = yield* ctx.session.get({ sessionID: context.sessionID }).pipe(Effect.mapError(failed))
            const child = Workflow.readChild(session.metadata)
            const report = { outcome: input.outcome, summary: input.summary }
            const run = Workflow.read(session.metadata)
            if (child === undefined && !Workflow.isOpen(run))
              return yield* new ToolFailure({ message: "No workflow stage is active." })
            const metadata =
              child !== undefined
                ? Workflow.writeChild(session.metadata, { ...child, reported: report })
                : run !== undefined
                  ? Workflow.write(session.metadata, { ...run, reported: report })
                  : session.metadata
            yield* ctx.session.update({ sessionID: session.id, metadata: metadata ?? {} }).pipe(Effect.mapError(failed))
            return {
              output: { outcome: input.outcome },
              content: "Stage reported. The workflow goes on when you finish this reply.",
            }
          }),
      }),
    )
    .pipe(Effect.orDie)

  // Only a session that has a stage to report on sees the tool.
  yield* ctx.session.hook("context", (event) =>
    Effect.gen(function* () {
      if (!(Workflow.TOOL in event.tools)) return
      const session = yield* ctx.session.get({ sessionID: event.sessionID })
      if (Workflow.readChild(session.metadata) === undefined && !Workflow.isOpen(Workflow.read(session.metadata)))
        delete event.tools[Workflow.TOOL]
    }).pipe(Effect.catchCause(() => Effect.void)),
  )

  // A workflow picked in the prompt box starts with the next message, which becomes the task.
  yield* ctx.session.hook("prompt", (event) =>
    Effect.gen(function* () {
      const session = yield* ctx.session.get({ sessionID: event.sessionID })
      const id = Workflow.pending(session.metadata)
      if (id === undefined || session.parentID !== undefined) return
      const cleared = (metadata: SessionMetadata | undefined) => Workflow.writePending(metadata, undefined)
      const definition = Workflow.find(yield* deps.load, id)
      if (definition === undefined || Workflow.problems(definition).length > 0 || Workflow.isOpen(Workflow.read(session.metadata)))
        return yield* ctx.session.update({ sessionID: session.id, metadata: cleared(session.metadata) })
      const run = Workflow.start(definition, event.prompt.text, session.agent ?? DEFAULT_AGENT)
      yield* ctx.session.update({ sessionID: session.id, metadata: cleared(Workflow.write(session.metadata, run)) })
      const stage = Workflow.stageOf(run)
      if (stage?.agent !== undefined && session.agent !== stage.agent)
        yield* ctx.session.switchAgent({ sessionID: session.id, agent: Agent.ID.make(stage.agent) })
      event.prompt.text = Workflow.stagePrompt(run)
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to start the picked workflow", { cause }))),
  )

  // Inside a workflow, pushing and publishing are never approved on the user's behalf.
  yield* ctx.permission.hook("evaluate", (event) =>
    Effect.gen(function* () {
      if (event.action !== "shell" || event.effect !== "allow") return
      if (!event.resources.some((resource) => OUTWARD.some((pattern) => pattern.test(resource)))) return
      const session = yield* ctx.session.get({ sessionID: event.sessionID })
      if (Workflow.readChild(session.metadata) === undefined && !Workflow.isOpen(Workflow.read(session.metadata))) return
      event.effect = "ask"
      event.message = "A workflow is running, so pushing and opening pull requests always need your approval."
    }).pipe(Effect.catchCause(() => Effect.void)),
  )

  yield* ctx.command.transform((editor) =>
    editor.add({
      name: "workflow",
      description: "run a workflow of stages (/workflow <name> <task>, or list, status, approve, resume, stop)",
      execute: (input) =>
        Effect.gen(function* () {
          const sessionID = input.sessionID
          const session = yield* ctx.session.get({ sessionID })
          if (session.parentID !== undefined) return yield* say(sessionID, "Workflows run in the main session.")
          const run = Workflow.read(session.metadata)
          const action = Workflow.parse(input.prompt.text)
          const definitions = yield* deps.load

          if (action.type === "list")
            return yield* say(sessionID, [Workflow.listing(definitions), ...(run ? ["", Workflow.describe(run)] : [])].join("\n"))
          if (action.type === "status") return yield* say(sessionID, Workflow.describe(run))
          if (action.type === "stop") {
            if (run === undefined) return yield* say(sessionID, "No workflow to stop.")
            if (run.child !== null) yield* ctx.session.interrupt({ sessionID: Session.ID.make(run.child) }).pipe(Effect.ignore)
            yield* save(sessionID, undefined)
            yield* restoreAgent(sessionID, run).pipe(Effect.catchCause(() => Effect.void))
            return yield* say(sessionID, "Workflow stopped.")
          }
          if (action.type === "resume") {
            if (run === undefined || (run.status !== "paused" && run.status !== "blocked"))
              return yield* say(sessionID, "No paused workflow to resume.")
            const retries = { ...run.retries, [run.stage]: 0 }
            const again: Workflow.Run = {
              ...run,
              status: "running",
              waiting: null,
              retries,
              nudges: 0,
              reported: null,
              child: null,
              note: "",
            }
            return yield* begin(sessionID, again, nextStage(sessionID))
          }
          if (action.type === "approve") {
            if (run?.status !== "waiting") return yield* say(sessionID, "Nothing is waiting for your approval.")
            if (run.waiting === "start")
              return yield* begin(sessionID, { ...run, status: "running", waiting: null }, nextStage(sessionID))
            return yield* proceed(sessionID, Workflow.route({ ...run, status: "running", waiting: null }, "pass", run.reported?.summary ?? ""))
          }

          if (Workflow.isOpen(run) || run?.status === "paused")
            return yield* say(sessionID, "A workflow is already running. Use /workflow stop first.")
          const definition = Workflow.find(definitions, action.name)
          if (definition === undefined)
            return yield* say(sessionID, `There is no workflow called "${action.name}".\n${Workflow.listing(definitions)}`)
          if (action.task === "")
            return yield* say(sessionID, `Say what ${definition.name} should work on: /workflow ${definition.id} <task>`)
          const problems = Workflow.problems(definition)
          if (problems.length > 0) return yield* say(sessionID, `${definition.name} cannot run:\n${problems.join("\n")}`)
          const started = Workflow.start(definition, action.task, session.agent ?? DEFAULT_AGENT)
          yield* begin(sessionID, started, (text) =>
            ctx.session.prompt({ ...input.prompt, sessionID, text, delivery: input.delivery }),
          )
        }).pipe(Effect.asVoid),
    }),
  )

  yield* ctx.rpc
    .register(Definition, {
      list: () => deps.load.pipe(Effect.map((workflows) => ({ workflows }))),
      save: (input) => deps.save(input.scope, input.workflow).pipe(Effect.map((problems) => ({ problems }))),
      remove: (input) => deps.remove(input.scope, input.id).pipe(Effect.map((removed) => ({ removed }))),
    })
    .pipe(Effect.orDie)

  type Ended = SessionEvent.Execution.Succeeded | SessionEvent.Execution.Interrupted | SessionEvent.Execution.Failed

  // A run that ends is where a stage gets judged, and where an unfinished one gets nudged on.
  const handle = Effect.fnUntraced(function* (event: Ended) {
    const sessionID = event.data.sessionID
    const session = yield* ctx.session.get({ sessionID })
    const child = Workflow.readChild(session.metadata)
    const parentID = child === undefined ? sessionID : Session.ID.make(child.parent)
    const owner = child === undefined ? session : yield* ctx.session.get({ sessionID: parentID })
    if (child === undefined && session.parentID !== undefined) return
    const run = Workflow.read(owner.metadata)
    if (run === undefined || run.status !== "running") return
    // The run is waiting on a fresh session, or this is a fresh session the run has since moved on from.
    if (child === undefined ? run.child !== null : run.child !== sessionID) return

    if (event.type === "session.execution.failed") return yield* pause(parentID, run, "A run stopped with an error.")
    if (event.type === "session.execution.interrupted") {
      // Shutdown and recovery interruptions leave the workflow running.
      if (event.data.reason !== "user") return
      return yield* pause(parentID, run, "You stopped the agent.")
    }
    const report = child === undefined ? run.reported : child.reported
    if (report !== null) return yield* settle(parentID, run, report)
    const nudges = child === undefined ? run.nudges : child.nudges
    if (nudges >= Workflow.MAX_NUDGES)
      return yield* pause(parentID, run, "The agent ended its replies without reporting the stage.")
    if (child === undefined) yield* save(sessionID, { ...run, nudges: nudges + 1 })
    else yield* patch(sessionID, (metadata) => Workflow.writeChild(metadata, { ...child, nudges: nudges + 1 }))
    yield* ctx.session.synthetic({ sessionID, text: Workflow.nudge(run), resume: true })
  })

  yield* ctx.event.subscribe().pipe(
    Stream.filter(
      (event): event is Ended =>
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.interrupted" ||
        event.type === "session.execution.failed",
    ),
    // A check command can take minutes, so each event is handled on its own and never holds up other sessions.
    Stream.runForEach((event) =>
      handle(event).pipe(
        Effect.catchCause((cause) => Effect.logWarning("failed to continue workflow", { cause })),
        Effect.forkScoped({ startImmediately: true }),
        Effect.asVoid,
      ),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
})

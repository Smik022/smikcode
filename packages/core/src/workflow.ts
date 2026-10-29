export * as Workflow from "./workflow.js"

import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { Option, Schema } from "effect"

/** Session metadata key holding the run in progress. */
export const KEY = "workflow"

/** Session metadata key holding a workflow picked in the prompt box, which the next message starts. */
export const PENDING = "workflow_pending"

/** Session metadata key on a fresh-stage session: the run it belongs to and the result it reported. */
export const CHILD = "workflow_child"

/** The tool a stage's agent calls to say how the stage went. */
export const TOOL = "workflow_stage"

/** A target for `onPass` that ends the workflow instead of naming a stage. */
export const DONE = "done"

/** Reminders sent to an agent that ended a run without reporting its stage, before the run pauses. */
export const MAX_NUDGES = 4

/** Times a failing stage is tried again when it sets no limit of its own. */
export const DEFAULT_RETRIES = 3

/** Past stage results kept in a run, so metadata stays small. */
const MAX_REPORTS = 8

const ID = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,62}$/u))
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Stage = Schema.Struct({
  id: ID,
  title: Schema.String,
  /** What the agent should do in this stage. */
  instructions: Schema.String,
  /** `fresh` runs the stage in a new session that has not seen the earlier work. Defaults to `same`. */
  context: Schema.optional(Schema.Literals(["same", "fresh"])),
  /** Agent for this stage, such as `plan` for a read-only review. */
  agent: Schema.optional(Schema.String),
  /** Model for this stage, written `provider/model` or `provider/model#variant`. */
  model: Schema.optional(Schema.String),
  /** How the stage ends: the agent says so (default), a command passes, or the user approves. */
  exit: Schema.optional(Schema.Literals(["agent", "command", "approval"])),
  /** With `exit: "command"`, a shell command that must exit 0 once the agent reports the stage as passed. */
  command: Schema.optional(Schema.String),
  /** Wait for the user to approve before this stage starts. */
  approveFirst: Schema.optional(Schema.Boolean),
  /** The stage to go to after a pass, or `done`. Defaults to the next stage in order. */
  onPass: Schema.optional(Schema.String),
  /** Where a failure goes, and how many times. Without it a failed stage is tried again. */
  onFail: Schema.optional(Schema.Struct({ goto: ID, max: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) })),
})
export type Stage = typeof Stage.Type

export const Definition = Schema.Struct({
  id: ID,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  stages: Schema.Array(Stage),
})
export type Definition = typeof Definition.Type

export const Outcome = Schema.Literals(["pass", "fail", "blocked"])

export const Report = Schema.Struct({ outcome: Outcome, summary: Schema.String })
export type Report = typeof Report.Type

export const Run = Schema.Struct({
  /** A copy of the workflow as it was when the run started, so editing the file never changes a run. */
  workflow: Definition,
  task: Schema.String,
  /** The agent the session had when the run started, which it goes back to once a stage's agent is no longer needed. */
  origin: Schema.NullOr(Schema.String),
  stage: ID,
  status: Schema.Literals(["running", "waiting", "paused", "done", "blocked"]),
  /** What a waiting run waits for: the go-ahead to start its stage, or approval of the stage's result. */
  waiting: Schema.NullOr(Schema.Literals(["start", "finish"])),
  /** Failed attempts so far, by the stage that failed. */
  retries: Schema.Record(Schema.String, Count),
  /** Reminders sent in the current stage. */
  nudges: Count,
  /** The most recent stage results. */
  reports: Schema.Array(
    Schema.Struct({ stage: ID, outcome: Schema.Literals(["pass", "fail"]), summary: Schema.String }),
  ),
  /** What the agent reported for the current stage, until the run ends and the engine acts on it. */
  reported: Schema.NullOr(Report),
  /** The session a fresh stage runs in. */
  child: Schema.NullOr(Schema.String),
  /** A short reason shown when the run paused or stopped. */
  note: Schema.String,
})
export type Run = typeof Run.Type

export const Child = Schema.Struct({
  parent: Schema.String,
  stage: ID,
  nudges: Count,
  reported: Schema.NullOr(Report),
})
export type Child = typeof Child.Type

const decodeRun = Schema.decodeUnknownOption(Run)
const decodeChild = Schema.decodeUnknownOption(Child)
const decodeText = Schema.decodeUnknownOption(Schema.String)

export const read = (metadata: SessionMetadata | undefined) => Option.getOrUndefined(decodeRun(metadata?.[KEY]))

export const readChild = (metadata: SessionMetadata | undefined) =>
  Option.getOrUndefined(decodeChild(metadata?.[CHILD]))

export const pending = (metadata: SessionMetadata | undefined) =>
  Option.getOrUndefined(decodeText(metadata?.[PENDING]))

/** A run whose stage the agent can report on. */
export const isOpen = (run: Run | undefined) => run?.status === "running" || run?.status === "waiting"

/** Replaces one metadata key, or removes it when `value` is undefined. Other metadata is kept. */
function put(metadata: SessionMetadata | undefined, key: string, value: SessionMetadata[string] | undefined) {
  const rest = Object.fromEntries(Object.entries(metadata ?? {}).filter(([name]) => name !== key))
  return value === undefined ? rest : { ...rest, [key]: value }
}

// A run holds only plain JSON, and a round trip drops the optional fields that were never set.
const json = (value: unknown): SessionMetadata[string] => JSON.parse(JSON.stringify(value))

export const write = (metadata: SessionMetadata | undefined, run: Run | undefined) =>
  put(metadata, KEY, run === undefined ? undefined : json(run))

export const writeChild = (metadata: SessionMetadata | undefined, child: Child | undefined) =>
  put(metadata, CHILD, child === undefined ? undefined : json(child))

export const writePending = (metadata: SessionMetadata | undefined, id: string | undefined) => put(metadata, PENDING, id)

/** What is wrong with a workflow definition, in words the author can act on. Empty when it is usable. */
export function problems(definition: Definition) {
  const ids = definition.stages.map((stage) => stage.id)
  const known = new Set(ids)
  return [
    ...(definition.stages.length === 0 ? ["It has no stages."] : []),
    ...ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `Two stages are called "${id}".`),
    ...definition.stages.flatMap((stage) => [
      ...(stage.exit === "command" && !stage.command?.trim()
        ? [`Stage "${stage.id}" ends with a command but has none.`]
        : []),
      ...(stage.onPass !== undefined && stage.onPass !== DONE && !known.has(stage.onPass)
        ? [`Stage "${stage.id}" goes on to "${stage.onPass}", which does not exist.`]
        : []),
      ...(stage.onFail !== undefined && !known.has(stage.onFail.goto)
        ? [`Stage "${stage.id}" goes back to "${stage.onFail.goto}" on failure, which does not exist.`]
        : []),
    ]),
  ]
}

export const find = (definitions: ReadonlyArray<Definition>, name: string) => {
  const wanted = name.trim().toLowerCase()
  return definitions.find((item) => item.id === wanted || item.name.toLowerCase() === wanted)
}

export const stageOf = (run: Run) => run.workflow.stages.find((stage) => stage.id === run.stage)

const first = (definition: Definition): Stage => {
  const stage = definition.stages[0]
  if (stage === undefined) throw new Error("A workflow needs at least one stage.")
  return stage
}

// Moves a run to a stage. Whatever the previous stage reported or spawned no longer applies.
function enter(run: Run, stage: Stage, changes: Pick<Run, "reports" | "retries">): Run {
  return {
    workflow: run.workflow,
    task: run.task,
    origin: run.origin,
    stage: stage.id,
    status: stage.approveFirst ? "waiting" : "running",
    waiting: stage.approveFirst ? "start" : null,
    retries: changes.retries,
    nudges: 0,
    reports: changes.reports,
    reported: null,
    child: null,
    note: "",
  }
}

/** Starts a run at the first stage. The user just asked for it, so the first stage never waits for approval. */
export function start(definition: Definition, task: string, origin: string | null): Run {
  const run = enter(
    {
      workflow: definition,
      task,
      origin,
      stage: "",
      status: "running",
      waiting: null,
      retries: {},
      nudges: 0,
      reports: [],
      reported: null,
      child: null,
      note: "",
    },
    first(definition),
    { reports: [], retries: {} },
  )
  return { ...run, status: "running", waiting: null }
}

export type Step =
  | { readonly type: "enter"; readonly run: Run }
  | { readonly type: "done"; readonly run: Run }
  | { readonly type: "blocked"; readonly run: Run }

/** Decides what comes after the current stage ended with `outcome`. */
export function route(run: Run, outcome: "pass" | "fail", summary: string): Step {
  const stages = run.workflow.stages
  const index = stages.findIndex((stage) => stage.id === run.stage)
  const current = stages[index]
  if (current === undefined) return { type: "blocked", run: { ...run, status: "blocked", note: "The stage is missing." } }
  const reports = [...run.reports, { stage: current.id, outcome, summary }].slice(-MAX_REPORTS)
  const ended = (status: "done" | "blocked", note: string): Run => ({
    ...run,
    status,
    waiting: null,
    reports,
    reported: null,
    child: null,
    nudges: 0,
    note,
  })
  const go = (target: string, retries: Run["retries"]): Step => {
    const stage = stages.find((item) => item.id === target)
    if (stage === undefined) return { type: "blocked", run: ended("blocked", `Stage "${target}" does not exist.`) }
    return { type: "enter", run: enter(run, stage, { reports, retries }) }
  }

  if (outcome === "pass") {
    const target = current.onPass ?? stages[index + 1]?.id ?? DONE
    if (target === DONE) return { type: "done", run: ended("done", "") }
    return go(target, run.retries)
  }
  const used = run.retries[current.id] ?? 0
  const limit = current.onFail?.max ?? DEFAULT_RETRIES
  if (used >= limit)
    return { type: "blocked", run: ended("blocked", `Stage "${current.title}" failed ${used} times, so the workflow stopped.`) }
  return go(current.onFail?.goto ?? current.id, { ...run.retries, [current.id]: used + 1 })
}

/** The instructions for the run's current stage, with what the earlier stages reported. */
export function stagePrompt(run: Run) {
  const stages = run.workflow.stages
  const stage = stageOf(run)
  if (stage === undefined) return ""
  const position = `${stages.findIndex((item) => item.id === stage.id) + 1}/${stages.length}`
  const last = run.reports.at(-1)
  const earlier = run.reports.findLast((item) => item.outcome === "pass" && item.stage !== stage.id)
  const exit = stage.exit ?? "agent"
  return [
    `<workflow name="${run.workflow.name}" stage="${position}" title="${stage.title}">`,
    `Task: ${run.task}`,
    "</workflow>",
    "",
    `Stage ${position}: ${stage.title}`,
    stage.instructions.trim(),
    ...(earlier ? ["", `Result of the earlier stage "${titleOf(run, earlier.stage)}":`, earlier.summary] : []),
    ...(last?.outcome === "fail"
      ? [
          "",
          last.stage === stage.id
            ? "The last attempt at this stage failed:"
            : `Stage "${titleOf(run, last.stage)}" failed and sent the work back to this stage:`,
          last.summary,
          "Fix what it names.",
        ]
      : []),
    ...(stage.context === "fresh"
      ? [
          "",
          "You are starting with a clean context and have not seen the earlier work. Look at the repository yourself, for example with git status and git diff, before you judge anything.",
        ]
      : []),
    "",
    `When this stage is finished, call the ${TOOL} tool. Use outcome "pass" if the stage's goal is met, "fail" if it is not and the work needs another attempt, or "blocked" if you cannot go on without the user. Put what you did, what you found, or what you need in the summary.`,
    ...(exit === "command"
      ? [`After you report "pass", SmikCode runs \`${stage.command}\`. The stage passes only if it exits with 0.`]
      : []),
    ...(exit === "approval" ? ["After you report \"pass\", the workflow waits for the user to approve before it goes on."] : []),
  ].join("\n")
}

const titleOf = (run: Run, stage: string) => run.workflow.stages.find((item) => item.id === stage)?.title ?? stage

export const nudge = (run: Run) =>
  `<system-reminder>The workflow stage "${stageOf(run)?.title ?? run.stage}" is not finished. Keep working on it. When it is done, call the ${TOOL} tool with outcome "pass", "fail" or "blocked" and a summary.</system-reminder>`

/** The note put in the session when a stage runs in a session of its own. */
export const handoff = (run: Run) =>
  `Stage "${stageOf(run)?.title ?? run.stage}" is running in a fresh session so that it sees the work without having been part of it.`

export function describe(run: Run | undefined) {
  if (run === undefined) return "No workflow is running. Use /workflow <name> <task> to start one, or /workflow list."
  const stages = run.workflow.stages
  const index = stages.findIndex((stage) => stage.id === run.stage)
  const lines = stages.map((stage, position) => {
    const mark = run.status === "done" || position < index ? "done" : position === index ? "now " : "    "
    return `  [${mark}] ${stage.title}`
  })
  const waiting =
    run.waiting === "start"
      ? " Waiting for /workflow approve to start this stage."
      : run.waiting === "finish"
        ? " Waiting for /workflow approve to accept this stage."
        : ""
  const note = run.note === "" ? "" : ` ${run.note}`
  return [`${run.workflow.name} (${run.status}): ${run.task}${waiting}${note}`, ...lines].join("\n")
}

export function listing(definitions: ReadonlyArray<Definition>) {
  if (definitions.length === 0) return "There are no workflows yet."
  return [
    "Workflows (start one with /workflow <name> <task>):",
    ...definitions.map(
      (item) => `  ${item.id} - ${item.name}${item.description ? `: ${item.description}` : ""} (${item.stages.length} stages)`,
    ),
  ].join("\n")
}

export type Action =
  | { readonly type: "list" }
  | { readonly type: "status" }
  | { readonly type: "stop" }
  | { readonly type: "resume" }
  | { readonly type: "approve" }
  | { readonly type: "start"; readonly name: string; readonly task: string }

export function parse(input: string): Action {
  const match = /^(\S+)\s*([\s\S]*)$/u.exec(input.trim())
  if (match === null) return { type: "list" }
  const word = (match[1] ?? "").toLowerCase()
  if (word === "list") return { type: "list" }
  if (word === "status") return { type: "status" }
  if (word === "stop" || word === "cancel") return { type: "stop" }
  if (word === "resume" || word === "retry") return { type: "resume" }
  if (word === "approve" || word === "next") return { type: "approve" }
  return { type: "start", name: word, task: (match[2] ?? "").trim() }
}

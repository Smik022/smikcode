export * as Workflow from "./workflow.js"

import { Workflow as Stored } from "@opencode/schema/workflow"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { Option, Schema } from "effect"

// The stored form is shared with clients that show, pick and edit workflows.
export const KEY = Stored.KEY
export const PENDING = Stored.PENDING
export const DONE = Stored.DONE
export const DRAFT = Stored.DRAFT
export const DEFAULT_RETRIES = Stored.DEFAULT_RETRIES
export const DEFAULT_MAX_STEPS = Stored.DEFAULT_MAX_STEPS
export const CHANGES = Stored.CHANGES
export const Stage = Stored.Stage
export type Stage = Stored.Stage
export const Definition = Stored.Definition
export type Definition = Stored.Definition
export const Source = Stored.Source
export type Source = Stored.Source
export const Listed = Stored.Listed
export const Outcome = Stored.Outcome
export const Report = Stored.Report
export type Report = Stored.Report
export const Run = Stored.Run
export type Run = Stored.Run
export const read = Stored.read
export const pending = Stored.pending
export const draft = Stored.draft
export const clearDraft = Stored.clearDraft
export const isOpen = Stored.isOpen
export const writePending = Stored.writePending
export const problems = Stored.problems
export const OUTWARD = Stored.OUTWARD

/** Session metadata key on a fresh-stage session: the run it belongs to and the result it reported. */
export const CHILD = "workflow_child"

/** The tool a stage's agent calls to say how the stage went. */
export const TOOL = "workflow_stage"

/** Reminders sent to an agent that ended a run without reporting its stage, before the run pauses. */
export const MAX_NUDGES = 4

/** Past stage results kept in a run, so metadata stays small. */
const MAX_REPORTS = 8

const ID = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,62}$/u))
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Child = Schema.Struct({
  parent: Schema.String,
  stage: ID,
  nudges: Count,
  reported: Schema.NullOr(Stored.Report),
})
export type Child = typeof Child.Type

const decodeChild = Schema.decodeUnknownOption(Child)

export const readChild = (metadata: SessionMetadata | undefined) =>
  Option.getOrUndefined(decodeChild(metadata?.[CHILD]))

/** Replaces one metadata key, or removes it when `value` is undefined. Other metadata is kept. */
function put(metadata: SessionMetadata | undefined, key: string, value: SessionMetadata[string] | undefined) {
  const rest = Object.fromEntries(Object.entries(metadata ?? {}).filter(([name]) => name !== key))
  return value === undefined ? rest : { ...rest, [key]: value }
}

// A run holds only plain JSON, and a round trip drops the optional fields that were never set.
const json = (value: unknown): SessionMetadata[string] => JSON.parse(JSON.stringify(value))

export const write = (metadata: SessionMetadata | undefined, run: Run | undefined) =>
  put(metadata, KEY, run === undefined ? undefined : json(run))

export const writeDraft = (metadata: SessionMetadata | undefined, definition: Definition) =>
  put(metadata, DRAFT, json(definition))

export const writeChild = (metadata: SessionMetadata | undefined, child: Child | undefined) =>
  put(metadata, CHILD, child === undefined ? undefined : json(child))

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
    steps: (run.steps ?? 0) + 1,
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
  const limit = run.workflow.maxSteps ?? DEFAULT_MAX_STEPS
  const go = (target: string, retries: Run["retries"]): Step => {
    const stage = stages.find((item) => item.id === target)
    if (stage === undefined) return { type: "blocked", run: ended("blocked", `Stage "${target}" does not exist.`) }
    if ((run.steps ?? 0) >= limit)
      return { type: "blocked", run: ended("blocked", `The workflow went through ${limit} stages without finishing, so it stopped.`) }
    return { type: "enter", run: enter(run, stage, { reports, retries }) }
  }

  if (outcome === "pass") {
    const target = current.onPass ?? stages[index + 1]?.id ?? DONE
    if (target === DONE) return { type: "done", run: ended("done", "") }
    return go(target, run.retries)
  }
  const used = run.retries[current.id] ?? 0
  const attempts = current.onFail?.max ?? DEFAULT_RETRIES
  if (used >= attempts)
    return { type: "blocked", run: ended("blocked", `Stage "${current.title}" failed ${used + 1} times, so the workflow stopped.`) }
  return go(current.onFail?.goto ?? current.id, { ...run.retries, [current.id]: used + 1 })
}

/**
 * Moves the run to a stage the user chose, whatever the stage's own routing says. The stage starts afresh, with its
 * failed attempts forgotten. The stage budget does not apply: the user is steering.
 */
export function jump(run: Run, target: string, note: string): Step {
  const stage = run.workflow.stages.find((item) => item.id === target)
  if (stage === undefined) return { type: "blocked", run: { ...run, status: "blocked", note: `Stage "${target}" does not exist.` } }
  const current = run.workflow.stages.find((item) => item.id === run.stage)
  const reports = current === undefined ? run.reports : [...run.reports, { stage: current.id, outcome: "pass" as const, summary: note }].slice(-MAX_REPORTS)
  return { type: "enter", run: enter(run, stage, { reports, retries: { ...run.retries, [stage.id]: 0 } }) }
}

/** The run back at its current stage, with the user's request for changes to what it reported. */
export function revise(run: Run, text: string): Run {
  const stage = run.workflow.stages.find((item) => item.id === run.stage)
  const reports = [...run.reports, { stage: run.stage, outcome: "fail" as const, summary: `${CHANGES}${text}` }].slice(-MAX_REPORTS)
  return {
    ...(stage === undefined ? run : enter(run, stage, { reports, retries: run.retries })),
    status: "running",
    waiting: null,
  }
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
    ...(last?.outcome === "fail" && last.summary.startsWith(CHANGES)
      ? ["", "The user looked at your result for this stage and asked for changes:", last.summary.slice(CHANGES.length), "Make those changes."]
      : last?.outcome === "fail"
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
  | { readonly type: "new"; readonly text: string }
  | { readonly type: "save"; readonly scope: "global" | "project" }
  | { readonly type: "discard" }
  | { readonly type: "skip" }
  | { readonly type: "back" }
  | { readonly type: "goto"; readonly stage: string }
  | { readonly type: "changes"; readonly text: string }
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
  if (word === "new" || word === "draft" || word === "create") return { type: "new", text: (match[2] ?? "").trim() }
  if (word === "save") return { type: "save", scope: (match[2] ?? "").trim().toLowerCase() === "project" ? "project" : "global" }
  if (word === "discard") return { type: "discard" }
  if (word === "skip") return { type: "skip" }
  if (word === "back") return { type: "back" }
  if (word === "goto" || word === "jump") return { type: "goto", stage: (match[2] ?? "").trim().toLowerCase() }
  if (word === "changes" || word === "revise") return { type: "changes", text: (match[2] ?? "").trim() }
  return { type: "start", name: word, task: (match[2] ?? "").trim() }
}

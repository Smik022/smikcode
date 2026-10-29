export * as Workflow from "./workflow.js"

import { Option, Schema } from "effect"

/** Session metadata key holding the run in progress. */
export const KEY = "workflow"

/** Session metadata key holding a workflow picked in the prompt box, which the next message starts. */
export const PENDING = "workflow_pending"

/** Session metadata key holding a workflow drafted from a description, until the user saves or discards it. */
export const DRAFT = "workflow_draft"

/** A target for `onPass` that ends the workflow instead of naming a stage. */
export const DONE = "done"

/** Times a failing stage is tried again when it sets no limit of its own. */
export const DEFAULT_RETRIES = 3

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

/** Where a workflow comes from. A later source replaces an earlier one with the same id. */
export const Source = Schema.Literals(["builtin", "global", "project"])
export type Source = typeof Source.Type

/** A workflow as the backend lists it. */
export const Listed = Schema.Struct({ ...Definition.fields, source: Source })
export type Listed = typeof Listed.Type

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

const decodeRun = Schema.decodeUnknownOption(Run)
const decodeText = Schema.decodeUnknownOption(Schema.String)

// Generic over the value type so callers keep their own JSON typing (schema and generated client types differ).
type Metadata<T> = Readonly<Record<string, T>> | undefined

/** The run stored in a session's metadata, if it holds a valid one. */
export const read = (metadata: Readonly<Record<string, unknown>> | undefined) =>
  Option.getOrUndefined(decodeRun(metadata?.[KEY]))

/** The workflow picked in the prompt box that the next message starts. */
export const pending = (metadata: Readonly<Record<string, unknown>> | undefined) =>
  Option.getOrUndefined(decodeText(metadata?.[PENDING]))

const decodeDefinition = Schema.decodeUnknownOption(Definition)

/** The workflow drafted from a description in this session, if there is one. */
export const draft = (metadata: Readonly<Record<string, unknown>> | undefined) =>
  Option.getOrUndefined(decodeDefinition(metadata?.[DRAFT]))

/** A run whose stage the agent can report on. */
export const isOpen = (run: Run | undefined) => run?.status === "running" || run?.status === "waiting"

/** The metadata with one key replaced, or removed when `value` is undefined. Other metadata is kept. */
export function put<T>(metadata: Metadata<T>, key: string, value: T | string | undefined) {
  const rest: Record<string, T | string> = Object.fromEntries(Object.entries(metadata ?? {}).filter(([name]) => name !== key))
  return value === undefined ? rest : { ...rest, [key]: value }
}

export const writePending = <T>(metadata: Metadata<T>, id: string | undefined) => put(metadata, PENDING, id)

/** The metadata without a finished or abandoned run. */
export const clear = <T>(metadata: Metadata<T>) => put(metadata, KEY, undefined)

/** The metadata without a drafted workflow. */
export const clearDraft = <T>(metadata: Metadata<T>) => put(metadata, DRAFT, undefined)

/** Words that /workflow reads as commands, so a workflow cannot be called one of them. */
export const RESERVED = ["list", "status", "stop", "cancel", "resume", "retry", "approve", "next", "new", "draft", "create", "save", "discard", DONE]

/** The message of the prompt a workflow forces for pushing and publishing. Clients never answer it for the user. */
export const OUTWARD = "A workflow is running, so pushing and opening pull requests always need your approval."

const MODEL = /^[^\s/]+\/[^\s#]+(?:#\S+)?$/u

/** What is wrong with a workflow definition, in words the author can act on. Empty when it is usable. */
export function problems(definition: Definition) {
  const ids = definition.stages.map((stage) => stage.id)
  const known = new Set(ids)
  return [
    ...(RESERVED.includes(definition.id) ? [`"${definition.id}" is a command word, so a workflow cannot be called that.`] : []),
    ...(definition.stages.length === 0 ? ["It has no stages."] : []),
    ...ids.filter((id, index) => ids.indexOf(id) !== index).map((id) => `Two stages are called "${id}".`),
    ...(ids.includes(DONE) ? [`A stage cannot be called "${DONE}", because that word ends the workflow.`] : []),
    ...definition.stages.flatMap((stage) => [
      ...(stage.exit === "command" && !stage.command?.trim()
        ? [`Stage "${stage.id}" ends with a command but has none.`]
        : []),
      ...(stage.model !== undefined && !MODEL.test(stage.model)
        ? [`Stage "${stage.id}" names the model "${stage.model}", which must be written provider/model or provider/model#variant.`]
        : []),
      ...(stage.onPass !== undefined && stage.onPass !== DONE && !known.has(stage.onPass)
        ? [`Stage "${stage.id}" goes on to "${stage.onPass}", which does not exist.`]
        : []),
      ...(stage.onFail !== undefined && !known.has(stage.onFail.goto)
        ? [`Stage "${stage.id}" goes back to "${stage.onFail.goto}" on failure, which does not exist.`]
        : []),
    ]),
    ...loops(definition),
  ]
}

// Following passes from the first stage must end, unless a stage in the loop waits for the user, who can end it.
function loops(definition: Definition) {
  const stages = definition.stages
  const index = new Map(stages.map((stage, position) => [stage.id, position]))
  const next = (position: number) => {
    const stage = stages[position]
    if (stage === undefined) return undefined
    if (stage.onPass === undefined) return position + 1 < stages.length ? position + 1 : undefined
    return stage.onPass === DONE ? undefined : index.get(stage.onPass)
  }
  const seen: number[] = []
  let at: number | undefined = stages.length === 0 ? undefined : 0
  while (at !== undefined && !seen.includes(at)) {
    seen.push(at)
    at = next(at)
  }
  if (at === undefined) return []
  const cycle = seen.slice(seen.indexOf(at))
  if (cycle.some((position) => stages[position]?.exit === "approval")) return []
  return [`Following passes from the first stage goes round in a loop (${cycle.map((position) => stages[position]?.id).join(" > ")}) and never finishes.`]
}

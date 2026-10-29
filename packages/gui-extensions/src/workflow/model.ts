import { Workflow } from "@opencode/schema/workflow"

/** A stage as the editor holds it. Every field is text or a choice, so inputs bind to them directly. */
export type DraftStage = {
  /** Never shown. Fixed when the stage is added, so renaming a stage never breaks what points at it. */
  id: string
  title: string
  instructions: string
  context: "same" | "fresh"
  agent: string
  model: string
  exit: "agent" | "command" | "approval"
  command: string
  approveFirst: boolean
  /** A stage id, `done`, or empty for the next stage. */
  onPass: string
  /** A stage id to go back to on failure, or empty to try this stage again. */
  failGoto: string
  /** Attempts before the workflow stops, or empty for the default. */
  failMax: string
}

export type Draft = {
  id: string
  name: string
  description: string
  /** Where the workflow is saved. */
  scope: "global" | "project"
  /** Not saved yet, so its id still follows its name. */
  fresh: boolean
  stages: DraftStage[]
}

/** The id a name turns into: lower case letters, digits, "-" and "_", made different from every one in `taken`. */
export function slug(text: string, taken: ReadonlySet<string>, fallback: string) {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 56) || fallback

  return [base, ...Array.from({ length: 99 }, (_, index) => `${base}-${index + 2}`)].find((id) => !taken.has(id)) ?? base
}

export function blankStage(draft: Pick<Draft, "stages">, title: string): DraftStage {
  return {
    id: slug(title, new Set(draft.stages.map((stage) => stage.id)), "stage"),
    title,
    instructions: "",
    context: "same",
    agent: "",
    model: "",
    exit: "agent",
    command: "",
    approveFirst: false,
    onPass: "",
    failGoto: "",
    failMax: "",
  }
}

export function blank(scope: Draft["scope"], title: string): Draft {
  const draft = { id: "", name: "", description: "", scope, fresh: true, stages: [] }

  return { ...draft, stages: [blankStage(draft, title)] }
}

export function fromDefinition(definition: Workflow.Definition, scope: Draft["scope"], fresh = false): Draft {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    scope,
    fresh,
    stages: definition.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      instructions: stage.instructions,
      context: stage.context ?? "same",
      agent: stage.agent ?? "",
      model: stage.model ?? "",
      exit: stage.exit ?? "agent",
      command: stage.command ?? "",
      approveFirst: stage.approveFirst ?? false,
      onPass: stage.onPass ?? "",
      failGoto: stage.onFail && stage.onFail.goto !== stage.id ? stage.onFail.goto : "",
      failMax: stage.onFail ? String(stage.onFail.max) : "",
    })),
  }
}

/**
 * The file's contents: only what differs from the defaults, so a saved workflow reads like one written by hand. The
 * first stage always runs in this chat and never waits, so it keeps neither setting.
 */
export function toDefinition(draft: Draft): Workflow.Definition {
  const name = draft.name.trim()
  const description = draft.description.trim()
  const stages = draft.stages.map(stageOf)

  if (description === "") return { id: draft.id, name, stages }

  return { id: draft.id, name, description, stages }
}

type Writable<T> = { -readonly [K in keyof T]: T[K] }

function stageOf(stage: DraftStage, index: number): Workflow.Stage {
  const result: Writable<Workflow.Stage> = {
    id: stage.id,
    title: stage.title.trim(),
    instructions: stage.instructions.trim(),
  }

  const agent = stage.agent.trim()
  const model = stage.model.trim()
  const fresh = stage.context === "fresh" && index > 0

  if (fresh) result.context = "fresh"

  if (agent !== "") result.agent = agent

  if (fresh && model !== "") result.model = model

  if (stage.exit !== "agent") result.exit = stage.exit

  if (stage.exit === "command") result.command = stage.command.trim()

  if (stage.approveFirst && index > 0) result.approveFirst = true

  if (stage.onPass !== "") result.onPass = stage.onPass

  if (stage.failGoto !== "" || stage.failMax.trim() !== "") {
    const max = Math.floor(Number(stage.failMax))

    result.onFail = {
      goto: stage.failGoto === "" ? stage.id : stage.failGoto,
      max: Number.isFinite(max) && max >= 1 ? max : Workflow.DEFAULT_RETRIES,
    }
  }

  return result
}

/** The draft without a stage, and without anything that went to it. */
export function removeStage(draft: Draft, id: string): Draft {
  return {
    ...draft,
    stages: draft.stages
      .filter((stage) => stage.id !== id)
      .map((stage) => ({
        ...stage,
        onPass: stage.onPass === id ? "" : stage.onPass,
        failGoto: stage.failGoto === id ? "" : stage.failGoto,
      })),
  }
}

/** The draft with a stage moved one place up (-1) or down (1). */
export function moveStage(draft: Draft, id: string, direction: -1 | 1): Draft {
  const from = draft.stages.findIndex((stage) => stage.id === id)
  const to = from + direction

  if (from < 0 || to < 0 || to >= draft.stages.length) return draft
  const stages = [...draft.stages]
  const moved = stages.splice(from, 1)[0]

  if (!moved) return draft
  stages.splice(to, 0, moved)

  return { ...draft, stages }
}

/** What stops a draft from being saved, as keys the page turns into words. Empty when it can be saved. */
export function missing(draft: Draft) {
  return [
    ...(draft.name.trim() === "" ? ["name" as const] : []),
    ...(draft.stages.some((stage) => stage.title.trim() === "") ? ["title" as const] : []),
    ...(draft.stages.some((stage) => stage.instructions.trim() === "") ? ["instructions" as const] : []),
    ...(draft.stages.some((stage) => stage.exit === "command" && stage.command.trim() === "") ? ["command" as const] : []),
  ]
}

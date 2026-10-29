import { describe, expect, test } from "bun:test"
import { Workflow } from "@opencode/schema/workflow"
import { Schema } from "effect"
import { asJson, blank, blankStage, copyOf, fromDefinition, missing, moveStage, parseImport, removeStage, slug, toDefinition } from "./model"

const review: Workflow.Definition = {
  id: "review",
  name: "Build, then review",
  description: "A second pair of eyes",
  stages: [
    { id: "build", title: "Build", instructions: "Build it." },
    {
      id: "review",
      title: "Review",
      instructions: "Review it.",
      context: "fresh",
      agent: "plan",
      model: "anthropic/claude#high",
      onPass: "done",
      onFail: { goto: "fix", max: 2 },
    },
    { id: "fix", title: "Fix", instructions: "Fix it.", exit: "command", command: "bun test", onPass: "review" },
    { id: "ship", title: "Ship", instructions: "Ship it.", exit: "approval", approveFirst: true },
  ],
}

describe("workflow editor model", () => {
  test("a workflow opened and saved again is the same file", () => {
    expect(toDefinition(fromDefinition(review, "project"))).toEqual(review)
  })

  test("ids are valid, and a name that is taken gets a number", () => {
    const valid = Schema.is(Workflow.Definition.fields.id)

    expect(slug("My TDD flow!", new Set(), "workflow")).toBe("my-tdd-flow")
    expect(slug("***", new Set(), "workflow")).toBe("workflow")
    expect(slug("Review", new Set(["review", "review-2"]), "workflow")).toBe("review-3")
    expect(valid(slug("  Ünïcode — name  ", new Set(), "workflow"))).toBe(true)
  })

  test("only settings that differ from the defaults are written", () => {
    const draft = blank("global", "Plan")
    const stage = draft.stages[0]

    if (stage === undefined) throw new Error("a new draft has a stage")
    stage.instructions = "  Plan it.  "
    draft.name = " Mine "
    draft.id = "mine"

    expect(toDefinition(draft)).toEqual({
      id: "mine",
      name: "Mine",
      stages: [{ id: "plan", title: "Plan", instructions: "Plan it." }],
    })
  })

  test("the first stage never keeps a fresh context or a wait for approval", () => {
    const draft = fromDefinition(review, "project")
    const first = draft.stages[0]

    if (first === undefined) throw new Error("the sample has stages")
    first.context = "fresh"
    first.approveFirst = true
    first.model = "x/y"

    expect(toDefinition(draft).stages[0]).toEqual({ id: "build", title: "Build", instructions: "Build it." })
  })

  test("a failure limit with no stage to go back to means trying the same stage again", () => {
    const draft = fromDefinition(review, "project")
    const stage = draft.stages[2]

    if (stage === undefined) throw new Error("the sample has stages")
    stage.failMax = "5"

    expect(toDefinition(draft).stages[2]?.onFail).toEqual({ goto: "fix", max: 5 })
  })

  test("removing a stage clears whatever pointed at it, so the result still passes validation", () => {
    const draft = removeStage(fromDefinition(review, "project"), "fix")

    expect(draft.stages.map((stage) => stage.id)).toEqual(["build", "review", "ship"])
    expect(draft.stages[1]?.failGoto).toBe("")
    expect(Workflow.problems(toDefinition(draft))).toEqual([])
  })

  test("moving a stage swaps it with its neighbour and stops at the ends", () => {
    const draft = fromDefinition(review, "project")

    expect(moveStage(draft, "fix", -1).stages.map((stage) => stage.id)).toEqual(["build", "fix", "review", "ship"])
    expect(moveStage(draft, "build", -1)).toBe(draft)
    expect(moveStage(draft, "ship", 1)).toBe(draft)
  })

  test("a new stage gets an id that no stage has", () => {
    const draft = fromDefinition(review, "project")

    expect(blankStage(draft, "Review").id).toBe("review-2")
  })

  test("says what is still missing", () => {
    const draft = blank("global", "Plan")

    expect(missing(draft)).toEqual(["name", "instructions"])
    draft.name = "Mine"
    draft.stages[0] = { ...blankStage(draft, "Plan"), instructions: "Do", exit: "command" }
    expect(missing(draft)).toEqual(["command"])
  })
  test("time limits and the stage budget are kept, and a field that is not a whole number is dropped", () => {
    const limited: Workflow.Definition = {
      id: "limited",
      name: "Limited",
      maxSteps: 12,
      stages: [
        { id: "a", title: "A", instructions: "x", timeoutMinutes: 30 },
        { id: "b", title: "B", instructions: "y" },
      ],
    }

    expect(toDefinition(fromDefinition(limited, "global"))).toEqual(limited)
    const draft = fromDefinition(limited, "global")
    draft.maxSteps = "0"
    draft.stages[0]!.timeout = "soon"
    expect(toDefinition(draft)).toEqual({ id: "limited", name: "Limited", stages: limited.stages.map((stage) => ({ id: stage.id, title: stage.title, instructions: stage.instructions })) })
  })

  test("a copy is a new workflow with its own id and name, and exports as the file's text", () => {
    const copy = copyOf(review, "Build, then review copy", "project", new Set(["review", "review-copy"]))

    expect(copy).toMatchObject({ id: "review-copy-2", name: "Build, then review copy", fresh: true, scope: "project" })
    expect(copy.stages.map((stage) => stage.id)).toEqual(review.stages.map((stage) => stage.id))
    expect(JSON.parse(asJson(copy))).toEqual({ ...review, id: "review-copy-2", name: "Build, then review copy" })
  })

  test("imports a pasted workflow from text around it, without replacing one that has its id", () => {
    const pasted = `Here you go:\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``

    expect(parseImport(pasted, new Set())).toEqual({ type: "ok", workflow: review })
    expect(parseImport(pasted, new Set(["review"]))).toMatchObject({ type: "ok", workflow: { id: "review-2" } })
    expect(parseImport("not a workflow", new Set())).toEqual({ type: "format" })
    expect(parseImport('{ "id": "x", "name": "X" }', new Set())).toEqual({ type: "format" })
    expect(parseImport(JSON.stringify({ ...review, id: "save" }), new Set())).toMatchObject({ type: "problems" })
  })

})

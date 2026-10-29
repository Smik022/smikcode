import { describe, expect, test } from "bun:test"
import { Workflow } from "../src/workflow"
import { WorkflowDraft } from "../src/workflow-draft"

const reply = {
  id: "spec-test-review",
  name: "Spec, test, review",
  description: "A short spec, a failing test, the change, then a fresh review",
  stages: [
    { id: "spec", title: "Spec", instructions: "Write a half-page spec.", exit: "approval" },
    { id: "red", title: "Failing test", instructions: "Write one failing test." },
    { id: "green", title: "Make it pass", instructions: "Make it pass.", exit: "command", command: "bun test" },
    {
      id: "review",
      title: "Review",
      instructions: "Review the change. Do not edit files.",
      context: "fresh",
      agent: "plan",
      onPass: "done",
      onFail: { goto: "green", max: 2 },
    },
  ],
}

describe("workflow draft", () => {
  test("reads a workflow out of a reply that has a code fence and words around it", () => {
    const text = `Here is the workflow:\n\`\`\`json\n${JSON.stringify(reply, null, 2)}\n\`\`\`\nTell me if you want changes.`
    const result = WorkflowDraft.parse(text, new Set())

    expect(result.problems).toEqual([])
    expect(result.workflow?.stages.map((stage) => stage.id)).toEqual(["spec", "red", "green", "review"])
    expect(result.workflow && Workflow.problems(result.workflow)).toEqual([])
  })

  test("never reuses an id that is taken, so a draft cannot replace another workflow", () => {
    const result = WorkflowDraft.parse(JSON.stringify(reply), new Set(["spec-test-review", "spec-test-review-2"]))

    expect(result.workflow?.id).toBe("spec-test-review-3")
  })

  test("the first stage runs in this chat and never waits, whatever the model said", () => {
    const first = { ...reply.stages[0], context: "fresh", approveFirst: true, model: "x/y" }
    const result = WorkflowDraft.parse(JSON.stringify({ ...reply, stages: [first, ...reply.stages.slice(1)] }), new Set())

    expect(result.workflow?.stages[0]).toEqual({ id: "spec", title: "Spec", instructions: "Write a half-page spec.", exit: "approval" })
  })

  test("says what is wrong when the reply is not a workflow, or is one that cannot run", () => {
    expect(WorkflowDraft.parse("I cannot do that.", new Set()).problems).toHaveLength(1)
    expect(WorkflowDraft.parse('{ "id": "x", "name": "X" }', new Set()).problems).toHaveLength(1)

    const broken = { ...reply, stages: [{ id: "a", title: "A", instructions: "x", onPass: "nowhere" }] }

    expect(WorkflowDraft.parse(JSON.stringify(broken), new Set()).problems).toEqual([
      'Stage "a" goes on to "nowhere", which does not exist.',
    ])
  })

  test("the prompt carries the request, the taken ids and what was wrong last time", () => {
    const text = WorkflowDraft.prompt("  tests first, then review  ", ["tdd", "sdd"], ["It has no stages."])

    expect(text).toContain("tdd, sdd")
    expect(text).toContain("- It has no stages.")
    expect(text.endsWith("tests first, then review")).toBe(true)
    expect(WorkflowDraft.prompt("x", [])).not.toContain("could not be used")
  })

  test("the outline names every stage and how to keep or drop the draft", () => {
    const result = WorkflowDraft.parse(JSON.stringify(reply), new Set())
    const text = result.workflow ? WorkflowDraft.outline(result.workflow) : ""

    expect(text).toContain("3. Make it pass (must pass `bun test`)")
    expect(text).toContain("4. Review (fresh session, plan agent)")
    expect(text).toContain("/workflow save project")
  })
})

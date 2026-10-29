import { describe, expect, test } from "bun:test"
import { Workflow } from "@opencode/schema/workflow"
import { DONE, START, box, edges, height, routes, SIZE } from "./flow"
import { fromDefinition } from "./model"

const review: Workflow.Definition = {
  id: "review",
  name: "Build, then review",
  stages: [
    { id: "build", title: "Build", instructions: "Build it." },
    {
      id: "review",
      title: "Review",
      instructions: "Review it.",
      context: "fresh",
      onPass: "done",
      onFail: { goto: "fix", max: 2 },
    },
    { id: "fix", title: "Fix", instructions: "Fix it.", onPass: "review" },
  ],
}

const stages = fromDefinition(review, "project").stages

describe("workflow flow", () => {
  test("draws what the engine does: a pass goes where onPass says, a failure where onFail says", () => {
    expect(edges(stages)).toEqual([
      { from: START, to: 0, kind: "next" },
      { from: 0, to: 1, kind: "next" },
      { from: 0, to: 0, kind: "retry", attempts: Workflow.DEFAULT_RETRIES },
      { from: 1, to: DONE, kind: "pass" },
      { from: 1, to: 2, kind: "fail", attempts: 2 },
      { from: 2, to: 1, kind: "pass" },
      { from: 2, to: 2, kind: "retry", attempts: Workflow.DEFAULT_RETRIES },
    ])
  })

  test("the last stage runs on to the end, and a pass to the end from there is not a jump", () => {
    const only = fromDefinition({ id: "one", name: "One", stages: [{ id: "a", title: "A", instructions: "x", onPass: "done" }] }, "global").stages

    expect(edges(only).filter((edge) => edge.kind !== "retry")).toEqual([
      { from: START, to: 0, kind: "next" },
      { from: 0, to: DONE, kind: "next" },
    ])
  })

  test("a stage that sends a pass to itself gets no arrow for it", () => {
    const loop = stages.map((stage) => (stage.id === "fix" ? { ...stage, onPass: "fix" } : stage))

    expect(edges(loop).filter((edge) => edge.from === 2 && edge.kind !== "retry")).toEqual([])
  })

  test("a pass that jumps goes round on the left and a failure on the right, further out the further they reach", () => {
    const found = routes(edges(stages), stages.length)
    const pass = found.find((item) => item.edge.kind === "pass" && item.edge.from === 2)
    const fail = found.find((item) => item.edge.kind === "fail")

    expect(pass?.label?.anchor).toBe("end")
    expect(fail?.label?.anchor).toBe("start")
    expect(pass?.d.startsWith(`M ${SIZE.left} `)).toBe(true)
    expect(fail?.d.startsWith(`M ${SIZE.left + SIZE.node.width} `)).toBe(true)
    expect(found.every((item) => !item.d.includes("NaN"))).toBe(true)
  })

  test("the end box sits below the last stage", () => {
    const last = box(stages.length - 1, stages.length)

    expect(box(DONE, stages.length).y).toBe(last.y + last.height + SIZE.gap)
    expect(height(stages.length)).toBe(box(DONE, stages.length).y + SIZE.pill.height)
  })
})

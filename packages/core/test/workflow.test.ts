import { describe, expect, test } from "bun:test"
import { Workflow } from "@opencode/core/workflow"
import { WorkflowPresets } from "@opencode/core/workflow-presets"

const definition: Workflow.Definition = {
  id: "demo",
  name: "Demo",
  stages: [
    { id: "build", title: "Build", instructions: "Build it." },
    { id: "review", title: "Review", instructions: "Review it.", context: "fresh", onFail: { goto: "fix", max: 2 } },
    { id: "fix", title: "Fix", instructions: "Fix it.", onPass: "review" },
    { id: "ship", title: "Ship", instructions: "Ship it.", exit: "command", command: "echo ok" },
  ],
}

const at = (stage: string, changes: Partial<Workflow.Run> = {}): Workflow.Run => ({
  ...Workflow.start(definition, "add dark mode", "build"),
  stage,
  ...changes,
})

describe("workflow routing", () => {
  test("starts at the first stage, running, with the task and the agent to return to", () => {
    const run = Workflow.start(definition, "add dark mode", "build")
    expect(run).toMatchObject({ stage: "build", status: "running", task: "add dark mode", origin: "build", retries: {} })
  })

  test("never makes the first stage wait for approval, because the user just asked for the run", () => {
    const gated: Workflow.Definition = {
      ...definition,
      stages: [{ id: "a", title: "A", instructions: "x", approveFirst: true }, ...definition.stages.slice(1)],
    }
    expect(Workflow.start(gated, "task", null)).toMatchObject({ status: "running", waiting: null })
  })

  test("a pass goes to the next stage in order, or to the stage onPass names", () => {
    const next = Workflow.route(at("build"), "pass", "built")
    expect(next).toMatchObject({ type: "enter", run: { stage: "review", status: "running" } })
    const jump = Workflow.route(at("fix"), "pass", "fixed")
    expect(jump).toMatchObject({ type: "enter", run: { stage: "review" } })
  })

  test("a pass on the last stage finishes the run, and onPass done finishes early", () => {
    expect(Workflow.route(at("ship"), "pass", "shipped")).toMatchObject({ type: "done", run: { status: "done" } })
    const early: Workflow.Definition = {
      ...definition,
      stages: [{ id: "a", title: "A", instructions: "x", onPass: Workflow.DONE }, ...definition.stages.slice(1)],
    }
    expect(Workflow.route({ ...Workflow.start(early, "t", null) }, "pass", "ok")).toMatchObject({ type: "done" })
  })

  test("a failure goes where onFail says, counting attempts against the failing stage", () => {
    const first = Workflow.route(at("review"), "fail", "a bug in parse()")
    expect(first).toMatchObject({ type: "enter", run: { stage: "fix", retries: { review: 1 } } })
    const second = Workflow.route(at("review", { retries: { review: 1 } }), "fail", "still a bug")
    expect(second).toMatchObject({ type: "enter", run: { stage: "fix", retries: { review: 2 } } })
  })

  test("a failure at the limit stops the run instead of looping forever", () => {
    const step = Workflow.route(at("review", { retries: { review: 2 } }), "fail", "again")
    expect(step).toMatchObject({ type: "blocked", run: { status: "blocked" } })
    expect(step.run.note).toContain("failed 2 times")
  })

  test("a stage without onFail tries itself again, up to the default limit", () => {
    const again = Workflow.route(at("build"), "fail", "tests fail")
    expect(again).toMatchObject({ type: "enter", run: { stage: "build", retries: { build: 1 } } })
    const spent = Workflow.route(at("build", { retries: { build: Workflow.DEFAULT_RETRIES } }), "fail", "tests fail")
    expect(spent.type).toBe("blocked")
  })

  test("moving on forgets what the last stage reported and spawned", () => {
    const run = at("build", { reported: { outcome: "pass", summary: "done" }, child: "ses_x", nudges: 3 })
    const step = Workflow.route(run, "pass", "built")
    expect(step.run).toMatchObject({ reported: null, child: null, nudges: 0 })
  })

  test("keeps only the latest results, and the newest stays last", () => {
    let run = at("build")
    for (let index = 0; index < 12; index++) {
      const step = Workflow.route({ ...run, stage: "fix" }, "pass", `result ${index}`)
      run = step.run
    }
    expect(run.reports.length).toBeLessThanOrEqual(8)
    expect(run.reports.at(-1)?.summary).toBe("result 11")
  })

  test("a stage that waits for approval to start holds the run", () => {
    const gated: Workflow.Definition = {
      ...definition,
      stages: [
        { id: "a", title: "A", instructions: "x" },
        { id: "b", title: "B", instructions: "y", approveFirst: true },
      ],
    }
    const step = Workflow.route(Workflow.start(gated, "t", null), "pass", "ok")
    expect(step).toMatchObject({ type: "enter", run: { stage: "b", status: "waiting", waiting: "start" } })
  })
})

describe("workflow definitions", () => {
  test("every prebuilt workflow is valid", () => {
    expect(WorkflowPresets.all.map((item) => [item.id, Workflow.problems(item)])).toEqual(
      WorkflowPresets.all.map((item) => [item.id, []]),
    )
  })

  test("a run where every stage passes visits each prebuilt workflow's stages in a sensible order", () => {
    const visited = WorkflowPresets.all.map((item) => {
      const seen: string[] = []
      let run = Workflow.start(item, "task", null)
      for (let step = 0; step < 20; step++) {
        seen.push(run.stage)
        const next = Workflow.route(run, "pass", "ok")
        if (next.type !== "enter") break
        run = next.run
      }
      return [item.id, seen]
    })
    expect(visited).toEqual([
      ["sdd", ["spec", "plan", "build", "verify"]],
      ["tdd", ["red", "green", "refactor"]],
      ["review", ["build", "review"]],
      ["pr", ["review", "prepare", "open"]],
    ])
  })

  test("names what is wrong in a way the author can act on", () => {
    const broken: Workflow.Definition = {
      id: "broken",
      name: "Broken",
      stages: [
        { id: "a", title: "A", instructions: "x", exit: "command" },
        { id: "a", title: "A again", instructions: "y", onPass: "nowhere" },
        { id: "c", title: "C", instructions: "z", onFail: { goto: "gone", max: 1 } },
      ],
    }
    expect(Workflow.problems(broken)).toEqual([
      'Two stages are called "a".',
      'Stage "a" ends with a command but has none.',
      'Stage "a" goes on to "nowhere", which does not exist.',
      'Stage "c" goes back to "gone" on failure, which does not exist.',
    ])
    expect(Workflow.problems({ ...broken, stages: [] })).toEqual(["It has no stages."])
  })

  test("finds a workflow by id or by name, ignoring case", () => {
    expect(Workflow.find([definition], "DEMO")).toBe(definition)
    expect(Workflow.find([definition], "demo")).toBe(definition)
    expect(Workflow.find([definition], "other")).toBeUndefined()
  })
})

describe("workflow session state", () => {
  test("round-trips a run through session metadata and keeps the other keys", () => {
    const run = Workflow.start(definition, "add dark mode", "build")
    const metadata = Workflow.write({ ticket: "SMK-1" }, run)
    expect(metadata.ticket).toBe("SMK-1")
    expect(Workflow.read(metadata)).toEqual(run)
    expect(Workflow.write(metadata, undefined)).toEqual({ ticket: "SMK-1" })
  })

  test("reads nothing from missing, malformed or partial state", () => {
    expect(Workflow.read(undefined)).toBeUndefined()
    expect(Workflow.read({ workflow: "x" })).toBeUndefined()
    expect(Workflow.read({ workflow: { task: "no stages" } })).toBeUndefined()
  })

  test("remembers a workflow picked in the prompt box until it starts", () => {
    const picked = Workflow.writePending({ ticket: "SMK-1" }, "tdd")
    expect(Workflow.pending(picked)).toBe("tdd")
    expect(Workflow.writePending(picked, undefined)).toEqual({ ticket: "SMK-1" })
    expect(Workflow.pending({ workflow_pending: 5 })).toBeUndefined()
  })

  test("only a running or waiting run has a stage to report on", () => {
    const run = Workflow.start(definition, "t", null)
    expect(Workflow.isOpen(run)).toBe(true)
    expect(Workflow.isOpen({ ...run, status: "waiting" })).toBe(true)
    expect(Workflow.isOpen({ ...run, status: "paused" })).toBe(false)
    expect(Workflow.isOpen({ ...run, status: "done" })).toBe(false)
    expect(Workflow.isOpen(undefined)).toBe(false)
  })
})

describe("workflow text", () => {
  test("the stage prompt carries the task, the instructions and how to report", () => {
    const prompt = Workflow.stagePrompt(at("build"))
    expect(prompt).toContain("Task: add dark mode")
    expect(prompt).toContain("Stage 1/4: Build")
    expect(prompt).toContain("Build it.")
    expect(prompt).toContain(`call the ${Workflow.TOOL} tool`)
  })

  test("a fresh stage is told to look at the repository itself, and gets the earlier result", () => {
    const run = at("review", { reports: [{ stage: "build", outcome: "pass", summary: "built the toggle" }] })
    const prompt = Workflow.stagePrompt(run)
    expect(prompt).toContain("clean context")
    expect(prompt).toContain('Result of the earlier stage "Build"')
    expect(prompt).toContain("built the toggle")
  })

  test("a retry is told what failed last time", () => {
    const run = at("fix", { reports: [{ stage: "fix", outcome: "fail", summary: "tests still red" }] })
    expect(Workflow.stagePrompt(run)).toContain("The last attempt at this stage failed:\ntests still red")
  })

  test("a stage that a failure was sent to is told which stage failed and why", () => {
    const run = at("fix", { reports: [{ stage: "review", outcome: "fail", summary: "parse() drops a token" }] })
    expect(Workflow.stagePrompt(run)).toContain('Stage "Review" failed and sent the work back to this stage:\nparse() drops a token')
  })

  test("a stage that ends with a command or approval says so", () => {
    expect(Workflow.stagePrompt(at("ship"))).toContain("SmikCode runs `echo ok`")
    const gated: Workflow.Definition = {
      ...definition,
      stages: [{ id: "a", title: "A", instructions: "x", exit: "approval" }],
    }
    expect(Workflow.stagePrompt(Workflow.start(gated, "t", null))).toContain("waits for the user to approve")
  })

  test("describes where a run stands", () => {
    expect(Workflow.describe(undefined)).toContain("No workflow is running")
    const text = Workflow.describe(at("review"))
    expect(text).toContain("Demo (running): add dark mode")
    expect(text).toContain("[done] Build")
    expect(text).toContain("[now ] Review")
    expect(text).toContain("[    ] Fix")
  })

  test("parses the command", () => {
    expect(Workflow.parse("")).toEqual({ type: "list" })
    expect(Workflow.parse("LIST")).toEqual({ type: "list" })
    expect(Workflow.parse("status")).toEqual({ type: "status" })
    expect(Workflow.parse("cancel")).toEqual({ type: "stop" })
    expect(Workflow.parse("retry")).toEqual({ type: "resume" })
    expect(Workflow.parse("next")).toEqual({ type: "approve" })
    expect(Workflow.parse("tdd add a retry to fetch\nand log it")).toEqual({
      type: "start",
      name: "tdd",
      task: "add a retry to fetch\nand log it",
    })
    expect(Workflow.parse("sdd")).toEqual({ type: "start", name: "sdd", task: "" })
  })

  test("parses the commands that make a workflow", () => {
    expect(Workflow.parse("new tests first, then a review")).toEqual({ type: "new", text: "tests first, then a review" })
    expect(Workflow.parse("draft")).toEqual({ type: "new", text: "" })
    expect(Workflow.parse("save")).toEqual({ type: "save", scope: "global" })
    expect(Workflow.parse("SAVE Project")).toEqual({ type: "save", scope: "project" })
    expect(Workflow.parse("discard")).toEqual({ type: "discard" })
  })
})

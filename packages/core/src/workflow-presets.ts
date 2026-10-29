export * as WorkflowPresets from "./workflow-presets.js"

import type { Workflow } from "./workflow.js"

// A reviewer works in a clean context and the read-only Plan agent, so it judges the change instead of defending it.
const REVIEW = {
  context: "fresh",
  agent: "plan",
} as const

export const sdd: Workflow.Definition = {
  id: "sdd",
  name: "Spec-driven development",
  description: "Write a spec you approve, plan from it, build, then check the result against the spec",
  stages: [
    {
      id: "spec",
      title: "Write the spec",
      instructions: `Understand the task by reading the relevant code first. Then write a specification as a Markdown file in a \`specs\` folder (create it if it does not exist): the goal, what is out of scope, the requirements, acceptance criteria that can be checked one by one, and open questions. Keep it short and concrete. Do not write any code in this stage.`,
      exit: "approval",
    },
    {
      id: "plan",
      title: "Plan the work",
      instructions: `Read the approved spec. Write a technical plan at the end of the same file: the approach, the files and modules that change, and an ordered list of small tasks. Put the tasks in the todo list. Do not write code yet.`,
    },
    {
      id: "build",
      title: "Build it",
      instructions: `Work through the tasks in order, one at a time, keeping each change small. Tick tasks off as you go. If the spec turns out to be wrong or incomplete, fix the spec first and say so. Run the project's tests and linters before you report the stage.`,
    },
    {
      id: "verify",
      title: "Check against the spec",
      ...REVIEW,
      instructions: `Read the spec and the changes. Go through every acceptance criterion and decide whether the code meets it, running the tests where that settles it. Do not edit files. Report "pass" only if every criterion is met; otherwise report "fail" and list each unmet criterion with the evidence.`,
      onFail: { goto: "build", max: 2 },
    },
  ],
}

export const tdd: Workflow.Definition = {
  id: "tdd",
  name: "Test-driven development",
  description: "Write a failing test, make it pass, then clean up, checking with your test command",
  stages: [
    {
      id: "red",
      title: "Write a failing test",
      instructions: `Read the relevant code and find how this project writes and runs tests. Write the smallest test that describes the behavior the task asks for, and run it to see it fail for the right reason. Do not change the code under test in this stage.`,
    },
    {
      id: "green",
      title: "Make it pass",
      instructions: `Write the simplest change that makes the new test pass without breaking the others. Run the tests for the area you touched, and report "pass" only when they are green. To have SmikCode run the suite itself as the check, give this stage a command in your own copy of this workflow.`,
      onFail: { goto: "green", max: 4 },
    },
    {
      id: "refactor",
      title: "Clean up",
      instructions: `Improve the names, structure and duplication in the code you just wrote, and in the test, without changing behavior. Run the tests after each step, and report "pass" only when they are still green.`,
      onFail: { goto: "refactor", max: 3 },
    },
  ],
}

export const review: Workflow.Definition = {
  id: "review",
  name: "Build, then fresh-eye review",
  description: "Build the change, then a reviewer that has not seen the work checks it and sends fixes back",
  stages: [
    {
      id: "build",
      title: "Build it",
      instructions: `Do the task. Read the relevant code first, keep the change focused, and run the project's tests and linters before you report the stage.`,
    },
    {
      id: "review",
      title: "Fresh-eye review",
      ...REVIEW,
      instructions: `Review the uncommitted changes as if a colleague had sent them to you. Look for bugs, missed edge cases, broken callers, security problems, missing tests and anything that does not match the task. Do not edit files. Report "pass" if you would approve the change. Otherwise report "fail" and list each problem with the file and what is wrong.`,
      onPass: "done",
      onFail: { goto: "fix", max: 3 },
    },
    {
      id: "fix",
      title: "Fix the findings",
      instructions: `Fix every problem the reviewer listed, and add tests where it asked for them. If you disagree with a finding, say why in your summary instead of ignoring it. Run the tests before you report the stage.`,
      onPass: "review",
    },
  ],
}

export const pr: Workflow.Definition = {
  id: "pr",
  name: "Pull request pipeline",
  description: "Review the change, prepare the commit and pull request, and wait for your approval before pushing",
  stages: [
    {
      id: "review",
      title: "Self-review",
      ...REVIEW,
      instructions: `Review the uncommitted changes for bugs, missing tests, leftover debugging code and anything that should not be committed. Do not edit files. Report "pass" if the change is ready to commit; otherwise report "fail" with the problems.`,
      onPass: "prepare",
      onFail: { goto: "fix", max: 2 },
    },
    {
      id: "fix",
      title: "Fix the findings",
      instructions: `Fix each problem the review listed and run the tests.`,
      onPass: "review",
    },
    {
      id: "prepare",
      title: "Commit and draft the pull request",
      instructions: `Create a branch if you are on the default branch, and commit the change with a clear message in the project's commit style. Then write the pull request title and description, but do not push and do not open the pull request. Show the user the branch name, the commit and the draft.`,
      exit: "approval",
    },
    {
      id: "open",
      title: "Push and open the pull request",
      instructions: `The user approved the draft. Push the branch and open the pull request with the title and description you drafted. Report the link.`,
    },
  ],
}

export const all: ReadonlyArray<Workflow.Definition> = [sdd, tdd, review, pr]

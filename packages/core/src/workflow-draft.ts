export * as WorkflowDraft from "./workflow-draft.js"

import { Option, Schema } from "effect"
import { Workflow } from "./workflow.js"

/** Times a model is asked for a workflow, each time told what was wrong with the last reply. */
export const MAX_ATTEMPTS = 3

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Workflow.Definition))

/** What a model is asked: the format, the rules that make a workflow good, and the user's description. */
export function prompt(description: string, taken: ReadonlyArray<string>, problems: ReadonlyArray<string> = []) {
  return [
    "You design development workflows for a coding agent. A workflow is a list of stages the agent goes through in order. Reply with one JSON object and nothing else: no explanation, no code fence.",
    "",
    "Format:",
    '{ "id": "kebab-case-id", "name": "Short name", "description": "One sentence", "stages": [ { "id": "kebab-case-id", "title": "Short title", "instructions": "What the agent does in this stage, and when it counts as done." } ] }',
    "",
    "A stage can also have these fields. Leave each out unless it is needed:",
    '- "context": "fresh" runs the stage in a new session that has not seen the earlier work. Use it for a review that must be independent. Never on the first stage.',
    '- "agent": "plan" makes a stage read-only, for a review or an analysis. Otherwise leave the agent out.',
    '- "exit": "agent" (the default: the agent says it is done), "command" (also set "command" to a shell command that must exit 0, such as the test command) or "approval" (the user approves the result before the workflow goes on).',
    '- "approveFirst": true waits for the user before the stage starts. Never on the first stage.',
    '- "onPass": the id of the stage to go to after a pass, or "done" to finish. The default is the next stage.',
    '- "onFail": { "goto": "stage id", "max": 2 } says where a failure goes and how many attempts are allowed. The default is to try the same stage again, up to 3 times.',
    "",
    "Rules:",
    "- Use 2 to 8 stages. Ids use only lower case letters, digits, - and _, and are different from each other.",
    "- Write each stage's instructions to the agent in 1 to 4 concrete sentences.",
    '- A review stage is fresh, uses the "plan" agent, says not to edit files, and sends a failure back to the stage that fixes things with onFail.',
    '- Use "command" only for a command the user named or that is obvious, such as the project\'s tests.',
    "- Never put a stage that pushes code or opens a pull request without an approval step before it.",
    `- Do not use these ids for the workflow: ${taken.length === 0 ? "(none)" : taken.join(", ")}.`,
    ...(problems.length === 0
      ? []
      : ["", "Your last reply could not be used:", ...problems.map((problem) => `- ${problem}`), "Reply again with the corrected JSON object."]),
    "",
    "The user's request:",
    description.trim(),
  ].join("\n")
}

export type Result =
  | { readonly workflow: Workflow.Definition; readonly problems: readonly [] }
  | { readonly workflow: undefined; readonly problems: ReadonlyArray<string> }

/** A workflow id that none of `taken` has: the id itself, or with a number after it. */
export function unique(id: string, taken: ReadonlySet<string>) {
  return [id, ...Array.from({ length: 98 }, (_, index) => `${id}-${index + 2}`)].find((item) => !taken.has(item)) ?? id
}

/**
 * Turns a model's reply into a usable workflow, or says what is wrong with it. The reply may sit in a code fence or
 * have words around it. The first stage is made to run in the current chat and never wait, because the engine does.
 */
export function parse(reply: string, taken: ReadonlySet<string>): Result {
  const start = reply.indexOf("{")
  const end = reply.lastIndexOf("}")
  const parsed = start < 0 || end < start ? Option.none() : decode(reply.slice(start, end + 1))

  if (Option.isNone(parsed))
    return {
      workflow: undefined,
      problems: [
        "The reply was not a workflow in the format. Every stage needs an id, a title and instructions, and ids use only lower case letters, digits, - and _.",
      ],
    }

  const problems = Workflow.problems(parsed.value)

  if (problems.length > 0) return { workflow: undefined, problems }

  return {
    workflow: {
      ...parsed.value,
      id: unique(parsed.value.id, taken),
      stages: parsed.value.stages.map((stage, index) => {
        if (index > 0) return stage
        const { context: _context, model: _model, approveFirst: _approveFirst, ...rest } = stage

        return rest
      }),
    },
    problems: [],
  }
}

/** The drafted workflow in words, with what to do with it. */
export function outline(definition: Workflow.Definition) {
  return [
    `Drafted "${definition.name}"${definition.description ? `: ${definition.description}` : ""}`,
    ...definition.stages.map((stage, index) => {
      const notes = [
        stage.context === "fresh" ? "fresh session" : undefined,
        stage.agent === undefined ? undefined : `${stage.agent} agent`,
        stage.exit === "command" ? `must pass \`${stage.command}\`` : undefined,
        stage.exit === "approval" ? "you approve it" : undefined,
        stage.approveFirst ? "asks you first" : undefined,
      ].filter((note) => note !== undefined)

      return `  ${index + 1}. ${stage.title}${notes.length === 0 ? "" : ` (${notes.join(", ")})`}`
    }),
    "Nothing is saved yet. /workflow save keeps it for every project, /workflow save project keeps it in this project, /workflow discard drops it.",
  ].join("\n")
}

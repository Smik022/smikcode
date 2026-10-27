export * as Goal from "./goal.js"

import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { Option, Schema } from "effect"

/** Session metadata key holding the goal. */
export const KEY = "goal"

/** Automatic continuations allowed before the goal pauses and waits for the user. */
export const MAX_CONTINUATIONS = 10

export const Info = Schema.Struct({
  text: Schema.String,
  status: Schema.Literals(["active", "paused", "complete", "blocked"]),
  /** Continuations sent since the goal was set or last resumed. */
  turns: Schema.Int,
  note: Schema.optional(Schema.String),
})
export type Info = typeof Info.Type

const decode = Schema.decodeUnknownOption(Info)

export function read(metadata: SessionMetadata | undefined) {
  return Option.getOrUndefined(decode(metadata?.[KEY]))
}

export const isActive = (metadata: SessionMetadata | undefined) => read(metadata)?.status === "active"

/** Replaces the stored goal, or removes it when `goal` is undefined. Other metadata is kept. */
export function write(metadata: SessionMetadata | undefined, goal: Info | undefined): SessionMetadata {
  const rest = Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => key !== KEY))
  if (goal === undefined) return rest
  return {
    ...rest,
    [KEY]: { text: goal.text, status: goal.status, turns: goal.turns, ...(goal.note ? { note: goal.note } : {}) },
  }
}

export const start = (text: string): Info => ({ text, status: "active", turns: 0 })

export function parse(input: string) {
  const text = input.trim()
  const word = text.toLowerCase()
  if (text === "") return { type: "status" } as const
  if (word === "clear" || word === "cancel" || word === "stop") return { type: "clear" } as const
  if (word === "pause") return { type: "pause" } as const
  if (word === "resume") return { type: "resume" } as const
  return { type: "set", text } as const
}

export const kickoff = (text: string) => `<goal>
${text}
</goal>

Work toward this goal on your own. Plan the steps (use the todo tool when there are several), do the work, and check the result, running tests or other checks where they exist. Do not stop to ask permission to continue. When the goal is fully met, call the goal tool with status "complete" and a short summary. If you cannot go on without the user, call it with status "blocked" and say what you need.`

export const nudge = (text: string) =>
  `<system-reminder>The goal is not finished: ${text}\nKeep working toward it. When it is fully met, call the goal tool with status "complete"; if you are stuck and need the user, call it with status "blocked".</system-reminder>`

export function describe(goal: Info | undefined) {
  if (goal === undefined) return "No goal is set. Use /goal <what you want done> to set one."
  const note = goal.note ? ` ${goal.note}` : ""
  return `Goal (${goal.status}): ${goal.text}${note}`
}

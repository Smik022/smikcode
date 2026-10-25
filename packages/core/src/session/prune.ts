export * as SessionPrune from "./prune.js"

import { Message, type LLMRequest, type ToolResultPart } from "@opencode/ai"

// Tool results from the current and previous user turns are always sent in full.
const PROTECTED_TURNS = 2
// Only results at least this large are worth replacing.
const MIN_RESULT_CHARS = 2_000
// Trim only when it saves at least this much, so short sessions keep their exact transcript and
// prompt cache. Because the boundary only moves when the user sends a prompt, the trimmed
// prefix stays identical for every step within a turn.
const MIN_SAVINGS_CHARS = 80_000

type Messages = LLMRequest["messages"]

/**
 * Replaces large tool results from older user turns with a one-line note. The stored session is
 * untouched: this only shapes what the model is sent, and the model can re-run a tool if needed.
 */
export function trim(messages: Messages): Messages {
  const boundary = protectedStart(messages)
  if (boundary <= 0) return messages
  const savings = messages
    .slice(0, boundary)
    .flatMap(resultsOf)
    .map(size)
    .filter((chars) => chars >= MIN_RESULT_CHARS)
    .reduce((total, chars) => total + chars, 0)
  if (savings < MIN_SAVINGS_CHARS) return messages

  return messages.map((message, index) => {
    if (index >= boundary || message.role !== "tool") return message
    const content = message.content.map((part) =>
      part.type === "tool-result" && part.result.type !== "error" && size(part) >= MIN_RESULT_CHARS
        ? { ...part, result: { type: "text" as const, value: note(part) } }
        : part,
    )
    return content.every((part, position) => part === message.content[position])
      ? message
      : new Message({ ...message, content })
  })
}

/** Index of the first message in the protected turns, or 0 when there are not enough turns yet. */
function protectedStart(messages: Messages) {
  const prompts = messages.flatMap((message, index) => (isPrompt(message) ? [index] : []))
  return prompts.length > PROTECTED_TURNS ? (prompts.at(-PROTECTED_TURNS) ?? 0) : 0
}

// A user message that carries no tool results starts a new turn.
function isPrompt(message: Message) {
  return message.role === "user" && message.content.every((part) => part.type !== "tool-result")
}

function resultsOf(message: Message) {
  if (message.role !== "tool") return []
  return message.content.filter((part): part is ToolResultPart => part.type === "tool-result")
}

function size(part: ToolResultPart) {
  return text(part).length
}

function text(part: ToolResultPart) {
  const result = part.result
  if (result.type === "text") return typeof result.value === "string" ? result.value : JSON.stringify(result.value)
  if (result.type === "content")
    return result.value.map((item) => (item.type === "text" ? item.text : (item.name ?? item.uri))).join("\n")
  return JSON.stringify(result.value) ?? ""
}

function note(part: ToolResultPart) {
  const lines = text(part).split("\n").length
  return `[Output of this earlier ${part.name} call was trimmed to save context (${lines} lines). Call the tool again if you need it.]`
}

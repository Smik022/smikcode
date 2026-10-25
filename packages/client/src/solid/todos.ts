import type { SessionMessageInfo } from "../promise"

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type Todo = { content: string; status: TodoStatus }

const statuses = new Set<string>(["pending", "in_progress", "completed", "cancelled"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Reads a todo tool call's input; undefined while it is still streaming or malformed. */
export function parseTodos(input: unknown): Todo[] | undefined {
  if (!isRecord(input) || !Array.isArray(input.todos)) return
  const todos = input.todos.flatMap((item): Todo[] => {
    if (!isRecord(item) || typeof item.content !== "string" || typeof item.status !== "string") return []
    if (!statuses.has(item.status)) return []
    return [{ content: item.content, status: item.status as TodoStatus }]
  })
  return todos.length === input.todos.length ? todos : undefined
}

/**
 * The session's current checklist: each `todo` tool call replaces the whole list, so the latest completed
 * call wins. Undefined when the agent has not kept one. Every client shows the same list from this.
 */
export function latestTodos(messages: ReadonlyArray<SessionMessageInfo>): Todo[] | undefined {
  return messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter((part) => part.type === "tool" && part.name === "todo" && part.state.status === "completed")
    .map((part) => (part.type === "tool" ? parseTodos(part.state.input) : undefined))
    .findLast((todos) => todos !== undefined)
}

import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "../src/promise"
import { latestTodos, parseTodos, type Todo } from "../src/solid/todos"

// Only the fields latestTodos reads; the rest of an assistant message is irrelevant here.
const assistant = (...tools: { name: string; status: string; input: unknown }[]) =>
  ({
    type: "assistant",
    content: tools.map((tool, index) => ({
      type: "tool",
      id: `call-${index}`,
      name: tool.name,
      state: { status: tool.status, input: tool.input },
    })),
  }) as unknown as SessionMessageInfo

describe("todos", () => {
  test("parses a complete todo input and rejects partial or unknown items", () => {
    expect(parseTodos({ todos: [{ content: "Fix it", status: "in_progress" }] })).toEqual([
      { content: "Fix it", status: "in_progress" },
    ])
    expect(parseTodos({ todos: [{ content: "Fix it", status: "done" }] })).toBeUndefined()
    expect(parseTodos('{"todos": [')).toBeUndefined()
    expect(parseTodos({ todos: [] })).toEqual([])
  })

  test("the latest completed todo call is the current list", () => {
    const first = { todos: [{ content: "Plan", status: "in_progress" }] }
    const second: { todos: Todo[] } = {
      todos: [
        { content: "Plan", status: "completed" },
        { content: "Build", status: "in_progress" },
      ],
    }
    const messages = [
      { type: "user" } as unknown as SessionMessageInfo,
      assistant({ name: "todo", status: "completed", input: first }, { name: "read", status: "completed", input: {} }),
      assistant({ name: "todo", status: "completed", input: second }),
      // A call that failed or is still running does not replace the list.
      assistant({ name: "todo", status: "error", input: { todos: [] } }),
      assistant({ name: "todo", status: "running", input: { todos: [] } }),
    ]
    expect(latestTodos(messages)).toEqual(second.todos)
    expect(latestTodos(messages.slice(0, 1))).toBeUndefined()
  })
})

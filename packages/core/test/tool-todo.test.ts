import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_todo_tool_test")

const todoToolNode = makeLocationNode({
  name: "test/todo-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(TodoTool.Plugin)),
  deps: [Tool.node],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, todoToolNode]), [Image.node.replace(imagePassthrough)]),
)

const call = (id: string, input: unknown) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: TodoTool.name, input },
})

describe("TodoTool", () => {
  it.effect("is a native tool that replaces the whole checklist", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain("todo")

      const todos = [
        { content: "Find the bug", status: "completed" },
        { content: "Write a failing test", status: "in_progress" },
        { content: "Fix it", status: "pending" },
        { content: "Rewrite the module", status: "cancelled" },
      ]
      expect(yield* executeTool(registry, call("call-todo", { todos }))).toEqual({
        status: "completed",
        output: { todos },
        metadata: { todos },
        content: [
          {
            type: "text",
            text: [
              "Todo list updated (1/4 completed):",
              "[x] Find the bug",
              "[>] Write a failing test",
              "[ ] Fix it",
              "[-] Rewrite the module",
            ].join("\n"),
          },
        ],
      })
    }),
  )

  it.effect("rejects more than one item in progress and unknown statuses", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect(
        yield* executeTool(
          registry,
          call("call-todo-busy", {
            todos: [
              { content: "A", status: "in_progress" },
              { content: "B", status: "in_progress" },
            ],
          }),
        ),
      ).toMatchObject({ status: "error", error: { message: expect.stringContaining("at most one item in_progress") } })
      expect(
        yield* executeTool(registry, call("call-todo-invalid", { todos: [{ content: "A", status: "done" }] })),
      ).toMatchObject({ status: "error", error: { type: "tool.execution" } })
    }),
  )

  it.effect("reports when everything is done", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      expect(
        yield* executeTool(registry, call("call-todo-done", { todos: [{ content: "Ship it", status: "completed" }] })),
      ).toMatchObject({
        content: [{ type: "text", text: "Todo list updated (1/1 completed, nothing left to do):\n[x] Ship it" }],
      })
    }),
  )
})

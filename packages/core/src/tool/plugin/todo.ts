export * as TodoTool from "./todo.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"

export const name = "todo"

export const description = `Keep a checklist for the current task so you and the user can follow progress.

Use it when the work has three or more distinct steps, when the user gives you several things to do, or when a visible plan would help the user follow along. Skip it for a single quick change or a question you can answer directly.

Each call replaces the whole list, so send every item with its current status:
- Mark an item in_progress just before you start it, and keep at most one item in_progress.
- Mark an item completed as soon as it is done; don't batch completions.
- Use cancelled for items that turned out to be unnecessary instead of deleting them.
- Add items you discover along the way.`

export const Status = Schema.Literals(["pending", "in_progress", "completed", "cancelled"])

export const Item = Schema.Struct({
  content: Schema.String.annotate({ description: "The step, as a short imperative phrase" }),
  status: Status,
})

export const Input = Schema.Struct({
  todos: Schema.Array(Item).annotate({ description: "The complete checklist; it replaces the previous one" }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(Item),
})
export type Output = typeof Output.Type

const markers: Record<typeof Status.Type, string> = {
  pending: "[ ]",
  in_progress: "[>]",
  completed: "[x]",
  cancelled: "[-]",
}

export const toModelContent = (todos: Output["todos"]) => {
  if (todos.length === 0) return "Todo list cleared."
  const done = todos.filter((todo) => todo.status === "completed").length
  const open = todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress").length
  return [
    `Todo list updated (${done}/${todos.length} completed${open === 0 ? ", nothing left to do" : ""}):`,
    ...todos.map((todo) => `${markers[todo.status]} ${todo.content}`),
  ].join("\n")
}

export const Plugin = {
  id: "opencode.tool.todo",
  effect: Effect.fn("TodoTool.Plugin")(function* (ctx: Context) {
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          // The list lives in this call's input, so the latest todo call in the session history is the
          // current list; no separate state is stored.
          execute: (input) => {
            const active = input.todos.filter((todo) => todo.status === "in_progress").length
            if (active > 1)
              return Effect.fail(
                new ToolFailure({
                  message: `${active} items are in_progress. Keep at most one item in_progress and mark the others pending or completed.`,
                }),
              )
            return Effect.succeed({
              output: { todos: input.todos },
              content: toModelContent(input.todos),
              metadata: { todos: input.todos },
            })
          },
        }),
      )
      .pipe(Effect.orDie)
  }),
}

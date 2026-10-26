import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { Todo } from "@opencode/client/solid"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import "./todo-card.css"

/**
 * The agent's checklist from its latest `todo` tool call, as a small card above the composer.
 * It renders nothing until the agent keeps a list.
 */
export function TodoCard(props: { tasks: ReadonlyArray<Todo> }) {
  const language = useLanguage()
  const [state, setState] = createStore({ collapsed: false })
  const done = createMemo(() => props.tasks.filter((task) => task.status === "completed").length)

  return (
    <Show when={props.tasks.length > 0}>
      <section data-component="todo-card" data-collapsed={state.collapsed ? "" : undefined}>
        <button
          type="button"
          data-slot="todo-card-header"
          aria-expanded={!state.collapsed}
          onClick={() => setState("collapsed", (collapsed) => !collapsed)}
        >
          <span data-slot="todo-card-title">{language.t("session.todo.title")}</span>
          <span data-slot="todo-card-progress">
            {language.t("session.todo.progress", { done: done(), total: props.tasks.length })}
          </span>
          <Icon name="chevron-down" size="small" data-slot="todo-card-chevron" />
        </button>
        <Show when={!state.collapsed}>
          <ul data-slot="todo-card-list">
            <For each={props.tasks}>
              {(task) => (
                <li data-slot="todo-card-item" data-status={task.status}>
                  <span data-slot="todo-card-marker" aria-hidden="true">
                    <Show when={task.status === "completed"}>
                      <Icon name="check" size="small" />
                    </Show>
                  </span>
                  <span data-slot="todo-card-text" dir="auto">
                    {task.content}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  )
}

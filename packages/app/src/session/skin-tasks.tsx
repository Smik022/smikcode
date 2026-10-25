import { For, Show } from "solid-js"
import type { Todo } from "@opencode/client/solid"

/** One entry of a session's task list: an item of the agent's latest `todo` tool call. */
export type SkinTask = Todo

/**
 * The session task list that skins with a left sidebar (data-skin-sidebar="left") show above the side panel.
 * The session screen passes the agent's latest `todo` checklist; the slot renders nothing without tasks.
 */
export function SkinTasksSlot(props: { tasks: ReadonlyArray<SkinTask> }) {
  return (
    <Show when={props.tasks.length > 0}>
      <ul data-component="skin-tasks">
        <For each={props.tasks}>
          {(task) => (
            <li data-slot="skin-task" data-status={task.status}>
              {task.content}
            </li>
          )}
        </For>
      </ul>
    </Show>
  )
}

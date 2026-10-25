import { For, Show } from "solid-js"

/** One entry of a session's task list, as the todo tool reports it. */
export type SkinTask = {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

/**
 * Slot for the session task list that skins with a left sidebar (data-skin-sidebar="left") show above the side
 * panel. It renders nothing without tasks.
 *
 * TODO(todo-tool): the todo tool is being added on another branch. Pass its task list from the session screen
 * (packages/app/src/session/screen.tsx) once it exists; until then the screen passes an empty list.
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

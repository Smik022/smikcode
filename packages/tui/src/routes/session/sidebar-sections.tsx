import { TextAttributes } from "@opentui/core"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { createMemo, For, Show, type Accessor } from "solid-js"
import { useData } from "../../context/data"
import { useRoute } from "../../context/route"
import { useTheme } from "../../context/theme"

/** One entry of a session's task checklist, shaped like the todo tool's `latestTodos()` entries. */
export type SessionTask = {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
}

/**
 * SLOT(todo-tool): the session's task checklist.
 *
 * The todo tool is being added separately. Until its data reaches the TUI this returns no tasks, so the
 * "tasks" sidebar section stays hidden. Wire it to `latestTodos(messages)` from `util/todos.ts`; the
 * section renders as soon as this returns at least one task.
 */
export function useSessionTasks(_sessionID: Accessor<string>): Accessor<readonly SessionTask[]> {
  return () => []
}

const marks: Record<SessionTask["status"], string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
  cancelled: "[-]",
}

/** Checklist of the session's tasks. Renders nothing without tasks. */
export function SidebarTasks(props: { tasks: readonly SessionTask[] }) {
  const theme = useTheme()
  const done = () => props.tasks.filter((task) => task.status === "completed").length
  return (
    <Show when={props.tasks.length > 0}>
      <box flexShrink={0}>
        <text fg={theme.text.base} wrapMode="none">
          <b>tasks</b>
          <span style={{ fg: theme.text.muted }}>
            {" "}
            {done()}/{props.tasks.length}
          </span>
        </text>
        <For each={props.tasks}>
          {(task) => (
            <box flexDirection="row" gap={1}>
              <text
                flexShrink={0}
                fg={task.status === "in_progress" ? theme.role.assistant : theme.text.muted}
                wrapMode="none"
              >
                {marks[task.status]}
              </text>
              <text
                flexGrow={1}
                minWidth={0}
                wrapMode="word"
                fg={task.status === "completed" || task.status === "cancelled" ? theme.text.muted : theme.text.base}
                attributes={task.status === "cancelled" ? TextAttributes.STRIKETHROUGH : undefined}
              >
                {task.content}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

export type SidebarSession = { id: string; title: string }

/** Recent sessions of the current project, newest first; the open one is marked. */
export function SidebarSessions(props: {
  sessions: readonly SidebarSession[]
  current: string
  onSelect: (id: string) => void
}) {
  const theme = useTheme()
  return (
    <Show when={props.sessions.length > 0}>
      <box flexShrink={0}>
        <text fg={theme.text.base} wrapMode="none">
          <b>sessions</b>
        </text>
        <For each={props.sessions}>
          {(session) => (
            <box onMouseUp={() => props.onSelect(session.id)}>
              <text
                wrapMode="none"
                truncate
                fg={session.id === props.current ? theme.text.formfield.selected : theme.text.muted}
              >
                {session.id === props.current ? "▸ " : "  "}
                {session.title}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

const SIDEBAR_SESSION_LIMIT = 8

export function useSidebarSessions(sessionID: Accessor<string>) {
  const data = useData()
  const route = useRoute()
  const sessions = createMemo(() => {
    const current = data.session.get(sessionID())
    if (!current) return []
    return data.session
      .list()
      .filter((session) => !session.parentID && session.projectID === current.projectID)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .slice(0, SIDEBAR_SESSION_LIMIT)
      .map((session) => ({ id: session.id, title: withTimestampedFallback(session) }))
  })
  return {
    sessions,
    select: (id: string) => route.navigate({ type: "session", sessionID: id }),
  }
}

import { For, Show } from "solid-js"
import { HomeSessionStatusController } from "@/home/sessions/controller"
import { useLanguage } from "@/runtime/i18n/language"
import { sessionLabel } from "@/session/title"
import { useSidebar } from "@/shell/sidebar/context"
import { getRelativeTime } from "@/shell/time"
import "./recent.css"

/** The few most recent sessions, shown beneath the start composer. */
export function RecentSessions() {
  const sidebar = useSidebar()
  const language = useLanguage()
  const records = () => sidebar.sessions.data.records().slice(0, 4)
  const server = () => sidebar.home.selection.value().server

  return (
    <Show when={records().length > 0}>
      <section data-component="recent-sessions" aria-label={language.t("start.recent")}>
        <h2 data-slot="recent-sessions-title">{language.t("start.recent")}</h2>
        <For each={records()}>
          {(record) => (
            <button type="button" data-slot="recent-session" onClick={() => sidebar.sessions.session.open(record.session)}>
              <Show when={server()} fallback={<span data-slot="recent-dot" aria-hidden="true" />}>
                {(key) => (
                  <HomeSessionStatusController
                    server={key()}
                    record={record}
                    isOpenTab={() => false}
                    render={(state) => (
                      <span
                        data-slot="recent-dot"
                        data-state={state.loading() ? "running" : state.unread() ? "unread" : undefined}
                        aria-hidden="true"
                      />
                    )}
                  />
                )}
              </Show>
              <span data-slot="recent-session-title" dir="auto">
                {sessionLabel(record.session)}
              </span>
              <span data-slot="recent-session-project">{record.projectName}</span>
              <span data-slot="recent-session-time">
                {getRelativeTime(
                  new Date(record.session.time.updated ?? record.session.time.created).toISOString(),
                  language.t,
                )}
              </span>
            </button>
          )}
        </For>
      </section>
    </Show>
  )
}

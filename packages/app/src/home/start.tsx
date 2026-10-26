import { createEffect, createMemo, Show, untrack } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useServers } from "@/runtime/server/registry"
import { useSidebar } from "@/shell/sidebar/context"
import { useTabs } from "@/shell/tabs/tabs"

/**
 * The desktop start page. With a project it opens that project's draft session in place (the draft screen is the
 * start screen: greeting, composer, recent sessions); without one it asks for a project, since a draft needs a folder.
 */
export function HomeStart() {
  const sidebar = useSidebar()
  const tabs = useTabs()
  const servers = useServers()
  const language = useLanguage()

  const target = createMemo(() => {
    const conn = sidebar.home.server.focused()
    const project = sidebar.home.project.newSession()

    return conn && project ? { conn, directory: project.worktree } : undefined
  })

  createEffect(() => {
    const next = target()

    if (!tabs.ready() || !next) return
    untrack(() => sidebar.openProjectDraft(next.conn, next.directory, { replace: true }))
  })

  return (
    <Show when={servers.hydrated() && !target()}>
      <div
        data-component="home-start"
        class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col items-center justify-center gap-6 self-stretch rounded-[10px] bg-v2-background-bg-base px-6"
      >
        <h1 class="m-0 text-center text-[28px] leading-9 text-v2-text-text-base [font-weight:500]">
          {language.t("start.greeting")}
        </h1>
        <div class="flex max-w-[420px] flex-col items-center gap-4 text-center">
          <div class="flex flex-col gap-1">
            <p class="m-0 text-[15px] leading-5 text-v2-text-text-base [font-weight:530]">
              {language.t("start.noProject.title")}
            </p>
            <p class="m-0 text-[13px] leading-5 text-v2-text-text-muted">{language.t("start.noProject.description")}</p>
          </div>
          <Button
            variant="contrast"
            size="large"
            data-action="start-add-project"
            onClick={() => {
              const conn = sidebar.home.server.focused()

              if (conn) sidebar.projects.project.choose(conn)
            }}
          >
            <Icon name="folder-add-left" />
            {language.t("home.project.add")}
          </Button>
        </div>
      </div>
    </Show>
  )
}

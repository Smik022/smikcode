import { Schema } from "effect"
import { createMemo } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { createHomeController } from "@/home/model"
import { createHomeProjectsController } from "@/home/projects/controller"
import { createHomeSessionsController } from "@/home/sessions/controller"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { pathKey } from "@/workspaces/path-key"
import { findSessionTab, useTabs } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"

const SidebarSchema = Persistence.struct({
  opened: Schema.Boolean,
  collapsed: Persistence.record(Schema.Boolean),
})

/** How many sessions a project group lists before "Show more". */
export const SIDEBAR_SESSION_PREVIEW = 6

/**
 * Owns what the left sidebar and the start screen share: the home controllers (projects, sessions across every
 * project), whether the sidebar is open, and which project groups are collapsed.
 */
export const { use: useSidebar, provider: SidebarProvider } = createSimpleContext({
  name: "Sidebar",
  gate: false,
  init: () => {
    const language = useLanguage()
    const command = useCommand()
    const layout = useLayout()
    const tabs = useTabs()
    const global = useGlobal()
    const home = createHomeController()
    const projects = createHomeProjectsController(home)
    const sessions = createHomeSessionsController(home, { allProjects: true })
    const [state, setState] = persisted(Persist.global("shell.sidebar"), SidebarSchema, { opened: true, collapsed: {} })

    const toggle = () => setState("opened", (opened) => !opened)

    command.register("shell-sidebar", () => [
      {
        id: "sidebar.toggle",
        title: language.t("sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: toggle,
      },
    ])

    // The session the route shows, resolved to the root session its tab belongs to.
    const activeSessionID = createMemo(() => {
      const route = layout.route()

      if (route.type !== "session") return

      const tab = findSessionTab(tabs.store, route.server, route.sessionId)

      return (tab?.type === "session" ? tab.sessionId : undefined) ?? route.sessionId
    })

    const groups = createMemo(() => {
      const records = sessions.data.records()

      return home.project.list().map((project) => {
        const key = pathKey(project.worktree)

        return {
          project,
          key,
          records: records.filter((record) => pathKey(record.project.worktree) === key),
        }
      })
    })

    /** Opens the project's most recent draft, or starts one, so repeated clicks do not pile up empty drafts. */
    const openProjectDraft = (conn: ServerConnection.Any, directory: string, options?: { replace?: boolean }) => {
      const server = ServerConnection.key(conn)
      const draft = tabs.store.findLast(
        (tab) => tab.type === "draft" && tab.server === server && pathKey(tab.directory) === pathKey(directory),
      )

      if (draft) {
        tabs.select(draft, options)

        return
      }

      const ctx = global.ensureServerCtx(conn)
      ctx.projects.open(directory)
      ctx.projects.touch(directory)
      void tabs.newDraft({ server, directory }, undefined, undefined, options)
    }

    const newSession = () => {
      const conn = home.server.focused()
      const project = home.project.newSession()

      if (!conn || !project) return
      openProjectDraft(conn, project.worktree)
    }

    return {
      home,
      projects,
      sessions,
      groups,
      activeSessionID,
      opened: () => state.opened,
      toggle,
      collapsed: (key: string) => state.collapsed[key] ?? false,
      toggleCollapsed: (key: string) => setState("collapsed", key, !(state.collapsed[key] ?? false)),
      openProjectDraft,
      newSession,
    }
  },
})

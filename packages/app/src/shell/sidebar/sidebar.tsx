import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { InlineInput } from "@opencode/ui/inline-input"
import { Keybind } from "@opencode/ui/keybind"
import { Logo } from "@opencode/ui/logo"
import { Menu } from "@opencode/ui/menu"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { displayName, getProjectAvatarSource, getProjectAvatarVariant, ProjectAvatar } from "@opencode/ui/project-avatar"
import { HomeSessionStatusController, type HomeSessionRecord } from "@/home/sessions/controller"
import { fileManagerApp } from "@/home/projects/file-manager"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { sessionLabel } from "@/session/title"
import { getRelativeTime } from "@/shell/time"
import type { LocalProject } from "@/shell/state/layout"
import { SIDEBAR_SESSION_PREVIEW, useSidebar } from "./context"
import "./sidebar.css"

/** The primary navigation: new session, search, projects with their sessions, settings and help. */
export function Sidebar() {
  const sidebar = useSidebar()
  const language = useLanguage()
  const command = useCommand()
  const [search, setSearch] = createStore({ value: "" })
  const [rows, setRows] = createStore<{ editor: { id: string; draft: string; renaming: boolean } | undefined }>({
    editor: undefined,
  })

  const query = createMemo(() => search.value.trim().toLowerCase())

  const results = createMemo(() => {
    const value = query()

    if (!value) return []

    return sidebar.sessions.data
      .searchRecords()
      .filter((record) => `${sessionLabel(record.session)} ${record.projectName}`.toLowerCase().includes(value))
      .slice(0, 50)
  })

  const server = () => sidebar.home.server.focused()
  const serverKey = () => sidebar.home.selection.value().server

  const row = (record: HomeSessionRecord) => (
    <SessionRow
      record={record}
      active={sidebar.activeSessionID() === record.session.id}
      server={serverKey()}
      showProject={!!query()}
      editor={rows.editor?.id === record.session.id ? rows.editor : undefined}
      onEdit={(editor) => setRows("editor", editor)}
    />
  )

  return (
    <nav data-component="app-sidebar" aria-label={language.t("sidebar.label")}>
      <div data-slot="sidebar-header">
        <div data-slot="sidebar-wordmark">
          <Logo class="h-3 w-auto" />
        </div>
        <button type="button" data-action="sidebar-new-session" onClick={sidebar.newSession}>
          <Icon name="plus" />
          <span data-slot="sidebar-new-session-label">{language.t("command.session.new")}</span>
          <Keybind keys={command.keybindParts("tab.new")} variant="neutral" />
        </button>
        <label data-slot="sidebar-search">
          <Icon name="magnifying-glass" size="small" />
          <input
            type="text"
            data-action="sidebar-search"
            value={search.value}
            placeholder={language.t("home.sessions.search.placeholder")}
            aria-label={language.t("home.sessions.search.placeholder")}
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setSearch("value", event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearch("value", "")
            }}
          />
        </label>
      </div>

      <ScrollView class="min-h-0 flex-1">
        <div data-slot="sidebar-body">
          <Show
            when={!query()}
            fallback={
              <section data-slot="sidebar-results" aria-label={language.t("home.sessions.search.sessions")}>
                <Show
                  when={results().length > 0}
                  fallback={
                    <p data-slot="sidebar-empty">
                      {language.t("home.sessions.search.noResults", { query: search.value.trim() })}
                    </p>
                  }
                >
                  <For each={results()}>{row}</For>
                </Show>
              </section>
            }
          >
            <div data-slot="sidebar-section-header">
              <span>{language.t("home.projects")}</span>
              <div data-slot="sidebar-section-actions">
                <Show when={sidebar.home.server.list().length > 1}>
                  <ServerMenu />
                </Show>
                <Tooltip placement="bottom" value={language.t("home.project.add")}>
                  <IconButton
                    type="button"
                    data-action="sidebar-add-project"
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="folder-add-left" />}
                    aria-label={language.t("home.project.add")}
                    onClick={() => {
                      const conn = server()

                      if (conn) sidebar.projects.project.choose(conn)
                    }}
                  />
                </Tooltip>
              </div>
            </div>
            <Show
              when={sidebar.groups().length > 0}
              fallback={
                <button type="button" data-slot="sidebar-add-project-row" onClick={() => {
                  const conn = server()

                  if (conn) sidebar.projects.project.choose(conn)
                }}>
                  <Icon name="folder-add-left" size="small" />
                  <span>{language.t("home.project.add")}</span>
                </button>
              }
            >
              <For each={sidebar.groups()}>
                {(group) => (
                  <ProjectGroup
                    project={group.project}
                    projectKey={group.key}
                    records={group.records}
                    row={row}
                  />
                )}
              </For>
            </Show>
          </Show>
        </div>
      </ScrollView>

      <div data-slot="sidebar-footer">
        <button type="button" data-action="sidebar-settings" onClick={() => sidebar.projects.utility.settings()}>
          <Icon name="settings-gear" size="small" />
          <span>{language.t("sidebar.settings")}</span>
        </button>
        <button type="button" data-action="sidebar-help" onClick={() => sidebar.projects.utility.help()}>
          <Icon name="help" size="small" />
          <span>{language.t("sidebar.help")}</span>
        </button>
      </div>
    </nav>
  )
}

function ProjectGroup(props: {
  project: LocalProject
  projectKey: string
  records: HomeSessionRecord[]
  row: (record: HomeSessionRecord) => ReturnType<typeof SessionRow>
}) {
  const sidebar = useSidebar()
  const language = useLanguage()
  const platform = usePlatform()
  const [more, setMore] = createSignal(false)
  const collapsed = () => sidebar.collapsed(props.projectKey)
  const visible = createMemo(() => (more() ? props.records : props.records.slice(0, SIDEBAR_SESSION_PREVIEW)))
  const server = () => sidebar.home.server.focused()
  const projects = sidebar.projects

  const withServer = (run: (conn: ServerConnection.Any) => void) => () => {
    const conn = server()

    if (conn) run(conn)
  }

  const unread = () => {
    const conn = server()

    return conn ? projects.project.hasUnread(conn, props.project) : false
  }

  return (
    <section data-slot="sidebar-group" data-collapsed={collapsed() ? "" : undefined}>
      <div data-slot="sidebar-group-header">
        <button
          type="button"
          data-slot="sidebar-group-toggle"
          aria-expanded={!collapsed()}
          onClick={() => sidebar.toggleCollapsed(props.projectKey)}
        >
          <Icon name="chevron-down" size="small" data-slot="sidebar-group-chevron" />
          <ProjectAvatar
            fallback={displayName(props.project)}
            src={getProjectAvatarSource(props.project.id, props.project.icon)}
            variant={getProjectAvatarVariant(props.project.icon?.color)}
          />
          <span data-slot="sidebar-group-name">{displayName(props.project)}</span>
          <Show when={unread() && collapsed()}>
            <span data-slot="sidebar-dot" data-state="unread" aria-hidden="true" />
          </Show>
        </button>
        <div data-slot="sidebar-group-actions">
          <Menu gutter={6} modal={false} placement="bottom-end">
            <Menu.Trigger
              as={IconButton}
              data-action="sidebar-project-menu"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" />}
              aria-label={language.t("common.moreOptions")}
            />
            <Menu.Portal>
              <Menu.Content>
                <Menu.Item onSelect={withServer((conn) => sidebar.openProjectDraft(conn, props.project.worktree))}>
                  {language.t("command.session.new")}
                </Menu.Item>
                <Show when={projects.project.canImportSession}>
                  <Menu.Item onSelect={withServer((conn) => projects.project.importSession(conn, props.project))}>
                    {language.t("command.session.import")}
                  </Menu.Item>
                </Show>
                <Menu.Item onSelect={withServer((conn) => projects.project.edit(conn, props.project))}>
                  {language.t("dialog.project.edit.title")}
                </Menu.Item>
                <Show when={server() && projects.project.canReveal(server()!)}>
                  <Menu.Item onSelect={withServer((conn) => projects.project.reveal(conn, props.project))}>
                    {language.t(
                      fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown")
                        .actionLabel,
                    )}
                  </Menu.Item>
                </Show>
                <Menu.Item disabled={!unread()} onSelect={withServer((conn) => projects.project.clearNotifications(conn, props.project))}>
                  {language.t("sidebar.project.clearNotifications")}
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item onSelect={withServer((conn) => projects.project.close(conn, props.project.worktree))}>
                  {language.t("common.close")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
          <Tooltip placement="bottom" value={language.t("command.session.new")}>
            <IconButton
              type="button"
              data-action="sidebar-project-new-session"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="edit" />}
              aria-label={language.t("command.session.new")}
              onClick={withServer((conn) => sidebar.openProjectDraft(conn, props.project.worktree))}
            />
          </Tooltip>
        </div>
      </div>
      <Show when={!collapsed()}>
        <div data-slot="sidebar-group-sessions">
          <Show when={props.records.length > 0} fallback={<p data-slot="sidebar-empty">{language.t("sidebar.session.empty")}</p>}>
            <For each={visible()}>{props.row}</For>
            <Show when={props.records.length > SIDEBAR_SESSION_PREVIEW}>
              <button type="button" data-slot="sidebar-more" onClick={() => setMore((value) => !value)}>
                {language.t(more() ? "sidebar.session.showLess" : "sidebar.session.showMore")}
              </button>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  )
}

function SessionRow(props: {
  record: HomeSessionRecord
  active: boolean
  server: ServerConnection.Key | undefined
  showProject: boolean
  editor: { id: string; draft: string; renaming: boolean } | undefined
  onEdit: (editor: { id: string; draft: string; renaming: boolean } | undefined) => void
}) {
  const sidebar = useSidebar()
  const language = useLanguage()
  const title = createMemo(() => sessionLabel(props.record.session))
  const session = () => props.record.session
  const updated = () => new Date(session().time.updated ?? session().time.created).toISOString()

  const save = async () => {
    const current = props.editor

    if (!current || current.renaming || !props.server) return
    props.onEdit({ ...current, renaming: true })
    const saved = await sidebar.sessions.session.rename(props.server, session(), current.draft)
    props.onEdit(saved ? undefined : { ...current, renaming: false })
  }

  return (
    <div data-slot="sidebar-session" data-active={props.active ? "" : undefined}>
      <Show
        when={!props.editor}
        fallback={
          <div data-slot="sidebar-session-editor">
            <InlineInput
              aria-label={language.t("common.rename")}
              dir="auto"
              ref={(element: HTMLInputElement) =>
                requestAnimationFrame(() => {
                  element.focus()
                  element.select()
                })
              }
              value={props.editor?.draft ?? ""}
              disabled={props.editor?.renaming ?? false}
              class="min-w-0 flex-1 text-v2-text-text-base"
              style={{ "--inline-input-shadow": "none", "text-align": "start" }}
              onInput={(event: InputEvent & { currentTarget: HTMLInputElement }) => {
                const draft = event.currentTarget.value
                const current = props.editor

                if (current) props.onEdit({ ...current, draft })
              }}
              onKeyDown={(event: KeyboardEvent) => {
                event.stopPropagation()

                if (event.isComposing || event.keyCode === 229) return

                if (event.key === "Enter") {
                  event.preventDefault()
                  void save()

                  return
                }

                if (event.key === "Escape") props.onEdit(undefined)
              }}
              onBlur={() => {
                if (!props.editor?.renaming) props.onEdit(undefined)
              }}
            />
          </div>
        }
      >
        <button
          type="button"
          data-slot="sidebar-session-button"
          aria-current={props.active ? "page" : undefined}
          onClick={(event) => sidebar.sessions.session.open(session(), { background: event.ctrlKey || event.metaKey })}
          onMouseEnter={() => sidebar.sessions.location.sync(props.record)}
        >
          <SessionStatus record={props.record} server={props.server} />
          <span data-slot="sidebar-session-title" dir="auto">
            {title()}
          </span>
          <Show when={props.showProject}>
            <span data-slot="sidebar-session-project">{props.record.projectName}</span>
          </Show>
          <span data-slot="sidebar-session-time">{getRelativeTime(updated(), language.t)}</span>
        </button>
        <Menu gutter={4} modal={false} placement="bottom-end">
          <Menu.Trigger
            as={IconButton}
            data-slot="sidebar-session-menu"
            variant="ghost-muted"
            size="small"
            icon={<Icon name="outline-dots" />}
            aria-label={language.t("common.moreOptions")}
          />
          <Menu.Portal>
            <Menu.Content
              onCloseAutoFocus={(event) => {
                // Rename moves focus into its editor; do not hand it back to the trigger.
                if (props.editor) event.preventDefault()
              }}
            >
              <Menu.Item onSelect={() => props.onEdit({ id: session().id, draft: title(), renaming: false })}>
                {language.t("common.rename")}
              </Menu.Item>
              <Menu.Item onSelect={() => props.server && void sidebar.sessions.session.export(props.server, session())}>
                {language.t("common.export")}…
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item onSelect={() => props.server && sidebar.sessions.session.showDelete(props.server, session())}>
                {language.t("common.delete")}…
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </Show>
    </div>
  )
}

/** A dot for sessions that are running or need attention; nothing otherwise. */
function SessionStatus(props: { record: HomeSessionRecord; server: ServerConnection.Key | undefined }) {
  const language = useLanguage()

  return (
    <Show when={props.server} fallback={<span data-slot="sidebar-dot" aria-hidden="true" />}>
      {(server) => (
        <HomeSessionStatusController
          server={server()}
          record={props.record}
          isOpenTab={() => false}
          render={(state) => (
            <span
              data-slot="sidebar-dot"
              data-state={state.loading() ? "running" : state.unread() ? "unread" : undefined}
              role={state.loading() || state.unread() ? "img" : undefined}
              aria-label={
                state.loading()
                  ? language.t("sidebar.session.running")
                  : state.unread()
                    ? language.t("sidebar.session.unread")
                    : undefined
              }
              aria-hidden={state.loading() || state.unread() ? undefined : true}
            />
          )}
        />
      )}
    </Show>
  )
}

function ServerMenu() {
  const sidebar = useSidebar()
  const language = useLanguage()
  const focused = () => sidebar.home.server.focused()

  return (
    <Menu gutter={6} modal={false} placement="bottom-end">
      <Menu.Trigger
        as={IconButton}
        data-action="sidebar-server-menu"
        variant="ghost-muted"
        size="small"
        icon={<Icon name="workspace" />}
        aria-label={language.t("sidebar.server.switch")}
      />
      <Menu.Portal>
        <Menu.Content>
          <For each={sidebar.home.server.list()}>
            {(conn) => (
              <Menu.Item onSelect={() => sidebar.projects.server.focus(conn)}>
                <span>{serverName(conn)}</span>
                <Show when={focused() && ServerConnection.key(focused()!) === ServerConnection.key(conn)}>
                  <Icon name="check" size="small" />
                </Show>
              </Menu.Item>
            )}
          </For>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

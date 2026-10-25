import type { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { Logo } from "../../../component/logo"
import { Prompt } from "../../../component/prompt"
import { ThemePreview, useTheme } from "../../../context/theme"
import { InlineToolRow } from "../../../routes/session/message-parts"
import { SidebarFrame } from "../../../routes/session/sidebar"
import { SidebarSessions, SidebarTasks, type SessionTask } from "../../../routes/session/sidebar-sections"
import { SKINS } from "../../../theme"
import { Divider, panelBorder, panelPadding, RoleLabel, SkinHeader } from "../../../ui/skin"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const NARROW_WIDTH = 52
const placeholders = { normal: ["Restyle the sidebar", "Explain the build"], shell: ["ls -la"] }
const sessions = [
  { id: "ses_skins", title: "SmikCode skins" },
  { id: "ses_web", title: "Web skin switcher" },
  { id: "ses_logo", title: "Pixel wordmark" },
]
const tasks: SessionTask[] = [
  { content: "Add skin tokens to the theme schema", status: "completed" },
  { content: "Dock the sidebar per skin", status: "in_progress" },
  { content: "Record the story", status: "pending" },
]

type Screen = "home" | "session"

function SkinsStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const [skin, setSkin] = createSignal(0)
  const [screen, setScreen] = createSignal<Screen>("session")
  const [narrow, setNarrow] = createSignal(false)
  const [showTasks, setShowTasks] = createSignal(true)
  const cycle = (step: number) => setSkin((current) => (current + step + SKINS.length) % SKINS.length)
  const reset = () => {
    setSkin(0)
    setScreen("session")
    setNarrow(false)
    setShowTasks(true)
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "right,l,s", title: "Next skin", group: "Storybook", run: () => cycle(1) },
      { bind: "left,h", title: "Previous skin", group: "Storybook", run: () => cycle(-1) },
      {
        bind: "space",
        title: "Toggle home and session",
        group: "Storybook",
        run: () => setScreen((current) => (current === "home" ? "session" : "home")),
      },
      { bind: "w", title: "Toggle narrow width", group: "Storybook", run: () => setNarrow((value) => !value) },
      { bind: "t", title: "Toggle task data", group: "Storybook", run: () => setShowTasks((value) => !value) },
      { bind: "r", title: "Reset story", group: "Storybook", run: reset },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height}>
      <ThemePreview name={SKINS[skin()]!.id}>
        <SkinCanvas
          screen={screen()}
          width={narrow() ? Math.min(NARROW_WIDTH, dimensions().width) : dimensions().width}
          tasks={showTasks() ? tasks : []}
        />
      </ThemePreview>
      <StoryFooter
        context={props.context}
        title="storybook / smikcode skins"
        details={[SKINS[skin()]!.title, screen(), narrow() ? `narrow (${NARROW_WIDTH})` : "wide"]}
        message="resize the terminal to check real narrow and wide layouts"
        controls={[
          { shortcut: "←/→", label: "skin" },
          { shortcut: "space", label: "home/session" },
          { shortcut: "w", label: "width" },
          { shortcut: "t", label: "tasks" },
          { shortcut: "r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

function SkinCanvas(props: { screen: Screen; width: number; tasks: readonly SessionTask[] }) {
  const theme = useTheme()
  const wide = () => props.width > 100
  return (
    <box flexGrow={1} minHeight={0} width={props.width} backgroundColor={theme.background.base}>
      <Show
        when={props.screen === "session"}
        fallback={
          <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
            <box width="100%" flexShrink={0}>
              <SkinHeader info={{ directory: "~/code/smikcode", agent: "Build", model: "Claude Sonnet" }} />
            </box>
            <box flexGrow={1} />
            <Logo />
            <box height={1} />
            <box width="100%" maxWidth={75}>
              <Prompt disabled placeholders={placeholders} />
            </box>
            <box flexGrow={1} />
          </box>
        }
      >
        <box flexGrow={1} minHeight={0} flexDirection={theme.skin.sidebar.side === "left" ? "row-reverse" : "row"}>
          <box flexGrow={1} minWidth={0} paddingLeft={2} paddingRight={2}>
            <SkinHeader info={{ directory: "~/code/smikcode", agent: "Build", model: "Claude Sonnet", percent: 42 }} />
            <Transcript />
            <box flexGrow={1} />
            <Prompt disabled placeholders={placeholders} />
          </box>
          <Show when={wide()}>
            <SidebarPreview tasks={props.tasks} />
          </Show>
        </box>
      </Show>
    </box>
  )
}

function Transcript() {
  const theme = useTheme()
  const panel = () => (theme.skin.panel === "flat" ? theme.background.base : theme.background.raised.base)
  const indent = () => (theme.skin.border === "none" ? 0 : 1)
  const message = (text: string) => (
    <box marginTop={1} flexShrink={0}>
      <RoleLabel role="user" paddingLeft={indent()} />
      <box {...panelBorder(theme.skin.border, theme.role.user)} backgroundColor={panel()}>
        <box
          paddingTop={panelPadding(theme.skin.border)}
          paddingBottom={panelPadding(theme.skin.border)}
          paddingLeft={2}
        >
          <text fg={theme.text.base}>{text}</text>
        </box>
      </box>
    </box>
  )
  return (
    <box flexShrink={0}>
      {message("Make the sidebar dock on the left for the workshop skin")}
      <box marginTop={1} flexShrink={0}>
        <RoleLabel role="assistant" paddingLeft={indent()} />
        <InlineToolRow skin={theme.skin.tool} icon="→" complete color={theme.text.muted} pending="Reading file…">
          Read src/component/session-frame.tsx
        </InlineToolRow>
        <InlineToolRow skin={theme.skin.tool} icon="✱" complete color={theme.text.muted} pending="Searching content…">
          Grep "sidebar" (12 matches)
        </InlineToolRow>
        <InlineToolRow
          skin={theme.skin.tool}
          icon="✗"
          complete
          failed
          color={theme.text.muted}
          errorColor={theme.text.feedback.error.base}
          pending="Running…"
        >
          Shell bun typecheck
        </InlineToolRow>
        <box paddingLeft={3} paddingTop={1}>
          <text fg={theme.markdown.text}>The sidebar now follows the skin's sidebar side token.</text>
        </box>
      </box>
      <Show when={theme.skin.turns === "rule"}>
        <box marginTop={1}>
          <Divider />
        </box>
      </Show>
      {message("Thanks, ship it")}
    </box>
  )
}

function SidebarPreview(props: { tasks: readonly SessionTask[] }) {
  const theme = useTheme()
  return (
    <SidebarFrame>
      <box gap={1}>
        <text fg={theme.text.base}>
          <b>SmikCode skins</b>
        </text>
        <Show when={theme.skin.sidebar.sessions}>
          <SidebarSessions sessions={sessions} current="ses_skins" onSelect={() => {}} />
        </Show>
        <SidebarTasks tasks={props.tasks} />
      </box>
    </SidebarFrame>
  )
}

export const skinsStory: Story = {
  id: "skins",
  title: "SmikCode skins",
  render: (context) => <SkinsStory context={context} />,
}

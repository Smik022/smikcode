import { useData } from "../../context/data"
import { createMemo, Show, type ParentProps } from "solid-js"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"
import { Slot } from "../../plugin/render"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { TextAttributes } from "@opentui/core"
import "../../component/title-shimmer"

import { getScrollAcceleration } from "../../util/scroll"
import { SESSION_SIDEBAR_WIDTH } from "../../ui/layout"
import { frameStyle } from "../../ui/skin"
import type { ComponentTheme } from "../../theme/component"
import { SidebarSessions, SidebarTasks, useSessionTasks, useSidebarSessions } from "./sidebar-sections"

export function Sidebar(props: { sessionID: string }) {
  const data = useData()
  const theme = useTheme()
  const config = useConfig().data
  const session = createMemo(() => data.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  const tasks = useSessionTasks(() => props.sessionID)
  const recent = useSidebarSessions(() => props.sessionID)
  const background = () => sidebarBackground(theme)

  return (
    <Show when={session()}>
      <SidebarFrame>
        <box flexShrink={0} paddingRight={2} paddingBottom={1}>
          <title_shimmer
            fg={theme.text.base}
            rename={{
              pending: data.session.title.pending(props.sessionID),
              title: withTimestampedFallback(session()),
            }}
            enabled={config.animations ?? true}
            backdrop={background()}
            attributes={
              data.session.title.pending(props.sessionID) && config.animations === false
                ? TextAttributes.DIM
                : TextAttributes.BOLD
            }
          >
            {withTimestampedFallback(session())}
          </title_shimmer>
        </box>
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollAcceleration={scrollAcceleration()}
          // The sidebar only scrolls vertically; a horizontal bar steals a row during initial layout.
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{
            // Use the content's reserved right padding instead of changing its width when the bar toggles.
            position: "absolute",
            right: 0,
            top: 0,
            width: 1,
            height: "100%",
            trackOptions: {
              backgroundColor: background(),
              foregroundColor: theme.scrollbar.base,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <Show when={theme.skin.sidebar.sessions}>
              <SidebarSessions sessions={recent.sessions()} current={props.sessionID} onSelect={recent.select} />
            </Show>
            <SidebarTasks tasks={tasks()} />
            <Slot path="sidebar.content" input={{ sessionID: props.sessionID }} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Slot path="sidebar.footer" input={{ sessionID: props.sessionID }} />
        </box>
      </SidebarFrame>
    </Show>
  )
}

function sidebarBackground(theme: ComponentTheme) {
  return theme.skin.panel === "flat" ? theme.background.base : theme.background.raised.base
}

/** The sidebar panel in the active skin: framed skins outline it, others keep one edge facing the transcript. */
export function SidebarFrame(props: ParentProps) {
  const theme = useTheme()
  const framed = () => theme.skin.border !== "split" && theme.skin.border !== "none"
  const edge = () => (theme.skin.sidebar.side === "left" ? "right" : "left")
  return (
    <box
      backgroundColor={sidebarBackground(theme)}
      width={SESSION_SIDEBAR_WIDTH}
      height="100%"
      paddingTop={framed() ? 0 : 1}
      paddingBottom={framed() ? 0 : 1}
      paddingLeft={framed() ? 1 : 2}
      paddingRight={framed() ? 1 : 2}
      position="relative"
      // borderColor and borderStyle switch the border back on, so `border` has to be applied after them.
      borderColor={theme.border.base}
      borderStyle={frameStyle(theme.skin.border)}
      border={framed() ? true : theme.skin.border === "none" ? [edge()] : false}
    >
      {props.children}
    </box>
  )
}

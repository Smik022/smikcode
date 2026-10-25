import { BorderChars, TextAttributes, type BorderSides, type BorderStyle, type RGBA } from "@opentui/core"
import type { SkinBorder } from "@opencode/theme/tui"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { EmptyBorder, SplitBorder } from "./border"

const LEFT: BorderSides[] = ["left"]

/**
 * Border props for a skinned panel; spread them onto a box instead of setting these props separately.
 *
 * Every key is always present so switching skins live replaces the previous style. Key order matters:
 * OpenTUI's `borderColor` and `borderStyle` setters switch the border back on (and `borderStyle` drops
 * custom characters), so `border` is applied last. Borderless panels keep the default colour so later
 * colour changes never re-enable their border.
 */
export function panelBorder(
  border: SkinBorder,
  color: RGBA,
): {
  borderColor: RGBA | undefined
  borderStyle: BorderStyle | undefined
  customBorderChars: typeof SplitBorder.customBorderChars | undefined
  border: boolean | BorderSides[]
} {
  if (border === "split")
    return {
      borderColor: color,
      borderStyle: undefined,
      customBorderChars: SplitBorder.customBorderChars,
      border: LEFT,
    }
  if (border === "none")
    return { borderColor: undefined, borderStyle: undefined, customBorderChars: undefined, border: false }
  return { borderColor: color, borderStyle: frameStyle(border), customBorderChars: undefined, border: true }
}

/** The box-drawing style behind a framed skin border; split and none fall back to single lines. */
export function frameStyle(border: SkinBorder): BorderStyle {
  if (border === "rounded" || border === "double") return border
  return "single"
}

/** Vertical padding inside a skinned panel: split bars keep the classic airy block, frames hug their content. */
export function panelPadding(border: SkinBorder) {
  return border === "split" ? 1 : 0
}

/** A full-width rule drawn with the skin's divider glyph. */
export function Divider(props: { color?: RGBA }) {
  const theme = useTheme()
  return (
    <box
      height={1}
      flexShrink={0}
      border={["top"]}
      borderColor={props.color ?? theme.border.base}
      customBorderChars={{ ...EmptyBorder, horizontal: theme.skin.divider }}
    />
  )
}

/** The skin's speaker label (`◆ you`, `smik ▸`, `USER:` …). Renders nothing when the skin has no role labels. */
export function RoleLabel(props: { role: "user" | "assistant"; paddingLeft?: number }) {
  const theme = useTheme()
  return (
    <Show when={theme.skin.role[props.role]}>
      {(label) => (
        <box paddingLeft={props.paddingLeft ?? 0} flexShrink={0}>
          <text fg={theme.role[props.role]} attributes={TextAttributes.BOLD} wrapMode="none" selectable={false}>
            {label()}
          </text>
        </box>
      )}
    </Show>
  )
}

export type SkinHeaderInfo = {
  directory?: string
  agent?: string
  model?: string
  percent?: number
}

/**
 * The skin's top bar: a one-line status strip (`SMIKCODE · cwd · agent · model · ctx%`) or a block banner.
 * Renders nothing for skins whose header is `none`.
 */
export function SkinHeader(props: { info: SkinHeaderInfo }) {
  const theme = useTheme()
  const details = () =>
    [
      props.info.directory,
      props.info.agent,
      props.info.model,
      props.info.percent === undefined ? undefined : `${props.info.percent}%`,
    ].filter((value): value is string => Boolean(value))

  return (
    <Show when={theme.skin.header !== "none"}>
      <box flexShrink={0} paddingBottom={theme.skin.header === "status" ? 0 : 1}>
        <Show
          when={theme.skin.header === "banner"}
          fallback={
            <>
              <text wrapMode="none" truncate>
                <span style={{ fg: theme.brand.end, attributes: TextAttributes.BOLD }}>SMIKCODE</span>
                <span style={{ fg: theme.text.muted }}>
                  {details()
                    .map((value) => ` · ${value}`)
                    .join("")}
                </span>
              </text>
              <Divider />
            </>
          }
        >
          <box flexDirection="row" height={1}>
            <text flexShrink={0} wrapMode="none" fg={theme.brand.start} attributes={TextAttributes.BOLD}>
              {"█▓▒░ SMIK ░▒▓█ "}
            </text>
            <text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={theme.text.muted}>
              {details().join(" · ")}
            </text>
            <box flexGrow={1} minWidth={1} paddingLeft={1}>
              <Divider color={theme.brand.end} />
            </box>
          </box>
        </Show>
      </box>
    </Show>
  )
}

/**
 * The top edge of a framed panel with labels set into the line: `╭─ Build ──────── model ─╮`.
 * Pair it with a box whose border omits the top side.
 */
export function FrameTop(props: { border: SkinBorder; color: RGBA; left?: string; right?: string; labelColor?: RGBA }) {
  const chars = () => BorderChars[frameStyle(props.border)]
  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <text flexShrink={0} fg={props.color} wrapMode="none" selectable={false}>
        {chars().topLeft}
        {chars().horizontal}
      </text>
      <Show when={props.left}>
        {(label) => (
          <text flexShrink={0} fg={props.labelColor ?? props.color} wrapMode="none" attributes={TextAttributes.BOLD}>
            {` ${label()} `}
          </text>
        )}
      </Show>
      <box
        flexGrow={1}
        minWidth={1}
        height={1}
        border={["top"]}
        borderColor={props.color}
        customBorderChars={{ ...EmptyBorder, horizontal: chars().horizontal }}
      />
      <Show when={props.right}>
        {(label) => (
          <text flexShrink={1} minWidth={0} fg={props.color} wrapMode="none" truncate>
            {` ${label()} `}
          </text>
        )}
      </Show>
      <text flexShrink={0} fg={props.color} wrapMode="none" selectable={false}>
        {chars().horizontal}
        {chars().topRight}
      </text>
    </box>
  )
}

import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { logoRows, markRows, type LogoCell } from "../logo"

/** The SmikCode wordmark in the active skin's logo variant; narrow terminals get the monogram. */
export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const full = createMemo(() => logoRows(theme.skin.logo, theme.skin.divider))
  const rows = createMemo(() => {
    const width = Math.max(...full().map((row) => row.length))
    return dimensions().width < width + 4 ? markRows() : full()
  })
  const color = (ink: LogoCell["ink"]) => {
    if (ink === "rule") return theme.border.base
    if (ink === "shadow") return theme.brand.end
    return tint(theme.brand.start, theme.brand.end, ink)
  }

  return (
    <box>
      <Show when={dimensions().height >= 12}>
        <For each={rows()}>
          {(row) => (
            <text selectable={false} wrapMode="none" attributes={TextAttributes.BOLD}>
              <For each={row}>{(cell) => <span style={{ fg: color(cell.ink) }}>{cell.char}</span>}</For>
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}

import { createMemo } from "solid-js"
import { Select } from "@opencode/ui/select"
import { useExtension } from "../sdk"
import type definition from "./index"

const TOOLS = ["safe", "edits", "all"] as const

/** The Claude Code section of the General settings page, in the host's settings row markup. */
export default function ClaudeSection() {
  const ctx = useExtension<typeof definition>()
  const claude = ctx.stores.claude
  const options = createMemo(() => TOOLS.map((value) => ({ value, label: ctx.t(`settings.tools.${value}`) })))

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("settings.title")}</h3>

      <div data-component="settings-list">
        <div data-component="settings-row">
          <div data-slot="settings-row-copy">
            <div data-slot="settings-row-title">{ctx.t("settings.tools.title")}</div>
            <div data-slot="settings-row-description">{ctx.t("settings.tools.description")}</div>
          </div>
          <div data-slot="settings-row-control">
            <Select
              data-action="settings-claude-tools"
              options={options()}
              current={options().find((option) => option.value === claude.value.tools)}
              value={(option) => option.value}
              label={(option) => option.label}
              placement="bottom-end"
              gutter={6}
              onSelect={(option) =>
                option &&
                claude.update((draft) => {
                  draft.tools = option.value
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

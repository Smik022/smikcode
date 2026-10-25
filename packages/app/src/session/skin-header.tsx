import { createMemo, Show } from "solid-js"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { useLocal } from "@/providers/models/selection"
import { useModels } from "@/providers/models/models"
import type { SessionModel } from "@/session/model"

/**
 * The one-line strip at the top of the session view for skins with data-skin-header="status" (brand · cwd · agent ·
 * model · context %) or "banner" (brand · cwd · model). The brand text comes from --skin-header-label; skins without
 * a header hide the strip in CSS.
 */
export function SkinSessionHeader(props: { session: SessionModel }) {
  const local = useLocal()
  const models = useModels()

  // Same step as the context indicator and the TUI: the latest usage after the last compaction, before an undo.
  const context = createMemo(() => {
    const message = lastAssistantWithUsage(props.session.history.messages(), props.session.data.revertMessageID())

    if (!message) return
    const limit = models.find({ providerID: message.model.providerID, modelID: message.model.id })?.limit.context

    if (!limit) return
    const tokens = message.tokens

    return Math.round(
      ((tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write) / limit) * 100,
    )
  })

  return (
    <div data-component="skin-session-header">
      <span data-slot="skin-header-cwd" title={props.session.workspace.directory()}>
        {props.session.workspace.directory()}
      </span>
      <Show when={local.agent.current()?.name}>{(name) => <span data-slot="skin-header-agent">{name()}</span>}</Show>
      <Show when={local.model.current()?.name}>{(name) => <span data-slot="skin-header-model">{name()}</span>}</Show>
      <Show when={context() !== undefined}>
        <span data-slot="skin-header-context">{context()}%</span>
      </Show>
    </div>
  )
}

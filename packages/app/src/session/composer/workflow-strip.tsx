import { createMemo, For, Show } from "solid-js"
import { Workflow } from "@opencode/schema/workflow"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import type { SessionModel } from "../model"

// A strip above the composer for the workflow the session runs: its stages, where it is, and what it waits for.
// Like the queue panel it slides under the composer card, so the two read as one attached surface.
export function WorkflowStrip(props: { session: SessionModel }) {
  const language = useLanguage()
  const server = useServerSDK()
  const run = createMemo(() => Workflow.read(props.session.data.info()?.metadata))

  const failed = () => showToast({ title: language.t("common.requestFailed") })

  // The same commands a user can type, so the strip and the prompt box always agree.
  const command = (text: string) => {
    const info = props.session.data.info()

    if (!info) return
    void server.api.session.command({ sessionID: info.id, name: "workflow", text }).catch(failed)
  }

  const dismiss = () => {
    const info = props.session.data.info()

    if (!info) return
    void server.api.session.update({ sessionID: info.id, metadata: Workflow.clear(info.metadata) }).catch(failed)
  }

  return (
    <Show when={run()}>
      {(current) => {
        const position = () => current().workflow.stages.findIndex((stage) => stage.id === current().stage)
        const title = () => current().workflow.stages[position()]?.title ?? current().stage

        const status = () =>
          current().status === "waiting"
            ? language.t(current().waiting === "finish" ? "session.workflow.waitingFinish" : "session.workflow.waitingStart")
            : language.t(`session.workflow.${current().status}`)

        return (
          <div
            data-component="session-workflow-strip"
            data-status={current().status}
            class="relative z-0 -mb-3 flex items-start justify-between gap-3 rounded-xl bg-v2-background-bg-base px-3 pt-1.5 pb-[18px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
          >
            <div class="flex h-8 min-w-0 flex-1 items-center gap-2 text-[13px] font-[440] leading-[var(--line-height-compact)]">
              <Icon name="branch-out" class="shrink-0 text-v2-text-text-muted" />
              <span class="max-w-[40%] shrink-0 truncate font-[530] text-v2-text-text-base">{current().workflow.name}</span>
              <div class="flex shrink-0 items-center gap-1" aria-hidden="true">
                <For each={current().workflow.stages}>
                  {(_, index) => (
                    <span
                      class="size-1.5 rounded-full"
                      classList={{
                        "bg-v2-text-text-muted": current().status === "done" || index() < position(),
                        "bg-v2-text-text-base": current().status !== "done" && index() === position(),
                        "animate-pulse": current().status === "running" && index() === position(),
                        "bg-v2-background-bg-layer-04": current().status !== "done" && index() > position(),
                      }}
                    />
                  )}
                </For>
              </div>
              <Show when={current().status !== "done"}>
                <span class="min-w-0 truncate text-v2-text-text-muted">
                  {language.t("session.workflow.stage", { current: position() + 1, total: current().workflow.stages.length })}
                  {": "}
                  {title()}
                </span>
              </Show>
              <span class="shrink-0 truncate text-v2-text-text-faint" title={current().note || undefined}>
                {status()}
              </span>
            </div>
            <div class="flex h-8 shrink-0 items-center gap-1.5">
              <Show when={current().status === "waiting"}>
                <Button
                  data-action="session-workflow-approve"
                  type="button"
                  size="small"
                  variant="ghost-faint"
                  icon="check"
                  class="![font-weight:530]"
                  onClick={() => command("approve")}
                >
                  {language.t("session.workflow.approve")}
                </Button>
              </Show>
              <Show when={current().status === "paused" || current().status === "blocked"}>
                <Button
                  data-action="session-workflow-resume"
                  type="button"
                  size="small"
                  variant="ghost-faint"
                  icon="arrow-up"
                  class="![font-weight:530]"
                  onClick={() => command("resume")}
                >
                  {language.t("session.workflow.resume")}
                </Button>
              </Show>
              <Show
                when={current().status === "done"}
                fallback={
                  <Tooltip placement="top" value={language.t("session.workflow.stop")}>
                    <IconButton
                      data-action="session-workflow-stop"
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      icon={<Icon name="outline-xmark" />}
                      aria-label={language.t("session.workflow.stop")}
                      onClick={() => command("stop")}
                    />
                  </Tooltip>
                }
              >
                <Tooltip placement="top" value={language.t("session.workflow.dismiss")}>
                  <IconButton
                    data-action="session-workflow-dismiss"
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    icon={<Icon name="outline-xmark" />}
                    aria-label={language.t("session.workflow.dismiss")}
                    onClick={dismiss}
                  />
                </Tooltip>
              </Show>
            </div>
          </div>
        )
      }}
    </Show>
  )
}

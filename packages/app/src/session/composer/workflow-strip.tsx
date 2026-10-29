import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Workflow } from "@opencode/schema/workflow"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Textarea } from "@opencode/ui/textarea"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { openNotificationSession } from "@/shell/notifications/notification"
import { showToast } from "@/shell/notifications/toast"
import { useTabs } from "@/shell/tabs/tabs"
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

  // A workflow drafted from a description waits to be saved or dropped. A run in progress takes the strip first.
  const drafted = createMemo(() =>
    run() === undefined || run()?.status === "done" ? Workflow.draft(props.session.data.info()?.metadata) : undefined,
  )

  return (
    <>
      <Show when={drafted()}>
        {(current) => (
          <div
            data-component="session-workflow-strip"
            data-status="draft"
            class="relative z-0 -mb-3 flex items-start justify-between gap-3 rounded-xl bg-v2-background-bg-base px-3 pt-1.5 pb-[18px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
          >
            <div class="flex h-8 min-w-0 flex-1 items-center gap-2 text-[13px] font-[440] leading-[var(--line-height-compact)]">
              <Icon name="branch-out" class="shrink-0 text-v2-text-text-muted" />
              <span class="min-w-0 shrink truncate font-[530] text-v2-text-text-base">{current().name}</span>
              <span class="shrink-0 truncate text-v2-text-text-muted">
                {language.plural("session.workflow.stages", current().stages.length)}
              </span>
              <span class="shrink-0 truncate text-v2-text-text-faint">{language.t("session.workflow.draft")}</span>
            </div>
            <div class="flex h-8 shrink-0 items-center gap-1.5">
              <Button
                data-action="session-workflow-save"
                type="button"
                size="small"
                variant="ghost-faint"
                icon="check"
                class="![font-weight:530]"
                onClick={() => command("save")}
              >
                {language.t("session.workflow.save")}
              </Button>
              <Button
                data-action="session-workflow-save-project"
                type="button"
                size="small"
                variant="ghost-faint"
                class="![font-weight:530]"
                onClick={() => command("save project")}
              >
                {language.t("session.workflow.saveProject")}
              </Button>
              <Tooltip placement="top" value={language.t("session.workflow.discard")}>
                <IconButton
                  data-action="session-workflow-discard"
                  type="button"
                  size="small"
                  variant="ghost-muted"
                  icon={<Icon name="outline-xmark" />}
                  aria-label={language.t("session.workflow.discard")}
                  onClick={() => command("discard")}
                />
              </Tooltip>
            </div>
          </div>
        )}
      </Show>
      <Show when={run()}>
        {(current) => <RunStrip run={current()} command={command} dismiss={dismiss} />}
      </Show>
    </>
  )
}

function RunStrip(props: { run: Workflow.Run; command: (text: string) => void; dismiss: () => void }) {
  const language = useLanguage()
  const tabs = useTabs()
  const server = useServer()
  const [state, setState] = createStore({ open: false, asking: false, text: "" })

  const stages = () => props.run.workflow.stages
  const position = () => stages().findIndex((stage) => stage.id === props.run.stage)
  const title = () => stages()[position()]?.title ?? props.run.stage
  const titleOf = (id: string) => stages().find((stage) => stage.id === id)?.title ?? id
  const reviewing = () => props.run.status === "waiting" && props.run.waiting === "finish"
  // What the agent reported is what the user is asked to approve, so it is shown without having to ask.
  const expanded = () => state.open || reviewing() || state.asking
  const open = () => props.run.status !== "done"

  const status = () =>
    props.run.status === "waiting"
      ? language.t(props.run.waiting === "finish" ? "session.workflow.waitingFinish" : "session.workflow.waitingStart")
      : language.t(`session.workflow.${props.run.status}`)

  const send = () => {
    const text = state.text.trim()

    if (text === "") return
    props.command(`changes ${text}`)
    setState({ asking: false, text: "" })
  }

  return (
    <div
      data-component="session-workflow-strip"
      data-status={props.run.status}
      class="relative z-0 -mb-3 flex flex-col rounded-xl bg-v2-background-bg-base px-3 pt-1.5 pb-[18px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex h-8 min-w-0 flex-1 items-center gap-2 text-[13px] font-[440] leading-[var(--line-height-compact)]">
          <Icon name="branch-out" class="shrink-0 text-v2-text-text-muted" />
          <span class="max-w-[40%] shrink-0 truncate font-[530] text-v2-text-text-base">{props.run.workflow.name}</span>
          <div class="flex shrink-0 items-center gap-1" aria-hidden="true">
            <For each={stages()}>
              {(_, index) => (
                <span
                  class="size-1.5 rounded-full"
                  classList={{
                    "bg-v2-text-text-muted": props.run.status === "done" || index() < position(),
                    "bg-v2-text-text-base": props.run.status !== "done" && index() === position(),
                    "animate-pulse": props.run.status === "running" && index() === position(),
                    "bg-v2-background-bg-layer-04": props.run.status !== "done" && index() > position(),
                  }}
                />
              )}
            </For>
          </div>
          <Show when={props.run.status !== "done"}>
            {/* The dots show where the run is, so the stage's title gets the room; the count is in the tooltip. */}
            <span
              class="min-w-0 truncate text-v2-text-text-muted"
              title={language.t("session.workflow.stage", { current: position() + 1, total: stages().length })}
            >
              {title()}
            </span>
          </Show>
          <span class="shrink-0 truncate text-v2-text-text-faint" title={props.run.note || undefined}>
            {status()}
          </span>
        </div>
        <div class="flex h-8 shrink-0 items-center gap-1.5">
          <Show when={props.run.status === "waiting"}>
            <Button
              data-action="session-workflow-approve"
              type="button"
              size="small"
              variant="ghost-faint"
              icon="check"
              class="![font-weight:530]"
              onClick={() => props.command("approve")}
            >
              {language.t("session.workflow.approve")}
            </Button>
          </Show>
          <Show when={reviewing()}>
            <Button
              data-action="session-workflow-changes"
              type="button"
              size="small"
              variant="ghost-faint"
              class="![font-weight:530]"
              onClick={() => setState("asking", (asking) => !asking)}
            >
              {language.t("session.workflow.changes")}
            </Button>
          </Show>
          <Show when={props.run.status === "paused" || props.run.status === "blocked"}>
            <Button
              data-action="session-workflow-resume"
              type="button"
              size="small"
              variant="ghost-faint"
              icon="arrow-up"
              class="![font-weight:530]"
              onClick={() => props.command("resume")}
            >
              {language.t("session.workflow.resume")}
            </Button>
          </Show>
          <Show when={open()}>
            <Tooltip placement="top" value={language.t("session.workflow.details")}>
              <IconButton
                data-action="session-workflow-details"
                type="button"
                size="small"
                variant="ghost-muted"
                icon={<Icon name="chevron-down" class={expanded() ? "" : "rotate-180"} />}
                aria-label={language.t("session.workflow.details")}
                aria-expanded={expanded()}
                onClick={() => setState("open", (value) => !value)}
              />
            </Tooltip>
            <Menu gutter={6} modal={false} placement="top-end">
              <Menu.Trigger
                as={IconButton}
                data-action="session-workflow-more"
                type="button"
                size="small"
                variant="ghost-muted"
                icon={<Icon name="outline-dots" />}
                aria-label={language.t("session.workflow.more")}
              />
              <Menu.Portal>
                <Menu.Content style={{ "min-width": "200px" }}>
                  <Menu.Item data-action="session-workflow-skip" onSelect={() => props.command("skip")}>
                    {language.t("session.workflow.skip")}
                  </Menu.Item>
                  <Menu.Item
                    data-action="session-workflow-back"
                    disabled={position() <= 0}
                    onSelect={() => props.command("back")}
                  >
                    {language.t("session.workflow.back")}
                  </Menu.Item>
                  <Menu.Separator />
                  <For each={stages()}>
                    {(stage) => (
                      <Menu.Item
                        data-action="session-workflow-goto"
                        disabled={stage.id === props.run.stage}
                        onSelect={() => props.command(`goto ${stage.id}`)}
                      >
                        {language.t("session.workflow.jump", { title: stage.title })}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </Show>
          <Show
            when={props.run.status === "done"}
            fallback={
              <Tooltip placement="top" value={language.t("session.workflow.stop")}>
                <IconButton
                  data-action="session-workflow-stop"
                  type="button"
                  size="small"
                  variant="ghost-muted"
                  icon={<Icon name="outline-xmark" />}
                  aria-label={language.t("session.workflow.stop")}
                  onClick={() => props.command("stop")}
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
                onClick={props.dismiss}
              />
            </Tooltip>
          </Show>
        </div>
      </div>

      <Show when={expanded() && open()}>
        <div data-slot="session-workflow-details" class="flex flex-col gap-2 pt-1 text-[13px] leading-[var(--line-height-compact)]">
          <Show when={reviewing() && props.run.reported}>
            {(report) => (
              <div class="flex flex-col gap-0.5">
                <span class="text-12-regular text-v2-text-text-faint">{language.t("session.workflow.reported")}</span>
                <p class="max-h-32 overflow-y-auto whitespace-pre-wrap text-v2-text-text-base">{report().summary}</p>
              </div>
            )}
          </Show>

          <Show when={state.asking}>
            <div class="flex flex-col gap-1.5">
              <Textarea
                data-action="session-workflow-changes-text"
                aria-label={language.t("session.workflow.changes")}
                class="!w-full"
                rows={2}
                value={state.text}
                placeholder={language.t("session.workflow.changes.placeholder")}
                onInput={(event) => setState("text", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) send()
                }}
              />
              <div class="flex items-center gap-1.5">
                <Button
                  data-action="session-workflow-changes-send"
                  type="button"
                  size="small"
                  variant="ghost-faint"
                  icon="arrow-up"
                  class="![font-weight:530]"
                  disabled={state.text.trim() === ""}
                  onClick={send}
                >
                  {language.t("session.workflow.changes.send")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost-muted"
                  onClick={() => setState({ asking: false, text: "" })}
                >
                  {language.t("session.workflow.changes.cancel")}
                </Button>
              </div>
            </div>
          </Show>

          <Show when={props.run.reports.length > 0}>
            <div class="flex flex-col gap-1">
              <span class="text-12-regular text-v2-text-text-faint">{language.t("session.workflow.results")}</span>
              <For each={props.run.reports}>
                {(report) => (
                  <div class="flex items-start gap-2" data-outcome={report.outcome}>
                    <Icon
                      name={report.outcome === "pass" ? "check" : "circle-xmark"}
                      class="mt-0.5 shrink-0 text-v2-text-text-muted"
                    />
                    <div class="min-w-0">
                      <span class="font-[530] text-v2-text-text-base">{titleOf(report.stage)}</span>
                      <p class="max-h-16 overflow-y-auto whitespace-pre-wrap text-v2-text-text-muted">
                        {report.summary.startsWith(Workflow.CHANGES)
                          ? `${language.t("session.workflow.requested")}: ${report.summary.slice(Workflow.CHANGES.length)}`
                          : report.summary}
                      </p>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={props.run.child}>
            {(child) => (
              <div>
                <Button
                  data-action="session-workflow-open-stage"
                  type="button"
                  size="small"
                  variant="ghost-faint"
                  icon="branch-out"
                  class="![font-weight:530]"
                  onClick={() => openNotificationSession(tabs, server.key, child())}
                >
                  {language.t("session.workflow.openStage")}
                </Button>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}

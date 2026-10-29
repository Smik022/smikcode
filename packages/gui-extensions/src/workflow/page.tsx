import { createMemo, For, Show, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query"
import { Option, Schema } from "effect"
import type { JsonValue } from "@opencode/client/promise"
import { Workflow } from "@opencode/schema/workflow"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Select } from "@opencode/ui/select"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { showToast } from "@opencode/ui/toast"
import { useExtension } from "../sdk"
import type definition from "./index"
import { Flow } from "./diagram"
import {
  blank,
  blankStage,
  fromDefinition,
  missing,
  moveStage,
  removeStage,
  slug,
  toDefinition,
  type Draft,
  type DraftStage,
} from "./model"

const RPC = "smikcode.workflow"

const decodeList = Schema.decodeUnknownOption(Schema.Struct({ workflows: Schema.Array(Workflow.Listed) }))

const decodeSaved = Schema.decodeUnknownOption(Schema.Struct({ problems: Schema.Array(Schema.String) }))

const decodeDrafted = Schema.decodeUnknownOption(
  Schema.Struct({ workflow: Schema.optional(Workflow.Definition), problems: Schema.Array(Schema.String) }),
)

type Choice = { value: string; label: string }

type Saving = { workflow: Workflow.Definition; scope: Draft["scope"] }

// A workflow holds only plain JSON, and a round trip drops the optional fields that were never set.
const json = (input: Saving): JsonValue => JSON.parse(JSON.stringify(input))

const EXITS = ["agent", "command", "approval"] as const

const VIEWS = ["cards", "flow"] as const

/** The Workflows settings page: the saved workflows, and a card editor for the one being made or changed. */
export default function WorkflowPage() {
  const ctx = useExtension<typeof definition>()
  const queryClient = useQueryClient()

  const [state, setState] = createStore<{
    draft?: Draft
    problems: string[]
    /** The description being typed, and why the last one gave no draft. */
    describe: { text: string; problems: string[] }
    /** The open draft was made from a description, so it has not been looked at yet. */
    drafted: boolean
  }>({ problems: [], describe: { text: "", problems: [] }, drafted: false })

  // The backend that holds the workflows: the routed session's, else a session's that is open, else the local one.
  const target = createMemo(() => {
    const session = ctx.sessions.current() ?? ctx.sessions.list().find((item) => item.location)
    const servers = ctx.servers.list().map((id) => ctx.servers.get(id))
    const server = session?.server ?? servers.find((item) => item?.builtin) ?? servers.find((item) => item !== undefined)

    return server ? { server, location: session?.location } : undefined
  })

  const call = async (method: "list" | "save" | "remove" | "describe", input: JsonValue, signal?: AbortSignal) => {
    const current = target()

    if (!current) throw new Error("No server")

    const response = await current.server.client.rpc.call(
      { rpcID: RPC, method, location: current.location, input },
      { signal },
    )

    return response.output
  }

  const list = useQuery(() => ({
    queryKey: [ctx.id, "list", target()?.server.id, target()?.location?.directory],
    enabled: target() !== undefined,
    retry: false,
    queryFn: async (query) => {
      const decoded = decodeList(await call("list", {}, query.signal))

      if (Option.isNone(decoded)) throw new Error("Unexpected reply")

      return decoded.value.workflows
    },
  }))

  const refresh = () => queryClient.invalidateQueries({ queryKey: [ctx.id] })

  const save = useMutation(() => ({
    mutationFn: async (input: Saving) => {
      const decoded = decodeSaved(await call("save", json(input)))

      if (Option.isNone(decoded)) throw new Error("Unexpected reply")

      return { ...input, problems: [...decoded.value.problems] }
    },
    onSuccess: async (result) => {
      if (result.problems.length > 0) return setState("problems", result.problems)
      await refresh()
      showToast({ title: ctx.t("toast.saved", { name: result.workflow.name }) })
      setState({ draft: undefined, problems: [], drafted: false })
    },
    onError: () => showToast({ title: ctx.t("toast.failed") }),
  }))

  const describe = useMutation(() => ({
    mutationFn: async (text: string) => {
      const decoded = decodeDrafted(await call("describe", { text }))

      if (Option.isNone(decoded)) throw new Error("Unexpected reply")

      return decoded.value
    },
    onSuccess: (result) => {
      // The draft opens in the editor, saved nowhere, so it can be checked and changed first.
      if (result.workflow) {
        setState({
          draft: fromDefinition(result.workflow, "global", true),
          problems: [],
          drafted: true,
          describe: { text: "", problems: [] },
        })

        return
      }

      setState("describe", "problems", [...result.problems])
    },
    onError: () => setState("describe", "problems", [ctx.t("describe.failed")]),
  }))

  const remove = useMutation(() => ({
    mutationFn: async (input: { id: string; name: string; scope: Draft["scope"] }) => {
      await call("remove", { id: input.id, scope: input.scope })

      return input
    },
    onSuccess: async (result) => {
      await refresh()
      showToast({ title: ctx.t("toast.deleted", { name: result.name }) })
      setState({ draft: undefined, problems: [], drafted: false })
    },
    onError: () => showToast({ title: ctx.t("toast.failed") }),
  }))

  const taken = () => new Set((list.data ?? []).map((item) => item.id))
  // Project files need a project, which is known once a session is open.
  const projectKnown = () => target()?.location !== undefined

  const create = () =>
    setState({ draft: blank("global", ctx.t("stage.default", { number: 1 })), problems: [], drafted: false })

  const edit = (item: Workflow.Listed) =>
    setState({
      // A prebuilt workflow is changed by saving a copy of its own, which then takes its place.
      draft: fromDefinition(item, item.source === "builtin" ? (projectKnown() ? "project" : "global") : item.source),
      problems: [],
      drafted: false,
    })

  const close = () => setState({ draft: undefined, problems: [], drafted: false })

  const draftIt = () => {
    const text = state.describe.text.trim()

    if (text === "" || describe.isPending) return
    setState("describe", "problems", [])
    describe.mutate(text)
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{ctx.t("title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{ctx.t("description")}</span>
          </div>
          <Show when={!state.draft}>
            <Button
              data-action="settings-workflow-new"
              size="normal"
              variant="neutral"
              icon="plus"
              class="shrink-0 whitespace-nowrap"
              onClick={create}
            >
              {ctx.t("new")}
            </Button>
          </Show>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <Show
          when={state.draft}
          fallback={
            <>
            <section class="flex flex-col gap-2" aria-label={ctx.t("describe.title")}>
              <Field label={ctx.t("describe.title")} hint={ctx.t("describe.hint")}>
                <Textarea
                  data-action="settings-workflow-describe"
                  aria-label={ctx.t("describe.title")}
                  class="!w-full"
                  rows={3}
                  value={state.describe.text}
                  placeholder={ctx.t("describe.placeholder")}
                  disabled={describe.isPending}
                  onInput={(event) => setState("describe", "text", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) draftIt()
                  }}
                />
              </Field>
              <div class="flex items-start gap-3">
                <Button
                  data-action="settings-workflow-draft"
                  size="normal"
                  variant="contrast"
                  class="shrink-0 whitespace-nowrap"
                  disabled={describe.isPending || state.describe.text.trim() === "" || !target()}
                  onClick={draftIt}
                >
                  {describe.isPending ? ctx.t("describe.drafting") : ctx.t("describe.draft")}
                </Button>
                <Show when={state.describe.problems.length > 0}>
                  <div class="flex flex-col gap-1 pt-1" role="alert">
                    <For each={state.describe.problems}>
                      {(problem) => <p class="text-13-regular text-text-danger-base">{problem}</p>}
                    </For>
                  </div>
                </Show>
              </div>
            </section>
            <section class="settings-section" aria-label={ctx.t("title")}>
              <Show
                when={!list.isError && target()}
                fallback={
                  <div class="flex flex-col items-start gap-3 py-4">
                    <p class="text-13-regular text-v2-text-text-muted">{ctx.t("unavailable")}</p>
                    <Button size="small" variant="neutral" onClick={() => void list.refetch()}>
                      {ctx.t("retry")}
                    </Button>
                  </div>
                }
              >
                <Show when={list.data} fallback={<p class="py-4 text-13-regular text-v2-text-text-muted">{ctx.t("loading")}</p>}>
                  {(items) => (
                    <div data-component="settings-list">
                      <For each={items()} fallback={<p class="py-4 text-13-regular text-v2-text-text-muted">{ctx.t("empty")}</p>}>
                        {(item) => (
                          <div data-component="settings-row" data-action={`settings-workflow-${item.id}`}>
                            <div data-slot="settings-row-copy">
                              <div data-slot="settings-row-title" class="flex items-center gap-2">
                                <span class="truncate">{item.name}</span>
                                <span class="shrink-0 rounded-md px-1.5 text-11-regular leading-[var(--line-height-compact)] text-v2-text-text-muted shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]">
                                  {ctx.t(`source.${item.source}`)}
                                </span>
                              </div>
                              <div data-slot="settings-row-description">
                                {item.description ? `${item.description} · ` : ""}
                                {ctx.plural("stages", item.stages.length)}
                              </div>
                            </div>
                            <div data-slot="settings-row-control">
                              <Button size="small" variant="neutral" onClick={() => edit(item)}>
                                {ctx.t("edit")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>
              </Show>
            </section>
            </>
          }
        >
          {(draft) => (
            <Editor
              draft={draft()}
              projectKnown={projectKnown()}
              problems={state.problems}
              drafted={state.drafted}
              saving={save.isPending || remove.isPending}
              source={list.data?.find((item) => item.id === draft().id)?.source}
              change={(next) => setState("draft", reconcile(next, { key: "id" }))}
              name={(name) => {
                // A workflow's id follows its name until the first save, and never changes afterwards.
                if (state.draft?.fresh) setState("draft", { name, id: slug(name, taken(), "workflow") })
                else setState("draft", "name", name)
              }}
              onSave={(next) => save.mutate({ workflow: toDefinition(next), scope: next.scope })}
              onDelete={(next) => remove.mutate({ id: next.id, name: next.name, scope: next.scope })}
              onClose={close}
            />
          )}
        </Show>
      </div>
    </>
  )
}

function Editor(props: {
  draft: Draft
  /** The draft came from a description. */
  drafted: boolean
  projectKnown: boolean
  problems: readonly string[]
  saving: boolean
  /** Where the saved workflow with this id comes from now, if there is one. */
  source: Workflow.Listed["source"] | undefined
  change: (next: Draft) => void
  name: (name: string) => void
  onSave: (draft: Draft) => void
  onDelete: (draft: Draft) => void
  onClose: () => void
}) {
  const ctx = useExtension<typeof definition>()
  // The stage chosen in the flow; the first one until another is picked, or when the chosen one is removed.
  const [view, setView] = createStore<{ selected?: string }>({})
  const flow = () => ctx.stores.editor.value.view === "flow"
  const current = createMemo(() => props.draft.stages.find((stage) => stage.id === view.selected) ?? props.draft.stages[0])
  const currentIndex = () => props.draft.stages.findIndex((stage) => stage.id === current()?.id)

  const patch = (id: string, change: Partial<DraftStage>) =>
    props.change({
      ...props.draft,
      stages: props.draft.stages.map((stage) => (stage.id === id ? { ...stage, ...change } : stage)),
    })

  const scopes = createMemo<Choice[]>(() => [
    { value: "global", label: ctx.t("source.global") },
    ...(props.projectKnown || props.draft.scope === "project" ? [{ value: "project", label: ctx.t("source.project") }] : []),
  ])

  // Changing where a saved workflow lives would leave the old file behind, so the place is fixed once it is saved.
  const placed = () => props.source === "global" || props.source === "project"
  const lacking = createMemo(() => missing(props.draft))
  // Only a workflow of the user's own can be deleted; a prebuilt one has nothing to delete.
  const deletable = () => placed()

  return (
    <div class="flex flex-col gap-6">
      <div>
        <Button size="small" variant="ghost-muted" icon="outline-arrow-left" onClick={props.onClose}>
          {ctx.t("back")}
        </Button>
      </div>

      <Show when={props.drafted}>
        <p
          data-component="workflow-drafted"
          class="rounded-xl bg-v2-background-bg-base px-3 py-2 text-13-regular text-v2-text-text-muted shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
        >
          {ctx.t("drafted.note")}
        </p>
      </Show>

      <section class="flex flex-col gap-3">
        <Field label={ctx.t("field.name")}>
          <TextInput
            data-action="settings-workflow-name"
            aria-label={ctx.t("field.name")}
            class="w-full"
            value={props.draft.name}
            placeholder={ctx.t("field.name.placeholder")}
            onInput={(event) => props.name(event.currentTarget.value)}
          />
        </Field>
        <Field label={ctx.t("field.description")}>
          <TextInput
            aria-label={ctx.t("field.description")}
            class="w-full"
            value={props.draft.description}
            placeholder={ctx.t("field.description.placeholder")}
            onInput={(event) => props.change({ ...props.draft, description: event.currentTarget.value })}
          />
        </Field>
        <div data-component="settings-list">
          <div data-component="settings-row">
            <div data-slot="settings-row-copy">
              <div data-slot="settings-row-title">{ctx.t("field.scope")}</div>
              <div data-slot="settings-row-description">{ctx.t("field.scope.description")}</div>
            </div>
            <div data-slot="settings-row-control">
              <Choose
                label={ctx.t("field.scope")}
                options={scopes()}
                value={props.draft.scope}
                disabled={placed()}
                onSelect={(value) => props.change({ ...props.draft, scope: value === "project" ? "project" : "global" })}
              />
            </div>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <h3 class="settings-section-title">{ctx.t("stage.heading")}</h3>
          <SegmentedControl
            value={flow() ? "flow" : "cards"}
            onChange={(value) => {
              const view = VIEWS.find((item) => item === value)

              if (view) ctx.stores.editor.update((draft) => void (draft.view = view))
            }}
          >
            <SegmentedControlItem value="cards" data-action="settings-workflow-view-cards">
              {ctx.t("view.cards")}
            </SegmentedControlItem>
            <SegmentedControlItem value="flow" data-action="settings-workflow-view-flow">
              {ctx.t("view.flow")}
            </SegmentedControlItem>
          </SegmentedControl>
        </div>

        <Show
          when={flow()}
          fallback={
            <For each={props.draft.stages}>
              {(stage, index) => (
                <StageCard
                  stage={stage}
                  index={index()}
                  stages={props.draft.stages}
                  onChange={(change) => patch(stage.id, change)}
                  onMove={(direction) => props.change(moveStage(props.draft, stage.id, direction))}
                  onRemove={() => props.change(removeStage(props.draft, stage.id))}
                />
              )}
            </For>
          }
        >
          <Flow stages={props.draft.stages} selected={current()?.id} onSelect={(id) => setView("selected", id)} />
          <p class="text-11-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">{ctx.t("flow.hint")}</p>
          <Show when={current()}>
            {(stage) => (
              <StageCard
                stage={stage()}
                index={currentIndex()}
                stages={props.draft.stages}
                onChange={(change) => patch(stage().id, change)}
                onMove={(direction) => props.change(moveStage(props.draft, stage().id, direction))}
                onRemove={() => props.change(removeStage(props.draft, stage().id))}
              />
            )}
          </Show>
        </Show>

        <div>
          <Button
            data-action="settings-workflow-add-stage"
            size="small"
            variant="neutral"
            icon="plus"
            onClick={() => {
              const added = blankStage(props.draft, ctx.t("stage.default", { number: props.draft.stages.length + 1 }))

              props.change({ ...props.draft, stages: [...props.draft.stages, added] })
              // In the flow the new stage is the one to fill in next.
              setView("selected", added.id)
            }}
          >
            {ctx.t("stage.add")}
          </Button>
        </div>
      </section>

      <Show when={lacking().length > 0 || props.problems.length > 0}>
        <div class="flex flex-col gap-1" role="alert">
          <For each={lacking()}>{(key) => <p class="text-13-regular text-text-danger-base">{ctx.t(`missing.${key}`)}</p>}</For>
          <For each={props.problems}>{(problem) => <p class="text-13-regular text-text-danger-base">{problem}</p>}</For>
        </div>
      </Show>

      <div class="flex items-center justify-between gap-3">
        <div>
          <Show when={deletable()}>
            <Button
              data-action="settings-workflow-delete"
              size="normal"
              variant="ghost-muted"
              disabled={props.saving}
              onClick={() => props.onDelete(props.draft)}
            >
              {ctx.t("delete")}
            </Button>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Button size="normal" variant="ghost-muted" disabled={props.saving} onClick={props.onClose}>
            {ctx.t("cancel")}
          </Button>
          <Button
            data-action="settings-workflow-save"
            size="normal"
            variant="contrast"
            disabled={props.saving || lacking().length > 0}
            onClick={() => props.onSave(props.draft)}
          >
            {props.saving ? ctx.t("saving") : ctx.t("save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function StageCard(props: {
  stage: DraftStage
  index: number
  stages: readonly DraftStage[]
  onChange: (change: Partial<DraftStage>) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const ctx = useExtension<typeof definition>()
  const first = () => props.index === 0
  const others = () => props.stages.filter((stage) => stage.id !== props.stage.id)

  const contexts = createMemo<Choice[]>(() => [
    { value: "same", label: ctx.t("context.same") },
    { value: "fresh", label: ctx.t("context.fresh") },
  ])

  const exits = createMemo<Choice[]>(() => [
    { value: "agent", label: ctx.t("exit.agent") },
    { value: "command", label: ctx.t("exit.command") },
    { value: "approval", label: ctx.t("exit.approval") },
  ])

  const passes = createMemo<Choice[]>(() => [
    { value: "", label: ctx.t("pass.next") },
    { value: Workflow.DONE, label: ctx.t("pass.done") },
    ...others().map((stage) => ({ value: stage.id, label: ctx.t("pass.go", { title: stage.title || stage.id }) })),
  ])

  const fails = createMemo<Choice[]>(() => [
    { value: "", label: ctx.t("fail.retry") },
    ...others().map((stage) => ({ value: stage.id, label: ctx.t("fail.go", { title: stage.title || stage.id }) })),
  ])

  return (
    <div
      data-component="workflow-stage"
      class="flex flex-col gap-3 rounded-xl bg-v2-background-bg-base p-3 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
    >
      <div class="flex items-center gap-2">
        <span class="w-5 shrink-0 text-center text-12-regular tabular-nums text-v2-text-text-muted">{props.index + 1}</span>
        <TextInput
          data-action="settings-workflow-stage-title"
          aria-label={ctx.t("stage.title")}
          class="min-w-0 flex-1"
          value={props.stage.title}
          placeholder={ctx.t("stage.title")}
          onInput={(event) => props.onChange({ title: event.currentTarget.value })}
        />
        <IconButton
          type="button"
          size="small"
          variant="ghost-muted"
          icon={<Icon name="chevron-down" class="rotate-180" />}
          aria-label={ctx.t("stage.up")}
          disabled={first()}
          onClick={() => props.onMove(-1)}
        />
        <IconButton
          type="button"
          size="small"
          variant="ghost-muted"
          icon={<Icon name="chevron-down" />}
          aria-label={ctx.t("stage.down")}
          disabled={props.index === props.stages.length - 1}
          onClick={() => props.onMove(1)}
        />
        <IconButton
          type="button"
          size="small"
          variant="ghost-muted"
          icon={<Icon name="outline-trash" />}
          aria-label={ctx.t("stage.remove")}
          disabled={props.stages.length === 1}
          onClick={props.onRemove}
        />
      </div>

      <Textarea
        data-action="settings-workflow-stage-instructions"
        aria-label={ctx.t("stage.instructions")}
        class="!w-full"
        rows={4}
        value={props.stage.instructions}
        placeholder={ctx.t("stage.instructions.placeholder")}
        onInput={(event) => props.onChange({ instructions: event.currentTarget.value })}
      />

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Show when={!first()}>
          <Field label={ctx.t("stage.context")} hint={props.stage.context === "fresh" ? ctx.t("context.fresh.description") : undefined}>
            <Choose
              label={ctx.t("stage.context")}
              options={contexts()}
              value={props.stage.context}
              onSelect={(value) => props.onChange({ context: value === "fresh" ? "fresh" : "same" })}
            />
          </Field>
        </Show>
        <Field label={ctx.t("stage.agent")}>
          <TextInput
            aria-label={ctx.t("stage.agent")}
            class="w-full"
            value={props.stage.agent}
            placeholder={ctx.t("stage.agent.placeholder")}
            onInput={(event) => props.onChange({ agent: event.currentTarget.value })}
          />
        </Field>
        <Show when={!first() && props.stage.context === "fresh"}>
          <Field label={ctx.t("stage.model")}>
            <TextInput
              aria-label={ctx.t("stage.model")}
              class="w-full"
              value={props.stage.model}
              placeholder={ctx.t("stage.model.placeholder")}
              onInput={(event) => props.onChange({ model: event.currentTarget.value })}
            />
          </Field>
        </Show>
        <Field label={ctx.t("stage.exit")}>
          <Choose
            label={ctx.t("stage.exit")}
            options={exits()}
            value={props.stage.exit}
            onSelect={(value) => {
              const exit = EXITS.find((item) => item === value)

              if (exit) props.onChange({ exit })
            }}
          />
        </Field>
        <Show when={props.stage.exit === "command"}>
          <Field label={ctx.t("stage.command")}>
            <TextInput
              aria-label={ctx.t("stage.command")}
              class="w-full font-mono"
              value={props.stage.command}
              placeholder={ctx.t("stage.command.placeholder")}
              onInput={(event) => props.onChange({ command: event.currentTarget.value })}
            />
          </Field>
        </Show>
        <Field label={ctx.t("stage.onPass")}>
          <Choose
            label={ctx.t("stage.onPass")}
            options={passes()}
            value={props.stage.onPass}
            onSelect={(value) => props.onChange({ onPass: value })}
          />
        </Field>
        <Field label={ctx.t("stage.onFail")}>
          <Choose
            label={ctx.t("stage.onFail")}
            options={fails()}
            value={props.stage.failGoto}
            onSelect={(value) => props.onChange({ failGoto: value })}
          />
        </Field>
        <Field label={ctx.t("stage.max")}>
          <TextInput
            aria-label={ctx.t("stage.max")}
            class="w-full"
            type="number"
            numeric
            min={1}
            value={props.stage.failMax}
            placeholder={String(Workflow.DEFAULT_RETRIES)}
            onInput={(event) => props.onChange({ failMax: event.currentTarget.value })}
          />
        </Field>
      </div>

      <Show when={!first()}>
        <Switch
          aria-label={ctx.t("stage.approveFirst")}
          checked={props.stage.approveFirst}
          onChange={(checked) => props.onChange({ approveFirst: checked })}
        >
          {ctx.t("stage.approveFirst")}
        </Switch>
      </Show>
    </div>
  )
}

function Field(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <span class="text-12-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-11-regular leading-[var(--line-height-compact)] text-v2-text-text-faint">{props.hint}</span>
      </Show>
    </div>
  )
}

// The select shows nothing for an empty value, so "the default" travels as this placeholder and is turned back here.
const DEFAULT = "(default)"

function Choose(props: {
  label: string
  options: Choice[]
  value: string
  disabled?: boolean
  onSelect: (value: string) => void
}) {
  const options = createMemo(() =>
    props.options.map((option) => ({ value: option.value === "" ? DEFAULT : option.value, label: option.label })),
  )

  return (
    <Select
      aria-label={props.label}
      disabled={props.disabled}
      options={options()}
      current={options().find((option) => option.value === (props.value === "" ? DEFAULT : props.value))}
      value={(option) => option.value}
      label={(option) => option.label}
      placement="bottom-start"
      gutter={6}
      onSelect={(option) => option && props.onSelect(option.value === DEFAULT ? "" : option.value)}
    />
  )
}

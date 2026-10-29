import { createMemo, For, Show } from "solid-js"
import { useExtension } from "../sdk"
import type definition from "./index"
import { box, DONE, edges, height, routes, START, width, type Box, type Edge } from "./flow"
import type { DraftStage } from "./model"

const px = (value: number) => `${value}px`

const place = (item: Box) => ({ left: px(item.x), top: px(item.y), width: px(item.width), height: px(item.height) })

// The faint dotted ground the nodes sit on, in the border color so it follows the theme.
const GROUND = {
  "background-image": "radial-gradient(circle, var(--v2-border-border-base) 1px, transparent 1px)",
  "background-size": "18px 18px",
}

/**
 * The stages drawn as nodes in one column, with an arrow for what happens after a pass and a dashed one for what
 * happens after a failure. Choosing a node brings its arrows forward and leaves the others faint.
 */
export function Flow(props: { stages: readonly DraftStage[]; selected: string | undefined; onSelect: (id: string) => void }) {
  const ctx = useExtension<typeof definition>()
  const count = () => props.stages.length
  const chosen = () => props.stages.findIndex((stage) => stage.id === props.selected)
  const found = createMemo(() => routes(edges(props.stages), count()))

  // The retry loops of every stage would crowd the picture, so only the chosen stage shows its own.
  const shown = (edge: Edge) => {
    if (edge.kind === "retry") return edge.from === chosen() ? 1 : 0

    return chosen() < 0 || edge.from === chosen() || edge.to === chosen() ? 1 : 0.3
  }

  const label = (edge: Edge) => {
    if (edge.kind === "pass") return ctx.t("flow.pass")

    if (edge.kind === "fail") return ctx.t("flow.fail", { attempts: edge.attempts ?? 0 })

    if (edge.kind === "retry") return ctx.t("flow.retry", { attempts: edge.attempts ?? 0 })

    return undefined
  }

  // What is special about a stage, on one line.
  const summary = (stage: DraftStage, index: number) =>
    [
      index > 0 && stage.context === "fresh" ? ctx.t("flow.fresh") : ctx.t("flow.chat"),
      stage.agent.trim() === "" ? undefined : stage.agent.trim(),
      stage.exit === "command" ? ctx.t("flow.command", { command: stage.command.trim() }) : undefined,
      stage.exit === "approval" ? ctx.t("flow.approval") : undefined,
      index > 0 && stage.approveFirst ? ctx.t("flow.askFirst") : undefined,
    ]
      .filter((part) => part !== undefined)
      .join(" · ")

  return (
    <div
      data-component="workflow-flow"
      class="flex justify-start overflow-x-auto rounded-xl py-6 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)] sm:justify-center"
      style={GROUND}
    >
      <div class="relative shrink-0" style={{ width: px(width()), height: px(height(count())) }}>
        <svg class="pointer-events-none absolute inset-0" width={width()} height={height(count())} aria-hidden="true">
          <defs>
            <marker
              id="workflow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
              class="text-v2-text-text-muted"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
            <marker
              id="workflow-arrow-fail"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
              class="text-text-danger-base"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <For each={found()}>
            {(item) => {
              const failing = () => item.edge.kind === "fail" || item.edge.kind === "retry"

              return (
                <g
                  class={failing() ? "text-text-danger-base" : "text-v2-text-text-muted"}
                  style={{ opacity: shown(item.edge), transition: "opacity 120ms ease-out" }}
                >
                  <path
                    d={item.d}
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-dasharray={failing() ? "5 4" : undefined}
                    marker-end={failing() ? "url(#workflow-arrow-fail)" : "url(#workflow-arrow)"}
                  />
                  <Show when={item.label && label(item.edge)}>
                    {(text) => (
                      <text
                        x={item.label?.x}
                        y={item.label?.y}
                        text-anchor={item.label?.anchor}
                        font-size="11"
                        fill="currentColor"
                        // The text sits on the dots, so it gets a halo in the page color to stay readable.
                        style={{ "paint-order": "stroke", stroke: "var(--v2-background-bg-base)", "stroke-width": "4px" }}
                      >
                        {text()}
                      </text>
                    )}
                  </Show>
                </g>
              )
            }}
          </For>
        </svg>

        <div
          class="absolute grid place-items-center rounded-full bg-v2-background-bg-base text-11-regular text-v2-text-text-muted shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
          style={place(box(START, count()))}
        >
          {ctx.t("flow.start")}
        </div>

        <For each={props.stages}>
          {(stage, index) => (
            <button
              type="button"
              data-component="workflow-node"
              data-selected={stage.id === props.selected ? "" : undefined}
              aria-pressed={stage.id === props.selected}
              class="absolute flex flex-col justify-center gap-1 rounded-xl bg-v2-background-bg-base px-3 text-start outline-none transition-shadow focus-visible:shadow-[inset_0_0_0_1px_var(--v2-text-text-base)]"
              classList={{
                "shadow-[inset_0_0_0_1px_var(--v2-text-text-base)]": stage.id === props.selected,
                "shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)] hover:shadow-[inset_0_0_0_1px_var(--v2-border-border-base)]":
                  stage.id !== props.selected,
              }}
              style={place(box(index(), count()))}
              onClick={() => props.onSelect(stage.id)}
            >
              <span class="flex min-w-0 items-center gap-2">
                <span class="grid size-5 shrink-0 place-items-center rounded-full bg-v2-background-bg-layer-04 text-11-regular tabular-nums text-v2-text-text-base">
                  {index() + 1}
                </span>
                <span class="truncate text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                  {stage.title.trim() === "" ? ctx.t("stage.number", { number: index() + 1 }) : stage.title}
                </span>
              </span>
              <span class="truncate ps-7 text-11-regular leading-[var(--line-height-compact)] text-v2-text-text-muted">
                {summary(stage, index())}
              </span>
            </button>
          )}
        </For>

        <div
          class="absolute grid place-items-center rounded-full bg-v2-background-bg-base text-11-regular text-v2-text-text-muted shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
          style={place(box(DONE, count()))}
        >
          {ctx.t("flow.done")}
        </div>
      </div>
    </div>
  )
}

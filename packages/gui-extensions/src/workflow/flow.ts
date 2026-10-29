import { Workflow } from "@opencode/schema/workflow"
import type { DraftStage } from "./model"

/** Where an arrow starts, before the first stage. */
export const START = -1

/** Where an arrow ends when the workflow finishes. */
export const DONE = "done"

/**
 * One arrow of the flow, from a stage (or `START`) to a stage (or `DONE`).
 * - `next`: the usual step to the stage below.
 * - `pass`: a pass that skips ahead or goes back, or finishes early.
 * - `fail`: a failure that goes back to another stage.
 * - `retry`: a failure that tries the same stage again.
 */
export type Edge = {
  from: number
  to: number | typeof DONE
  kind: "next" | "pass" | "fail" | "retry"
  /** Failed attempts allowed, for `fail` and `retry`. */
  attempts?: number
}

/** The arrows the engine would follow for these stages: after a pass, and after a failure. */
export function edges(stages: readonly DraftStage[]): Edge[] {
  const last = stages.length - 1
  const positions = new Map(stages.map((stage, index) => [stage.id, index]))

  if (stages.length === 0) return []

  return [
    { from: START, to: 0, kind: "next" },
    ...stages.flatMap((stage, index): Edge[] => {
      const following = index < last ? index + 1 : DONE

      const target =
        stage.onPass === "" ? following : stage.onPass === Workflow.DONE ? DONE : positions.get(stage.onPass)

      const goto = stage.failGoto === "" ? undefined : positions.get(stage.failGoto)
      const limit = Math.floor(Number(stage.failMax))
      const attempts = Number.isFinite(limit) && limit >= 1 ? limit : Workflow.DEFAULT_RETRIES

      // A pass that points at its own stage would never end, so it has no arrow.
      const pass: Edge[] =
        target === undefined || target === index
          ? []
          : [{ from: index, to: target, kind: target === following ? "next" : "pass" }]

      const fail: Edge =
        goto === undefined || goto === index
          ? { from: index, to: index, kind: "retry", attempts }
          : { from: index, to: goto, kind: "fail", attempts }

      return [...pass, fail]
    }),
  ]
}

/** Sizes of the diagram, in pixels. Nodes are in one column, with a lane on each side for arrows that jump. */
export const SIZE = { node: { width: 360, height: 64 }, pill: { width: 88, height: 28 }, gap: 48, left: 112, right: 152 }

export type Box = { x: number; y: number; width: number; height: number }

/** The box of a stage, of the start (`START`) or of the end (`DONE`). */
export function box(at: number | typeof DONE, count: number): Box {
  const x = SIZE.left + SIZE.node.width / 2

  if (at === START) return { x: x - SIZE.pill.width / 2, y: 0, width: SIZE.pill.width, height: SIZE.pill.height }
  const top = (index: number) => SIZE.pill.height + SIZE.gap + index * (SIZE.node.height + SIZE.gap)

  if (at === DONE) return { x: x - SIZE.pill.width / 2, y: top(count), width: SIZE.pill.width, height: SIZE.pill.height }

  return { x: SIZE.left, y: top(at), width: SIZE.node.width, height: SIZE.node.height }
}

export function width() {
  return SIZE.left + SIZE.node.width + SIZE.right
}

export function height(count: number) {
  const end = box(DONE, count)

  return end.y + end.height
}

export type Route = {
  edge: Edge
  /** The SVG path of the arrow. */
  d: string
  /** Where its label sits, and which way the text runs from there. */
  label: { x: number; y: number; anchor: "start" | "end" } | undefined
}

/**
 * The paths of all arrows. Straight arrows join neighbours; a pass that jumps goes round on the left and a failure on
 * the right, with arrows that span more stages further out so they never run into each other.
 */
export function routes(list: readonly Edge[], count: number): Route[] {
  const span = (edge: Edge) => Math.abs((edge.to === DONE ? count : edge.to) - edge.from)
  const side = (edge: Edge) => (edge.kind === "pass" ? "left" : "right")
  const lanes = new Map<Edge, number>()

  for (const wanted of ["left", "right"] as const) {
    list
      .filter((edge) => edge.kind !== "next" && edge.kind !== "retry" && side(edge) === wanted)
      .toSorted((a, b) => span(a) - span(b))
      .forEach((edge, lane) => lanes.set(edge, lane))
  }

  return list.map((edge) => route(edge, count, lanes.get(edge) ?? 0))
}

function route(edge: Edge, count: number, lane: number): Route {
  const from = box(edge.from, count)
  const to = box(edge.to, count)
  const middle = (item: Box) => item.y + item.height / 2
  const center = SIZE.left + SIZE.node.width / 2

  if (edge.kind === "next") {
    return { edge, d: `M ${center} ${from.y + from.height} L ${center} ${to.y - 2}`, label: undefined }
  }

  if (edge.kind === "retry") {
    const x = from.x + from.width
    const y = middle(from)

    return {
      edge,
      d: `M ${x} ${y - 10} C ${x + 44} ${y - 26}, ${x + 44} ${y + 26}, ${x + 2} ${y + 10}`,
      label: { x: x + 40, y: y + 4, anchor: "start" },
    }
  }

  const reach = 40 + lane * 22
  const left = edge.kind === "pass"
  const x1 = left ? from.x : from.x + from.width
  const x2 = left ? to.x : to.x + to.width
  const out = left ? -reach : reach
  const y1 = middle(from)
  const y2 = middle(to)

  if (edge.to === DONE) {
    // The end sits in the middle of the column, so the arrow goes down the lane and turns in below the last stage.
    const x = x1 + out
    const r = 14

    return {
      edge,
      d: `M ${x1} ${y1} L ${x + r} ${y1} Q ${x} ${y1} ${x} ${y1 + r} L ${x} ${y2 - r} Q ${x} ${y2} ${x + r} ${y2} L ${x2 - 2} ${y2}`,
      label: { x: x - 8, y: (y1 + y2) / 2 + 4, anchor: "end" },
    }
  }

  return {
    edge,
    // Pulled in by a pixel at the end so the arrowhead touches the box rather than sinking into it.
    d: `M ${x1} ${y1} C ${x1 + out} ${y1}, ${x2 + out} ${y2}, ${x2 + (left ? -2 : 2)} ${y2}`,
    label: { x: x1 + out * 0.75 + (left ? -8 : 8), y: (y1 + y2) / 2 + 4, anchor: left ? "end" : "start" },
  }
}

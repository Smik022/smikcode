import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Option, Schema } from "effect"
import type { SessionMetadata } from "@opencode/schema/session-metadata"
import { Workflow } from "@opencode/schema/workflow"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ComposerControls } from "./adapter"

const decodeList = Schema.decodeUnknownOption(Schema.Struct({ workflows: Schema.Array(Workflow.Listed) }))

/** The workflows the backend offers for this location. A server without workflows offers none. */
export function createWorkflowList() {
  const server = useServerSDK()
  const location = useWorkspaceLocation()
  const [store, setStore] = createStore<{ items: Workflow.Listed[] }>({ items: [] })
  let latest = 0

  const refresh = () => {
    const request = ++latest

    void server.api.rpc
      .call({ rpcID: "smikcode.workflow", method: "list", location: { directory: location().directory }, input: {} })
      .then((response) => {
        // An older reply must not replace a newer one.
        if (request !== latest) return
        const listed = decodeList(response.output)

        if (Option.isSome(listed)) setStore("items", [...listed.value.workflows])
      })
      .catch(() => undefined)
  }

  onMount(refresh)

  return { items: () => store.items, refresh }
}

/**
 * The prompt box's workflow picker. The choice is kept as the session's pending workflow, which the backend turns
 * into a run when the next message is sent.
 */
export function createWorkflowControl(input: {
  metadata: () => SessionMetadata | undefined
  select: (id: string | undefined) => void
}): NonNullable<ComposerControls["workflow"]> {
  const list = createWorkflowList()

  // Only a run the agent is working on holds the choice; a paused or finished one can be followed by another.
  const open = () => {
    const run = Workflow.read(input.metadata())

    return Workflow.isOpen(run) ? run : undefined
  }

  return {
    get current() {
      return open()?.workflow.id ?? Workflow.pending(input.metadata())
    },
    get options() {
      const run = open()

      if (run) return [{ id: run.workflow.id, label: run.workflow.name }]

      return list.items().map((item) => ({ id: item.id, label: item.name }))
    },
    get locked() {
      return open() !== undefined
    },
    select: input.select,
    refresh: list.refresh,
  }
}

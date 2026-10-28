import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { ToolFailure } from "@opencode/ai"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { BridgePlugin } from "@opencode/core/plugin/bridge"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { testEffect } from "../lib/effect"
import { imagePassthrough } from "../lib/image"
import { registerToolPlugin } from "../lib/tool"

const sessionID = Session.ID.make("ses_bridge_test")
const childID = Session.ID.make("ses_bridge_child")

type Handlers = {
  readonly launch: (input: { tools: string }) => Effect.Effect<{ command: string; args: ReadonlyArray<string> }>
  readonly tools: (input: {}, rpc: Rpc) => Effect.Effect<{ tools: ReadonlyArray<{ name: string }> }>
  readonly call: (
    input: { sessionID: string; name: string; input: Record<string, never> },
    rpc: Rpc,
  ) => Effect.Effect<
    { isError: boolean; content: ReadonlyArray<{ type: string; text?: string }> },
    { type: string; message: string }
  >
}
type Rpc = { readonly error: (type: string, message: string, data: unknown) => { type: string; message: string } }

const rpc: Rpc = { error: (type, message) => ({ type, message }) }

// Stub tools covering a normal result, a failure, a permission decline and a tool the bridge must hide.
const stubs = {
  id: "test.bridge.tools",
  effect: (ctx: Parameters<typeof BridgePlugin.Plugin.effect>[0]) =>
    ctx.tool
      .transform((editor) => {
        const add = (name: string, execute: () => Effect.Effect<{ content: string }, ToolFailure>) =>
          editor.add({
            name,
            options: { codemode: false },
            description: `Stub ${name}`,
            input: Schema.Struct({ text: Schema.optional(Schema.String) }),
            execute,
          })
        add("echo", () => Effect.succeed({ content: "echoed" }))
        add("broken", () => Effect.fail(new ToolFailure({ message: "disk is full" })))
        add("declined", () => Effect.die(new Permission.DeclinedError()))
        add("question", () => Effect.succeed({ content: "should be hidden" }))
      })
      .pipe(Effect.orDie),
}

const bridgeNode = makeLocationNode({
  name: "test/bridge-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(stubs)),
  deps: [Tool.node],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, bridgeNode]), [Image.node.replace(imagePassthrough)]),
)

/** Registers the bridge plugin against the real registry and captures its RPC handlers. */
const handlers = Effect.gen(function* () {
  let captured: Handlers | undefined
  yield* registerToolPlugin(BridgePlugin.Plugin, {
    rpc: Object.assign(
      () => {
        throw new Error("unused rpc.client")
      },
      {
        register: (_definition: unknown, value: unknown) => {
          // The handler map's types come from the RPC definition, which this test deliberately does not repeat.
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          captured = value as Handlers
          return Effect.succeed({ events: { emit: () => Effect.void }, dispose: Effect.void })
        },
      },
    ),
    session: {
      // The bridge reads only these fields of a session.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      get: (input: { sessionID: string }) =>
        input.sessionID === sessionID || input.sessionID === childID
          ? Effect.succeed({
              id: input.sessionID,
              agent: "build",
              parentID: input.sessionID === childID ? sessionID : undefined,
              location: { directory: "/workspace" },
            } as never)
          : Effect.fail("missing" as never),
    },
  } as never)
  if (!captured) return yield* Effect.die("bridge did not register its RPC")
  return captured
})

describe("bridge plugin", () => {
  it.effect("lists tools and hides the ones that need an interactive agent", () =>
    Effect.gen(function* () {
      const bridge = yield* handlers
      const names = (yield* bridge.tools({}, rpc)).tools.map((tool) => tool.name)
      expect(names).toContain("echo")
      expect(names).not.toContain("question")
    }),
  )

  it.effect("gives a terminal the command that starts Claude Code with the chosen tools", () =>
    Effect.gen(function* () {
      const bridge = yield* handlers
      const launch = yield* bridge.launch({ tools: "all" })
      expect(launch.command).toBe(process.execPath)
      expect(launch.args.slice(-4)).toEqual(["claude", "--tools", "all", "--wait-on-error"])
    }),
  )

  it.effect("runs a tool inside the session and returns its output", () =>
    Effect.gen(function* () {
      const bridge = yield* handlers
      const result = yield* bridge.call({ sessionID, name: "echo", input: {} }, rpc)
      expect(result).toEqual({ isError: false, content: [{ type: "text", text: "echoed" }] })
    }),
  )

  it.effect("reports a failing tool as an error result instead of failing the call", () =>
    Effect.gen(function* () {
      const bridge = yield* handlers
      const result = yield* bridge.call({ sessionID, name: "broken", input: {} }, rpc)
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toBe("disk is full")
    }),
  )

  it.effect("reports a declined permission request plainly", () =>
    Effect.gen(function* () {
      const bridge = yield* handlers
      const result = yield* bridge.call({ sessionID, name: "declined", input: {} }, rpc)
      expect(result).toEqual({
        isError: true,
        content: [{ type: "text", text: "The request was declined in SmikCode." }],
      })
    }),
  )

  it.effect("refuses a missing session, a subagent session and a hidden tool", () =>
    Effect.gen(function* () {
      const bridge = yield* handlers
      const missing = yield* bridge.call({ sessionID: "ses_nope", name: "echo", input: {} }, rpc).pipe(Effect.flip)
      expect(missing).toMatchObject({ type: "unavailable", message: "Session not found." })
      const child = yield* bridge.call({ sessionID: childID, name: "echo", input: {} }, rpc).pipe(Effect.flip)
      expect(child).toMatchObject({ type: "unavailable", message: "Subagent sessions cannot be used." })
      const hidden = yield* bridge.call({ sessionID, name: "question", input: {} }, rpc).pipe(Effect.flip)
      expect(hidden).toMatchObject({ type: "unavailable" })
    }),
  )
})

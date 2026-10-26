import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Info } from "@opencode/schema/config"
import { Tool } from "@opencode/schema/tool"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "../../src/location"
import { PluginHooks } from "../../src/plugin/hooks"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node, Global.node]),
    [Global.node.replace(tempGlobalLayer), offlineModels],
  ),
)
type Hooks = NonNullable<typeof Info.Encoded.hooks>

// Forward slashes keep the interpreter path valid in bash, cmd and PowerShell alike.
const bun = process.execPath.replaceAll("\\", "/")

// Hook scripts live in files so the tests do not depend on any shell's quoting rules.
const scripts = {
  // Blocks and echoes what the hook was told about the tool call.
  block: `const input = JSON.parse(require("fs").readFileSync(0, "utf8"))
console.error(input.hook_event_name + ":" + input.tool_name + ":" + input.tool_input.command)
process.exit(2)`,
  context: `console.log(JSON.stringify({ hookSpecificOutput: { additionalContext: "lint: 3 errors" } }))`,
  chatter: `console.log("formatted 4 files")`,
  fail: `process.exit(1)`,
}

function withHooks<A, E, R>(
  build: (command: (script: keyof typeof scripts) => string) => Hooks,
  body: (hooks: PluginHooks.Interface) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) =>
      Effect.gen(function* () {
        const files = yield* Effect.promise(async () => {
          const written = await Promise.all(
            Object.entries(scripts).map(async ([name, source]) => {
              const file = path.join(tmp.path, `${name}.js`)
              await fs.writeFile(file, source)
              return [name, `${bun} ${file.replaceAll("\\", "/")}`] as const
            }),
          )
          return Object.fromEntries(written)
        })
        const hooks = build((script) => files[script])
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "opencode.json"), JSON.stringify({ hooks })))
        return yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          return yield* body(yield* PluginHooks.Service)
        }).pipe(
          Effect.scoped,
          Effect.provide(LocationServiceMap.Service.get(Location.Ref.make({ directory: AbsolutePath.make(tmp.path) }))),
        )
      }),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )
}

const call = {
  sessionID: Session.ID.make("ses_hooks_test"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_hooks_test"),
  id: Tool.CallID.make("call_hooks_test"),
}

const before = (tool: string) => ({ ...call, tool, input: { command: "echo hi" } })

const after = (tool: string) => ({
  ...call,
  tool,
  input: { command: "echo hi" },
  status: "completed" as const,
  result: { content: [{ type: "text" as const, text: "hi" }] },
})

describe("shell hooks", () => {
  it.live("blocks a tool call when a PreToolUse hook exits 2 and passes the call on stdin", () =>
    withHooks(
      (command) => ({ PreToolUse: [{ matcher: "shell", hooks: [{ type: "command", command: command("block") }] }] }),
      (hooks) =>
        Effect.gen(function* () {
          const exit = yield* hooks.trigger("tool", "execute.before", before("shell")).pipe(Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(String(exit)).toContain("Blocked by PreToolUse hook: PreToolUse:shell:echo hi")
        }),
    ),
  )

  it.live("matches Claude Code tool names and leaves other tools alone", () =>
    withHooks(
      (command) => ({ PreToolUse: [{ matcher: "Bash", hooks: [{ command: command("block") }] }] }),
      (hooks) =>
        Effect.gen(function* () {
          expect(
            Exit.isFailure(yield* hooks.trigger("tool", "execute.before", before("shell")).pipe(Effect.exit)),
          ).toBe(true)
          expect(Exit.isSuccess(yield* hooks.trigger("tool", "execute.before", before("read")).pipe(Effect.exit))).toBe(
            true,
          )
        }),
    ),
  )

  it.live("adds structured PostToolUse context to the result but ignores plain stdout", () =>
    withHooks(
      (command) => ({
        PostToolUse: [{ matcher: "*", hooks: [{ command: command("context") }, { command: command("chatter") }] }],
      }),
      (hooks) =>
        Effect.gen(function* () {
          const event = yield* hooks.trigger("tool", "execute.after", after("edit"))
          if (event.status !== "completed") return yield* Effect.die("expected a completed result")
          const text = (event.result.content as ReadonlyArray<{ type: string; text?: string }>)
            .map((item) => item.text)
            .join("")
          expect(text).toContain("hi")
          expect(text).toContain("lint: 3 errors")
          expect(text).not.toContain("formatted 4 files")
        }),
    ),
  )

  it.live("treats a hook that exits with another code as non-blocking", () =>
    withHooks(
      (command) => ({ PreToolUse: [{ hooks: [{ command: command("fail") }] }] }),
      (hooks) =>
        Effect.gen(function* () {
          expect(
            Exit.isSuccess(yield* hooks.trigger("tool", "execute.before", before("shell")).pipe(Effect.exit)),
          ).toBe(true)
        }),
    ),
  )
})

import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { MemoryTool } from "@opencode/core/tool/plugin/memory"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { tempGlobalLayer } from "./fixture/global"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_memory_tool_test")

const memoryToolNode = makeLocationNode({
  name: "test/memory-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(MemoryTool.Plugin)),
  deps: [Tool.node, FSUtil.node, Global.node, Location.node],
})

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Tool.node, memoryToolNode, Global.node]), [
    Image.node.replace(imagePassthrough),
    Global.node.replace(tempGlobalLayer),
    Location.node.replace(tempLocationLayer),
  ]),
)

const call = (id: string, input: unknown) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: MemoryTool.name, input },
})

const text = (result: Effect.Success<ReturnType<typeof executeTool>>) =>
  result.status === "completed"
    ? (result.content ?? []).map((item) => (item.type === "text" ? item.text : "")).join("")
    : ""

describe("MemoryTool", () => {
  it.effect("saves a fact to user memory, skips duplicates and forgets it again", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const global = yield* Global.Service
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toContain("memory")
      const file = path.join(global.config, "memory.md")

      const saved = yield* executeTool(registry, call("save", { action: "save", scope: "user", text: "Use pnpm" }))
      expect(text(saved)).toBe("Saved to user memory: Use pnpm")
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toContain("- Use pnpm\n")

      const again = yield* executeTool(registry, call("again", { action: "save", scope: "user", text: "use pnpm" }))
      expect(text(again)).toBe("Already in user memory: use pnpm")

      const forgotten = yield* executeTool(registry, call("forget", { action: "forget", scope: "user", text: "pnpm" }))
      expect(text(forgotten)).toBe("Removed from user memory:\n- Use pnpm")
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).not.toContain("Use pnpm")
    }),
  )

  it.effect("keeps project memory in the data directory and refuses a too-short forget phrase", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const global = yield* Global.Service

      const saved = yield* executeTool(
        registry,
        call("project", { action: "save", scope: "project", text: "Staging API is https://staging.example.com" }),
      )
      expect(text(saved)).toContain("Saved to project memory")
      const files = yield* Effect.promise(() => fs.readdir(path.join(global.data, "memory")))
      expect(files).toHaveLength(1)

      const refused = yield* executeTool(registry, call("short", { action: "forget", scope: "project", text: "a" }))
      expect(refused.status).toBe("error")
    }),
  )
})

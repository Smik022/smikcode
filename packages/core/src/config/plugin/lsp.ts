export * as ConfigLspPlugin from "./lsp.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import type { ConfigLSP } from "@opencode/schema/config/lsp"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Lsp } from "../../lsp.js"
import { make } from "../../lsp/builtins.js"
import { ConfigEntryObserver } from "./entry-observer.js"

type ServerEntry = typeof ConfigLSP.Entry.Type

// Unlike formatters, language servers are on by default in SmikCode: installed servers are used
// unless `lsp` is false, and named entries add, override or disable servers.
export const Plugin = define({
  id: "opencode.config.lsp",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const lsp = yield* Lsp.Service
    const global = yield* Global.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, lsp.reload())

    yield* lsp.transform((editor) => {
      const configured = resolve(loaded.entries)
      if (configured === false) return
      const builtIns = make({ bin: global.bin })
      builtIns.forEach(editor.set)
      if (configured === undefined || configured === true) return

      for (const [name, entry] of Object.entries(configured)) {
        if (entry.disabled) {
          editor.remove(name)
          continue
        }
        const builtIn = builtIns.find((server) => server.name === name)
        editor.set({
          name,
          extensions: "extensions" in entry && entry.extensions ? entry.extensions : (builtIn?.extensions ?? []),
          environment: "env" in entry ? entry.env : undefined,
          initialization: "initialization" in entry ? entry.initialization : undefined,
          command: "command" in entry ? Effect.succeed([...entry.command]) : (builtIn?.command ?? Effect.succeed(false)),
        })
      }
    })
  }),
})

// Documents apply from lowest to highest priority. A boolean resets everything before it; an object
// merges each named server's fields over the same name from earlier objects.
function resolve(entries: readonly Entry[]) {
  return entries.reduce<boolean | Record<string, ServerEntry> | undefined>((result, entry) => {
    if (entry.type !== "document" || entry.info.lsp === undefined) return result
    if (typeof entry.info.lsp === "boolean") return entry.info.lsp
    return Object.entries(entry.info.lsp).reduce<Record<string, ServerEntry>>(
      (merged, [name, item]) => ({ ...merged, [name]: { ...merged[name], ...item } }),
      typeof result === "object" ? result : {},
    )
  }, undefined)
}

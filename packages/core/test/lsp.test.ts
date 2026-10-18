import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Lsp } from "@opencode/core/lsp"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const fakeServer = path.join(import.meta.dir, "fixture", "fake-lsp.ts")

const withLsp = <A, E>(directory: string, servers: Lsp.Server[], body: (lsp: Lsp.Interface) => Effect.Effect<A, E>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const lsp = yield* Lsp.Service
      yield* lsp.transform((editor) => servers.forEach(editor.set))
      return yield* body(lsp)
    }),
  ).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Lsp.node]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
      ]),
    ),
  )

const fake: Lsp.Server = {
  name: "fake",
  extensions: [".txt"],
  command: Effect.succeed([process.execPath, fakeServer]),
}

const it = testEffect(Layer.empty)

describe("Lsp", () => {
  it.live("reports a server's settled diagnostics for new and changed documents", () =>
    withTempDir((tmp) =>
      withLsp(tmp.path, [fake], (lsp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "notes.txt")
          const opened = yield* lsp.diagnostics(file, "fine\n  BAD here\nWARN")
          expect(opened).toEqual([
            {
              server: "fake",
              diagnostics: [
                { line: 2, column: 3, severity: 1, message: "bad token", source: "fake", code: "E1" },
                { line: 3, column: 1, severity: 2, message: "suspicious token", source: "fake", code: "W1" },
              ],
            },
          ])
          expect(Lsp.format("notes.txt", opened)).toBe(
            "Language server errors in notes.txt after this change (fix them if they are caused by it):\n  2:3 fake(E1) bad token",
          )

          const changed = yield* lsp.diagnostics(file, "all fixed\nWARN")
          expect(changed.flatMap((report) => report.diagnostics.map((diagnostic) => diagnostic.severity))).toEqual([2])
          expect(Lsp.format("notes.txt", changed)).toBeUndefined()
        }),
      ),
    ),
  )

  it.live("skips files no server handles and servers that are not installed", () =>
    withTempDir((tmp) =>
      withLsp(tmp.path, [fake, { name: "missing", extensions: [".md"], command: Effect.succeed(false) }], (lsp) =>
        Effect.gen(function* () {
          expect(yield* lsp.diagnostics(path.join(tmp.path, "main.go"), "BAD")).toEqual([])
          expect(yield* lsp.diagnostics(path.join(tmp.path, "README.md"), "BAD")).toEqual([])
        }),
      ),
    ),
  )
})

import { Effect } from "effect"
import { which } from "../util/which.js"
import type { Server } from "../lsp.js"

/**
 * Language servers SmikCode uses when they are already installed. Nothing is downloaded: a server
 * whose executable is not on PATH (or in SmikCode's bin directory) stays disabled.
 */
export function make(input: { readonly bin: string }): Server[] {
  const server = (name: string, extensions: string[], candidates: string[][]): Server => ({
    name,
    extensions,
    command: Effect.sync(() => {
      const found = candidates
        .map(([executable, ...args]) => ({ path: which(executable, undefined, input.bin), args }))
        .find((candidate) => candidate.path)
      return found?.path ? [found.path, ...found.args] : false
    }),
  })

  return [
    server(
      "typescript",
      [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
      [["typescript-language-server", "--stdio"]],
    ),
    server(
      "pyright",
      [".py", ".pyi"],
      [
        ["basedpyright-langserver", "--stdio"],
        ["pyright-langserver", "--stdio"],
      ],
    ),
    server("gopls", [".go"], [["gopls"]]),
    server("rust-analyzer", [".rs"], [["rust-analyzer"]]),
    server("clangd", [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"], [["clangd"]]),
  ]
}

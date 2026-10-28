import { Effect, Option } from "effect"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { EOL, tmpdir } from "node:os"
import path from "node:path"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { claudeArgs, mcpConfig, needsShell, NOT_INSTALLED, quoteForCmd, serverArgs } from "../../mcp-server/launch"
import { selfCommand } from "../../util/process"

// A terminal tab closes when its process exits, so a failure to start would vanish before it could be read. Only
// asked for with --wait-on-error, where the input is the terminal; it gives up after a minute so nothing hangs.
const pause = () =>
  new Promise<void>((resolve) => {
    process.stderr.write("Press Enter to close this tab." + EOL)
    const timer = setTimeout(done, 60_000)
    function done() {
      clearTimeout(timer)
      process.stdin.pause()
      resolve()
    }
    process.stdin.once("data", done)
    process.stdin.resume()
  })

// Runs the user's own claude executable with SmikCode's MCP server attached, and hands the terminal over to it.
export default Runtime.handler(
  Commands.commands.claude,
  Effect.fn("cli.claude")((input) =>
    Effect.gen(function* () {
      const executable = Bun.which("claude")
      if (!executable) {
        process.stderr.write(NOT_INSTALLED + EOL)
        process.exitCode = 1
        if (input.waitOnError) yield* Effect.promise(pause)
        return
      }
      const directory = Option.getOrUndefined(input.directory) ?? process.cwd()
      const config = mcpConfig(
        serverArgs({
          self: selfCommand(),
          directory,
          tools: input.tools,
          permission: input.permission,
          server: Option.getOrUndefined(input.server),
        }),
      )
      const folder = yield* Effect.promise(() => mkdtemp(path.join(tmpdir(), "smikcode-claude-")))
      const file = path.join(folder, "mcp.json")
      yield* Effect.promise(() => writeFile(file, JSON.stringify(config), { mode: 0o600 }))
      const args = claudeArgs(file, input.args)
      const result = yield* Effect.promise(
        () =>
          new Promise<{ code: number; started: boolean }>((resolve) => {
            const shell = needsShell(executable)
            const child = shell
              ? spawn(quoteForCmd(executable), args.map(quoteForCmd), { cwd: directory, stdio: "inherit", shell: true })
              : spawn(executable, args, { cwd: directory, stdio: "inherit" })
            child.on("error", (error) => {
              process.stderr.write(`Could not start Claude Code: ${error.message}` + EOL)
              resolve({ code: 1, started: false })
            })
            child.on("exit", (status) => resolve({ code: status ?? 1, started: true }))
          }),
      ).pipe(Effect.ensuring(Effect.promise(() => rm(folder, { recursive: true, force: true }))))
      process.exitCode = result.code
      // Claude Code's own exit, even a failing one, is its to show; only a failure to start needs holding open.
      if (!result.started && input.waitOnError) yield* Effect.promise(pause)
    }),
  ),
)

import { autocomplete, cancel, intro, isCancel, log, outro } from "@clack/prompts"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { formatSessionHtml, formatSessionMarkdown } from "@opencode/tui/util/session-export"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(
  Commands.commands.session.commands.export,
  Effect.fn("cli.session.export")((input) =>
    Effect.gen(function* () {
      const format = input.format
      if (format !== "json" && format !== "markdown" && format !== "html")
        return yield* Effect.fail(new Error(`Unknown export format "${format}". Use json, markdown or html.`))
      const requested = Option.getOrUndefined(input.session)
      if (!requested && !process.stdin.isTTY) {
        yield* Effect.fail(new Error("Pass a session ID when running without an interactive terminal"))
      }
      const server = yield* ServerConnection.resolve({
        server: Option.getOrUndefined(input.server),
        standalone: input.standalone,
      })
      const client = OpenCode.make({
        baseUrl: server.endpoint.url,
        headers: Service.headers(server.endpoint),
      })
      const sessionID = requested
        ? requested
        : yield* Effect.gen(function* () {
            intro("Export session", { output: process.stderr })
            const location = yield* Effect.tryPromise({
              try: () => client.location.get({ location: { directory: process.cwd() } }),
              catch: (cause) => cause,
            })
            const page = yield* Effect.tryPromise({
              try: () =>
                client.session.list({
                  directory: location.directory,
                  parentID: null,
                  order: "desc",
                  limit: 50,
                }),
              catch: (cause) => cause,
            })
            if (page.data.length === 0) {
              log.error("No sessions found", { output: process.stderr })
              outro("Done", { output: process.stderr })
              return undefined
            }
            const selected = yield* Effect.tryPromise({
              try: () =>
                autocomplete({
                  message: "Select session to export",
                  maxItems: 10,
                  options: page.data.map((session) => ({
                    label: session.title,
                    value: session.id,
                    hint: `${new Date(session.time.updated).toLocaleString()} - ${session.id.slice(-8)}`,
                  })),
                  output: process.stderr,
                }),
              catch: (cause) => cause,
            })
            if (isCancel(selected)) {
              cancel("Cancelled", { output: process.stderr })
              process.exitCode = 130
              return undefined
            }
            outro("Exporting session...", { output: process.stderr })
            return selected
          })
      if (!sessionID) return
      const data = yield* Effect.tryPromise({
        try: () => client.session.export({ sessionID, sanitize: format === "json" ? input.sanitize : undefined }),
        catch: (cause) => cause,
      })
      const options = { thinking: input.thinking, tools: true }
      const content =
        format === "markdown"
          ? formatSessionMarkdown(data.info, data.messages, options)
          : format === "html"
            ? formatSessionHtml(data.info, data.messages, options)
            : JSON.stringify(data, null, 2) + EOL
      const output = Option.getOrUndefined(input.output)
      if (!output) {
        process.stdout.write(content)
        return
      }
      yield* Effect.tryPromise({ try: () => Bun.write(output, content), catch: (cause) => cause })
      process.stderr.write(`Exported ${sessionID} to ${output}` + EOL)
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          process.stderr.write(errorMessage(error) + EOL)
          process.exitCode = 1
        }),
      ),
    ),
  ),
)

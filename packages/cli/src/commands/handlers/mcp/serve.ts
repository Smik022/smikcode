import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { fromClient } from "../../../mcp-server/backend"
import { createServer, serveLines } from "../../../mcp-server/protocol"
import { createTools } from "../../../mcp-server/tools"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"
import { OPENCODE_VERSION } from "../../../version"

const INSTRUCTIONS = [
  "These tools are SmikCode's.",
  "delegate_task hands a self-contained task to a SmikCode agent, which can run on any model connected in SmikCode, and returns its answer.",
  "sessions_list and session_export read earlier SmikCode sessions.",
  "The other tools are SmikCode's own and run under its permission rules; which of them are offered depends on how the server was started, and anything that needs approval is declined unless it was started with --permission.",
].join(" ")

// stdout belongs to the protocol, so nothing else may write to it while this runs.
export default Runtime.handler(
  Commands.commands.mcp.commands.serve,
  Effect.fn("cli.mcp.serve")((input) =>
    Effect.gen(function* () {
      const connection = yield* ServerConnection.resolve({
        server: Option.getOrUndefined(input.server),
        standalone: input.standalone,
      })
      const client = OpenCode.make({
        baseUrl: connection.endpoint.url,
        headers: Service.headers(connection.endpoint),
      })
      const tools = createTools({
        backend: fromClient(client, connection.endpoint.url),
        directory: Option.getOrUndefined(input.directory) ?? process.cwd(),
        permission: input.permission,
        bridge: !input.noBridge,
        tools: input.tools,
      })
      const server = createServer({
        name: "smikcode",
        version: OPENCODE_VERSION,
        instructions: INSTRUCTIONS,
        tools: tools.list,
      })
      yield* Effect.promise(() => serveLines(server, process.stdin, (line) => void process.stdout.write(line)))
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

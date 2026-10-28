import { OpenCode } from "@opencode/client"
import { formatSessionMarkdown } from "@opencode/tui/util/session-export"
import type { Backend, BridgeContent } from "./tools"

const BRIDGE = "smikcode.bridge"

/** The backend the MCP server talks to: SmikCode's HTTP API, plus the bridge RPC the backend registers. */
export function fromClient(client: ReturnType<typeof OpenCode.make>, url: string): Backend {
  return {
    url,
    location: (directory) => client.location.get({ location: { directory } }),
    listSessions: async ({ directory, limit }) =>
      (await client.session.list({ directory, parentID: null, order: "desc", limit })).data,
    createSession: (input) =>
      client.session.create({
        title: input.title,
        agent: input.agent,
        ...(input.model ? { model: input.model } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        location: { directory: input.directory },
      }),
    prompt: async (input) => {
      await client.session.prompt(input)
    },
    messages: async (sessionID, limit) => (await client.message.list({ sessionID, order: "desc", limit })).data,
    pendingPermissions: (sessionID) => client.permission.list({ sessionID }),
    rejectPermission: (input) => client.permission.reply({ ...input, decision: "reject" }),
    interrupt: async (sessionID) => {
      await client.session.interrupt({ sessionID })
    },
    exportMarkdown: async (sessionID, thinking) => {
      const data = await client.session.export({ sessionID })
      return formatSessionMarkdown(data.info, data.messages, { thinking, tools: true })
    },
    bridgeTools: async (directory) => {
      const response = await client.rpc.call({ rpcID: BRIDGE, method: "tools", location: { directory }, input: {} })
      return response.output.tools
    },
    bridgeCall: async ({ directory, sessionID, name, input }) => {
      const response = await client.rpc.call({
        rpcID: BRIDGE,
        method: "call",
        location: { directory },
        // The arguments arrived as JSON from the client, so this round trip only tells the type checker so.
        input: { sessionID, name, input: JSON.parse(JSON.stringify(input)) },
      })
      const output: { isError: boolean; content: BridgeContent[] } = response.output
      return output
    },
  }
}

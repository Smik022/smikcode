import path from "node:path"

/**
 * Starting the user's own Claude Code with SmikCode's tools attached. Claude Code is run exactly as installed:
 * nothing here reads, writes or changes its credentials, settings or environment, and sign-in stays with it.
 */

export type ServerCommand = { readonly command: string; readonly args: readonly string[] }

/** The MCP config Claude Code loads with --mcp-config. */
export function mcpConfig(server: ServerCommand) {
  return { mcpServers: { smikcode: { command: server.command, args: [...server.args] } } }
}

/** The command line that runs this SmikCode as an MCP server. */
export function serverArgs(input: {
  readonly self: readonly string[]
  readonly directory: string
  readonly tools: string
  readonly permission: string
  readonly server?: string
}): ServerCommand {
  const [command, ...prefix] = input.self
  if (!command) throw new Error("Failed to resolve the SmikCode command")
  return {
    command,
    args: [
      ...prefix,
      "mcp",
      "serve",
      "--directory",
      input.directory,
      "--tools",
      input.tools,
      "--permission",
      input.permission,
      ...(input.server ? ["--server", input.server] : []),
    ],
  }
}

/** Arguments for the claude executable: our config first, then whatever the user passed through. */
export const claudeArgs = (configPath: string, passthrough: readonly string[]) => [
  "--mcp-config",
  configPath,
  ...passthrough,
]

/** Windows cannot run a .cmd or .bat shim without a shell, so those arguments are quoted for cmd.exe. */
export const needsShell = (executable: string, platform: NodeJS.Platform = process.platform) =>
  platform === "win32" && [".cmd", ".bat"].includes(path.extname(executable).toLowerCase())

export const quoteForCmd = (value: string) => `"${value.replaceAll('"', '""')}"`

export const NOT_INSTALLED =
  "Claude Code is not installed or is not on your PATH. Install it from Anthropic (see https://code.claude.com/docs), sign in with `claude`, then run this again. SmikCode never installs it or handles its sign-in."

# SmikCode

SmikCode is an AI coding agent for your terminal, browser and desktop. It reads and edits your code, runs commands, and works with most LLM providers (Anthropic, OpenAI, Google, Bedrock, OpenRouter, local models and more).

> SmikCode is a fork of [opencode](https://github.com/anomalyco/opencode) (MIT). See [Credits](#credits).

## What's different from opencode

- **Its own identity:** the `smikcode` command, the SmikCode name throughout the UI, and its own config and data folders, server port and desktop app ID. It installs side by side with opencode and never shares state with it.
- **Its own look:** switchable skins (Neon night, Mono + amber, Warm workshop, Retro CRT) in the terminal UI, web app and desktop app.
- **Planned improvements:** LSP diagnostics after edits, a todo/plan tool, trimming of old tool output in long sessions, and local session export.

## Run from source

You need [Bun](https://bun.sh) 1.4.x and Git.

```bash
git clone https://github.com/Smik022/smikcode.git
cd smikcode
bun install
bun run dev            # terminal UI from source
bun run dev:web        # web app
bun run dev:desktop    # desktop app (Electron)
```

To build a standalone `smikcode` binary for your platform:

```bash
cd packages/cli
bun run build -- --single
```

The binary is written to `packages/cli/dist/cli-<os>-<arch>/bin/`.

### Windows notes

- Git on Windows can't create symlinks unless Developer Mode is on, so one TypeScript file, `packages/app/src/custom-elements.d.ts`, comes out as plain text. Either turn on Developer Mode and re-checkout, or replace it with `/// <reference path="../../ui/src/custom-elements.d.ts" />` and run `git update-index --skip-worktree packages/app/src/custom-elements.d.ts`.
- If `bun run check` crashes the TypeScript compiler, run `bun turbo typecheck --concurrency=1` instead.

## Configuration

| What | Where |
|---|---|
| Global config | `~/.config/smikcode/smikcode.json` (or `.jsonc`) |
| Project config | `smikcode.json` / `smikcode.jsonc` in your project, or a `.smikcode/` folder |
| Data (sessions database, logs) | `~/.local/share/smikcode/` |
| Environment variables | `SMIKCODE_*`, for example `SMIKCODE_CONFIG`, `SMIKCODE_PASSWORD` |

For compatibility, `opencode.json`, `.opencode/` and `OPENCODE_*` variables still work, but SmikCode's own files and variables take priority.

## Updating

SmikCode doesn't have a release feed yet, so it never updates itself. To update, pull and rebuild:

```bash
git pull
bun install
```

## Credits

SmikCode is built on [opencode](https://github.com/anomalyco/opencode) by the opencode authors and contributors, used under the MIT License. Thank you to everyone who built it. The original copyright notice is kept in [LICENSE](LICENSE).

## License

[MIT](LICENSE)

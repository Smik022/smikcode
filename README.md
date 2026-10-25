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

### Language server diagnostics

After the agent edits or writes a file, SmikCode sends the new contents to that language's server and shows the agent any errors, so it can fix its own mistakes. These servers are used automatically if they're installed and on your `PATH`:

| Language | Server |
|---|---|
| TypeScript / JavaScript | `typescript-language-server` |
| Python | `basedpyright-langserver` or `pyright-langserver` |
| Go | `gopls` |
| Rust | `rust-analyzer` |
| C / C++ | `clangd` |

Turn this off with `"lsp": false`, or add and override servers:

```jsonc
{
  "lsp": {
    "clangd": { "disabled": true },
    "lua": { "command": ["lua-language-server"], "extensions": [".lua"] }
  }
}
```

## Exporting a session

opencode's online sharing is switched off, so SmikCode exports sessions to files you can keep or send:

- In the terminal UI, run `/export` and choose **Markdown**, **HTML page** or **JSON**.
- From the command line:

```bash
smikcode session export <session-id> --format html --output session.html
```

The HTML page is fully self-contained, with no scripts and no network requests, so it opens anywhere. JSON exports can be re-imported with `smikcode session import`. Add `--thinking` to include the model's reasoning.

## Trimming old tool output

In long sessions, SmikCode replaces large tool output from older turns with a short note before each model call, so you hit full compaction less often. Your stored session is never changed. Turn it off with `"compaction": { "prune": false }`.

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

# SmikCode

SmikCode is an AI coding agent for your terminal, browser and desktop. It reads and edits your code, runs commands, and works with most LLM providers (Anthropic, OpenAI, Google, Bedrock, OpenRouter, local models and more).

> SmikCode is a fork of [opencode](https://github.com/anomalyco/opencode) (MIT). See [Credits](#credits).

## What's different from opencode

- **Its own identity:** the `smikcode` command, the SmikCode name throughout the UI, and its own config and data folders, server port and desktop app ID. It installs side by side with opencode and never shares state with it.
- **Its own look:** four switchable skins in the terminal UI, web app and desktop app. A skin changes layout, borders, labels and logo as well as colors (see [Skins](#skins)).
- **Extra agent features:** LSP diagnostics after edits, a todo tool, trimming of old tool output in long sessions, local session export, [lifecycle hooks](#lifecycle-hooks), [persistent memory](#memory), [CLAUDE.md support](#claudemd-support), [permission modes](#permission-modes), [goals](#goals) and your own [workflows](#workflows), borrowed from Claude Code and Codex.

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

## Skins

| Skin | Look |
|---|---|
| **Neon night** (default) | Deep navy, magenta for you and cyan for the agent, rounded panels, gradient logo |
| **Mono + amber** | Greys and one amber accent, no boxes (thin rules only), status bar along the top |
| **Warm workshop** | Sand, terracotta and olive, square panels, left sidebar with your sessions and the agent's task list |
| **Retro CRT** | Green phosphor on black, block-letter banner, `USER:` / `SMIK:` labels, `SMIK>` prompt |

- **Terminal UI:** run `/themes` and pick a skin; the choice is saved.
- **Web and desktop:** Settings, then Appearance, then Skin.

The Warm workshop task list fills in when the agent uses the `todo` tool for multi-step work.

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

### Lifecycle hooks

Hooks run your own shell commands at set points, in the same format as Claude Code's `hooks` setting, so existing hook scripts carry over. Put them in `smikcode.json`:

```jsonc
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "command": "./scripts/check-command.sh" }] }],
    "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "command": "npx prettier --check ." }] }],
    "UserPromptSubmit": [{ "hooks": [{ "command": "git status --short" }] }],
    "Stop": [{ "hooks": [{ "command": "./scripts/run-tests.sh", "timeout": 120 }] }],
    "SessionStart": [{ "hooks": [{ "command": "cat docs/CONTEXT.md" }] }]
  }
}
```

| Event | Runs | What a hook can do |
|---|---|---|
| `PreToolUse` | Before a tool call | Exit `2` to block the call; stderr is sent to the model |
| `PostToolUse` | After a tool call | Exit `2` to send stderr to the model as feedback |
| `UserPromptSubmit` | When you send a prompt | Print text to add it as context |
| `Stop` | When the agent finishes | Exit `2` to make it keep going (at most 3 times in a row) |
| `SessionStart` | When a session is created | Print text to add it as context |

The command gets the event as JSON on stdin (`hook_event_name`, `session_id`, `cwd`, `tool_name`, `tool_input`, `prompt`, ...) and the `SMIKCODE_PROJECT_DIR` and `CLAUDE_PROJECT_DIR` variables. `matcher` is a regular expression on the tool name; Claude Code names (`Bash`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `WebFetch`, `Task`) match the matching SmikCode tools. A hook can also print JSON such as `{"decision": "block", "reason": "..."}` or `{"hookSpecificOutput": {"additionalContext": "..."}}`. Hooks that crash, time out (60 seconds by default) or exit with any other code never block the agent.

To reuse hooks you already have in Claude Code, set `"claude_hooks": true`. SmikCode then also runs the hooks in `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json` (only command hooks for the five events above; the rest of those files is ignored). It is off by default because a repository's `.claude/settings.json` would otherwise run commands the first time you open it.

### Memory

Ask the agent to remember something ("always use pnpm", "the staging API is at ...") and it saves it with the `memory` tool. Saved facts load into every later session as instructions.

- **User memory** (every project): `~/.config/smikcode/memory.md`
- **Project memory** (this project only, kept out of your repository): `~/.local/share/smikcode/memory/<project>.md`

They are plain Markdown with one bullet per fact, so you can edit them by hand. Ask the agent to "forget" a fact to remove it.

### Permission modes

In the web and desktop apps, the picker next to the model in the prompt box (**Default**, **Accept edits**, **Auto**) sets this for the session, or for a new session before you send the first message. In any client you can also type `/mode` to see or change how much SmikCode asks before acting:

| Mode | What happens |
|---|---|
| `default` | Follows your permission rules, asking only where a rule says to ask |
| `edits` | File edits are approved automatically, even where a rule says to ask; everything else follows the rules |
| `auto` | Anything a rule would ask about is approved automatically |

`/mode edits` switches this session to accept-edits mode, and `/mode default` switches back. A mode only replaces a "would ask" with "allow": deny rules still win, so Plan mode stays read-only in every mode. Out of the box SmikCode's rules allow most actions (only reading `.env` files asks), so the modes matter once you add `ask` rules to your config.

### Goals

`/goal <what you want done>` gives the agent a goal and lets it keep working until it is met, instead of stopping to ask you at every turn. When a run ends and the goal is not done, SmikCode sends a nudge to continue. The agent ends it by calling its `goal` tool with `complete` or `blocked`.

- `/goal` shows the current goal; `/goal pause`, `/goal resume` and `/goal clear` manage it.
- Stopping the agent yourself pauses the goal.
- After 10 automatic continuations in a row the goal pauses so a stuck agent can't loop forever; `/goal resume` gives it another 10.

### Workflows

A workflow is your own development process, written as stages the agent goes through in order: write a spec, write a failing test, build, review with fresh eyes, open a pull request. The agent works through the stages one by one.

In the desktop app, pick one from the workflow menu in the prompt box (next to the permission mode). Your next message becomes the task. A strip above the prompt box then shows the stage the run is in, and offers Approve, Resume and Stop when they apply. You can also type `/workflow <name> <task>`.

**Settings → Workflows** is where you build your own. Switch between **Cards** and **Flow** above the stages: Flow draws the stages as nodes with an arrow for what happens after a pass and a dashed one for what happens after a failure, and choosing a node edits it. Each stage sets its instructions, whether it runs in this chat or a fresh session, its agent and model, how it ends, and where a pass or a failure goes. You also choose whether to save the workflow for every project or only for this one. A prebuilt workflow can be changed the same way, and deleting your copy brings the prebuilt one back.

You can also describe a workflow in words. The **Describe a workflow** box at the top of the page, or `/workflow new <what it should do>` in the prompt box, asks your default model to draft the stages. The page opens the draft in the editor so you can check and change it; `/workflow new` keeps the draft in the session with a strip above the prompt box that offers Save and Save in this project, and `/workflow save`, `/workflow save project` and `/workflow discard` do the same by typing. Nothing is saved until you say so. This needs a model that works, and a draft that comes back unusable is sent back to the model up to three times with what was wrong.

| Command | What it does |
|---|---|
| `/workflow` or `/workflow list` | Lists the workflows, and where the current run stands |
| `/workflow <name> <task>` | Starts a workflow on a task |
| `/workflow status` | Shows the current run and its stages |
| `/workflow approve` | Lets a stage that is waiting for you carry on |
| `/workflow resume` | Starts the current stage again for a run that paused, got blocked, or stopped moving (for example after the server restarted) |
| `/workflow stop` | Ends the run and stops the agent working on its stage |
| `/workflow new <description>` | Drafts a workflow from a description |
| `/workflow save` / `/workflow save project` | Keeps the draft for every project, or for this project |
| `/workflow discard` | Drops the draft |

Four workflows come with SmikCode:

| Name | Stages |
|---|---|
| `sdd` | Write a spec (you approve it), plan, build, check the result against the spec |
| `tdd` | Write a failing test, make it pass, clean up |
| `review` | Build, then a reviewer that has not seen the work checks it and sends fixes back |
| `pr` | Self-review, commit and draft a pull request, then push and open it only after you approve |

The editor writes plain JSON files, so you can also write or share them by hand: `~/.config/smikcode/workflows/` (every project) or `.smikcode/workflows/` (this project, so teammates share it). A file with the same `id` as another replaces it, and a project's file wins over a global one, so you can adjust a prebuilt workflow.

```jsonc
{
  "id": "tdd-strict",
  "name": "Strict TDD",
  "stages": [
    { "id": "red", "title": "Failing test", "instructions": "Write one failing test for the task." },
    {
      "id": "green",
      "title": "Make it pass",
      "instructions": "Make the test pass with the simplest change.",
      "exit": "command",
      "command": "bun test",
      "onFail": { "goto": "green", "max": 4 }
    },
    {
      "id": "review",
      "title": "Fresh review",
      "instructions": "Review the change. Do not edit files.",
      "context": "fresh",
      "agent": "plan",
      "onPass": "done",
      "onFail": { "goto": "green", "max": 2 }
    }
  ]
}
```

| Stage field | Meaning |
|---|---|
| `id`, `title`, `instructions` | Required. What the agent is asked to do in the stage |
| `context` | `same` (default) keeps going in this chat. `fresh` runs the stage in a new session that has not seen the earlier work, which is what makes a review fresh. The first stage always runs in the current chat |
| `agent` | Agent for the stage, such as `plan` for a read-only review. The session goes back to its own agent afterwards |
| `model` | Model for a `fresh` stage, written `provider/model` or `provider/model#variant` |
| `exit` | How the stage ends. `agent` (default): the agent reports it with the `workflow_stage` tool. `command`: after the agent reports a pass, `command` must exit with 0, otherwise the output goes back to the agent. `approval`: after a pass, the run waits for `/workflow approve` |
| `approveFirst` | Wait for `/workflow approve` before the stage starts |
| `onPass` | The stage to go to after a pass, or `done`. Defaults to the next stage |
| `onFail` | `{ "goto": <stage>, "max": <n> }`: where a failure goes and how many times. Without it a failed stage is tried again, up to 3 times. When the limit is reached the run stops |

A `command` stage runs a shell command on your machine, so treat a project's `.smikcode/workflows/` like the scripts in its `package.json`: read a workflow that came from someone else before you pick it. Settings shows where each workflow comes from.

The run keeps a copy of the workflow it started with, so editing a file never changes a run in progress. If the agent ends its replies without reporting a stage, it is reminded up to 4 times before the run pauses. A workflow never pushes or opens a pull request on its own: while one runs, waits, is paused or is blocked, `git push`, `gh pr create`, `gh pr merge`, `gh release create`, `npm publish` and `docker push` always ask you first, even in Auto mode and with auto-approve on. This reads the command as written, so it is a guard rail and not a sandbox. A workflow cannot be called `list`, `new`, `save`, `done` or another word `/workflow` reads as a command, no stage can be called `done`, a stage's model must be written `provider/model`, and a workflow whose passes would go round in a loop forever is refused. A fresh stage that was running when the server restarted is picked up again when the project is opened.

### CLAUDE.md support

SmikCode reads `AGENTS.md` as its project instructions. Where a directory has no `AGENTS.md`, it reads that directory's `CLAUDE.md` instead, and it always adds `CLAUDE.local.md` (meant for personal notes you don't commit). Your global `~/.claude/CLAUDE.md` is used when `~/.config/smikcode/AGENTS.md` doesn't exist.

### Using your own Claude Code with SmikCode

SmikCode can start **your own, already signed-in Claude Code** with SmikCode's tools attached over MCP. Claude Code's model does the work, under your Claude plan. SmikCode's own chat and agent keep using whichever models you have connected in SmikCode.

- **Desktop:** in a session, type `/claude` in the prompt box, pick "Open Claude Code with SmikCode's tools" from the command palette, or click the `</>` button next to `+` in the terminal panel. Each opens a terminal tab running `claude` with SmikCode's tools attached. In Settings, General, the **Claude Code** section chooses which tools it gets (read only, read and edit files, or everything including commands; the default is everything).
- **Terminal:** `smikcode claude` runs `claude` in the current folder, pre-wired. Add `--tools safe|edits|all` and put Claude's own arguments after `--`, for example `smikcode claude -- --model opus`.
- **Permanently, from Claude Code:** `claude mcp add --scope user smikcode -- smikcode mcp serve --tools safe`

What Claude Code gets:

| Tool | What it does |
|---|---|
| `delegate_task` | Hands a task to a SmikCode agent on any model you have connected, including free ones, and returns its answer. Read-only unless `allow_edits` is set; it cannot run shell commands. |
| `sessions_list`, `session_export` | Read your earlier SmikCode sessions |
| `status` | Shows which backend and folder the server is using |
| SmikCode's own tools | Chosen with `--tools`: `safe` is read-only (read, glob, grep, web fetch and search, todo, skill); `edits` adds edit, write, patch and memory; `all` adds shell, CodeMode and any plugin tools |

SmikCode's own permission rules allow most actions out of the box, so `--tools` is the real limit on what Claude Code can do through SmikCode. `smikcode mcp serve --permission default|edits|auto` sets what those tools may do without asking. The server runs headless, so a request that needs approval is declined with a message that says how to allow it. Claude Code also asks you before calling an MCP tool unless you have allowed it in its own settings. Provider API keys and SmikCode's config are never offered as tools.

How this stays within Anthropic's rules: SmikCode only launches the unmodified `claude` you installed and runs an MCP server that Claude Code connects to. It never reads, stores or passes on Claude Code's login or tokens, offers no "Log in with Claude", and does not change Claude Code. Anthropic does not allow other apps to use Claude plan sign-in for their own requests, so Claude models inside SmikCode's own chat need an API key. Read [Anthropic's legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) for the current terms.

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

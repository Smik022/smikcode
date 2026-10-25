import type { SessionInfo, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { Brand } from "@opencode/util/brand"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { toolDisplayContent } from "./tool-display"
import { parseTodos } from "./todos"

export type ExportOptions = {
  /** Include the model's reasoning. */
  readonly thinking: boolean
  /** Include tool calls with their input and output. */
  readonly tools: boolean
}

export function formatSessionMarkdown(
  session: SessionInfo,
  messages: readonly SessionMessageInfo[],
  options: ExportOptions,
) {
  const body = messages.flatMap((message) => {
    if (message.type === "user") return [`## User\n\n${message.text}`]
    if (message.type === "shell")
      return [`## Shell\n\n\`\`\`\n$ ${message.command}\n${message.output?.output ?? ""}\n\`\`\``]
    if (message.type !== "assistant") return []
    const content = message.content.flatMap((item) => {
      if (item.type === "text") return [item.text]
      if (item.type === "reasoning") return options.thinking ? [`_Thinking:_\n\n${item.text}`] : []
      if (!options.tools) return []
      return [`**Tool: ${item.name}**\n\n**Input:**\n\`\`\`json\n${toolInput(item)}\n\`\`\`\n\n${toolOutput(item)}`]
    })
    if (content.length === 0) return []
    return [`## Assistant\n\n${content.join("\n\n")}`]
  })
  return `# ${withTimestampedFallback(session)}\n\n**Session ID:** ${session.id}\n**Created:** ${new Date(session.time.created).toLocaleString()}\n**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n---\n\n${body.join("\n\n---\n\n")}\n`
}

/**
 * A single self-contained HTML page for sharing a session: inline styles, no scripts and no
 * network requests, readable in light and dark mode. All session text is escaped.
 */
export function formatSessionHtml(
  session: SessionInfo,
  messages: readonly SessionMessageInfo[],
  options: ExportOptions,
) {
  const title = withTimestampedFallback(session)
  const body = messages.flatMap((message) => {
    if (message.type === "user") return [block("user", "You", prose(message.text))]
    if (message.type === "shell")
      return [
        block(
          "shell",
          "Shell",
          `<pre><code>$ ${escape(message.command)}\n${escape(message.output?.output ?? "")}</code></pre>`,
        ),
      ]
    if (message.type !== "assistant") return []
    const content = message.content.flatMap((item) => {
      if (item.type === "text") return [prose(item.text)]
      if (item.type === "reasoning")
        return options.thinking
          ? [`<details class="thinking"><summary>Thinking</summary>${prose(item.text)}</details>`]
          : []
      if (!options.tools) return []
      return [tool(item)]
    })
    if (content.length === 0) return []
    return [block("agent", Brand.name, content.join("\n"))]
  })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${Brand.name}">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<p class="brand">${Brand.name} session</p>
<h1>${escape(title)}</h1>
<p class="meta">Created ${escape(new Date(session.time.created).toLocaleString())} · Updated ${escape(new Date(session.time.updated).toLocaleString())} · <code>${escape(session.id)}</code></p>
</header>
${body.join("\n")}
<footer>Exported from ${Brand.name}</footer>
</main>
</body>
</html>
`
}

function block(kind: "user" | "agent" | "shell", label: string, content: string) {
  return `<section class="message ${kind}"><h2>${escape(label)}</h2>${content}</section>`
}

function tool(item: SessionMessageAssistantTool) {
  const status = item.state.status === "error" ? "failed" : item.state.status === "completed" ? "done" : "running"
  const todos = item.name === "todo" ? parseTodos(item.state.input) : undefined
  const output = toolOutput(item)
  const details = todos
    ? `<ul class="todos">${todos.map((todo) => `<li class="${todo.status}">${escape(todo.content)}</li>`).join("")}</ul>`
    : `<p class="label">Input</p><pre><code>${escape(toolInput(item))}</code></pre>${
        output ? `<p class="label">Output</p><pre><code>${escape(output)}</code></pre>` : ""
      }`
  return `<details class="tool ${status}"${todos ? " open" : ""}><summary><span class="name">${escape(item.name)}</span> <span class="status">${status}</span></summary>${details}</details>`
}

function toolInput(item: SessionMessageAssistantTool) {
  return typeof item.state.input === "string" ? item.state.input : JSON.stringify(item.state.input, null, 2)
}

function toolOutput(item: SessionMessageAssistantTool) {
  if (item.state.status === "error") return item.state.error.message
  if (item.state.status === "streaming") return ""
  return toolDisplayContent(item.state)
    .flatMap((entry) => (entry.type === "text" ? [entry.text] : [entry.name ?? entry.uri]))
    .join("\n")
}

/**
 * Renders the Markdown that matters most in a transcript (fenced code, inline code, bold) and keeps
 * everything else as escaped text with its line breaks.
 */
function prose(text: string) {
  return text
    .split(/^```[^\n]*\n?/m)
    .map((segment, index) =>
      index % 2 === 1
        ? `<pre><code>${escape(segment.replace(/\n$/, ""))}</code></pre>`
        : segment.trim() === ""
          ? ""
          : `<div class="prose">${inline(escape(segment.trim()))}</div>`,
    )
    .join("")
}

function inline(escaped: string) {
  return escaped.replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
}

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const STYLE = `
:root{--bg:#f7f5f0;--panel:#ffffff;--text:#1d1b22;--muted:#6b6672;--line:#e3ded5;--you:#b4237a;--agent:#0b7c8c;--code:#f0ece4;--ok:#2f7d32;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1020;--panel:#151a30;--text:#e8e6f0;--muted:#9a97ad;--line:#262c48;--you:#ff5fc8;--agent:#3ee0f0;--code:#0a0d1a;--ok:#7bd88f;--bad:#ff8a80}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
header{margin-bottom:24px}
.brand{margin:0;color:var(--agent);font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:12px}
h1{margin:4px 0 8px;font-size:26px;line-height:1.25}
.meta{margin:0;color:var(--muted);font-size:13px}
.message{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0}
.message h2{margin:0 0 8px;font-size:13px;letter-spacing:.04em;text-transform:uppercase}
.user h2{color:var(--you)}.agent h2{color:var(--agent)}.shell h2{color:var(--muted)}
.user{border-left:4px solid var(--you)}.agent{border-left:4px solid var(--agent)}
.prose{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}
code{font:13px/1.5 ui-monospace,"Cascadia Code",Menlo,Consolas,monospace;background:var(--code);border-radius:4px;padding:1px 4px}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow:auto;margin:8px 0}
pre code{background:none;padding:0;white-space:pre}
details{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:6px 10px}
summary{cursor:pointer;color:var(--muted);font-size:13px}
.tool .name{font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--text)}
.tool.done .status{color:var(--ok)}.tool.failed .status{color:var(--bad)}
.label{margin:8px 0 0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.todos{list-style:none;padding:0;margin:8px 0}
.todos li::before{display:inline-block;width:1.4em;color:var(--muted)}
.todos li.pending::before{content:"○"}.todos li.in_progress::before{content:"▸";color:var(--agent)}
.todos li.completed{color:var(--muted)}.todos li.completed::before{content:"✓";color:var(--ok)}
.todos li.cancelled{color:var(--muted);text-decoration:line-through}.todos li.cancelled::before{content:"✗"}
footer{margin-top:32px;color:var(--muted);font-size:12px;text-align:center}
`

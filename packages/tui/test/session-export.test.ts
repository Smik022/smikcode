import { describe, expect, test } from "bun:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { formatSessionHtml, formatSessionMarkdown } from "../src/util/session-export"

// Only the fields the exporters read.
const session = {
  id: "ses_export_test",
  title: "Fix <login> bug",
  time: { created: 0, updated: 0 },
} as unknown as SessionInfo

const messages = [
  { type: "user", text: "Why does `login()` fail? <script>alert(1)</script>" },
  {
    type: "assistant",
    content: [
      { type: "reasoning", text: "secret plan" },
      { type: "text", text: "It's the **token**.\n```ts\nif (a < b) login()\n```\nDone." },
      {
        type: "tool",
        id: "call-1",
        name: "read",
        state: {
          status: "completed",
          input: { path: "src/auth.ts" },
          content: [{ type: "text", text: "<tag> & more" }],
        },
      },
      {
        type: "tool",
        id: "call-2",
        name: "todo",
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "Find bug", status: "completed" },
              { content: "Fix <it>", status: "in_progress" },
            ],
          },
          content: [],
        },
      },
    ],
  },
] as unknown as SessionMessageInfo[]

describe("session export", () => {
  test("html is a self-contained page with every piece of session text escaped", () => {
    const html = formatSessionHtml(session, messages, { thinking: false, tools: true })
    expect(html).toStartWith("<!doctype html>")
    expect(html).toContain("<title>Fix &lt;login&gt; bug</title>")
    expect(html).not.toContain("<script")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("<code>login()</code>")
    expect(html).toContain("<strong>token</strong>")
    expect(html).toContain("<pre><code>if (a &lt; b) login()</code></pre>")
    expect(html).toContain("&lt;tag&gt; &amp; more")
    expect(html).toContain('<li class="in_progress">Fix &lt;it&gt;</li>')
    expect(html).not.toContain("secret plan")
    expect(html).not.toMatch(/https?:\/\//)
  })

  test("html honors the thinking and tools options", () => {
    const html = formatSessionHtml(session, messages, { thinking: true, tools: false })
    expect(html).toContain("secret plan")
    expect(html).not.toContain("src/auth.ts")
    expect(html).not.toContain("Find bug")
  })

  test("markdown keeps the existing transcript shape", () => {
    const markdown = formatSessionMarkdown(session, messages, { thinking: false, tools: true })
    expect(markdown).toStartWith("# Fix <login> bug\n\n**Session ID:** ses_export_test")
    expect(markdown).toContain("## User\n\nWhy does `login()` fail?")
    expect(markdown).toContain("**Tool: read**")
    expect(markdown).not.toContain("secret plan")
  })
})

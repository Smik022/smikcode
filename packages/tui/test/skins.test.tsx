import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = {
  id: "ses_skins",
  title: "Skinned session",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const messages = [
  { id: "msg_1", type: "user", text: "Explain the build", time: { created: 1 } },
  {
    id: "msg_2",
    type: "assistant",
    agent: "build",
    model: { providerID: "provider", id: "model" },
    content: [
      {
        type: "tool",
        id: "read-1",
        name: "read",
        time: { created: 2, completed: 3 },
        state: {
          status: "completed",
          input: { path: `${directory}/src/app.ts` },
          content: [{ type: "text", text: "ok" }],
          metadata: {},
        },
      },
      { type: "text", text: "Builds run through turbo." },
    ],
    finish: "stop",
    time: { created: 2, completed: 4 },
  },
  { id: "msg_3", type: "user", text: "Thanks", time: { created: 5 } },
]

function render(state: string, theme: string, width: number) {
  return createAppFixture({
    state,
    width,
    height: 40,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" }, theme: { name: theme }, session: { grouping: "none" } },
    fetch: (url) => {
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (/^\/api\/session\/[^/]+\/(inbox|permission)$/.test(url.pathname)) return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
}

const skins = [
  { id: "smik-neon", shows: ["◆ you", "◇ smik", "→ Read", "╭─ Build", "Model ─╮"], hides: ["SMIKCODE", "[OK]"] },
  { id: "smik-mono", shows: ["SMIKCODE · ", "you", "smik", "· Read", "───"], hides: ["╭", "┌", "◆ you", "[OK]"] },
  { id: "smik-workshop", shows: ["you ▸", "smik ▸", "▪ Read", "┌"], hides: ["SMIKCODE", "[OK]"] },
  { id: "smik-crt", shows: ["USER:", "SMIK:", "[OK] READ", "SMIK> ", "█▓▒░ SMIK ░▒▓█", "╔", "▒▒▒"], hides: ["◆ you"] },
]

test.each(skins.flatMap((skin) => [100, 150].map((width) => [skin.id, width, skin] as const)))(
  "%s skins the session view at width %d",
  async (_id, width, skin) => {
    await using state = await tmpdir()
    await using setup = await render(state.path, skin.id, width)
    await setup.ready
    const frame = await waitForHighlightedFrame(
      setup,
      (frame) => frame.includes("Builds run through turbo.") && skin.shows.every((text) => frame.includes(text)),
    )
    for (const text of skin.hides) expect(frame).not.toContain(text)
  },
)

test("the warm workshop sidebar docks on the left with a sessions list", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, "smik-workshop", 150)
  await setup.ready
  const frame = await waitForHighlightedFrame(setup, (frame) => frame.includes("sessions") && frame.includes("Thanks"))
  const lines = frame.split("\n")
  const sidebar = lines.find((line) => line.includes("sessions"))!
  const transcript = lines.find((line) => line.includes("Thanks"))!
  expect(sidebar.indexOf("sessions")).toBeLessThan(transcript.indexOf("Thanks"))
})

test("switching skins from the theme picker restyles the session live and persists", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, "smik-neon", 100)
  await setup.ready
  await waitForHighlightedFrame(
    setup,
    (frame) => frame.includes("◆ you") && frame.includes("Builds run through turbo."),
  )

  await setup.mockInput.typeText("/themes")
  setup.mockInput.pressEnter()
  const picker = await setup.waitForFrame(
    (frame) => frame.includes("SmikCode skins") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  // Skins lead the list, ahead of the upstream themes.
  expect(picker.indexOf("Retro CRT")).toBeLessThan(picker.indexOf("aura"))

  await setup.mockInput.typeText("Retro CRT")
  await setup.waitForFrame((frame) => frame.includes("USER:") && frame.includes("SMIK:"))
  setup.mockInput.pressEnter()
  const frame = await setup.waitForFrame((frame) => !frame.includes("SmikCode skins") && frame.includes("[OK] READ"))

  expect(frame).not.toContain("◆ you")
  expect(setup.config().theme?.name).toBe("smik-crt")
})

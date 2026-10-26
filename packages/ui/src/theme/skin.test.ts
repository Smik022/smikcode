import { describe, expect, test } from "bun:test"
import { resolveSkin } from "./skin"
import type { DesktopTheme } from "./types"

const load = (id: string): Promise<DesktopTheme> => Bun.file(new URL(`./themes/${id}.json`, import.meta.url)).json()

describe("resolveSkin", () => {
  test("a theme without a skin keeps the upstream layout: no attributes and empty labels", async () => {
    const skin = resolveSkin(await load("oc-2"), "dark")

    expect(skin.attributes).toEqual({})
    expect(skin.css).toContain('--skin-role-user-label: "";')
    expect(skin.css).toContain('--skin-role-assistant-label: "";')
    expect(skin.css).toContain('--skin-tool-marker: "";')
    expect(skin.css).toContain('--skin-prompt-prefix: "";')
    expect(skin.css).toContain('--skin-header-label: "";')
    expect(skin.css).toContain('--skin-divider-rule: "";')
    expect(skin.css).toContain("--skin-prompt-indent: 0ch;")
    expect(skin.css).toContain("--skin-radius: var(--radius-lg);")
    expect(skin.css).toContain("--skin-font: var(--font-family-sans);")
    expect(skin.css).toContain("--skin-role-user-color: var(--v2-text-text-base);")
    expect(skin.css).toContain("--skin-brand-end: var(--v2-text-text-accent);")
  })

  // Every built-in theme shares one layout: its skin only carries the logo treatment and the font.
  test.each([
    { id: "smik-neon", attributes: { "data-skin-logo": "gradient" }, css: ["--skin-brand-start: #ff3fb4;", "--skin-brand-end: #22e4f0;"] },
    { id: "smik-mono", attributes: { "data-skin-logo": "rule" }, css: ["--skin-role-user-color: #ffb000;"] },
    { id: "smik-workshop", attributes: { "data-skin-logo": "slab" }, css: ["--skin-role-user-color: #e0764f;"] },
    {
      id: "smik-crt",
      attributes: { "data-skin-logo": "phosphor", "data-skin-font": "mono" },
      css: ["--skin-font: var(--font-family-mono);"],
    },
  ])("$id keeps the shared layout and only sets its logo and font", async (input) => {
    const skin = resolveSkin(await load(input.id), "dark")

    expect(skin.attributes).toEqual(input.attributes)
    input.css.forEach((line) => expect(skin.css).toContain(line))
    expect(skin.css).toContain('--skin-role-user-label: "";')
    expect(skin.css).toContain("--skin-radius: var(--radius-lg);")
  })

  test("mode-specific skin colours follow the colour scheme", async () => {
    const theme = await load("smik-mono")

    expect(resolveSkin(theme, "light").css).toContain("--skin-role-user-color: #b26a00;")
    expect(resolveSkin(theme, "dark").css).toContain("--skin-role-user-color: #ffb000;")
  })

  test("labels are emitted as escaped CSS strings", async () => {
    const theme = await load("oc-2")
    const skin = resolveSkin({ ...theme, skin: { roleLabels: { user: 'say "hi" \\', assistant: "a\nb" } } }, "dark")

    expect(skin.css).toContain('--skin-role-user-label: "say \\"hi\\" \\\\";')
    expect(skin.css).toContain('--skin-role-assistant-label: "a\\A b";')
  })
})

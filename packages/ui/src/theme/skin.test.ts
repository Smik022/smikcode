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

  test.each([
    {
      id: "smik-neon",
      mode: "dark" as const,
      attributes: {
        "data-skin-panel": "rounded",
        "data-skin-fill": "fill",
        "data-skin-divider": "glyph",
        "data-skin-header": "none",
        "data-skin-sidebar": "right",
        "data-skin-tool": "icons",
        "data-skin-roles": "labels",
        "data-skin-prompt": "labels",
        "data-skin-logo": "gradient",
      },
      css: [
        "--skin-radius: 14px;",
        '--skin-role-user-label: "◆ you";',
        '--skin-role-assistant-label: "◇ smik";',
        "--skin-role-user-color: #ff3fb4;",
        "--skin-role-assistant-color: #22e4f0;",
        "--skin-brand-start: #ff3fb4;",
        "--skin-brand-end: #22e4f0;",
      ],
    },
    {
      id: "smik-mono",
      mode: "light" as const,
      attributes: {
        "data-skin-panel": "none",
        "data-skin-fill": "flat",
        "data-skin-divider": "glyph",
        "data-skin-header": "status",
        "data-skin-sidebar": "right",
        "data-skin-tool": "glyph",
        "data-skin-roles": "labels",
        "data-skin-logo": "rule",
      },
      css: [
        "--skin-radius: 0px;",
        '--skin-header-label: "SMIKCODE";',
        '--skin-tool-marker: "·";',
        "--skin-role-user-color: #b26a00;",
        "--skin-role-assistant-color: #1c1c1c;",
      ],
    },
    {
      id: "smik-workshop",
      mode: "dark" as const,
      attributes: {
        "data-skin-panel": "square",
        "data-skin-fill": "fill",
        "data-skin-divider": "glyph",
        "data-skin-header": "none",
        "data-skin-sidebar": "left",
        "data-skin-tool": "glyph",
        "data-skin-roles": "labels",
        "data-skin-logo": "slab",
      },
      css: ['--skin-divider: "━";', '--skin-role-user-label: "you ▸";', '--skin-tool-marker: "▪";'],
    },
    {
      id: "smik-crt",
      mode: "dark" as const,
      attributes: {
        "data-skin-panel": "double",
        "data-skin-fill": "fill",
        "data-skin-divider": "glyph",
        "data-skin-header": "banner",
        "data-skin-sidebar": "right",
        "data-skin-tool": "tag",
        "data-skin-roles": "labels",
        "data-skin-prompt": "prefix",
        "data-skin-font": "mono",
        "data-skin-logo": "phosphor",
        "data-skin-scanlines": "on",
      },
      css: [
        '--skin-prompt-prefix: "SMIK> ";',
        "--skin-prompt-indent: 6ch;",
        '--skin-tool-tag-ok: "[OK]";',
        '--skin-tool-tag-error: "[ERR]";',
        '--skin-role-user-label: "USER:";',
        '--skin-divider: "▒";',
        "--skin-font: var(--font-family-mono);",
      ],
    },
  ])("$id resolves its spec tokens", async (input) => {
    const skin = resolveSkin(await load(input.id), input.mode)

    expect(skin.attributes).toEqual(input.attributes)
    input.css.forEach((line) => expect(skin.css).toContain(line))
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

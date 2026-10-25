import { expect, test } from "bun:test"
import {
  migrateV1,
  parseThemeDocument,
  resolveSkin,
  resolveThemeDocument,
  themeModes,
  type ThemeDocument,
} from "../src/tui/index.js"
import type { ThemeV1Json } from "../src/tui/v1.js"

const assets = new URL("../../tui/src/theme/assets/", import.meta.url)
const classic = migrateV1((await Bun.file(new URL("opencode.json", assets)).json()) as ThemeV1Json)
const load = async (id: string) => parseThemeDocument(await Bun.file(new URL(`v2/${id}.json`, assets)).json(), id)
const skins: Record<string, ThemeDocument> = {
  "smik-neon": await load("smik-neon"),
  "smik-mono": await load("smik-mono"),
  "smik-workshop": await load("smik-workshop"),
  "smik-crt": await load("smik-crt"),
}

test("a theme without a skin keeps the classic layout", () => {
  expect(resolveSkin(undefined)).toEqual({
    logo: "gradient",
    border: "split",
    panel: "fill",
    divider: "─",
    header: "none",
    turns: "space",
    sidebar: { side: "right", sessions: false },
    role: { user: "", assistant: "" },
    tool: { marker: undefined, status: "icon", case: "none" },
    prompt: { prefix: "", labels: "inline" },
  })
})

test.each(["light", "dark"] as const)("older %s themes derive role and brand colours from existing roles", (mode) => {
  const theme = resolveThemeDocument(classic, mode)
  expect(theme.skin).toEqual(resolveSkin(undefined))
  expect(theme.role.user.equals(theme.text.action.primary.selected)).toBeTrue()
  expect(theme.role.assistant.equals(theme.text.muted)).toBeTrue()
  expect(theme.brand.start.equals(theme.text.muted)).toBeTrue()
  expect(theme.brand.end.equals(theme.text.base)).toBeTrue()
  expect(theme.surface("dialog").role.user.equals(theme.role.user)).toBeTrue()
  expect(theme.surface("dialog").skin).toBe(theme.skin)
})

test("every SmikCode skin resolves in each of its modes", () => {
  expect(themeModes(skins["smik-neon"]!)).toEqual(["dark"])
  expect(themeModes(skins["smik-mono"]!)).toEqual(["light", "dark"])
  expect(themeModes(skins["smik-workshop"]!)).toEqual(["light", "dark"])
  expect(themeModes(skins["smik-crt"]!)).toEqual(["dark"])
  for (const document of Object.values(skins)) {
    for (const mode of themeModes(document)) {
      const theme = resolveThemeDocument(document, mode)
      expect(theme.role.user.equals(theme.role.assistant)).toBeFalse()
      expect(theme.text.base.equals(theme.background.base)).toBeFalse()
    }
  }
})

test("skins carry their layout tokens", () => {
  const skin = (id: string) => resolveThemeDocument(skins[id]!, "dark").skin
  expect(skin("smik-neon")).toMatchObject({
    logo: "gradient",
    border: "rounded",
    role: { user: "◆ you", assistant: "◇ smik" },
    prompt: { labels: "border" },
  })
  expect(skin("smik-mono")).toMatchObject({
    border: "none",
    panel: "flat",
    header: "status",
    turns: "rule",
    role: { user: "you", assistant: "smik" },
    tool: { marker: "·" },
  })
  expect(skin("smik-workshop")).toMatchObject({
    border: "square",
    sidebar: { side: "left", sessions: true },
    role: { user: "you ▸", assistant: "smik ▸" },
    tool: { marker: "▪" },
  })
  expect(skin("smik-crt")).toMatchObject({
    logo: "phosphor",
    border: "double",
    divider: "▒",
    header: "banner",
    role: { user: "USER:", assistant: "SMIK:" },
    tool: { status: "tag", case: "upper" },
    prompt: { prefix: "SMIK> " },
  })
})

test("a mode can override part of the base skin", () => {
  const document = parseThemeDocument({
    ...skins["smik-mono"],
    light: { ...skins["smik-mono"]!.light, skin: { sidebar: { side: "left" } } },
  })
  expect(resolveThemeDocument(document, "light").skin.sidebar).toEqual({ side: "left", sessions: false })
  expect(resolveThemeDocument(document, "dark").skin.sidebar).toEqual({ side: "right", sessions: false })
})

test("rejects unknown skin values", () => {
  expect(() =>
    parseThemeDocument({ ...skins["smik-neon"], base: { ...skins["smik-neon"]!.base, skin: { border: "zigzag" } } }),
  ).toThrow()
})

import { migrateV1, parseThemeDocument, type ThemeDocument, type ModeDefinition } from "@opencode/theme/tui"
import { resolveThemeColors } from "./resolve"
import { DEFAULT_THEMES, type Theme, type ThemeV1Json } from "./v1"
import opencode from "./assets/v2/opencode.json" with { type: "json" }
import opencode2 from "./assets/v2/opencode2.json" with { type: "json" }
import smikNeon from "./assets/v2/smik-neon.json" with { type: "json" }
import smikMono from "./assets/v2/smik-mono.json" with { type: "json" }
import smikWorkshop from "./assets/v2/smik-workshop.json" with { type: "json" }
import smikCrt from "./assets/v2/smik-crt.json" with { type: "json" }

export { DEFAULT_THEMES, type Theme, type ThemeV1Json } from "./v1"

export type ThemeDocumentSource = Record<string, unknown>

/** SmikCode skins in picker order. They are listed before every other theme. */
export const SKINS = [
  { id: "smik-neon", title: "Neon night", source: smikNeon },
  { id: "smik-mono", title: "Mono + amber", source: smikMono },
  { id: "smik-workshop", title: "Warm workshop", source: smikWorkshop },
  { id: "smik-crt", title: "Retro CRT", source: smikCrt },
] as const

export const DEFAULT_THEME = "smik-neon"

const skinSources: Record<string, ThemeDocumentSource> = Object.fromEntries(SKINS.map((skin) => [skin.id, skin.source]))

let customThemes: Record<string, ThemeDocumentSource> = {}
let systemTheme: ThemeDocumentSource | undefined
const listeners = new Set<(themes: Record<string, ThemeDocumentSource>) => void>()
const parsed = new WeakMap<object, ThemeDocument>()
let opencodeTheme: (ThemeDocument & {
  readonly light: ModeDefinition
  readonly dark: ModeDefinition
}) | undefined

export function getOpenCodeTheme() {
  if (opencodeTheme) return opencodeTheme
  const document = parseThemeDocument(opencode, "opencode") as NonNullable<typeof opencodeTheme>
  opencodeTheme = document
  return document
}

let opencode2Theme: ThemeDocument | undefined

// Temporary theme for the "new-designs" experiment. It is not part of allThemes(), so only the
// TUI theme context offers it, and only while the experiment is enabled.
export function getOpenCode2Theme() {
  opencode2Theme ??= parseThemeDocument(opencode2, "opencode2")
  return opencode2Theme
}

function listThemes(): Record<string, ThemeDocumentSource> {
  // Priority: defaults < custom files < generated system. Skins come first so they lead the listing order.
  const themes: Record<string, ThemeDocumentSource> = {
    ...skinSources,
    ...DEFAULT_THEMES,
    opencode: getOpenCodeTheme(),
    ...customThemes,
  }
  return {
    ...themes,
    system: systemTheme ?? themes.system ?? themes.opencode,
  }
}

function syncThemes() {
  const themes = listThemes()
  for (const listener of listeners) listener(themes)
}

export function allThemes() {
  return listThemes()
}

export function isThemeSource(source: unknown): source is ThemeDocumentSource {
  if (typeof source !== "object" || source === null || Array.isArray(source)) return false
  return "theme" in source || "base" in source
}

export function parseTheme(source: ThemeDocumentSource, name = "theme") {
  const cached = parsed.get(source)
  if (cached) return cached

  const document = "theme" in source ? migrateV1(source as ThemeV1Json) : parseThemeDocument(source, name)

  parsed.set(source, document)
  return document
}

export function subscribeThemes(listener: (themes: Record<string, ThemeDocumentSource>) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setCustomThemes(themes: Record<string, unknown>) {
  customThemes = Object.fromEntries(
    Object.entries(themes).filter((entry): entry is [string, ThemeDocumentSource] => isThemeSource(entry[1])),
  )
  syncThemes()
}

export function setSystemTheme(theme: ThemeDocumentSource | undefined) {
  systemTheme = theme
  syncThemes()
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function resolveTheme(theme: ThemeV1Json, mode: "dark" | "light"): Theme {
  const resolved = resolveThemeColors(theme, mode)
  return {
    ...resolved.theme,
    _hasSelectedListItemText: resolved.hasSelectedListItemText,
    thinkingOpacity: resolved.thinkingOpacity,
  }
}

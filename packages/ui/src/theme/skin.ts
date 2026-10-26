import type { DesktopTheme, ThemeSkinColors } from "./types"

/** SmikCode skins, in the order they are listed everywhere themes are listed. */
export const SKIN_THEME_IDS = ["hackerman", "smik-neon", "smik-mono", "smik-workshop", "smik-crt"] as const

export const DEFAULT_THEME_ID = "hackerman"

/** Every attribute a skin may set on <html>, so switching themes can clear stale ones. */
export const SKIN_ATTRIBUTES = [
  "data-skin-panel",
  "data-skin-fill",
  "data-skin-divider",
  "data-skin-header",
  "data-skin-sidebar",
  "data-skin-tool",
  "data-skin-roles",
  "data-skin-prompt",
  "data-skin-font",
  "data-skin-logo",
  "data-skin-scanlines",
] as const

export type SkinAttribute = (typeof SKIN_ATTRIBUTES)[number]

export type SkinAttributes = Partial<Record<SkinAttribute, string>>

const defaultColors: ThemeSkinColors = {
  roleUser: "var(--v2-text-text-base)",
  roleAssistant: "var(--v2-text-text-muted)",
  brandStart: "var(--v2-text-text-base)",
  brandEnd: "var(--v2-text-text-accent)",
}

/**
 * Resolves a theme's skin into CSS custom properties for one mode plus the `data-skin-*` attributes for <html>.
 * Themes without a skin get empty labels and no attributes, so the attribute-scoped skin rules never apply.
 */
export function resolveSkin(theme: DesktopTheme, mode: "light" | "dark") {
  const skin = theme.skin
  const colors = (mode === "dark" ? theme.dark : theme.light).skinColors ?? defaultColors
  const tool = skin?.tool

  const vars = {
    "skin-radius": skin?.radius === undefined ? "var(--radius-lg)" : `${skin.radius}px`,
    "skin-divider": quote(skin?.divider),
    // CSS cannot repeat a string, so rules are drawn from a long run of the glyph clipped to the line's width.
    "skin-divider-rule": quote(skin?.divider?.repeat(240)),
    "skin-header-label": quote(skin?.headerLabel),
    "skin-role-user-label": quote(skin?.roleLabels?.user),
    "skin-role-assistant-label": quote(skin?.roleLabels?.assistant),
    "skin-role-user-color": colors.roleUser,
    "skin-role-assistant-color": colors.roleAssistant,
    "skin-brand-start": colors.brandStart,
    "skin-brand-end": colors.brandEnd,
    "skin-tool-marker": quote(tool?.style === "glyph" ? tool.marker : undefined),
    "skin-tool-tag-ok": quote(tool?.style === "tag" ? tool.ok : undefined),
    "skin-tool-tag-error": quote(tool?.style === "tag" ? tool.error : undefined),
    "skin-tool-tag-running": quote(tool?.style === "tag" ? tool.running : undefined),
    "skin-prompt-prefix": quote(skin?.promptPrefix),
    "skin-prompt-indent": `${[...(skin?.promptPrefix ?? "")].length}ch`,
    "skin-font": skin?.font === "mono" ? "var(--font-family-mono)" : "var(--font-family-sans)",
  }

  const prompt = [skin?.promptLabels ? "labels" : undefined, skin?.promptPrefix ? "prefix" : undefined]
    .filter((value) => value !== undefined)
    .join(" ")

  const attributes: SkinAttributes = Object.fromEntries(
    Object.entries({
      "data-skin-panel": skin?.panelBorder,
      "data-skin-fill": skin?.panelFill,
      "data-skin-divider": skin?.divider ? "glyph" : undefined,
      "data-skin-header": skin?.header,
      "data-skin-sidebar": skin?.sidebar,
      "data-skin-tool": tool?.style,
      "data-skin-roles": skin?.roleLabels ? "labels" : undefined,
      "data-skin-prompt": prompt || undefined,
      "data-skin-font": skin?.font === "mono" ? "mono" : undefined,
      "data-skin-logo": skin?.logo,
      "data-skin-scanlines": skin?.scanlines ? "on" : undefined,
    }).filter((entry): entry is [SkinAttribute, string] => entry[1] !== undefined),
  )

  return {
    css: Object.entries(vars)
      .map(([key, value]) => `--${key}: ${value};`)
      .join("\n  "),
    attributes,
  }
}

/** Sets the skin attributes on an element and removes the ones the skin does not use. */
export function applySkinAttributes(element: Element, attributes: SkinAttributes) {
  SKIN_ATTRIBUTES.forEach((name) => {
    const value = attributes[name]

    if (value === undefined) return element.removeAttribute(name)
    element.setAttribute(name, value)
  })
}

function quote(value: string | undefined) {
  return `"${(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}"`
}

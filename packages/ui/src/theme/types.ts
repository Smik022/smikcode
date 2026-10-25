export type HexColor = `#${string}`

export interface OklchColor {
  l: number // Lightness 0-1
  c: number // Chroma 0-0.4+
  h: number // Hue 0-360
}

export interface ThemeSeedColors {
  neutral: HexColor
  primary: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd: HexColor
  diffDelete: HexColor
}

export interface ThemePaletteColors {
  neutral: HexColor
  ink: HexColor
  primary: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  accent?: HexColor
  interactive?: HexColor
  diffAdd?: HexColor
  diffDelete?: HexColor
}

/** Mode-specific colours for skin chrome: role labels and the logo gradient. */
export interface ThemeSkinColors {
  roleUser: ColorValue
  roleAssistant: ColorValue
  brandStart: ColorValue
  brandEnd: ColorValue
}

type ThemeVariantBase = {
  overrides?: Record<string, ColorValue>
  v2Overrides?: Record<string, V2ColorValue>
  skinColors?: ThemeSkinColors
}

export type ThemeVariant =
  | ({ seeds: ThemeSeedColors; palette?: never } & ThemeVariantBase)
  | ({ palette: ThemePaletteColors; seeds?: never } & ThemeVariantBase)

export type SkinPanelBorder = "rounded" | "none" | "square" | "double"

export type SkinPanelFill = "fill" | "flat"

export type SkinHeader = "none" | "status" | "banner"

export type SkinSidebar = "left" | "right"

export type SkinLogo = "gradient" | "rule" | "slab" | "phosphor"

export type SkinFont = "default" | "mono"

export type SkinTool =
  | { style: "icons" }
  | { style: "glyph"; marker: string }
  | { style: "tag"; ok: string; error: string; running: string }

/** Non-colour layout tokens. A theme without `skin` keeps the upstream layout. */
export interface ThemeSkin {
  /** Panel corner radius in px. */
  radius?: number
  panelBorder?: SkinPanelBorder
  panelFill?: SkinPanelFill
  divider?: string
  header?: SkinHeader
  /** Brand text drawn at the start of the status strip or banner. */
  headerLabel?: string
  sidebar?: SkinSidebar
  roleLabels?: { user: string; assistant: string }
  tool?: SkinTool
  promptPrefix?: string
  /** Agent name at the top-left and model at the top-right of the prompt frame. */
  promptLabels?: boolean
  logo?: SkinLogo
  font?: SkinFont
  scanlines?: boolean
}

export interface DesktopTheme {
  $schema?: string
  name: string
  id: string
  light: ThemeVariant
  dark: ThemeVariant
  /** The theme only has a dark look: the dark variant is applied whatever the colour scheme. */
  darkOnly?: boolean
  skin?: ThemeSkin
}

export type TokenCategory =
  | "background"
  | "surface"
  | "text"
  | "border"
  | "icon"
  | "input"
  | "button"
  | "syntax"
  | "markdown"
  | "diff"
  | "avatar"

export type ThemeToken = string

export type CssVarRef = `var(--${string})`

export type ColorValue = HexColor | CssVarRef

export type V2ColorValue = HexColor | CssVarRef | string

export type ResolvedTheme = Record<ThemeToken, ColorValue>

export type ResolvedV2Theme = Record<string, V2ColorValue>

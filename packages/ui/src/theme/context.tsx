// @refresh reload

import { createEffect, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createSimpleContext } from "../context/helper"
import neonThemeJson from "./themes/smik-neon.json"
import { resolveThemeVariant, themeToCss } from "./resolve"
import { applySkinAttributes, DEFAULT_THEME_ID, resolveSkin, SKIN_THEME_IDS } from "./skin"
import { resolveThemeVariantV2, themeV2ToCss } from "./v2/resolve"
import type { DesktopTheme } from "./types"

export type ColorScheme = "light" | "dark" | "system"

const STORAGE_KEYS = {
  THEME_ID: "opencode-theme-id",
  COLOR_SCHEME: "opencode-color-scheme",
  THEME_CSS_LIGHT: "opencode-theme-css-light",
  THEME_CSS_DARK: "opencode-theme-css-dark",
  THEME_ATTRIBUTES: "opencode-theme-attributes",
} as const

const THEME_STYLE_ID = "oc-theme"

let files: Record<string, () => Promise<{ default: DesktopTheme }>> | undefined

let ids: string[] | undefined

let known: Set<string> | undefined

function getFiles() {
  if (files) return files
  files = import.meta.glob<{ default: DesktopTheme }>("./themes/*.json")

  return files
}

function themeIDs() {
  if (ids) return ids
  const skins: readonly string[] = SKIN_THEME_IDS
  const files = Object.keys(getFiles()).map((path) => path.slice("./themes/".length, -".json".length))
  ids = [...skins.filter((id) => files.includes(id)), ...files.filter((id) => !skins.includes(id)).sort()]

  return ids
}

function knownThemes() {
  if (known) return known
  known = new Set(themeIDs())

  return known
}

const names: Record<string, string> = {
  "smik-neon": "Neon night",
  "smik-mono": "Mono + amber",
  "smik-workshop": "Warm workshop",
  "smik-crt": "Retro CRT",
  "oc-2": "OpenCode",
  amoled: "AMOLED",
  aura: "Aura",
  ayu: "Ayu",
  carbonfox: "Carbonfox",
  catppuccin: "Catppuccin",
  "catppuccin-frappe": "Catppuccin Frappe",
  "catppuccin-macchiato": "Catppuccin Macchiato",
  cobalt2: "Cobalt2",
  cursor: "Cursor",
  dracula: "Dracula",
  everforest: "Everforest",
  flexoki: "Flexoki",
  github: "GitHub",
  gruvbox: "Gruvbox",
  kanagawa: "Kanagawa",
  "lucent-orng": "Lucent Orng",
  material: "Material",
  matrix: "Matrix",
  mercury: "Mercury",
  monokai: "Monokai",
  nightowl: "Night Owl",
  nord: "Nord",
  "one-dark": "One Dark",
  onedarkpro: "One Dark Pro",
  orng: "Orng",
  "osaka-jade": "Osaka Jade",
  palenight: "Palenight",
  rosepine: "Rose Pine",
  shadesofpurple: "Shades of Purple",
  solarized: "Solarized",
  synthwave84: "Synthwave '84",
  tokyonight: "Tokyonight",
  vercel: "Vercel",
  vesper: "Vesper",
  zenburn: "Zenburn",
}

const defaultTheme = neonThemeJson as DesktopTheme

function resolveStoredTheme(id: string | null | undefined, registered?: Record<string, DesktopTheme>) {
  if (id === DEFAULT_THEME_ID || (id && (knownThemes().has(id) || registered?.[id]))) return id

  return DEFAULT_THEME_ID
}

function read(key: string) {
  if (typeof localStorage !== "object") return null

  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  if (typeof localStorage !== "object") return

  try {
    localStorage.setItem(key, value)
  } catch {}
}

function drop(key: string) {
  if (typeof localStorage !== "object") return

  try {
    localStorage.removeItem(key)
  } catch {}
}

function clear() {
  drop(STORAGE_KEYS.THEME_CSS_LIGHT)
  drop(STORAGE_KEYS.THEME_CSS_DARK)
  drop(STORAGE_KEYS.THEME_ATTRIBUTES)
}

function ensureThemeStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null

  if (existing) return existing
  const element = document.createElement("style")
  element.id = THEME_STYLE_ID
  document.head.appendChild(element)

  return element
}

function getSystemMode(): "light" | "dark" {
  if (typeof window !== "object") return "light"

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function themeMode(theme: DesktopTheme | undefined, mode: "light" | "dark") {
  if (theme?.darkOnly) return "dark"

  return theme?.lightOnly ? "light" : mode
}

function themeCss(theme: DesktopTheme, mode: "light" | "dark") {
  const isDark = mode === "dark"
  const variant = isDark ? theme.dark : theme.light

  return [
    themeToCss(resolveThemeVariant(variant, isDark)),
    themeV2ToCss(resolveThemeVariantV2(variant, isDark)),
    resolveSkin(theme, mode).css,
  ].join("\n  ")
}

function applyThemeCss(theme: DesktopTheme, themeId: string, mode: "light" | "dark") {
  const isDark = mode === "dark"

  const fullCss = `:root {
  color-scheme: ${mode};
  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
  ${themeCss(theme, mode)}
}`

  document.getElementById("oc-theme-preload")?.remove()
  ensureThemeStyleElement().textContent = fullCss
  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  applySkinAttributes(document.documentElement, resolveSkin(theme, mode).attributes)
  document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  // Update theme-color meta tag to match light/dark mode
  const meta = document.querySelector('meta[name="theme-color"]')

  if (meta) meta.setAttribute("content", isDark ? "#080808" : "#fafafa")
}

// packages/app/public/oc-theme-preload.js paints these before the app script runs. Previews are not cached.
function cacheThemeVariants(theme: DesktopTheme) {
  write(STORAGE_KEYS.THEME_CSS_LIGHT, themeCss(theme, themeMode(theme, "light")))
  write(STORAGE_KEYS.THEME_CSS_DARK, themeCss(theme, themeMode(theme, "dark")))
  write(
    STORAGE_KEYS.THEME_ATTRIBUTES,
    JSON.stringify({
      ...resolveSkin(theme, "dark").attributes,
      ...(theme.darkOnly ? { "data-color-scheme": "dark" } : {}),
      ...(theme.lightOnly ? { "data-color-scheme": "light" } : {}),
    }),
  )
}

export const { use: useTheme, provider: ThemeProvider } = createSimpleContext({
  name: "Theme",
  init: (props: {
    defaultTheme?: string
    onThemeApplied?: (theme: DesktopTheme, mode: "light" | "dark", scheme: ColorScheme) => void
  }) => {
    const rawTheme = read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme
    const themeId = resolveStoredTheme(rawTheme)

    if (rawTheme && rawTheme !== themeId) {
      write(STORAGE_KEYS.THEME_ID, themeId)
      clear()
    }

    const colorScheme = (read(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null) ?? "system"
    const mode = colorScheme === "system" ? getSystemMode() : colorScheme

    const [store, setStore] = createStore({
      themes: {
        [DEFAULT_THEME_ID]: defaultTheme,
      } as Record<string, DesktopTheme>,
      themeId,
      colorScheme,
      mode,
      previewThemeId: null as string | null,
      previewScheme: null as ColorScheme | null,
    })

    const loads = new Map<string, Promise<DesktopTheme | undefined>>()

    const load = (id: string) => {
      const next = id

      if (!next) return Promise.resolve(undefined)
      const hit = store.themes[next]

      if (hit) return Promise.resolve(hit)
      const pending = loads.get(next)

      if (pending) return pending
      const file = getFiles()[`./themes/${next}.json`]

      if (!file) return Promise.resolve(undefined)

      const task = file()
        .then((mod) => {
          const theme = mod.default
          setStore("themes", next, theme)

          return theme
        })
        .finally(() => {
          loads.delete(next)
        })

      loads.set(next, task)

      return task
    }

    const applyTheme = (theme: DesktopTheme, themeId: string, mode: "light" | "dark", scheme: ColorScheme) => {
      applyThemeCss(theme, themeId, themeMode(theme, mode))
      props.onThemeApplied?.(theme, themeMode(theme, mode), scheme)
    }

    const ids = () => {
      const extra = Object.keys(store.themes)
        .filter((id) => !knownThemes().has(id))
        .sort()

      const all = themeIDs()

      if (extra.length === 0) return all

      return [...all, ...extra]
    }

    const loadThemes = () => Promise.all(themeIDs().map(load)).then(() => store.themes)

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.THEME_ID && e.newValue) {
        const next = resolveStoredTheme(e.newValue, store.themes)

        if (next !== e.newValue) {
          write(STORAGE_KEYS.THEME_ID, next)
          clear()
        }

        setStore("themeId", next)

        void load(next).then((theme) => {
          if (!theme || store.themeId !== next) return
          cacheThemeVariants(theme)
        })
      }

      if (e.key === STORAGE_KEYS.COLOR_SCHEME && e.newValue) {
        setStore("colorScheme", e.newValue as ColorScheme)
        setStore("mode", e.newValue === "system" ? getSystemMode() : (e.newValue as "light" | "dark"))
      }
    }

    onMount(() => {
      makeEventListener(window, "storage", onStorage)

      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")

      const onMedia = () => {
        if (store.colorScheme !== "system") return
        setStore("mode", getSystemMode())
      }

      makeEventListener(mediaQuery, "change", onMedia)

      const rawTheme = read(STORAGE_KEYS.THEME_ID) ?? props.defaultTheme
      const savedTheme = resolveStoredTheme(rawTheme, store.themes)
      const savedScheme = (read(STORAGE_KEYS.COLOR_SCHEME) as ColorScheme | null) ?? "system"

      if (rawTheme && rawTheme !== savedTheme) {
        write(STORAGE_KEYS.THEME_ID, savedTheme)
        clear()
      }

      if (savedTheme !== store.themeId) setStore("themeId", savedTheme)

      if (savedScheme !== store.colorScheme) setStore("colorScheme", savedScheme)
      setStore("mode", savedScheme === "system" ? getSystemMode() : savedScheme)
      void load(savedTheme).then((theme) => {
        if (!theme || store.themeId !== savedTheme) return
        cacheThemeVariants(theme)
      })
    })

    createEffect(() => {
      const theme = store.themes[store.themeId]

      if (!theme) return
      applyTheme(theme, store.themeId, store.mode, store.colorScheme)
    })

    const setTheme = (id: string) => {
      const next = id

      if (!next) {
        console.warn(`Theme "${id}" not found`)

        return
      }

      if (!knownThemes().has(next) && !store.themes[next]) {
        console.warn(`Theme "${id}" not found`)

        return
      }

      setStore("themeId", next)

      void load(next).then((theme) => {
        if (!theme || store.themeId !== next) return
        cacheThemeVariants(theme)
        write(STORAGE_KEYS.THEME_ID, next)
      })
    }

    const setColorScheme = (scheme: ColorScheme) => {
      setStore("colorScheme", scheme)
      write(STORAGE_KEYS.COLOR_SCHEME, scheme)
      setStore("mode", scheme === "system" ? getSystemMode() : scheme)
    }

    return {
      themeId: () => store.themeId,
      colorScheme: () => store.colorScheme,
      mode: () => themeMode(store.themes[store.themeId], store.mode),
      ids,
      name: (id: string) => store.themes[id]?.name ?? names[id] ?? id,
      loadThemes,
      themes: () => store.themes,
      setTheme,
      setColorScheme,
      registerTheme: (theme: DesktopTheme) => setStore("themes", theme.id, theme),
      previewTheme: (id: string) => {
        const next = id

        if (!next) return

        if (!knownThemes().has(next) && !store.themes[next]) return
        setStore("previewThemeId", next)
        void load(next).then((theme) => {
          if (!theme || store.previewThemeId !== next) return

          const mode = store.previewScheme
            ? store.previewScheme === "system"
              ? getSystemMode()
              : store.previewScheme
            : store.mode

          applyTheme(theme, next, mode, store.previewScheme ?? store.colorScheme)
        })
      },
      previewColorScheme: (scheme: ColorScheme) => {
        setStore("previewScheme", scheme)
        const mode = scheme === "system" ? getSystemMode() : scheme
        const id = store.previewThemeId ?? store.themeId
        void load(id).then((theme) => {
          if (!theme) return

          if ((store.previewThemeId ?? store.themeId) !== id) return

          if (store.previewScheme !== scheme) return
          applyTheme(theme, id, mode, scheme)
        })
      },
      commitPreview: () => {
        if (store.previewThemeId) {
          setTheme(store.previewThemeId)
        }

        if (store.previewScheme) {
          setColorScheme(store.previewScheme)
        }

        setStore("previewThemeId", null)
        setStore("previewScheme", null)
      },
      cancelPreview: () => {
        setStore("previewThemeId", null)
        setStore("previewScheme", null)
        void load(store.themeId).then((theme) => {
          if (!theme) return
          applyTheme(theme, store.themeId, store.mode, store.colorScheme)
        })
      },
    }
  },
})

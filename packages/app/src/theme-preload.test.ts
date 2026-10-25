import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/oc-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

const setSystemDark = (matches: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches }) as MediaQueryList,
    configurable: true,
  })

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.getAttributeNames().forEach((name) => document.documentElement.removeAttribute(name))
  localStorage.clear()
  setSystemDark(false)
})

describe("theme preload", () => {
  test.each([
    { stored: undefined, systemDark: false, scheme: "light", background: "#fafafa" },
    { stored: "dark", systemDark: false, scheme: "dark", background: "#080808" },
    { stored: "light", systemDark: true, scheme: "light", background: "#fafafa" },
    { stored: "system", systemDark: true, scheme: "dark", background: "#080808" },
  ])(
    "paints the default theme in $scheme for stored scheme $stored (system dark: $systemDark)",
    ({ stored, systemDark, scheme, background }) => {
      setSystemDark(systemDark)

      if (stored) localStorage.setItem("opencode-color-scheme", stored)
      run()

      expect(document.documentElement.dataset.theme).toBe("smik-neon")
      expect(document.documentElement.dataset.colorScheme).toBe(scheme)
      expect(document.documentElement.style.backgroundColor).toBe(background)
    },
  )

  test.each([
    { scheme: undefined, key: "opencode-theme-css-light", css: "--background-base:#fff;", expected: "light" },
    { scheme: "dark", key: "opencode-theme-css-dark", css: "--background-base:#010203;", expected: "dark" },
  ])("restores the cached $expected css of a custom theme", ({ scheme, key, css, expected }) => {
    localStorage.setItem("opencode-theme-id", "nightowl")

    if (scheme) localStorage.setItem("opencode-color-scheme", scheme)
    localStorage.setItem(key, css)
    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(document.documentElement.dataset.colorScheme).toBe(expected)
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain(css)
  })

  test("restores cached skin attributes and keeps a dark-only skin dark in light mode", () => {
    localStorage.setItem("opencode-theme-id", "smik-crt")
    localStorage.setItem("opencode-color-scheme", "light")
    localStorage.setItem("opencode-theme-css-dark", '--skin-prompt-prefix:"SMIK> ";')
    localStorage.setItem(
      "opencode-theme-attributes",
      JSON.stringify({ "data-skin-header": "banner", "data-skin-tool": "tag", "data-color-scheme": "dark" }),
    )
    run()

    expect(document.documentElement.getAttribute("data-skin-header")).toBe("banner")
    expect(document.documentElement.getAttribute("data-skin-tool")).toBe("tag")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.getElementById("oc-theme-preload")?.textContent).toContain('--skin-prompt-prefix:"SMIK> ";')
  })
})

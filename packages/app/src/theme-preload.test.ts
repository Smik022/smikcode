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
  test("paints the dark-only default theme in dark on a first launch, even when the system and stored scheme are light", () => {
    setSystemDark(false)
    localStorage.setItem("opencode-color-scheme", "light")
    run()

    expect(document.documentElement.dataset.theme).toBe("hackerman")
    expect(document.documentElement.dataset.colorScheme).toBe("dark")
    expect(document.documentElement.style.backgroundColor).toBe("#080808")
  })

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

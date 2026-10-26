;(function () {
  var key = "opencode-theme-id"
  var storedThemeId = localStorage.getItem(key)
  // The default theme (Hackerman) is dark-only, so a first launch with no saved theme is dark even on a light system.
  var themeId = storedThemeId || "hackerman"
  var root = document.documentElement

  // data-skin-* layout attributes (and a forced data-color-scheme for dark-only themes) cached by the theme provider.
  var attributes = {}
  try {
    attributes = JSON.parse(localStorage.getItem("opencode-theme-attributes") || "{}") || {}
  } catch (error) {}

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var forced = attributes["data-color-scheme"]
  var isDark = forced
    ? forced === "dark"
    : !storedThemeId || scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  Object.keys(attributes).forEach(function (name) {
    if (name.indexOf("data-skin-") === 0) root.setAttribute(name, String(attributes[name]))
  })
  root.dataset.theme = themeId
  root.dataset.colorScheme = mode
  root.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa")

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()

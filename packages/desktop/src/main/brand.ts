// SmikCode's desktop identity. Electron-free so pure modules and their tests can import it. The desktop
// package does not depend on @opencode/util, so these mirror Brand.app and the deep-link scheme there.

/** Deep-link scheme. Kept apart from upstream's opencode:// so SmikCode never claims links meant for an installed OpenCode. */
export const PROTOCOL = "smikcode"

/** Directory the CLI's global paths live in (Brand.app); in isolated dev mode it sits under the app's userData. */
export const APP_DIRECTORY = "smikcode"

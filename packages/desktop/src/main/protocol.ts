// SmikCode's deep-link scheme. Kept apart from upstream's opencode:// so SmikCode never
// claims links meant for an installed OpenCode desktop app. Electron-free so it can be
// imported from pure modules and their tests.
export const PROTOCOL = "smikcode"

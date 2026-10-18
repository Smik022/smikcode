// SmikCode's user-facing identity. Internal package names (`@opencode/*`) and
// OPENCODE_* environment variables stay as upstream so upstream merges keep working;
// SMIKCODE_* variables are aliased onto them at CLI startup.
export const Brand = {
  name: "SmikCode",
  command: "smikcode",
  /** Directory name under the XDG data/config/state/cache roots. */
  app: "smikcode",
  envPrefix: "SMIKCODE_",
  /** Project config file names, highest priority last. */
  configFiles: ["smikcode.json", "smikcode.jsonc"],
  /** Project config directory. */
  configDirectory: ".smikcode",
  repository: "https://github.com/Smik022/smikcode",
  issues: "https://github.com/Smik022/smikcode/issues/new",
} as const

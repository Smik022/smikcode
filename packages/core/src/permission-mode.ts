export * as PermissionMode from "./permission-mode.js"

import type { SessionMetadata } from "@opencode/schema/session-metadata"

export const Modes = ["default", "edits", "auto"] as const
export type Mode = (typeof Modes)[number]

/** Session metadata key holding the mode. Absent means `default`. */
export const KEY = "permission_mode"

const aliases: Record<string, Mode> = {
  default: "default",
  normal: "default",
  ask: "default",
  edits: "edits",
  "accept-edits": "edits",
  acceptedits: "edits",
  auto: "auto",
  bypass: "auto",
  yolo: "auto",
}

export const descriptions: Record<Mode, string> = {
  default: "Ask before edits, commands and other protected actions.",
  edits: "File edits are approved automatically. Commands and other actions still ask.",
  auto: "Everything that is not denied by a rule is approved automatically.",
}

export function parse(text: string): Mode | undefined {
  const key = text.trim().toLowerCase()
  return Object.hasOwn(aliases, key) ? aliases[key] : undefined
}

export function read(metadata: SessionMetadata | undefined): Mode {
  const value = metadata?.[KEY]
  return Modes.find((mode) => mode === value) ?? "default"
}

/**
 * Whether a mode approves an action that would otherwise ask. A mode never overrides a deny rule: it is
 * applied only to requests that reach `ask`, so Plan mode stays read-only.
 */
export function approves(mode: Mode, action: string) {
  return mode === "auto" || (mode === "edits" && action === "edit")
}

export function write(metadata: SessionMetadata | undefined, mode: Mode): SessionMetadata {
  const rest = Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => key !== KEY))
  return mode === "default" ? rest : { ...rest, [KEY]: mode }
}

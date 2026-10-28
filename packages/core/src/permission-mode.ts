export * as PermissionMode from "./permission-mode.js"

import { PermissionMode as Stored, type Mode } from "@opencode/schema/permission-mode"

export type { Mode }
export const Modes = Stored.Modes
// The stored form is shared with clients that show and change the mode.
export const read = Stored.read
export const write = Stored.write

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
  default: "Follow the permission rules. SmikCode asks only where a rule says to ask.",
  edits: "File edits are approved automatically. Other actions follow the permission rules.",
  auto: "Everything a rule says to ask about is approved automatically. Deny rules still apply.",
}

export function parse(text: string): Mode | undefined {
  const key = text.trim().toLowerCase()
  return Object.hasOwn(aliases, key) ? aliases[key] : undefined
}

/**
 * Whether a mode approves an action that would otherwise ask. A mode never overrides a deny rule: it is
 * applied only to requests that reach `ask`, so Plan mode stays read-only.
 */
export function approves(mode: Mode, action: string) {
  return mode === "auto" || (mode === "edits" && action === "edit")
}

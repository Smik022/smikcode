export * as PermissionMode from "./permission-mode.js"

export const Modes = ["default", "edits", "auto"] as const
export type Mode = (typeof Modes)[number]

/** Session metadata key holding the mode. Absent means `default`. */
export const KEY = "permission_mode"

// Generic over the value type so callers keep their own JSON typing (schema and generated client types differ).
export function read(metadata: Readonly<Record<string, unknown>> | undefined): Mode {
  const value = metadata?.[KEY]
  return Modes.find((mode) => mode === value) ?? "default"
}

/** The metadata with the mode set; `default` removes the key. Other metadata is kept. */
export function write<T>(metadata: Readonly<Record<string, T>> | undefined, mode: Mode): Record<string, T | string> {
  const rest: Record<string, T | string> = Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key]) => key !== KEY),
  )
  return mode === "default" ? rest : { ...rest, [KEY]: mode }
}

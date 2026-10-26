export * as Memory from "./memory.js"

import path from "path"

export const Scopes = ["user", "project"] as const
export type Scope = (typeof Scopes)[number]

const HEADER = "# Memory\n\nFacts SmikCode was asked to remember. One per line; edit freely.\n\n"

/** User memory sits beside the global AGENTS.md; project memory stays out of the repository. */
export function file(
  input: { readonly config: string; readonly data: string; readonly projectID: string },
  scope: Scope,
) {
  return scope === "user"
    ? path.join(input.config, "memory.md")
    : path.join(input.data, "memory", `${input.projectID}.md`)
}

/** Appends one bullet, ignoring a fact that is already stored. */
export function add(content: string | undefined, fact: string) {
  const line = `- ${fact.trim().replace(/\s*\n\s*/g, " ")}`
  const current = content ?? HEADER
  if (current.split("\n").some((item) => item.trim().toLowerCase() === line.toLowerCase()))
    return { content: current, added: false }
  return { content: `${current.endsWith("\n") ? current : `${current}\n`}${line}\n`, added: true }
}

/** Removes every bullet that contains `match`. Headings and free text the user wrote are left alone. */
export function remove(content: string, match: string) {
  const needle = match.trim().toLowerCase()
  const lines = content.split("\n")
  const removed = lines.filter((line) => line.startsWith("- ") && line.toLowerCase().includes(needle))
  return {
    content: lines.filter((line) => !removed.includes(line)).join("\n"),
    removed: removed.map((line) => line.slice(2)),
  }
}

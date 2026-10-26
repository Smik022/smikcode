import { describe, expect, test } from "bun:test"
import path from "path"
import { Memory } from "../src/memory"

describe("Memory", () => {
  test("keeps user memory beside the global config and project memory in the data directory", () => {
    const input = { config: "/cfg", data: "/data", projectID: "prj_1" }
    expect(Memory.file(input, "user")).toBe(path.join("/cfg", "memory.md"))
    expect(Memory.file(input, "project")).toBe(path.join("/data", "memory", "prj_1.md"))
  })

  test("starts a new file with a heading and appends one bullet per fact", () => {
    const first = Memory.add(undefined, "Use pnpm")
    expect(first.added).toBe(true)
    expect(first.content).toStartWith("# Memory")
    expect(first.content).toEndWith("- Use pnpm\n")
    expect(Memory.add(first.content, "Tabs, not spaces").content).toEndWith("- Use pnpm\n- Tabs, not spaces\n")
  })

  test("collapses line breaks and ignores a fact that is already stored", () => {
    const first = Memory.add(undefined, "line one\nline two")
    expect(first.content).toContain("- line one line two\n")
    const again = Memory.add(first.content, "LINE ONE line two")
    expect(again.added).toBe(false)
    expect(again.content).toBe(first.content)
  })

  test("removes only bullets that contain the phrase", () => {
    const content = "# Memory\n\nnotes the user wrote about pnpm\n- Use pnpm for installs\n- Run tests with bun\n"
    const result = Memory.remove(content, "PNPM")
    expect(result.removed).toEqual(["Use pnpm for installs"])
    expect(result.content).toContain("notes the user wrote about pnpm")
    expect(result.content).toContain("- Run tests with bun")
    expect(result.content).not.toContain("Use pnpm for installs")
  })
})

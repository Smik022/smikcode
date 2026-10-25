import type { SkinLogo } from "@opencode/theme/tui"

// SmikCode pixel letters. `#` is a lit pixel; every letter is 7 pixels tall. The web wordmark draws the same bitmaps.
const letters: Record<string, readonly string[]> = {
  S: [".#####", "##....", "##....", ".####.", "....##", "....##", "#####."],
  M: ["##...##", "###.###", "##.#.##", "##...##", "##...##", "##...##", "##...##"],
  I: ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
  K: ["##..##", "##.##.", "####..", "###...", "####..", "##.##.", "##..##"],
}

// The compact "S" monogram used where the wordmark does not fit.
const monogram = [".####", "##...", ".###.", "...##", "####."]

/** Joins letters with one blank pixel column. */
export function pixels(word: string) {
  const glyphs = [...word].map((char) => letters[char] ?? [])
  return Array.from({ length: 7 }, (_, row) => glyphs.map((glyph) => glyph[row]).join("."))
}

/** Packs two pixel rows into each text row with half blocks, which keeps pixels square in a terminal cell. */
export function halfBlocks(rows: readonly string[]) {
  return Array.from({ length: Math.ceil(rows.length / 2) }, (_, index) => {
    const top = rows[index * 2] ?? ""
    const bottom = rows[index * 2 + 1] ?? ""
    return Array.from(top, (pixel, column) => {
      const lower = bottom[column] === "#"
      if (pixel === "#") return lower ? "█" : "▀"
      return lower ? "▄" : " "
    }).join("")
  })
}

/** One text row per pixel row: tall, condensed letters. */
export function fullBlocks(rows: readonly string[]) {
  return rows.map((row) => row.replaceAll("#", "█").replaceAll(".", " "))
}

export const wordmark = halfBlocks(pixels("SMIK"))
export const mark = halfBlocks(monogram)

/**
 * A logo cell. `ink` is the position along the brand gradient (0 = brand start, 1 = brand end);
 * "shadow" and "rule" are drawn in the skin's shadow and divider colours.
 */
export type LogoCell = { char: string; ink: number | "shadow" | "rule" }

export function logoRows(variant: SkinLogo, divider: string): LogoCell[][] {
  if (variant === "slab")
    return suffix(
      solid(halfBlocks(plate(pixels("SMIK"))), () => 0),
      "code",
    )
  if (variant === "rule") {
    const width = wordmark[0]?.length ?? 0
    return [...solid(wordmark, () => 0), [...line(divider, width - 6), ...text(" code ", 1)]]
  }
  if (variant === "phosphor") return suffix(shade(fullBlocks(pixels("SMIK"))), "CODE")
  const width = wordmark[0]?.length ?? 1
  return suffix(
    solid(wordmark, (column) => column / Math.max(1, width - 1)),
    "code",
  )
}

export function markRows(): LogoCell[][] {
  const width = mark[0]?.length ?? 1
  return solid(mark, (column) => column / Math.max(1, width - 1))
}

// Cuts the letters out of a solid plate with a one-pixel rim, like a stamped workshop badge.
function plate(rows: readonly string[]) {
  const rim = "#".repeat((rows[0]?.length ?? 0) + 2)
  return [rim, ...rows.map((row) => `#${Array.from(row, (pixel) => (pixel === "#" ? "." : "#")).join("")}#`), rim]
}

function solid(rows: readonly string[], ink: (column: number) => number): LogoCell[][] {
  return rows.map((row) => Array.from(row, (char, column) => ({ char, ink: char === " " ? 0 : ink(column) })))
}

// Drops a ▒ shadow one cell down and right of every lit cell, like a phosphor afterglow.
function shade(rows: readonly string[]): LogoCell[][] {
  const width = (rows[0]?.length ?? 0) + 1
  const lit = (row: number, column: number) => (rows[row]?.[column] ?? " ") !== " "
  return Array.from({ length: rows.length + 1 }, (_, row) =>
    Array.from({ length: width }, (_, column): LogoCell => {
      if (lit(row, column)) return { char: rows[row]![column]!, ink: 0 }
      if (lit(row - 1, column - 1)) return { char: "▒", ink: "shadow" }
      return { char: " ", ink: 0 }
    }),
  )
}

// Places a lowercase tag after the letters on the last row, in the brand end colour.
function suffix(rows: LogoCell[][], tag: string): LogoCell[][] {
  if (!tag) return rows
  const width = Math.max(...rows.map((row) => row.length))
  return rows.map((row, index) => [
    ...row,
    ...text(" ".repeat(width - row.length), 0),
    ...(index === rows.length - 1 ? text(` ${tag}`, 1) : text(" ".repeat(tag.length + 1), 0)),
  ])
}

function text(value: string, ink: number): LogoCell[] {
  return Array.from(value, (char) => ({ char, ink }))
}

function line(glyph: string, width: number): LogoCell[] {
  return Array.from({ length: Math.max(0, width) }, () => ({ char: glyph, ink: "rule" as const }))
}

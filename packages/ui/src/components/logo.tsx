import { createUniqueId, type ComponentProps } from "solid-js"

/** Pixel letter bitmaps of the SmikCode mark, `#` = pixel. `SMIK` is 7 rows tall, the smaller `code` 5 rows. */
export const LOGO_GLYPHS = {
  S: [".#####", "##....", "##....", ".####.", "....##", "....##", "#####."],
  M: ["##...##", "###.###", "##.#.##", "##...##", "##...##", "##...##", "##...##"],
  I: ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
  K: ["##..##", "##.##.", "####..", "###...", "####..", "##.##.", "##..##"],
  c: [".###", "#...", "#...", "#...", ".###"],
  o: [".##.", "#..#", "#..#", "#..#", ".##."],
  d: ["...#", ".###", "#..#", "#..#", ".###"],
  e: [".##.", "#..#", "####", "#...", ".###"],
} as const

export type LogoGlyph = keyof typeof LOGO_GLYPHS

/**
 * Where each letter sits in the 77×14 logo box. `SMIK` uses 2-unit pixels with one blank pixel column between
 * letters; `code` uses 1-unit pixels and is bottom-aligned to the right of `SMIK`.
 */
export const LOGO_LAYOUT = [
  { glyph: "S", x: 0, y: 0, size: 2 },
  { glyph: "M", x: 14, y: 0, size: 2 },
  { glyph: "I", x: 30, y: 0, size: 2 },
  { glyph: "K", x: 44, y: 0, size: 2 },
  { glyph: "c", x: 58, y: 9, size: 1 },
  { glyph: "o", x: 63, y: 9, size: 1 },
  { glyph: "d", x: 68, y: 9, size: 1 },
  { glyph: "e", x: 73, y: 9, size: 1 },
] as const satisfies ReadonlyArray<{ glyph: LogoGlyph; x: number; y: number; size: number }>

export const LOGO_WIDTH = 77

export const LOGO_HEIGHT = 14

/** One square subpath per pixel, so outlines and dash animations trace every pixel. */
export function pixelPath(rows: ReadonlyArray<string>, x: number, y: number, size: number) {
  return rows
    .flatMap((row, rowIndex) =>
      [...row].flatMap((cell, column) =>
        cell === "#" ? [`M${x + column * size} ${y + rowIndex * size}h${size}v${size}h-${size}z`] : [],
      ),
    )
    .join("")
}

function layoutPath(size: number) {
  return LOGO_LAYOUT.flatMap((item) =>
    item.size === size ? [pixelPath(LOGO_GLYPHS[item.glyph], item.x, item.y, item.size)] : [],
  ).join("")
}

export const LOGO_SMIK_PATH = layoutPath(2)

export const LOGO_CODE_PATH = layoutPath(1)

const markPath = pixelPath(LOGO_GLYPHS.S, 0, 0, 2)

/** The brand gradient runs from --skin-brand-start to --skin-brand-end across `width` user units. */
export function LogoGradient(props: { id: string; width: number }) {
  return (
    <linearGradient id={props.id} x1="0" y1="0" x2={props.width} y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" style={{ "stop-color": "var(--skin-brand-start, currentColor)" }} />
      <stop offset="1" style={{ "stop-color": "var(--skin-brand-end, currentColor)" }} />
    </linearGradient>
  )
}

/**
 * Paints a logo part with the brand gradient unless a skin's logo treatment (data-skin-logo on <html>) sets
 * --skin-logo-smik / --skin-logo-code.
 */
export function logoFill(gradient: string, part: "smik" | "code") {
  return { fill: `var(--skin-logo-${part}, url(#${gradient}))` }
}

export const Mark = (props: { class?: string }) => {
  const gradient = createUniqueId()

  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 12 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <LogoGradient id={gradient} width={12} />
      </defs>
      <path data-slot="logo-smik" d={markPath} style={logoFill(gradient, "smik")} />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  const gradient = createUniqueId()

  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="-2 -2 16 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <LogoGradient id={gradient} width={12} />
      </defs>
      <path data-slot="logo-smik" d={markPath} style={logoFill(gradient, "smik")} />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  const gradient = createUniqueId()

  return (
    <svg
      data-component="logo"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`}
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <defs>
        <LogoGradient id={gradient} width={LOGO_WIDTH} />
      </defs>
      <path data-slot="logo-smik" d={LOGO_SMIK_PATH} style={logoFill(gradient, "smik")} />
      <path data-slot="logo-code" d={LOGO_CODE_PATH} style={logoFill(gradient, "code")} />
    </svg>
  )
}

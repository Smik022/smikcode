import { createEffect, createUniqueId, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { LOGO_GLYPHS, LOGO_HEIGHT, LOGO_LAYOUT, LOGO_WIDTH, LogoGradient, logoFill, pixelPath } from "@opencode/ui/logo"

const target = LOGO_LAYOUT.map((item): string[] => [...LOGO_GLYPHS[item.glyph]])

// Flips random pixels of a letter; unsettled letters glitch until they lock onto their glyph.
const scramble = (rows: ReadonlyArray<string>) =>
  rows.map((row) => [...row].map((cell) => (Math.random() < 0.35 ? (cell === "#" ? "." : "#") : cell)).join(""))

export function AnimatedWordmark(props: { active: boolean }) {
  const [state, setState] = createStore({ letters: target })
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const gradient = createUniqueId()

  createEffect(
    on(
      () => props.active,
      (active) => {
        timers.forEach(clearTimeout)
        timers.clear()

        if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setState("letters", target)

          return
        }

        const settles = target.map(() => 6 + Math.floor(Math.random() * 8))
        const last = Math.max(...settles)
        setState("letters", target.map(scramble))

        Array.from({ length: last }, (_, index) => index + 1).forEach((tick) => {
          const timer = setTimeout(() => {
            setState(
              "letters",
              target.map((rows, index) => (tick >= settles[index] ? rows : scramble(rows))),
            )
            timers.delete(timer)
          }, tick * 75)

          timers.add(timer)
        })
      },
    ),
  )

  onCleanup(() => timers.forEach(clearTimeout))

  return (
    <svg class="settings-about-wordmark" viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`} aria-hidden="true">
      <defs>
        <LogoGradient id={gradient} width={LOGO_WIDTH} />
      </defs>
      <For each={LOGO_LAYOUT}>
        {(item, index) => (
          <path
            data-slot={item.size === 2 ? "logo-smik" : "logo-code"}
            style={logoFill(gradient, item.size === 2 ? "smik" : "code")}
            d={pixelPath(state.letters[index()], item.x, item.y, item.size)}
          />
        )}
      </For>
    </svg>
  )
}

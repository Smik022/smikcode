import { createMediaQuery } from "@solid-primitives/media"
import { Show } from "solid-js"

export function SessionHeaderSpacer(props: { visible: boolean }) {
  const isDesktop = createMediaQuery("(min-width: 768px)")

  // Skins that dock the side panel on the left keep the review toggle over this header, so they always reserve it.
  return (
    <Show when={isDesktop()}>
      <div
        data-slot="session-header-spacer"
        data-reserved={props.visible ? "" : undefined}
        class="size-7 shrink-0"
        aria-hidden
      />
    </Show>
  )
}

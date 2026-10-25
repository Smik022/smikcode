import { createUniqueId, type ComponentProps } from "solid-js"
import { LOGO_CODE_PATH, LOGO_HEIGHT, LOGO_SMIK_PATH, LOGO_WIDTH, LogoGradient, logoFill } from "../../components/logo"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()
  const gradient = createUniqueId()

  return (
    <svg
      data-component="wordmark"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`}
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill="none"
            stroke={props.outline ? `url(#${gradient})` : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <path
              data-slot="logo-smik"
              pathLength={props.outline ? 1 : undefined}
              d={LOGO_SMIK_PATH}
              style={props.outline ? undefined : logoFill(gradient, "smik")}
            />
            <path
              data-slot="logo-code"
              pathLength={props.outline ? 1 : undefined}
              d={LOGO_CODE_PATH}
              style={props.outline ? undefined : logoFill(gradient, "code")}
            />
          </g>
        </g>
      </g>
      <defs>
        <LogoGradient id={gradient} width={LOGO_WIDTH} />
        <mask
          id={mask}
          style="mask-type:alpha"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={LOGO_WIDTH}
          height={LOGO_HEIGHT}
        >
          <rect width={LOGO_WIDTH} height={LOGO_HEIGHT} fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient
          id={maskGradient}
          x1={LOGO_WIDTH / 2}
          y1={LOGO_HEIGHT * 0.53}
          x2={LOGO_WIDTH / 2}
          y2={LOGO_HEIGHT}
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

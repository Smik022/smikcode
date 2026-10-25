// @ts-nocheck
import * as mod from "./logo"

const docs = `### Overview
Pixel logo assets: mark (pixel S), splash, and logo (pixel SMIK with a smaller code).

Use Mark for compact spaces, Logo for headers, Splash for hero sections.

### API
- \`Mark\`, \`Splash\`, and \`Logo\` components accept standard SVG props.

### Variants and states
- Multiple logo variants for different contexts.

### Behavior
- Pure SVG rendering.

### Accessibility
- Provide title/aria-label when logos convey meaning.

### Theming/tokens
- Filled with a gradient from \`--skin-brand-start\` to \`--skin-brand-end\`.
- Skins restyle the \`logo-smik\` and \`logo-code\` paths through \`data-skin-logo\` on the root element.

`

export default {
  title: "UI/Logo",
  id: "components-logo",
  component: mod.Logo,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => (
    <div style={{ display: "grid", gap: "16px", "align-items": "start" }}>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Mark</div>
        <mod.Mark />
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Splash</div>
        <div style={{ width: "80px", height: "100px" }}>
          <mod.Splash class="size-full" />
        </div>
      </div>
      <div>
        <div style={{ color: "var(--text-weak)", "font-size": "12px" }}>Logo</div>
        <div style={{ width: "200px" }}>
          <mod.Logo class="block w-full" />
        </div>
      </div>
    </div>
  ),
}

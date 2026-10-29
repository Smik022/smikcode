import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, onIdle, SettingsPage, type Setup } from "../sdk"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  const Page = lazy(() => import("./page"))
  // The editor is a sizeable page; load it while idle so Settings opens without a blank page.
  onCleanup(onIdle(() => void Page.preload()))

  ctx.add(SettingsPage, {
    id: "workflows",
    icon: "branch-out",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [{ id: "workflows", title: ctx.t("title"), description: ctx.t("description"), keywords: "workflow stages sdd tdd review harness" }]
    },
    render: () => (
      <Suspense>
        <Page />
      </Suspense>
    ),
  })

  ctx.add(Command, {
    id: "open",
    get title() {
      return ctx.t("command")
    },
    get group() {
      return ctx.t("title")
    },
    run: () => ctx.layout.settings("workflows"),
  })
}

export default setup

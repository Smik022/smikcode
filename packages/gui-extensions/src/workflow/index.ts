import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import en from "./i18n/en"

// How the editor shows a workflow's stages: as cards, or as nodes joined by arrows.
const Editor = Schema.Struct({ view: Schema.Literals(["cards", "flow"]) })

// The editor for the workflows the backend runs. The list, saving and deleting go through the backend's own RPC, so
// only the editor's view is kept here.
export default Extension.define({
  id: "workflow",
  stores: {
    editor: Store.global(Editor, { view: "cards" }, "editor.v1"),
  },
  i18n: { en },
})

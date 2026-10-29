import { Extension } from "../sdk"
import en from "./i18n/en"

// The editor for the workflows the backend runs. The list, saving and deleting go through the backend's own RPC, so
// there is nothing to keep here.
export default Extension.define({
  id: "workflow",
  i18n: { en },
})

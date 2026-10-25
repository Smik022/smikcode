import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useThemes } from "../context/theme"
import { SKINS } from "../theme"
import { useDialog } from "../ui/dialog"
import { onCleanup } from "solid-js"

export function DialogThemeList() {
  const themes = useThemes()
  const skins = SKINS.filter((skin) => themes.has(skin.id)).map((skin) => ({
    title: skin.title,
    value: skin.id as string,
    description: skin.id,
    searchText: `${skin.title} ${skin.id}`,
    category: "SmikCode skins",
  }))
  const options = [
    ...skins,
    ...Object.keys(themes.all())
      .filter((value) => !SKINS.some((skin) => skin.id === value))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((value) => ({
        title: value,
        value: value,
        category: "Themes",
      })),
  ]
  const dialog = useDialog()
  let confirmed = false
  let ref: DialogSelectRef<string>
  const initial = themes.selected

  onCleanup(() => {
    if (!confirmed) themes.set(initial)
  })

  return (
    <DialogSelect
      title="Themes"
      searchInTitle
      titlePlaceholder="Search themes"
      options={options}
      current={initial}
      onMove={(opt) => {
        themes.set(opt.value)
      }}
      onSelect={(opt) => {
        themes.set(opt.value)
        confirmed = true
        dialog.clear()
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          themes.set(initial)
          return
        }

        const first = ref.filtered[0]
        if (first) themes.set(first.value)
      }}
    />
  )
}

// Generates SmikCode's app icons (a pixel "S") for every channel folder in ../icons.
//
// Run it with the Electron binary from packages/desktop, so no image library is needed:
//   <path to electron.exe> scripts/generate-icons.cjs
//
// Each channel gets its own accent so builds are easy to tell apart: prod is green phosphor, beta amber and
// dev cyan. For every existing PNG it rewrites the same size in the right shape, builds icon.ico (Windows) and
// icon.icns (macOS), and refreshes the web favicon. The web app's touch and PWA icons are read from the ios/
// and android/ folders (see packages/app/vite.icons.ts), so those are regenerated too.

const { app, BrowserWindow, nativeImage } = require("electron")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const MASTER = 1024
const ICONS = path.join(__dirname, "..", "icons")

const CHANNELS = {
  prod: { light: "#8dffb8", dark: "#00e65c", glow: "#00ff66", center: "#0d1f12", edge: "#020503" },
  beta: { light: "#ffe27a", dark: "#ffb000", glow: "#ffc533", center: "#1f180a", edge: "#050402" },
  dev: { light: "#8defff", dark: "#00b8d4", glow: "#22e4f0", center: "#0a1c20", edge: "#020405" },
}

// A 5x7 pixel "S".
const GLYPH = ["01111", "10000", "10000", "01110", "00001", "00001", "11110"]
const BLOCK = 96

// full: rounded square. mac: inset for macOS's Big Sur grid. square: full-bleed, for iOS (the system rounds it).
// round: circle, for Android. foreground: just the glyph on transparent, for Android adaptive icons.
function source(colors, mode) {
  const left = (MASTER - GLYPH[0].length * BLOCK) / 2
  const top = (MASTER - GLYPH.length * BLOCK) / 2
  const blocks = GLYPH.flatMap((row, y) =>
    [...row].flatMap((cell, x) =>
      cell === "1"
        ? [
            `<rect x="${left + x * BLOCK + 4}" y="${top + y * BLOCK + 4}" width="${BLOCK - 8}" height="${BLOCK - 8}" rx="10"/>`,
          ]
        : [],
    ),
  )
  const glyph = `
    <g fill="${colors.glow}" opacity=".55" filter="url(#glow)">${blocks.join("")}</g>
    <g fill="url(#ink)">${blocks.join("")}</g>`
  const radius = mode === "square" ? 0 : mode === "round" ? MASTER / 2 : 228
  const background = `
    <rect width="${MASTER}" height="${MASTER}" rx="${radius}" fill="url(#bg)"/>
    <rect x="6" y="6" width="${MASTER - 12}" height="${MASTER - 12}" rx="${Math.max(0, radius - 6)}" fill="none" stroke="${colors.glow}" stroke-opacity=".18" stroke-width="6"/>`
  const inset = (scale) =>
    `<g transform="translate(${(MASTER * (1 - scale)) / 2} ${(MASTER * (1 - scale)) / 2}) scale(${scale})">`
  // Adaptive icons crop to the middle 66%, so the glyph has to sit well inside it.
  const body =
    mode === "foreground"
      ? `${inset(0.62)}${glyph}</g>`
      : mode === "mac"
        ? `${inset(0.8)}${background}${glyph}</g>`
        : `${background}${glyph}`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MASTER}" height="${MASTER}" viewBox="0 0 ${MASTER} ${MASTER}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="${colors.center}"/><stop offset="1" stop-color="${colors.edge}"/></radialGradient>
    <linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${top + GLYPH.length * BLOCK}"><stop offset="0" stop-color="${colors.light}"/><stop offset="1" stop-color="${colors.dark}"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>
  </defs>
  ${body}
</svg>`
}

// Draws the SVG onto a MASTER x MASTER canvas inside the page and returns it as a PNG. A canvas does not depend
// on the window size, which Windows clamps to the screen, so large icons are not cropped.
async function render(window, svg) {
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
  const dataUrl = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image()
    image.src = ${JSON.stringify(url)}
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = ${MASTER}
    canvas.height = ${MASTER}
    canvas.getContext("2d").drawImage(image, 0, 0, ${MASTER}, ${MASTER})
    return canvas.toDataURL("image/png")
  })()`)

  return nativeImage.createFromDataURL(dataUrl)
}

const png = (image, size) => image.resize({ width: size, height: size, quality: "best" }).toPNG()

function ico(image) {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = sizes.map((size) => png(image, size))
  const header = Buffer.alloc(6 + sizes.length * 16)

  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16

    header.writeUInt8(size === 256 ? 0 : size, entry)
    header.writeUInt8(size === 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[index].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[index].length
  })

  return Buffer.concat([header, ...images])
}

function icns(image) {
  const entries = [
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ].map(([type, size]) => {
    const data = png(image, size)
    const head = Buffer.alloc(8)

    head.write(type, 0, "ascii")
    head.writeUInt32BE(8 + data.length, 4)

    return Buffer.concat([head, data])
  })
  const total = Buffer.alloc(8)

  total.write("icns", 0, "ascii")
  total.writeUInt32BE(8 + entries.reduce((sum, entry) => sum + entry.length, 0), 4)

  return Buffer.concat([total, ...entries])
}

// PNG width lives in the IHDR chunk at byte 16. Every icon here is square.
const width = (file) => fs.readFileSync(file).readUInt32BE(16)

const pngs = (directory) =>
  fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".png"))
    .map((name) => path.join(directory, name))

app.setPath("userData", path.join(os.tmpdir(), "smikcode-icon-generator"))
app.disableHardwareAcceleration()
app.on("window-all-closed", () => {})

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 200, height: 200, show: false })

  try {
    await window.loadURL("about:blank")
    for (const [channel, colors] of Object.entries(CHANNELS)) {
      const directory = path.join(ICONS, channel)
      const images = {}

      for (const mode of ["full", "mac", "square", "round", "foreground"])
        images[mode] = await render(window, source(colors, mode))

      for (const file of pngs(directory))
        fs.writeFileSync(file, png(images[path.basename(file) === "dock.png" ? "mac" : "full"], width(file)))
      for (const file of pngs(path.join(directory, "ios"))) fs.writeFileSync(file, png(images.square, width(file)))
      for (const folder of fs.readdirSync(path.join(directory, "android")).filter((name) => name.startsWith("mipmap-"))) {
        for (const file of pngs(path.join(directory, "android", folder))) {
          const mode = file.endsWith("_foreground.png") ? "foreground" : file.endsWith("_round.png") ? "round" : "full"

          fs.writeFileSync(file, png(images[mode], width(file)))
        }
      }
      // Adaptive icons draw their foreground over this colour.
      fs.writeFileSync(
        path.join(directory, "android", "values", "ic_launcher_background.xml"),
        `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <color name="ic_launcher_background">${colors.edge}</color>\n</resources>\n`,
      )
      fs.writeFileSync(path.join(directory, "icon.ico"), ico(images.full))
      fs.writeFileSync(path.join(directory, "icon.icns"), icns(images.mac))
      console.log(`wrote ${channel} icons`)
    }
    fs.writeFileSync(
      path.join(__dirname, "..", "..", "app", "public", "favicon-smik.svg"),
      source(CHANNELS.prod, "full"),
    )
    console.log("wrote favicon-smik.svg")
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})

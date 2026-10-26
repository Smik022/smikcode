import { resolveChannel } from "./utils"

const arg = process.argv[2]

const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

// Must match APP_IDS in electron-builder.config.ts and src/main/constants.ts.
const appId = channel === "prod" ? "dev.smikcode.desktop" : `dev.smikcode.desktop.${channel}`

const productName = channel === "prod" ? "SmikCode" : `SmikCode ${channel.charAt(0).toUpperCase() + channel.slice(1)}`

const summary = `AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="dev.smikcode">
    <name>SmikCode</name>
  </developer>

  <description>
    <p>
      SmikCode is an AI coding agent that helps you write and run code with any AI model. It is a fork of opencode.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/Smik022/smikcode/issues</url>
  <url type="homepage">https://github.com/Smik022/smikcode</url>
  <url type="vcs-browser">https://github.com/Smik022/smikcode</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)

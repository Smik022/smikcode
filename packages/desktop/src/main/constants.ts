import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

// SmikCode's own identities, so its settings and windows never mix with an installed OpenCode desktop app.
const appNames: Record<string, string> = {
  dev: "SmikCode Dev",
  beta: "SmikCode Beta",
  prod: "SmikCode",
}

const appIDs: Record<string, string> = {
  dev: "dev.smikcode.desktop.dev",
  beta: "dev.smikcode.desktop.beta",
  prod: "dev.smikcode.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "SmikCode Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "dev.smikcode.desktop.dev"

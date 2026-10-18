import { Brand } from "@opencode/util/brand"

// SmikCode reads its settings through upstream's OPENCODE_* names. Copy every
// SMIKCODE_* variable onto its OPENCODE_* twin before any other module reads the
// environment; this module must stay the first import of the CLI entry. An
// explicit OPENCODE_* value wins, and spawned servers inherit the result.
Object.entries(process.env)
  .filter((entry): entry is [string, string] => entry[0].startsWith(Brand.envPrefix) && entry[1] !== undefined)
  .forEach(([key, value]) => {
    const target = "OPENCODE_" + key.slice(Brand.envPrefix.length)
    process.env[target] ??= value
  })

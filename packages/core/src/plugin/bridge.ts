export * as BridgePlugin from "./bridge.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Rpc } from "@opencode/schema/rpc"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Cause, Effect, Schema } from "effect"
import path from "path"
import { Agent } from "../agent.js"
import { Permission } from "../permission.js"
import { Tool as ToolRegistry } from "../tool.js"

// Tools that only make sense inside an interactive agent loop of their own.
const EXCLUDED = new Set(["question", "goal", "subagent"])

const errors = { unavailable: Schema.Struct({}) }

const Content = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("file"),
    uri: Schema.String,
    mime: Schema.String,
    name: Schema.optional(Schema.String),
  }),
])

/**
 * Lets an MCP client list and run SmikCode's tools. Calls run inside an existing session, so they use that
 * session's agent, permission rules and permission mode, and any approval prompt appears in that session.
 */
export const Definition = Rpc.define({
  id: "smikcode.bridge",
  methods: {
    tools: {
      input: Schema.Struct({}),
      output: Schema.Struct({
        tools: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            description: Schema.String,
            // A JSON Schema document, opaque to this contract.
            inputSchema: Schema.Record(Schema.String, Schema.Unknown),
          }),
        ),
      }),
    },
    // How to start the user's Claude Code with these tools attached, as a command a terminal can run.
    launch: {
      input: Schema.Struct({ tools: Schema.Literals(["safe", "edits", "all"]) }),
      output: Schema.Struct({ command: Schema.String, args: Schema.Array(Schema.String) }),
    },
    call: {
      input: Schema.Struct({
        sessionID: Session.ID,
        name: Schema.String,
        input: Schema.Record(Schema.String, Schema.Json),
      }),
      output: Schema.Struct({ isError: Schema.Boolean, content: Schema.Array(Content) }),
      errors,
    },
  },
  events: {},
})

export const Plugin = define({
  id: "opencode.bridge",
  effect: Effect.fn(function* (ctx) {
    const registry = yield* ToolRegistry.Service

    yield* ctx.rpc
      .register(Definition, {
        tools: () =>
          registry.snapshot().pipe(
            Effect.map((snapshot) => ({
              tools: snapshot.definitions
                .filter((definition) => !EXCLUDED.has(definition.name))
                .map((definition) => ({
                  name: definition.name,
                  description: definition.description,
                  inputSchema: definition.inputSchema,
                })),
            })),
          ),
        launch: (input) => Effect.succeed(launchCommand(input.tools)),
        call: (input, rpc) =>
          Effect.gen(function* () {
            const unavailable = (message: string) => rpc.error("unavailable", message, {})
            if (EXCLUDED.has(input.name))
              return yield* Effect.fail(unavailable(`Tool is not available here: ${input.name}`))
            const session = yield* ctx.session
              .get({ sessionID: input.sessionID })
              .pipe(Effect.mapError(() => unavailable("Session not found.")))
            if (session.location.directory !== ctx.location.directory)
              return yield* Effect.fail(unavailable("Session belongs to another location."))
            if (session.parentID !== undefined)
              return yield* Effect.fail(unavailable("Subagent sessions cannot be used."))

            const snapshot = yield* registry.snapshot(session.permissions)
            return yield* snapshot
              .execute({
                sessionID: session.id,
                agent: session.agent ?? Agent.ID.make("build"),
                messageID: SessionMessage.ID.create(),
                call: {
                  type: "tool-call",
                  id: Tool.CallID.make(`bridge_${crypto.randomUUID().replaceAll("-", "")}`),
                  name: input.name,
                  input: input.input,
                },
              })
              .pipe(
                Effect.map((result) => ({
                  isError: false,
                  content: result.content.map((item) =>
                    item.type === "text"
                      ? { type: "text" as const, text: item.text }
                      : {
                          type: "file" as const,
                          uri: item.uri,
                          mime: item.mime,
                          ...(item.name ? { name: item.name } : {}),
                        },
                  ),
                })),
                // A failed or declined call is a result the client shows to its model, not a broken RPC.
                Effect.catchCause((cause) =>
                  Effect.succeed({ isError: true, content: [{ type: "text" as const, text: describe(cause) }] }),
                ),
              )
          }),
      })
      .pipe(Effect.orDie)
  }),
})

/**
 * The SmikCode that is serving this backend also runs `claude`, so the terminal needs nothing installed on PATH.
 * Running from source means an interpreter plus the script; a packaged build is the executable itself.
 */
function launchCommand(tools: string) {
  const runtime = path.basename(process.execPath, path.extname(process.execPath)).toLowerCase()
  const script = process.argv[1]
  const self =
    (runtime === "bun" || runtime === "node") && script ? [process.execPath, path.resolve(script)] : [process.execPath]
  return { command: self[0], args: [...self.slice(1), "claude", "--tools", tools, "--wait-on-error"] }
}

// Permission declines travel as defects so a tool cannot turn a "no" into model-visible output; report them plainly.
function describe(cause: Cause.Cause<unknown>) {
  const values = cause.reasons.map((reason) =>
    Cause.isDieReason(reason) ? reason.defect : Cause.isFailReason(reason) ? reason.error : undefined,
  )
  if (values.some((value) => value instanceof Permission.DeclinedError)) return "The request was declined in SmikCode."
  const corrected = values.find((value) => value instanceof Permission.CorrectedError)
  if (corrected) return `The request was declined in SmikCode: ${corrected.feedback}`
  const failure = values.find((value) => value instanceof Tool.Error)
  if (failure) return failure.message
  return "The tool failed."
}

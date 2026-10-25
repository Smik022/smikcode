import { describe, expect, test } from "bun:test"
import { Message, ToolResultPart } from "@opencode/ai"
import { SessionPrune } from "@opencode/core/session/prune"

const big = (label: string) => `${label}\n${"x".repeat(30_000)}`

const turn = (prompt: string, tool: string, output: string) => [
  Message.user(prompt),
  Message.assistant([{ type: "tool-call", id: `${prompt}-call`, name: tool, input: {} }]),
  Message.tool(ToolResultPart.make({ id: `${prompt}-call`, name: tool, result: output, resultType: "text" })),
]

const outputs = (messages: ReturnType<typeof SessionPrune.trim>) =>
  messages.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) => (part.type === "tool-result" ? [String(part.result.value)] : []))
      : [],
  )

describe("SessionPrune.trim", () => {
  test("replaces large results from older turns and keeps the last two turns intact", () => {
    const messages = [
      ...turn("one", "read", big("first")),
      ...turn("two", "shell", big("second")),
      ...turn("three", "grep", big("third")),
      ...turn("four", "read", big("fourth")),
      ...turn("five", "read", "small"),
    ]
    const trimmed = outputs(SessionPrune.trim(messages))

    expect(trimmed[0]).toBe(
      "[Output of this earlier read call was trimmed to save context (2 lines). Call the tool again if you need it.]",
    )
    expect(trimmed[1]).toStartWith("[Output of this earlier shell call was trimmed")
    expect(trimmed[2]).toStartWith("[Output of this earlier grep call was trimmed")
    expect(trimmed[3]).toBe(big("fourth"))
    expect(trimmed[4]).toBe("small")
  })

  test("leaves the transcript untouched when the savings are small or there are few turns", () => {
    const small = [...turn("one", "read", big("first")), ...turn("two", "read", "a"), ...turn("three", "read", "b")]
    expect(SessionPrune.trim(small)).toBe(small)

    const short = [...turn("one", "read", big("first")), ...turn("two", "read", big("second"))]
    expect(SessionPrune.trim(short)).toBe(short)
  })

  test("is stable across steps within the same turn", () => {
    const history = [
      ...turn("one", "read", big("first")),
      ...turn("two", "read", big("second")),
      ...turn("three", "read", big("third")),
      ...turn("four", "read", "x"),
    ]
    const step = outputs(SessionPrune.trim(history))
    const nextStep = outputs(
      SessionPrune.trim([
        ...history,
        Message.assistant([{ type: "tool-call", id: "more", name: "read", input: {} }]),
        Message.tool(ToolResultPart.make({ id: "more", name: "read", result: big("more"), resultType: "text" })),
      ]),
    )
    expect(nextStep.slice(0, step.length)).toEqual(step)
  })
})

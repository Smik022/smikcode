// A minimal stdio language server for tests. It reports an error on every line containing "BAD"
// and a warning on every line containing "WARN", publishing twice per change like real servers do.

let buffer = Buffer.alloc(0)

const send = (message: Record<string, unknown>) => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message })
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`)
}

const publish = (uri: string, text: string) => {
  const lines = text.split("\n")
  const found = (marker: string, severity: number, message: string) =>
    lines.flatMap((line, index) =>
      line.includes(marker)
        ? [
            {
              range: {
                start: { line: index, character: line.indexOf(marker) },
                end: { line: index, character: line.indexOf(marker) + marker.length },
              },
              severity,
              source: "fake",
              code: severity === 1 ? "E1" : "W1",
              message,
            },
          ]
        : [],
    )
  // A syntax-only pass first, then the full result, so clients must wait for the server to settle.
  send({ method: "textDocument/publishDiagnostics", params: { uri, diagnostics: [] } })
  setTimeout(
    () =>
      send({
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [...found("BAD", 1, "bad token"), ...found("WARN", 2, "suspicious token")] },
      }),
    50,
  )
}

const handle = (message: {
  id?: number
  method?: string
  params?: { textDocument?: { uri: string; text?: string }; contentChanges?: { text: string }[] }
}) => {
  if (message.method === "initialize")
    return send({ id: message.id, result: { capabilities: { textDocumentSync: 1 } } })
  if (message.method === "shutdown") return send({ id: message.id, result: null })
  if (message.method === "exit") return process.exit(0)
  if (message.method === "textDocument/didOpen" && message.params?.textDocument)
    return publish(message.params.textDocument.uri, message.params.textDocument.text ?? "")
  if (message.method === "textDocument/didChange" && message.params?.textDocument)
    return publish(message.params.textDocument.uri, message.params.contentChanges?.at(-1)?.text ?? "")
}

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const end = buffer.indexOf("\r\n\r\n")
    if (end === -1) return
    const length = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString("ascii"))?.[1])
    if (buffer.length < end + 4 + length) return
    const body = buffer.subarray(end + 4, end + 4 + length).toString("utf8")
    buffer = buffer.subarray(end + 4 + length)
    handle(JSON.parse(body))
  }
})

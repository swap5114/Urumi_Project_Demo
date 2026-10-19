export function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

// Tool errors are returned (isError: true), not thrown, so the model can read them and react.
export function failure(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

// A thin client for OpenRouter's chat completions endpoint, which speaks the
// OpenAI format for messages and tool calls. Any model OpenRouter serves works.

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }

export type CompleteInput = { model: string; messages: ChatMessage[]; tools?: ToolSpec[]; temperature?: number }
export type CompleteFn = (input: CompleteInput) => Promise<Extract<ChatMessage, { role: "assistant" }>>

export const AGENT_MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-sonnet-4.5"
// The simulated driver only needs to sound like a person, so a smaller model is plenty.
export const DRIVER_MODEL = process.env.DRIVER_MODEL ?? "anthropic/claude-haiku-4.5"

export const openRouterComplete: CompleteFn = async ({ model, messages, tools, temperature }) => {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error("OPENROUTER_API_KEY is not set. Add it to starter/.env.")
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Car Delivery Control Room",
    },
    body: JSON.stringify({ model, messages, tools: tools?.length ? tools : undefined, temperature: temperature ?? 0.2 }),
  })
  if (!response.ok) throw new Error(`OpenRouter answered ${response.status}: ${(await response.text()).slice(0, 500)}`)
  const json = await response.json() as { choices?: { message: { content: string | null; tool_calls?: ToolCall[] } }[] }
  const message = json.choices?.[0]?.message
  if (!message) throw new Error("OpenRouter returned no message.")
  return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls?.length ? message.tool_calls : undefined }
}

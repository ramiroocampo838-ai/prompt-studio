import { RateLimitError } from "../../queue.ts"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LlmProvider {
  name: string
  // Returns the raw text of the model answer; `json` asks the model for a JSON object.
  chat(messages: ChatMessage[], opts?: { json?: boolean }): Promise<string>
}

// OpenAI-compatible endpoint, usable anonymously (no account or key).
export const pollinationsText: LlmProvider = {
  name: "pollinations-text",
  async chat(messages, { json = false } = {}) {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages,
        // The default model reasons before answering; without headroom it runs out of tokens (HTTP 400).
        max_tokens: 8000,
        reasoning_effort: "low",
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    })
    if (res.status === 402 || res.status === 429) {
      const seconds = parseInt(res.headers.get("retry-after") ?? "30", 10) + 2
      throw new RateLimitError(`Pollinations text limit reached (HTTP ${res.status})`, seconds * 1000)
    }
    if (!res.ok) throw new Error(`Pollinations text HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content
    if (!content?.trim()) throw new Error("Pollinations text returned an empty answer")
    return content
  },
}

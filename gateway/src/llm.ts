// A tiny client for any "OpenAI-compatible" chat API (Gemini, Groq, Ollama, ...). Plain fetch, no SDK.
// Switching provider = changing LLM_BASE_URL, LLM_MODEL and the key. The key is never logged or put in an error.

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// Assistant messages are kept EXACTLY as the provider returned them (extra fields included),
// because some models need those fields echoed back on the next request.
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  [extra: string]: unknown;
}

export interface LlmTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
}

// A failure we can show to a user: no headers, no key, a short reason.
export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Llm {
  complete(messages: ChatMessage[], tools: LlmTool[]): Promise<{ message: ChatMessage; totalTokens?: number }>;
}

export function createLlm(cfg: LlmConfig): Llm {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const timeoutMs = cfg.timeoutMs ?? 30_000;

  return {
    async complete(messages, tools) {
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            ...(tools.length ? { tools, tool_choice: "auto" } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const e = err as Error;
        const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
        throw new LlmError(504, timedOut ? `the model did not answer within ${timeoutMs}ms` : "could not reach the model provider");
      }

      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        if (res.status === 401 || res.status === 403) throw new LlmError(502, "the model provider rejected the API key");
        if (res.status === 429) throw new LlmError(429, "the model provider's rate limit or quota is used up, try again later");
        throw new LlmError(502, `the model provider returned HTTP ${res.status}: ${detail}`);
      }

      const data = (await res.json()) as { choices?: { message?: ChatMessage }[]; usage?: { total_tokens?: number } };
      const message = data.choices?.[0]?.message;
      if (!message) throw new LlmError(502, "the model provider returned no message");
      return { message, totalTokens: data.usage?.total_tokens };
    },
  };
}

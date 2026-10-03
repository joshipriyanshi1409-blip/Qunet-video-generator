import { AiClientError, type TextModelClient } from './types.js';

/** Reusable HTTP adapter for vLLM, llama.cpp and other OpenAI-compatible servers. */
export function createOpenAiCompatibleClient(endpoint: string, apiKey?: string): TextModelClient {
  const url = new URL('chat/completions', `${endpoint.replace(/\/$/, '')}/`);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Model endpoint must be HTTP(S)');
  return {
    name: 'openai-compatible',
    async generate(model, request, signal) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
            response_format: request.json ? { type: 'json_object' } : undefined,
            max_tokens: request.maxOutputTokens, temperature: request.temperature ?? 0.7 }),
        });
      } catch (error) { throw new AiClientError('Inference endpoint unreachable', true, error); }
      if (!response.ok) throw new AiClientError(`Inference HTTP ${response.status}`, response.status === 429 || response.status >= 500);
      const data: unknown = await response.json();
      const parsed = data as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = parsed.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.length) throw new AiClientError('Empty inference response', false);
      return { text, model, promptTokens: parsed.usage?.prompt_tokens ?? 0, completionTokens: parsed.usage?.completion_tokens ?? 0 };
    },
  };
}

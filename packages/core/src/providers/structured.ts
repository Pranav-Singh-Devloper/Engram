import { z } from 'zod';
import { ProviderOutputError } from './provider.js';

/** Sends a generateContent request body and returns the parsed response JSON. */
export type GeneratePost = (body: unknown) => Promise<unknown>;

/** One turn of a structured exchange; `model` is the assistant. */
export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

/** A transport for structured generation: sends the exchange, returns the reply text. */
export type ChatSend = (request: {
  system: string;
  turns: readonly ChatTurn[];
  jsonSchema?: Record<string, unknown>;
  temperature: number;
}) => Promise<string>;

export interface StructuredRequest<T> {
  system: string;
  user: string;
  /** Validates (and may transform) the reply. */
  schema: z.ZodType<T>;
  /** Sent as `responseJsonSchema`. Gemini follows it but doesn't guarantee it, so `schema` still decides. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

const GenerateResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});

function replyText(json: unknown): string {
  const res = GenerateResponse.parse(json);
  const candidate = res.candidates?.[0];
  const text = candidate?.content?.parts.map((p) => p.text ?? '').join('') ?? '';
  if (text === '') {
    throw new ProviderOutputError(
      `Empty reply (finishReason: ${candidate?.finishReason ?? 'none'})`,
      JSON.stringify(json).slice(0, 500),
    );
  }
  return text;
}

export function check<T>(
  schema: z.ZodType<T>,
  text: string,
): { ok: true; value: T } | { ok: false; issues: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, issues: 'the reply was not valid JSON' };
  }
  let result: ReturnType<typeof schema.safeParse>;
  try {
    result = schema.safeParse(json);
  } catch (err) {
    // A transform that throws escapes safeParse; treat it as invalid output.
    return { ok: false, issues: err instanceof Error ? err.message : String(err) };
  }
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: z.prettifyError(result.error) };
}

/** Gemini's generateContent as a ChatSend. The body shape is fixed: recorded responses are keyed by it. */
export function geminiChat(post: GeneratePost): ChatSend {
  return async ({ system, turns, jsonSchema, temperature }) =>
    replyText(
      await post({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: {
          responseMimeType: 'application/json',
          ...(jsonSchema && { responseJsonSchema: jsonSchema }),
          temperature,
        },
      }),
    );
}

/**
 * Asks for JSON and validates it with zod. On a bad reply it shows the model
 * its own output and the validation errors once, then gives up with a typed
 * error. Callers decide whether to retry the whole operation.
 */
export async function generateStructured<T>(
  send: ChatSend,
  request: StructuredRequest<T>,
): Promise<T> {
  const turns: ChatTurn[] = [{ role: 'user', text: request.user }];
  const ask = () =>
    send({
      system: request.system,
      turns,
      jsonSchema: request.jsonSchema,
      temperature: request.temperature ?? 0,
    });

  const first = await ask();
  const firstCheck = check(request.schema, first);
  if (firstCheck.ok) return firstCheck.value;

  turns.push(
    { role: 'model', text: first },
    {
      role: 'user',
      text: `That reply was invalid:\n${firstCheck.issues}\nReply again with only the corrected JSON.`,
    },
  );
  const second = await ask();
  const secondCheck = check(request.schema, second);
  if (secondCheck.ok) return secondCheck.value;
  throw new ProviderOutputError(
    `Reply failed validation after one repair: ${secondCheck.issues}`,
    second.slice(0, 2000),
  );
}

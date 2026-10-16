import { z } from 'zod';
import { ProviderOutputError } from './provider.js';

/** Sends a generateContent request body and returns the parsed response JSON. */
export type GeneratePost = (body: unknown) => Promise<unknown>;

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

interface Content {
  role: 'user' | 'model';
  parts: { text: string }[];
}

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

/**
 * Asks for JSON and validates it with zod. On a bad reply it shows the model
 * its own output and the validation errors once, then gives up with a typed
 * error. Callers decide whether to retry the whole operation.
 */
export async function generateStructured<T>(
  post: GeneratePost,
  request: StructuredRequest<T>,
): Promise<T> {
  const contents: Content[] = [{ role: 'user', parts: [{ text: request.user }] }];
  const body = (): unknown => ({
    systemInstruction: { parts: [{ text: request.system }] },
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      ...(request.jsonSchema && { responseJsonSchema: request.jsonSchema }),
      temperature: request.temperature ?? 0,
    },
  });

  const first = replyText(await post(body()));
  const firstCheck = check(request.schema, first);
  if (firstCheck.ok) return firstCheck.value;

  contents.push(
    { role: 'model', parts: [{ text: first }] },
    {
      role: 'user',
      parts: [
        {
          text: `That reply was invalid:\n${firstCheck.issues}\nReply again with only the corrected JSON.`,
        },
      ],
    },
  );
  const second = replyText(await post(body()));
  const secondCheck = check(request.schema, second);
  if (secondCheck.ok) return secondCheck.value;
  throw new ProviderOutputError(
    `Reply failed validation after one repair: ${secondCheck.issues}`,
    second.slice(0, 2000),
  );
}

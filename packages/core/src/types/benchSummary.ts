// The JSON summary bench writes beside each report (bench/reports/<run>.json).
// MCP's engram://stats reads the newest one; both sides parse with this schema.
import { z } from 'zod';

export const BenchSummary = z.object({
  schema: z.literal(1),
  runId: z.string(),
  split: z.string(),
  /** The run's date, YYYY-MM-DD. */
  date: z.string(),
  /** When the run's last result was written (ISO); orders runs. */
  finishedAt: z.string(),
  /** A ranker comparison with no composed answers: accuracy is meaningless. */
  retrievalOnly: z.boolean(),
  model: z.string(),
  judge: z.string(),
  items: z.number().int(),
  modes: z.record(
    z.string(),
    z.object({
      /** Share of items judged correct, 0..1. */
      accuracy: z.number(),
      n: z.number().int(),
      /** Retrieval modes only. */
      recallAt8: z.number().nullable(),
      /** Model requests per item (sent + replayed from the bench cache), and tokens sent. */
      requestsPerItem: z.number().optional(),
      promptTokensPerItem: z.number().optional(),
    }),
  ),
  /** Accuracy per category and mode (P09b's eval charts). Absent in summaries written before it. */
  categories: z
    .record(
      z.string(),
      z.record(z.string(), z.object({ accuracy: z.number(), n: z.number().int() })),
    )
    .optional(),
});
export type BenchSummary = z.infer<typeof BenchSummary>;

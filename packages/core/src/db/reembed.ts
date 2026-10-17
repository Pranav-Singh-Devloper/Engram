// Converts a namespace to another embedding space (P08b, ADR-017):
// re-embeds every episode, fact statement and entity label with the
// configured embedder, then rebinds the namespace, all in one transaction.
import type { Provider } from '../providers/provider.js';
import { entityLabel } from '../resolve/entities.js';
import { transaction } from './client.js';
import type { Sql } from './client.js';
import { toSql } from './vector.js';
import type { EntityType } from '../types/index.js';

export interface ReembedReport {
  space: string;
  episodes: number;
  facts: number;
  entities: number;
}

export async function reembedNamespace(
  db: Sql,
  provider: Pick<Provider, 'embed' | 'embeddingSpace'>,
  namespaceId: string,
): Promise<ReembedReport> {
  const space = await provider.embeddingSpace();
  return transaction(db, async (tx) => {
    const episodes = await tx<{ id: string; content: string }[]>`
      select id, content from episodes where namespace_id = ${namespaceId} order by id`;
    const facts = await tx<{ id: string; statement: string }[]>`
      select id, statement from facts where namespace_id = ${namespaceId} order by id`;
    const entities = await tx<
      { id: string; name: string; type: string | null; description: string | null }[]
    >`
      select id, name, type, description from entities
      where namespace_id = ${namespaceId} and not is_self order by id`;

    const write = async (
      table: 'episodes' | 'facts' | 'entities',
      rows: { id: string; text: string }[],
    ) => {
      if (rows.length === 0) return;
      const vectors = await provider.embed(
        rows.map((r) => r.text),
        { purpose: 'document' },
      );
      for (const [i, r] of rows.entries()) {
        const v = vectors[i];
        if (v) await tx`update ${tx(table)} set embedding = ${toSql(v)} where id = ${r.id}`;
      }
    };
    await write(
      'episodes',
      episodes.map((e) => ({ id: e.id, text: e.content })),
    );
    await write(
      'facts',
      facts.map((f) => ({ id: f.id, text: f.statement })),
    );
    await write(
      'entities',
      entities.map((e) => ({
        id: e.id,
        text: entityLabel({
          name: e.name,
          type: e.type as EntityType | null,
          description: e.description,
        }),
      })),
    );
    await tx`update namespaces set embedding_model = ${space} where id = ${namespaceId}`;
    return { space, episodes: episodes.length, facts: facts.length, entities: entities.length };
  });
}

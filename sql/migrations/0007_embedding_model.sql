-- P08b, ADR-017: the embedding space every vector in a namespace lives in.
-- Vectors from different models (or different weights behind one tag) can't
-- be compared, so a namespace is bound to one space on its first embedding
-- write and anything else is refused until `pnpm db:reembed` converts it.
alter table engram.namespaces add column embedding_model text;
comment on column engram.namespaces.embedding_model is
  'Embedding space of every vector in the namespace: a model name (gemini-embedding-2) or name@digest for local models. Null only while the namespace holds no vectors; it is set by the first embedding write.';

-- Everything embedded before this migration came from gemini-embedding-2.
update engram.namespaces n set embedding_model = 'gemini-embedding-2'
 where exists (select 1 from engram.episodes e where e.namespace_id = n.id and e.embedding is not null)
    or exists (select 1 from engram.facts f where f.namespace_id = n.id and f.embedding is not null)
    or exists (select 1 from engram.entities x where x.namespace_id = n.id and x.embedding is not null);

// Prompts never carry database ids. Candidate, fact and memory ids are
// replaced by short stable labels (c1, f1, m1…) and mapped back in the
// answer. Prompts get shorter, and identical situations produce identical
// request bodies, so responses can be cached and replayed.

export interface Aliases {
  /** The label for each original id, in input order. */
  label: (id: string) => string;
  /** The original id for a label, or the value unchanged if it isn't one. */
  resolve: (label: string) => string;
}

export function aliasIds(ids: readonly string[], prefix: string): Aliases {
  const toLabel = new Map(ids.map((id, i) => [id, `${prefix}${i + 1}`]));
  const toId = new Map([...toLabel].map(([id, label]) => [label, id]));
  return {
    label: (id) => toLabel.get(id) ?? id,
    resolve: (label) => toId.get(label) ?? label,
  };
}

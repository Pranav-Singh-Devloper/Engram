# P09b — Web UI

**Status:** outline

> **Outline.** Expand this into the full template (see [README](README.md#full-template)) at the start of the phase, using what earlier phases learned. Don't build from the outline.

## Goal
Build the dashboard that makes memory visible: a chat playground showing cross-session recall, the entity timeline where conflict resolution can be seen, a memory inspector, eval results, and a landing page. Plus a scripted demo anyone can follow.

## Spec refs
§12 (required pages, design bar, data notice), §6.3 (`used_memory_ids` side panel), §7.3 (`includeRevised` toggle), §15 P9.

## Depends on
P09a (every page runs against the real API).

## Definition of done
- [ ] `/chat`:
  - an ephemeral namespace per visitor;
  - a session switcher (create and rename);
  - streaming answers;
  - a used-memories side panel with provenance links;
  - a persistent "don't enter personal data" notice.
- [ ] `/entities/[id]`:
  - horizontal validity bars per predicate;
  - superseded and retracted styling;
  - the revision chain;
  - a "show record-time history" toggle.
- [ ] `/memories`: search, filters for tier, status and predicate, sort by retention score, expandable provenance. It reads with `trackAccess = false`.
- [ ] `/evals`: per-category accuracy across the four modes, the LongMemEval number and run history.
- [ ] `/`: a short landing page with live stats from the showcase namespace.
- [ ] `docs/demo.md` can be followed without improvising:
  1. remember in session A;
  2. recall in session B;
  3. contradict a fact;
  4. watch the timeline update.
- [ ] Dark-mode friendly, no lorem ipsum, usable at phone width.

## Risks and verify-at-build-time
- **Verify:** current Tailwind, shadcn/ui and TanStack Query setup for the installed Next.js version. Ask before adding each.
- **Timeline rendering** of open-ended and very old windows needs sensible axis bounds. Use the showcase data for design.
- **Stretch** `/graph` (with `valid_at`/`known_at` sliders) is only done if P10 is on track.

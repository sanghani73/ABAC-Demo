/**
 * SAMPLE_QUERIES — clickable pills under the semantic search box.
 *
 * These strings feed BOTH the UI and scripts/seed.ts: seed pre-computes a
 * Voyage query embedding for every entry and stores it in the queryEmbeddings
 * collection, so at request time lib/queries.ts can resolve a pill click
 * without reaching the Voyage endpoint. That is what makes the search side of
 * the demo runnable offline.
 *
 * The last two entries deliberately target media rows rather than report
 * bodies — the drone still on INTREP-2025-0003 and the thermal video on
 * INTREP-2025-0017. They exercise the media_vector index and the per-item
 * ABAC gate (see README's media pipeline demo moment).
 *
 * If you add a query here, re-run `npm run seed` so its vector lands in the
 * cluster; otherwise offline mode will error on that string.
 */
export const SAMPLE_QUERIES: readonly string[] = [
  "supply route disruption near Murmansk",
  "northern fleet activity",
  "OP NEPTUNE planning indicators",
  "logistics readiness in 3 Cdo Bde",
  "coalition exercise fuel",
  "aerial drone view of a convoy on a road",
  "thermal imagery of a UAV at night",
];

/**
 * SAMPLE_CHAT_PROMPTS — clickable prompts in the "Ask AI" drawer's empty state.
 *
 * These are NOT cached: the chat drawer needs a live LLM regardless, so
 * "offline mode" doesn't apply to this surface. The list is chosen to match
 * the demo script — persona-differentiating questions that produce visibly
 * different answers depending on who's asking.
 */
export const SAMPLE_CHAT_PROMPTS: readonly string[] = [
  "What's happening with supply convoys around Kola?",
  "Summarise recent activity in the northern training area.",
  "What do we know about adversary UAV movements?",
  "What is the current readiness of 3 Cdo Bde?",
];

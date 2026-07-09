import type { Policy } from "./types";

/**
 * Pure validity check, safe to import from client components.
 *
 * A policy is currently effective if `enabled !== false` AND we're inside
 * any configured validity window. Time bounds are inclusive; either may be
 * omitted to leave that side open-ended.
 *
 * Kept in its own module (separate from policyEngine.ts) because the engine
 * transitively imports lib/mongo.ts via personas.ts — and pulling the Mongo
 * driver into a client bundle breaks on Node-only modules (`net`, `tls`).
 * Server-side callers (queries, the engine) and client-side callers (the
 * audit panel) both import from here.
 */
export function isPolicyActive(p: Policy, now: Date = new Date()): boolean {
  if (p.enabled === false) return false;
  const t = now.getTime();
  if (p.validFrom) {
    const from = Date.parse(p.validFrom);
    if (!Number.isNaN(from) && t < from) return false;
  }
  if (p.validUntil) {
    const until = Date.parse(p.validUntil);
    if (!Number.isNaN(until) && t > until) return false;
  }
  return true;
}

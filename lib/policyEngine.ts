import { COMPARTMENT_UNIVERSE } from "./personas";
import {
  CLASSIFICATION_RANK,
  Classification,
  Condition,
  Persona,
  Policy,
} from "./types";

export const REDACTED_PLACEHOLDER = "[REDACTED]";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface CompiledPolicies {
  /** Mongo expression for row-level filtering. Used as $vectorSearch.filter or top-level $match. */
  rowFilter: Record<string, unknown>;
  /** $set stage applying field-level redactions ($$REMOVE for omits, "[REDACTED]" for redacts). */
  fieldSet: Record<string, unknown>;
  /** Field policies that applied to at least one doc, for UI trace display. */
  fieldPoliciesApplied: Policy[];
  /**
   * Expression that rewrites `mediaItems[]` element-by-element, replacing
   * items the persona may not see with a `{ redacted: true, reason }` stub.
   * Null if no media policies applied (or persona is auditor).
   */
  mediaItemsExpr: unknown | null;
  /** Media policies that were compiled into mediaItemsExpr, for UI trace display. */
  mediaPoliciesApplied: Policy[];
}

/**
 * Semantics:
 *   - ROW policy with effect=allow: row is visible if persona meets the conditions (any allow → union)
 *   - ROW policy with effect=deny:  row is hidden if persona meets the conditions
 *   - FIELD policy with effect=redact/omit: conditions describe what the persona must satisfy
 *     to SEE the field. If the persona fails the conditions for a given doc, the effect is applied.
 *
 * Closed-by-default: if no allow policies match, the persona sees nothing.
 * Auditor short-circuit: personas marked isAuditor bypass all filtering and field redaction.
 */
/**
 * Build a $match-shaped pre-filter for the flattened media collection. The
 * media-index docs carry `classification` / `releasability` / `compartments`
 * at the root, so the same operators that gate row visibility on `reports`
 * gate item visibility here.
 *
 * Combines:
 *   - row-target ALLOW policies (the persona can see media iff the
 *     attribute conditions would let them see a same-shaped report)
 *   - media-target ALLOW policies (each item is gated by its own attrs)
 *
 * Policies are OR'd into the allow expression — any one allow grants
 * visibility. Auditors bypass entirely.
 */
export function compileMediaSearchFilter(
  persona: Persona,
  policies: Policy[],
): Record<string, unknown> {
  if (persona.isAuditor) return {};
  const enabled = policies.filter((p) => p.enabled !== false);
  const allows = enabled.filter(
    (p) => (p.target === "row" || p.target === "media") && p.effect === "allow",
  );
  if (allows.length === 0) {
    // Closed-by-default — match nothing.
    return { _id: { $exists: false } };
  }
  const exprs = allows
    .map((p) => buildConditionsMatch(persona, p.conditions))
    .filter((e): e is Record<string, unknown> => e !== null);
  if (exprs.length === 0) return { _id: { $exists: false } };
  if (exprs.length === 1) return exprs[0];
  return { $or: exprs };
}

export function compilePolicies(persona: Persona, policies: Policy[]): CompiledPolicies {
  const enabled = policies.filter((p) => p.enabled !== false);

  const rowAllows = enabled.filter((p) => p.target === "row" && p.effect === "allow");
  const rowDenies = enabled.filter((p) => p.target === "row" && p.effect === "deny");
  const fieldPolicies = enabled.filter(
    (p) => p.target === "field" && (p.effect === "omit" || p.effect === "redact"),
  );
  const mediaPolicies = enabled.filter(
    (p) => p.target === "media" && (p.effect === "allow" || p.effect === "deny"),
  );

  const rowFilter = buildRowFilter(persona, rowAllows, rowDenies);
  const { fieldSet, applied } = buildFieldSet(persona, fieldPolicies);
  const { mediaItemsExpr, applied: mediaApplied } = buildMediaItemsExpr(persona, mediaPolicies);

  return {
    rowFilter,
    fieldSet,
    fieldPoliciesApplied: applied,
    mediaItemsExpr,
    mediaPoliciesApplied: mediaApplied,
  };
}

/**
 * Reflective version of the field-policy logic, run in app code against the
 * already-filtered results so we can tell the UI exactly which fields were
 * touched on each doc. Mongo applies the same effect in-pipeline.
 */
export function annotateDoc(
  persona: Persona,
  doc: Record<string, unknown>,
  fieldPolicies: Policy[],
): { redacted: string[]; omitted: string[] } {
  const redacted: string[] = [];
  const omitted: string[] = [];
  if (persona.isAuditor) return { redacted, omitted };

  for (const p of fieldPolicies) {
    if (!p.fieldPath) continue;
    const satisfied = p.conditions.every((c) => evaluateCondition(c, persona, doc));
    if (satisfied) continue;
    // Don't gate on `fieldPath in doc`: Mongo has already $unset omitted
    // fields by the time we get here, so the absence IS the signal — we
    // still want to report it. For redact the value is "[REDACTED]" and
    // remains present.
    if (p.effect === "redact") redacted.push(p.fieldPath);
    else if (p.effect === "omit") omitted.push(p.fieldPath);
  }
  return { redacted, omitted };
}

// ---------------------------------------------------------------------------
// Row-level filter compilation
// ---------------------------------------------------------------------------

function buildRowFilter(
  persona: Persona,
  rowAllows: Policy[],
  rowDenies: Policy[],
): Record<string, unknown> {
  if (persona.isAuditor) return {};

  if (rowAllows.length === 0) {
    // Closed-by-default — match nothing.
    return { _id: { $exists: false } };
  }

  const allowExprs = rowAllows
    .map((p) => buildConditionsMatch(persona, p.conditions))
    .filter((e): e is Record<string, unknown> => e !== null);

  const denyExprs = rowDenies
    .map((p) => buildConditionsMatch(persona, p.conditions))
    .filter((e): e is Record<string, unknown> => e !== null);

  const allow =
    allowExprs.length === 0
      ? { _id: { $exists: false } }
      : allowExprs.length === 1
        ? allowExprs[0]
        : { $or: allowExprs };

  if (denyExprs.length === 0) return allow;
  const deny = denyExprs.length === 1 ? denyExprs[0] : { $or: denyExprs };
  return { $and: [allow, { $nor: [deny] }] };
}

/**
 * Build a $match-style expression from a list of conditions (AND).
 * Persona attribute values are inlined; doc fields are referenced by path.
 */
function buildConditionsMatch(
  persona: Persona,
  conditions: Condition[],
): Record<string, unknown> | null {
  if (conditions.length === 0) return null;
  const parts = conditions
    .map((c) => buildConditionMatch(c, persona))
    .filter((p): p is Record<string, unknown> => p !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

function buildConditionMatch(c: Condition, persona: Persona): Record<string, unknown> | null {
  switch (c.op) {
    case "always":
      return {};
    case "clearance_gte": {
      const allowed = clearedClassifications(persona.clearance);
      return { classification: { $in: allowed } };
    }
    case "field_classification_gte": {
      const field = c.value || "source_classification";
      const allowed = clearedClassifications(persona.clearance);
      // A doc passes if the named field is absent (no extra restriction) OR
      // its value is in the cleared set. $in alone wouldn't match missing fields,
      // so we OR with $exists:false.
      return {
        $or: [
          { [field]: { $exists: false } },
          { [field]: { $in: allowed } },
        ],
      };
    }
    case "nationality_in_rel":
      return { releasability: persona.nationality };
    case "compartments_superset": {
      // $vectorSearch.filter doesn't allow $expr. Rewrite the superset check
      // in operator-only form: a doc passes iff its compartments contain no
      // element from (UNIVERSE − user.compartments).
      const forbidden = COMPARTMENT_UNIVERSE.filter(
        (c) => !persona.compartments.includes(c),
      );
      if (forbidden.length === 0) {
        // Persona holds every compartment in the universe — no restriction.
        return {};
      }
      return { compartments: { $nin: forbidden } };
    }
    case "unit_eq":
      return { originating_unit: persona.unit };
    case "classification_eq":
      return c.value ? { classification: c.value } : null;
    default:
      return null;
  }
}

function clearedClassifications(clearance: Classification): Classification[] {
  const rank = CLASSIFICATION_RANK[clearance];
  return (["OFFICIAL", "SECRET", "TOP_SECRET"] as Classification[]).filter(
    (k) => CLASSIFICATION_RANK[k] <= rank,
  );
}

// ---------------------------------------------------------------------------
// Field-level $set compilation
// ---------------------------------------------------------------------------

interface FieldSetBuild {
  fieldSet: Record<string, unknown>;
  applied: Policy[];
}

/**
 * For each field policy, build a $cond:
 *   if persona satisfies the conditions for this doc -> keep the field as-is
 *   else -> apply the effect (REDACTED placeholder or $$REMOVE)
 *
 * Multiple policies on the same field nest: the outer policy's else-branch
 * is the inner policy's whole expression.
 */
function buildFieldSet(persona: Persona, policies: Policy[]): FieldSetBuild {
  if (persona.isAuditor) return { fieldSet: {}, applied: [] };

  const fieldSet: Record<string, unknown> = {};
  const applied: Policy[] = [];

  for (const p of policies) {
    if (!p.fieldPath) continue;
    const condExpr = buildConditionsExpr(persona, p.conditions);
    if (condExpr === null) continue;

    const current = fieldSet[p.fieldPath] ?? `$${p.fieldPath}`;
    const onFail = p.effect === "omit" ? "$$REMOVE" : REDACTED_PLACEHOLDER;
    fieldSet[p.fieldPath] = {
      $cond: { if: condExpr, then: current, else: onFail },
    };
    applied.push(p);
  }

  return { fieldSet, applied };
}

function buildConditionsExpr(
  persona: Persona,
  conditions: Condition[],
  fieldRoot = "$",
): unknown | null {
  if (conditions.length === 0) return true;
  const parts = conditions
    .map((c) => buildConditionExpr(c, persona, fieldRoot))
    .filter((p) => p !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

/**
 * `fieldRoot` controls where doc fields are referenced from. The default `$`
 * means top-level paths (`$classification`). For per-item evaluation inside a
 * `$map`, pass `$$item.` so attributes resolve against the current array
 * element (`$$item.classification`).
 */
function buildConditionExpr(c: Condition, persona: Persona, fieldRoot = "$"): unknown | null {
  const ref = (path: string) => `${fieldRoot}${path}`;
  switch (c.op) {
    case "always":
      return true;
    case "clearance_gte": {
      const allowed = clearedClassifications(persona.clearance);
      return { $in: [ref("classification"), allowed] };
    }
    case "field_classification_gte": {
      const field = c.value || "source_classification";
      const allowed = clearedClassifications(persona.clearance);
      // Missing field counts as "not protected" → condition satisfied.
      return {
        $or: [
          { $eq: [{ $type: ref(field) }, "missing"] },
          { $in: [ref(field), allowed] },
        ],
      };
    }
    case "nationality_in_rel":
      return { $in: [persona.nationality, { $ifNull: [ref("releasability"), []] }] };
    case "compartments_superset":
      return {
        $eq: [
          {
            $size: {
              $setDifference: [{ $ifNull: [ref("compartments"), []] }, persona.compartments],
            },
          },
          0,
        ],
      };
    case "unit_eq":
      return { $eq: [ref("originating_unit"), persona.unit] };
    case "classification_eq":
      return c.value ? { $eq: [ref("classification"), c.value] } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Media-item compilation
// ---------------------------------------------------------------------------

interface MediaItemsBuild {
  mediaItemsExpr: unknown | null;
  applied: Policy[];
}

/**
 * For each media policy build a $cond on each item:
 *   - effect=allow: if conditions hold, keep the item; else replace with stub.
 *   - effect=deny:  if conditions hold, replace with stub; else keep.
 *
 * Multiple policies compose AND-wise per item: an item must survive every
 * policy to be returned in full. Allows nest as condition expressions inside
 * a single $map.
 */
function buildMediaItemsExpr(persona: Persona, policies: Policy[]): MediaItemsBuild {
  if (persona.isAuditor || policies.length === 0) {
    return { mediaItemsExpr: null, applied: [] };
  }

  const applied: Policy[] = [];
  // Accumulate per-item keep predicate (default: keep all).
  let keepPredicate: unknown = true;
  // Accumulate human-readable reason expression for the failing item.
  // We chain: cond1 ? (cond2 ? ... : reason2) : reason1
  let reasonExpr: unknown = "Access denied by media policy";

  for (const p of policies) {
    const condExpr = buildConditionsExpr(persona, p.conditions, "$$item.");
    if (condExpr === null) continue;
    const passes = p.effect === "allow" ? condExpr : { $not: [condExpr] };
    keepPredicate =
      keepPredicate === true ? passes : { $and: [keepPredicate, passes] };
    const reasonText = p.description || p.name || `Blocked by ${p.policyId}`;
    reasonExpr = { $cond: { if: passes, then: reasonExpr, else: reasonText } };
    applied.push(p);
  }

  if (applied.length === 0) return { mediaItemsExpr: null, applied: [] };

  const stub = {
    mediaId: "$$item.mediaId",
    mediaType: "$$item.mediaType",
    redacted: true,
    reason: reasonExpr,
  };

  // Wrap in $ifNull so docs without mediaItems pass through unchanged.
  const expr = {
    $ifNull: [
      {
        $map: {
          input: "$mediaItems",
          as: "item",
          in: {
            $cond: { if: keepPredicate, then: "$$item", else: stub },
          },
        },
      },
      "$$REMOVE",
    ],
  };

  return { mediaItemsExpr: expr, applied };
}

// ---------------------------------------------------------------------------
// Client-side condition evaluation (for UI annotation)
// ---------------------------------------------------------------------------

function evaluateCondition(c: Condition, persona: Persona, doc: Record<string, unknown>): boolean {
  switch (c.op) {
    case "always":
      return true;
    case "clearance_gte": {
      const docClass = doc.classification as Classification | undefined;
      if (!docClass) return false;
      return CLASSIFICATION_RANK[persona.clearance] >= CLASSIFICATION_RANK[docClass];
    }
    case "field_classification_gte": {
      const field = c.value || "source_classification";
      const fieldClass = doc[field] as Classification | undefined;
      if (!fieldClass) return true; // missing → unrestricted
      return CLASSIFICATION_RANK[persona.clearance] >= CLASSIFICATION_RANK[fieldClass];
    }
    case "nationality_in_rel": {
      const rel = (doc.releasability as string[] | undefined) ?? [];
      return rel.includes(persona.nationality);
    }
    case "compartments_superset": {
      const docComps = (doc.compartments as string[] | undefined) ?? [];
      return docComps.every((k) => persona.compartments.includes(k));
    }
    case "unit_eq":
      return doc.originating_unit === persona.unit;
    case "classification_eq":
      return doc.classification === c.value;
    default:
      return false;
  }
}

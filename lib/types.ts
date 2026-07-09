export type Classification = "OFFICIAL" | "SECRET" | "TOP_SECRET";

export const CLASSIFICATION_RANK: Record<Classification, number> = {
  OFFICIAL: 1,
  SECRET: 2,
  TOP_SECRET: 3,
};

export type Nationality = "GBR" | "USA" | "AUS" | "CAN" | "NZL";

export interface Persona {
  id: string;
  name: string;
  role: string;
  clearance: Classification;
  nationality: Nationality;
  unit: string;
  compartments: string[];
  isAuditor?: boolean;
  description: string;
}

export interface Report {
  _id?: string;
  reportId: string;
  title: string;
  body: string;
  summary: string;
  source_name: string;
  grid_ref: string;
  originating_unit: string;
  classification: Classification;
  releasability: Nationality[];
  compartments: string[];
  created_at: string;
  mediaItems?: MediaItem[];
}

/**
 * A single image or video clip attached to a report. Each item carries its
 * OWN ABAC attributes — they may be tighter than the parent report's (e.g. a
 * SECRET report with a TOP_SECRET / GEOINT-compartment drone clip attached).
 * The policy engine evaluates row visibility against the report and field
 * visibility against each media item independently.
 *
 * `caption` is what `voyage-multimodal-3.5` embeds alongside the visual; it's
 * also what the UI shows when the item is redacted.
 */
export type MediaType = "image" | "video";

export interface MediaItem {
  mediaId: string;
  mediaType: MediaType;
  url: string;
  caption: string;
  capturedAt?: string;
  geo?: { lat: number; lon: number };
  classification: Classification;
  releasability: Nationality[];
  compartments: string[];
}

/**
 * Shape that replaces a redacted media item in the query response. The UI
 * uses this to render a locked thumbnail with the reason — the audience still
 * sees that the item exists, but not its content.
 */
export interface RedactedMediaItem {
  mediaId: string;
  mediaType: MediaType;
  redacted: true;
  reason: string;
}

export type Operator =
  | "clearance_gte"           // user.clearance >= doc.classification
  | "field_classification_gte" // user.clearance >= doc[<field>] (default: source_classification)
  | "nationality_in_rel"      // user.nationality ∈ doc.releasability
  | "compartments_superset"   // user.compartments ⊇ doc.compartments
  | "unit_eq"                 // user.unit == doc.originating_unit
  | "classification_eq"       // doc.classification == value
  | "always";                 // matches every doc (used for catch-all field policies)

export interface Condition {
  op: Operator;
  /**
   * For classification_eq: the literal classification to compare against.
   * For field_classification_gte: the doc field name holding the classification
   * (defaults to "source_classification" when omitted).
   */
  value?: string;
}

export type Effect = "allow" | "deny" | "omit" | "redact";

/**
 * Policy targets:
 *   - row:    controls whether the document is visible at all.
 *   - field:  controls a single scalar field on the document.
 *   - media:  controls a single MediaItem inside `mediaItems[]`. Conditions
 *             are evaluated against the item's own classification /
 *             releasability / compartments (not the parent report's).
 */
export type PolicyTarget = "row" | "field" | "media";

export interface Policy {
  _id?: string;
  policyId: string;
  name: string;
  description?: string;
  target: PolicyTarget;
  fieldPath?: string;     // only for target=field
  conditions: Condition[]; // ALL must be true (AND); for row target, defines who's ALLOWED to see the row
  effect: Effect;
  priority?: number;
  enabled: boolean;
  /**
   * Optional validity window. ISO-8601 timestamps. A policy is treated as
   * disabled when `now < validFrom` or `now > validUntil`. Both bounds are
   * inclusive; either may be omitted (open-ended on that side).
   *
   * Evaluated server-side on every request — the wall clock used is the
   * Node runtime's clock at request time, which means client-side countdowns
   * in the admin UI are approximate (subject to clock skew). The decision
   * itself is tamper-proof: no client input feeds into the comparison.
   */
  validFrom?: string;
  validUntil?: string;
}

export interface SearchRequestBody {
  personaId: string;
  query: string;
  limit?: number;
}

export interface SearchResult {
  doc: Partial<Report> & { score?: number };
  redactedFields: string[];
  omittedFields: string[];
  redactedMediaIds: string[];
  /**
   * mediaIds that drove this result via the media vector index. Empty when
   * the result came purely from the report-text search; populated when a
   * media item's embedding matched the query. The UI highlights these
   * thumbnails so the audience can see which modality drove the hit.
   */
  matchedMediaIds: string[];
  /**
   * "text" — found via the report-body text vector index.
   * "media" — surfaced only because a child media item matched (parent
   *   report wasn't itself a text hit). Still ABAC-checked.
   * "both" — both modalities matched the same report.
   */
  matchSource: "text" | "media" | "both";
}

export interface SearchResponse {
  persona: Persona;
  results: SearchResult[];
  pipeline: unknown[];
  totalReturned: number;
}

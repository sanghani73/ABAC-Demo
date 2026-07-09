import type { Db } from "mongodb";
import {
  COLLECTIONS,
  EMBEDDING_PATH,
  MEDIA_VECTOR_INDEX,
  VECTOR_INDEX,
  getDb,
} from "./mongo";
import { embedQuery } from "./embeddings";
import { getPersona } from "./personas";
import {
  annotateDoc,
  compileMediaSearchFilter,
  compilePolicies,
} from "./policyEngine";
import type { Persona, Policy, Report, SearchResult } from "./types";

interface ExecuteParams {
  personaId: string;
  query?: string;
  limit?: number;
}

interface ExecuteResult {
  persona: Persona;
  results: SearchResult[];
  pipeline: unknown[];
  /** Separate display pipeline for the media vector search (when run). */
  mediaPipeline: unknown[];
  totalReturned: number;
  totalUnfiltered: number;
  totalMediaReturned: number;
}

interface MediaHit {
  mediaId: string;
  parentReportId: string;
  score: number;
}

/**
 * Run a vector-search (when query is provided) or a plain browse (when not)
 * with ABAC pipeline stages injected. Returns enough trace data for the UI
 * to show the audience exactly what was filtered, redacted, or omitted.
 *
 * When `query` is set, this runs TWO vector searches in parallel — one over
 * `reports` (report bodies) and one over `media_index` (flattened media
 * items with their own ABAC attrs). Results are merged: a media hit whose
 * parent report wasn't already a text hit becomes a media-driven result,
 * loaded back from the reports collection with the same field/media
 * redaction pipeline applied so ABAC is consistent across both paths.
 *
 * Embedding strategy: this demo embeds queries in Node via the MongoDB-hosted
 * Voyage multimodal endpoint (see lib/embeddings.ts) and passes a
 * pre-computed `queryVector` to $vectorSearch. The "auto-embed" Atlas
 * feature is not used because this demo is sized for M10, where autoEmbed is
 * not available.
 */
export async function executeABACSearch(params: ExecuteParams): Promise<ExecuteResult> {
  const { personaId, query, limit = 20 } = params;
  const persona = await getPersona(personaId);
  if (!persona) throw new Error(`Unknown persona: ${personaId}`);

  const db = await getDb();
  // Fetch all policies — the engine filters by `enabled` AND the validity
  // window (`validFrom`/`validUntil`) via isPolicyActive(). Keeping the DB
  // query unfiltered means time-bounded policies are evaluated at request
  // time, not at fetch time, with one source of truth for "is this active?".
  const policies = (await db
    .collection<Policy>(COLLECTIONS.policies)
    .find({})
    .toArray()) as Policy[];

  const compiled = compilePolicies(persona, policies);

  let queryVector: number[] | null = null;
  if (query && query.trim().length > 0) {
    queryVector = await getCachedQueryEmbedding(db, query);
    if (!queryVector) {
      try {
        queryVector = await embedQuery(query);
      } catch (err) {
        throw new Error(
          `Query embedding unavailable — not in the offline cache and the Voyage call failed. ` +
            `Click a sample query pill for guaranteed offline behaviour, or restore network access. ` +
            `Underlying error: ${(err as Error).message}`,
        );
      }
    }
  }

  // Build the report-body pipeline and the media-index search in parallel.
  const reportPipeline = buildReportPipeline(compiled, queryVector, limit);
  const reportDisplay = buildReportPipelineForDisplay(compiled, queryVector, limit, query);

  const reportCol = db.collection(COLLECTIONS.reports);

  const [rawDocs, mediaHits] = await Promise.all([
    reportCol.aggregate(reportPipeline as object[]).toArray() as Promise<
      Record<string, unknown>[]
    >,
    queryVector
      ? executeMediaSearch(db, persona, policies, queryVector, limit)
      : Promise.resolve<{ hits: MediaHit[]; displayPipeline: unknown[] }>({
          hits: [],
          displayPipeline: [],
        }),
  ]);

  // Build the "matched media ids per report" map from the media hits.
  const mediaMatchesByReport = new Map<string, string[]>();
  for (const h of mediaHits.hits) {
    const arr = mediaMatchesByReport.get(h.parentReportId) ?? [];
    arr.push(h.mediaId);
    mediaMatchesByReport.set(h.parentReportId, arr);
  }

  // Reports that media-matched but weren't in the text hits: load them
  // separately, threading them through the SAME field/media redaction
  // pipeline so ABAC is enforced uniformly.
  const textReportIds = new Set(
    rawDocs.map((d) => d.reportId as string).filter(Boolean),
  );
  const mediaOnlyReportIds = Array.from(mediaMatchesByReport.keys()).filter(
    (id) => !textReportIds.has(id),
  );

  let mediaOnlyDocs: Record<string, unknown>[] = [];
  if (mediaOnlyReportIds.length > 0) {
    const followUpPipeline = buildFollowUpPipeline(compiled, mediaOnlyReportIds);
    mediaOnlyDocs = (await reportCol
      .aggregate(followUpPipeline as object[])
      .toArray()) as Record<string, unknown>[];
  }

  const totalUnfiltered = await unfilteredCount(db, queryVector, limit);

  const results: SearchResult[] = [
    ...rawDocs.map((doc) =>
      toSearchResult(doc, persona, compiled.fieldPoliciesApplied, mediaMatchesByReport, "text"),
    ),
    ...mediaOnlyDocs.map((doc) =>
      toSearchResult(doc, persona, compiled.fieldPoliciesApplied, mediaMatchesByReport, "media"),
    ),
  ];

  return {
    persona,
    results,
    pipeline: reportDisplay,
    mediaPipeline: mediaHits.displayPipeline,
    totalReturned: results.length,
    totalUnfiltered,
    totalMediaReturned: mediaHits.hits.length,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a precomputed Voyage query embedding from the `queryEmbeddings`
 * collection. Populated at seed time from lib/sampleQueries.ts, this is what
 * makes the demo's scripted queries runnable offline — the exact strings shown
 * as pills on the search page and in the chat drawer resolve here instead of
 * hitting ai.mongodb.com.
 *
 * Exact-match keying only. Fuzzy matching could silently return the wrong
 * vector; the pill UX guarantees the string arrives verbatim.
 */
async function getCachedQueryEmbedding(
  db: Db,
  query: string,
): Promise<number[] | null> {
  const doc = await db
    .collection<{ query: string; embedding: number[] }>(COLLECTIONS.queryEmbeddings)
    .findOne({ query });
  return doc?.embedding ?? null;
}

function buildReportPipeline(
  compiled: ReturnType<typeof compilePolicies>,
  queryVector: number[] | null,
  limit: number,
): unknown[] {
  const pipeline: unknown[] = [];
  if (queryVector) {
    pipeline.push({
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: EMBEDDING_PATH,
        queryVector,
        filter: compiled.rowFilter,
        limit,
        numCandidates: Math.max(150, limit * 10),
      },
    });
    pipeline.push({ $set: { score: { $meta: "vectorSearchScore" } } });
  } else {
    pipeline.push({ $match: compiled.rowFilter });
    pipeline.push({ $sort: { created_at: -1 } });
    pipeline.push({ $limit: limit });
  }
  if (Object.keys(compiled.fieldSet).length > 0) {
    pipeline.push({ $set: compiled.fieldSet });
  }
  if (compiled.mediaItemsExpr !== null) {
    pipeline.push({ $set: { mediaItems: compiled.mediaItemsExpr } });
  }
  pipeline.push({ $project: { _id: 0, [EMBEDDING_PATH]: 0 } });
  return pipeline;
}

function buildReportPipelineForDisplay(
  compiled: ReturnType<typeof compilePolicies>,
  queryVector: number[] | null,
  limit: number,
  queryText: string | undefined,
): unknown[] {
  const display: unknown[] = [];
  if (queryVector) {
    display.push({
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: EMBEDDING_PATH,
        queryVector: `<${queryVector.length}-dim vector embedded from "${queryText}">`,
        filter: compiled.rowFilter,
        limit,
        numCandidates: Math.max(150, limit * 10),
      },
    });
    display.push({ $set: { score: { $meta: "vectorSearchScore" } } });
  } else {
    display.push({ $match: compiled.rowFilter });
    display.push({ $sort: { created_at: -1 } });
    display.push({ $limit: limit });
  }
  if (Object.keys(compiled.fieldSet).length > 0) {
    display.push({ $set: compiled.fieldSet });
  }
  if (compiled.mediaItemsExpr !== null) {
    display.push({ $set: { mediaItems: compiled.mediaItemsExpr } });
  }
  display.push({ $project: { _id: 0, [EMBEDDING_PATH]: 0 } });
  return display;
}

/**
 * Reload reports that surfaced only through media hits, threading them
 * through the same field/media redaction stages so ABAC is enforced
 * identically to the text-search path.
 */
function buildFollowUpPipeline(
  compiled: ReturnType<typeof compilePolicies>,
  reportIds: string[],
): unknown[] {
  const pipeline: unknown[] = [
    { $match: { reportId: { $in: reportIds } } },
  ];
  if (Object.keys(compiled.fieldSet).length > 0) {
    pipeline.push({ $set: compiled.fieldSet });
  }
  if (compiled.mediaItemsExpr !== null) {
    pipeline.push({ $set: { mediaItems: compiled.mediaItemsExpr } });
  }
  pipeline.push({ $project: { _id: 0, [EMBEDDING_PATH]: 0 } });
  return pipeline;
}

async function executeMediaSearch(
  db: import("mongodb").Db,
  persona: Persona,
  policies: Policy[],
  queryVector: number[],
  limit: number,
): Promise<{ hits: MediaHit[]; displayPipeline: unknown[] }> {
  const mediaFilter = compileMediaSearchFilter(persona, policies);
  const mediaPipeline = [
    {
      $vectorSearch: {
        index: MEDIA_VECTOR_INDEX,
        path: EMBEDDING_PATH,
        queryVector,
        filter: mediaFilter,
        limit,
        numCandidates: Math.max(150, limit * 10),
      },
    },
    { $set: { score: { $meta: "vectorSearchScore" } } },
    {
      $project: {
        _id: 0,
        embedding: 0,
      },
    },
  ];

  const displayPipeline = [
    {
      $vectorSearch: {
        index: MEDIA_VECTOR_INDEX,
        path: EMBEDDING_PATH,
        queryVector: `<${queryVector.length}-dim vector (same vector used for reports)>`,
        filter: mediaFilter,
        limit,
        numCandidates: Math.max(150, limit * 10),
      },
    },
    { $set: { score: { $meta: "vectorSearchScore" } } },
    { $project: { _id: 0, embedding: 0 } },
  ];

  try {
    const hits = (await db
      .collection(COLLECTIONS.mediaIndex)
      .aggregate(mediaPipeline as object[])
      .toArray()) as Array<{
      mediaId: string;
      parentReportId: string;
      score: number;
    }>;
    return {
      hits: hits.map((h) => ({
        mediaId: h.mediaId,
        parentReportId: h.parentReportId,
        score: h.score,
      })),
      displayPipeline,
    };
  } catch (err) {
    // If the media index isn't built yet (e.g. first seed in progress) fail
    // soft — the demo still works on text alone.
    console.warn(
      `[queries] media vector search failed: ${(err as Error).message.split("\n")[0]}`,
    );
    return { hits: [], displayPipeline };
  }
}

function toSearchResult(
  doc: Record<string, unknown>,
  persona: Persona,
  fieldPoliciesApplied: Policy[],
  mediaMatchesByReport: Map<string, string[]>,
  matchSource: "text" | "media",
): SearchResult {
  const annotated = annotateDoc(persona, doc, fieldPoliciesApplied);
  const mediaItems = (doc.mediaItems as Array<Record<string, unknown>> | undefined) ?? [];
  const redactedMediaIds = mediaItems
    .filter((m) => m && m.redacted === true && typeof m.mediaId === "string")
    .map((m) => m.mediaId as string);
  const reportId = (doc.reportId as string) ?? "";
  const matchedMediaIds = mediaMatchesByReport.get(reportId) ?? [];
  const source: "text" | "media" | "both" =
    matchSource === "media"
      ? "media"
      : matchedMediaIds.length > 0
        ? "both"
        : "text";
  return {
    doc: doc as Partial<Report> & { score?: number },
    redactedFields: annotated.redacted,
    omittedFields: annotated.omitted,
    redactedMediaIds,
    matchedMediaIds,
    matchSource: source,
  };
}

async function unfilteredCount(
  db: import("mongodb").Db,
  queryVector: number[] | null,
  limit: number,
): Promise<number> {
  if (!queryVector) {
    return db.collection(COLLECTIONS.reports).countDocuments();
  }
  try {
    const r = await db
      .collection(COLLECTIONS.reports)
      .aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: EMBEDDING_PATH,
            queryVector,
            limit,
            numCandidates: Math.max(150, limit * 10),
          },
        },
        { $count: "n" },
      ])
      .toArray();
    return r[0]?.n ?? 0;
  } catch {
    return -1;
  }
}

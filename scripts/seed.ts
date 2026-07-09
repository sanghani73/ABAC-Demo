/**
 * Seeds the demo:
 *   1. Connects to the Atlas cluster pointed to by MONGODB_URI
 *   2. Drops & recreates the reports, policies, users, media_index and
 *      queryEmbeddings collections
 *   3. Generates Voyage embeddings for each report's `body` (input_type=document),
 *      each media item, and each sample search query (input_type=query)
 *   4. Inserts reports with the `embedding` field populated, plus policies,
 *      users, media rows, and sample-query vectors
 *   5. Ensures the Atlas Vector Search indexes (type=vector on `embedding`) exist
 *
 * Embedding is done client-side via the Voyage API (lib/embeddings.ts) — this
 * demo targets Atlas M10, on which the autoEmbed index type is not available.
 * The queryEmbeddings collection is the offline-mode cache: after a seed with
 * network access, lib/queries.ts serves the sample queries entirely from Mongo
 * with no need to reach the Voyage endpoint.
 *
 * Required env:
 *   MONGODB_URI                — Atlas cluster URI
 *   VOYAGE_API_KEY             — Voyage AI key (https://dash.voyageai.com/)
 *   VOYAGE_MODEL               — defaults to "voyage-3.5"
 *   MONGODB_DB                 — defaults to "abac_demo"
 *   MONGODB_REPORTS            — defaults to "reports"
 *   MONGODB_POLICIES           — defaults to "policies"
 *   MONGODB_QUERY_EMBEDDINGS   — defaults to "queryEmbeddings"
 *   MONGODB_VECTOR_INDEX       — defaults to "reports_vector"
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import {
  ContentPart,
  embedDocuments,
  embedMultimodal,
  embedTexts,
  voyageDimensions,
  voyageModel,
} from "../lib/embeddings";
import { readImageWithMime } from "../lib/imageMime";
import { SAMPLE_QUERIES } from "../lib/sampleQueries";

const MONGODB_URI = required("MONGODB_URI");
required("VOYAGE_API_KEY");
const DB = process.env.MONGODB_DB || "abac_demo";
const REPORTS = process.env.MONGODB_REPORTS || "reports";
const POLICIES = process.env.MONGODB_POLICIES || "policies";
const USERS = process.env.MONGODB_USERS || "users";
const MEDIA_INDEX = process.env.MONGODB_MEDIA_INDEX || "media_index";
const QUERY_EMBEDDINGS = process.env.MONGODB_QUERY_EMBEDDINGS || "queryEmbeddings";
const VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || "reports_vector";
const MEDIA_VECTOR_INDEX = process.env.MONGODB_MEDIA_VECTOR_INDEX || "media_vector";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB);
  const model = voyageModel();
  const dims = voyageDimensions();

  console.log(`Seeding db="${DB}", embedding model="${model}" (${dims} dims)`);

  // --- reports ---
  const reportsPath = join(process.cwd(), "data", "reports.seed.json");
  type MediaSeed = {
    mediaId: string;
    mediaType: "image" | "video";
    url: string;
    caption: string;
    capturedAt?: string;
    geo?: { lat: number; lon: number };
    classification: string;
    releasability: string[];
    compartments: string[];
  };
  type Report = Record<string, unknown> & {
    reportId: string;
    title?: string;
    body: string;
    classification: string;
    releasability: string[];
    compartments: string[];
    mediaItems?: MediaSeed[];
  };
  const reports = JSON.parse(readFileSync(reportsPath, "utf8")) as Report[];
  console.log(`Embedding ${reports.length} report bodies via Voyage...`);
  const vectors = await embedDocuments(reports.map((r) => r.body));
  const withVectors = reports.map((r, i) => ({ ...r, embedding: vectors[i] }));

  console.log(`Dropping and reseeding ${REPORTS}`);
  try {
    await db.collection(REPORTS).drop();
  } catch (err) {
    if ((err as { codeName?: string }).codeName !== "NamespaceNotFound") throw err;
  }
  await db.collection(REPORTS).insertMany(withVectors);

  // Helpful supporting indexes for the policy engine's $match filters.
  await db.collection(REPORTS).createIndexes([
    { key: { classification: 1 }, name: "classification_1" },
    { key: { releasability: 1 }, name: "releasability_1" },
    { key: { compartments: 1 }, name: "compartments_1" },
    { key: { originating_unit: 1 }, name: "originating_unit_1" },
    { key: { reportId: 1 }, name: "reportId_1", unique: true },
  ]);

  // --- media_index ---
  // Flatten every report's mediaItems[] into individual rows so each item can
  // be vector-searched and ABAC-filtered against its OWN classification /
  // releasability / compartments — independently of the parent report.
  await seedMediaIndex(db, reports);

  // --- policies ---
  const policiesPath = join(process.cwd(), "data", "policies.seed.json");
  const policies = JSON.parse(readFileSync(policiesPath, "utf8")) as unknown[];
  console.log(`Dropping and reseeding ${POLICIES} (${policies.length} policies)`);
  try {
    await db.collection(POLICIES).drop();
  } catch (err) {
    if ((err as { codeName?: string }).codeName !== "NamespaceNotFound") throw err;
  }
  await db.collection(POLICIES).insertMany(policies as Record<string, unknown>[]);
  await db.collection(POLICIES).createIndex({ policyId: 1 }, { unique: true });

  // --- users (personas) ---
  const usersPath = join(process.cwd(), "data", "users.seed.json");
  const users = JSON.parse(readFileSync(usersPath, "utf8")) as unknown[];
  console.log(`Dropping and reseeding ${USERS} (${users.length} users)`);
  try {
    await db.collection(USERS).drop();
  } catch (err) {
    if ((err as { codeName?: string }).codeName !== "NamespaceNotFound") throw err;
  }
  await db.collection(USERS).insertMany(users as Record<string, unknown>[]);
  await db.collection(USERS).createIndex({ id: 1 }, { unique: true });

  // --- query embeddings (offline cache for sample search queries) ---
  // Pre-compute the Voyage vector for every string in SAMPLE_QUERIES so the
  // demo's scripted queries can be served entirely from Mongo without a live
  // call to ai.mongodb.com. input_type MUST be "query" here to match what
  // lib/queries.ts uses at runtime — mixing document/query embeddings across
  // seed and serve degrades retrieval quality.
  console.log(`Embedding ${SAMPLE_QUERIES.length} sample queries via Voyage...`);
  const queryVectors = await embedTexts([...SAMPLE_QUERIES], "query");
  const queryDocs = SAMPLE_QUERIES.map((query, i) => ({
    query,
    embedding: queryVectors[i],
    model,
  }));
  console.log(`Dropping and reseeding ${QUERY_EMBEDDINGS} (${queryDocs.length} entries)`);
  try {
    await db.collection(QUERY_EMBEDDINGS).drop();
  } catch (err) {
    if ((err as { codeName?: string }).codeName !== "NamespaceNotFound") throw err;
  }
  await db.collection(QUERY_EMBEDDINGS).insertMany(queryDocs);
  await db.collection(QUERY_EMBEDDINGS).createIndex({ query: 1 }, { unique: true });

  // --- vector search indexes ---
  await ensureVectorIndex(db, REPORTS, dims, VECTOR_INDEX);
  await ensureMediaVectorIndex(db, MEDIA_INDEX, dims);

  await client.close();
  console.log("Seed complete.");
  console.log(
    `Run \`npm run seed:wait\` to block until the vector indexes "${VECTOR_INDEX}" and "${MEDIA_VECTOR_INDEX}" are queryable.`,
  );
}

/**
 * Flatten reports[].mediaItems[] into a `media_index` collection, embedding
 * each item via the multimodal endpoint. The embedding input combines the
 * item's caption (text) and its visual (image_url or image_base64 from the
 * local file). If the local file doesn't exist on disk, the item is embedded
 * text-only (caption) so the demo seeds cleanly before real media assets are
 * supplied — the vector still goes into the same 1024-dim space.
 *
 * Per the Voyage API spec, a single multimodal request must use EITHER
 * image_url OR image_base64 — not both. We embed each item in its own
 * single-element batch to keep the encoding choice local.
 */
async function seedMediaIndex(
  db: import("mongodb").Db,
  reports: Array<{
    reportId: string;
    title?: string;
    classification: string;
    releasability: string[];
    compartments: string[];
    originating_unit?: string;
    mediaItems?: Array<{
      mediaId: string;
      mediaType: "image" | "video";
      url: string;
      caption: string;
      capturedAt?: string;
      geo?: { lat: number; lon: number };
      classification: string;
      releasability: string[];
      compartments: string[];
    }>;
  }>,
) {
  type FlatMedia = {
    mediaId: string;
    mediaType: "image" | "video";
    url: string;
    caption: string;
    capturedAt?: string;
    geo?: { lat: number; lon: number };
    classification: string;
    releasability: string[];
    compartments: string[];
    /**
     * Inherited from the parent report. Lets the same `unit_eq` operator that
     * drives row-level "own-unit OFFICIAL" access also gate the report's
     * attached media — keeps policy semantics consistent across collections.
     */
    originating_unit?: string;
    parentReportId: string;
    parentTitle?: string;
    parentClassification: string;
    embedding?: number[];
  };

  const flat: FlatMedia[] = [];
  for (const r of reports) {
    for (const m of r.mediaItems ?? []) {
      flat.push({
        ...m,
        originating_unit: r.originating_unit,
        parentReportId: r.reportId,
        parentTitle: r.title,
        parentClassification: r.classification,
      });
    }
  }

  console.log(`Dropping and reseeding ${MEDIA_INDEX} (${flat.length} media items)`);
  try {
    await db.collection(MEDIA_INDEX).drop();
  } catch (err) {
    if ((err as { codeName?: string }).codeName !== "NamespaceNotFound") throw err;
  }
  if (flat.length === 0) return;

  console.log(`Embedding ${flat.length} media items via Voyage multimodal...`);
  for (const item of flat) {
    const content: ContentPart[] = [{ type: "text", text: item.caption }];
    const visualPart = loadVisualContent(item);
    if (visualPart) content.push(visualPart);
    const [vec] = await embedMultimodal([{ content }], "document");
    item.embedding = vec;
  }

  await db.collection(MEDIA_INDEX).insertMany(flat);
  await db.collection(MEDIA_INDEX).createIndexes([
    { key: { mediaId: 1 }, name: "mediaId_1", unique: true },
    { key: { parentReportId: 1 }, name: "parentReportId_1" },
    { key: { classification: 1 }, name: "classification_1" },
    { key: { releasability: 1 }, name: "releasability_1" },
    { key: { compartments: 1 }, name: "compartments_1" },
  ]);
}

/**
 * Resolve a MediaItem's `url` to a multimodal content part suitable for the
 * Voyage embeddings API. We expect demo media files to live under
 * `public/<url>` so Next.js can also serve them. For images we base64 the
 * file. For videos we skip the visual (no frame extraction in this demo) and
 * the caller will embed caption-only.
 *
 * Returns null when no usable visual is available — the caller falls back to
 * caption-only embedding.
 */
function loadVisualContent(item: {
  mediaType: "image" | "video";
  url: string;
}): ContentPart | null {
  if (item.mediaType !== "image") return null;
  if (!item.url) return null;
  const trimmed = item.url.replace(/^\//, "");
  const onDisk = join(process.cwd(), "public", trimmed);
  if (!existsSync(onDisk) || !statSync(onDisk).isFile()) return null;
  // Sniff the real format from magic bytes — extensions lie when files were
  // downloaded from sources that re-encode (e.g. .jpg actually WEBP).
  const sniffed = readImageWithMime(onDisk);
  if (!sniffed) return null;
  return {
    type: "image_base64",
    image_base64: `data:${sniffed.mime};base64,${sniffed.buf.toString("base64")}`,
  };
}

async function ensureVectorIndex(
  db: import("mongodb").Db,
  collectionName: string,
  numDimensions: number,
  indexName: string,
) {
  const col = db.collection(collectionName);

  let existing: Array<{ name: string; status?: string; latestDefinition?: unknown }> = [];
  try {
    existing = (await col.listSearchIndexes().toArray()) as Array<{
      name: string;
      status?: string;
      latestDefinition?: unknown;
    }>;
  } catch (err) {
    console.warn(
      "Could not list search indexes — cluster may not support Atlas Search " +
        "(which is required for $vectorSearch). Continuing.",
    );
    console.warn((err as Error).message);
    return;
  }

  const definition = {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions,
        similarity: "cosine",
      },
      { type: "filter", path: "classification" },
      { type: "filter", path: "releasability" },
      { type: "filter", path: "compartments" },
      { type: "filter", path: "originating_unit" },
    ],
  };

  const found = existing.find((i) => i.name === indexName);
  if (found) {
    console.log(`Vector index "${indexName}" already exists (status=${found.status ?? "?"}).`);
    return;
  }

  console.log(`Creating vector index "${indexName}" (numDimensions=${numDimensions})`);
  await col.createSearchIndex({
    name: indexName,
    type: "vectorSearch",
    definition,
  });
  console.log(`Vector index "${indexName}" creation submitted.`);
}

/**
 * Vector index for the flattened media collection. Filters are on the
 * MediaItem's OWN attributes (classification / releasability / compartments)
 * plus `parentReportId` so we can correlate back to the source report.
 */
async function ensureMediaVectorIndex(
  db: import("mongodb").Db,
  collectionName: string,
  numDimensions: number,
) {
  const col = db.collection(collectionName);
  let existing: Array<{ name: string; status?: string }> = [];
  try {
    existing = (await col.listSearchIndexes().toArray()) as Array<{
      name: string;
      status?: string;
    }>;
  } catch (err) {
    console.warn(
      "Could not list search indexes on media collection — continuing.",
    );
    console.warn((err as Error).message);
    return;
  }
  const found = existing.find((i) => i.name === MEDIA_VECTOR_INDEX);
  if (found) {
    console.log(
      `Vector index "${MEDIA_VECTOR_INDEX}" already exists (status=${found.status ?? "?"}).`,
    );
    return;
  }
  const definition = {
    fields: [
      { type: "vector", path: "embedding", numDimensions, similarity: "cosine" },
      { type: "filter", path: "classification" },
      { type: "filter", path: "releasability" },
      { type: "filter", path: "compartments" },
      { type: "filter", path: "originating_unit" },
      { type: "filter", path: "parentReportId" },
    ],
  };
  console.log(
    `Creating vector index "${MEDIA_VECTOR_INDEX}" on ${collectionName} (numDimensions=${numDimensions})`,
  );
  await col.createSearchIndex({
    name: MEDIA_VECTOR_INDEX,
    type: "vectorSearch",
    definition,
  });
  console.log(`Vector index "${MEDIA_VECTOR_INDEX}" creation submitted.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

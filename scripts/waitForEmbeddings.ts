/**
 * Polls the Atlas vector search index until it reports READY/queryable and the
 * full document set is returnable via $vectorSearch.
 *
 * With manual (client-side) embeddings, vectors are present at insert time —
 * so the only thing we're waiting on is Atlas finishing the search-index build.
 * The simplest reliable signal is to run a low-cost $vectorSearch and wait
 * until the result count matches the seed size.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { MongoClient } from "mongodb";
import { embedQuery } from "../lib/embeddings";

const MONGODB_URI = required("MONGODB_URI");
required("VOYAGE_API_KEY");
const DB = process.env.MONGODB_DB || "abac_demo";
const REPORTS = process.env.MONGODB_REPORTS || "reports";
const VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || "reports_vector";
const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000;

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
  const col = db.collection(REPORTS);

  const expected = await col.countDocuments();
  console.log(`Waiting for vector index "${VECTOR_INDEX}" to cover ${expected} docs...`);

  const probeVector = await embedQuery("supply route disruption");

  const start = Date.now();
  let lastCount = -1;
  while (Date.now() - start < MAX_WAIT_MS) {
    const statusInfo = await indexStatus(col);
    if (statusInfo) {
      process.stdout.write(`  index status: ${statusInfo}\n`);
    }
    let hitCount = -1;
    try {
      const probe = await col
        .aggregate([
          {
            $vectorSearch: {
              index: VECTOR_INDEX,
              path: "embedding",
              queryVector: probeVector,
              limit: expected,
              numCandidates: Math.max(100, expected * 4),
            },
          },
          { $count: "n" },
        ])
        .toArray();
      hitCount = probe[0]?.n ?? 0;
    } catch (err) {
      const msg = (err as Error).message;
      process.stdout.write(`  probe error: ${msg.split("\n")[0]}\n`);
    }

    if (hitCount === expected && hitCount > 0) {
      console.log(`Index ready: ${hitCount}/${expected} docs queryable.`);
      await client.close();
      return;
    }
    if (hitCount !== lastCount && hitCount >= 0) {
      console.log(`  ${hitCount}/${expected} docs queryable`);
      lastCount = hitCount;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  console.error(`Timed out after ${MAX_WAIT_MS / 1000}s waiting for index to become ready.`);
  await client.close();
  process.exit(1);
}

async function indexStatus(col: import("mongodb").Collection): Promise<string | null> {
  try {
    const indexes = (await col.listSearchIndexes().toArray()) as Array<{
      name: string;
      status?: string;
      queryable?: boolean;
    }>;
    const idx = indexes.find((i) => i.name === VECTOR_INDEX);
    if (!idx) return "(not found yet)";
    return `${idx.status ?? "?"}${idx.queryable === false ? " (not yet queryable)" : ""}`;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

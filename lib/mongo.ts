import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  // Don't throw at import time — scripts and routes will fail with a clearer message when used.
  console.warn("[mongo] MONGODB_URI is not set");
}

const dbName = process.env.MONGODB_DB || "abac_demo";

declare global {
  // eslint-disable-next-line no-var
  var __mongoClient: MongoClient | undefined;
}

export function getClient(): MongoClient {
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (!global.__mongoClient) {
    global.__mongoClient = new MongoClient(uri);
  }
  return global.__mongoClient;
}

export async function getDb(): Promise<Db> {
  const client = getClient();
  await client.connect();
  return client.db(dbName);
}

export const COLLECTIONS = {
  reports: process.env.MONGODB_REPORTS || "reports",
  policies: process.env.MONGODB_POLICIES || "policies",
  users: process.env.MONGODB_USERS || "users",
  mediaIndex: process.env.MONGODB_MEDIA_INDEX || "media_index",
  queryEmbeddings: process.env.MONGODB_QUERY_EMBEDDINGS || "queryEmbeddings",
};

export const VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX || "reports_vector";
export const MEDIA_VECTOR_INDEX = process.env.MONGODB_MEDIA_VECTOR_INDEX || "media_vector";
export const EMBEDDING_PATH = "embedding";

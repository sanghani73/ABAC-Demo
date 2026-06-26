/**
 * MongoDB-hosted Voyage AI embedding client.
 *
 * The demo uses the multimodal endpoint for EVERYTHING — report bodies (pure
 * text), media captions (text + image / video frame). One model
 * (`voyage-multimodal-3.5`) means a single 1024-dim space across both the
 * `reports` and `media_index` collections, so a single query vector ranks
 * text and visual hits together.
 *
 * Endpoint: POST https://ai.mongodb.com/v1/multimodalembeddings
 * Bearer:   MongoDB-issued key (set as VOYAGE_API_KEY in .env.local)
 *
 * Used by:
 *   - scripts/seed.ts        (input_type: "document", batched, both reports and media)
 *   - lib/queries.ts         (input_type: "query", single string)
 */

export const DEFAULT_VOYAGE_MODEL = "voyage-multimodal-3.5";
const MULTIMODAL_URL = "https://ai.mongodb.com/v1/multimodalembeddings";

/**
 * Embedding dimensions per Voyage model. Used to size the Atlas vector index.
 * Keep in sync with https://www.mongodb.com/docs/voyageai/models/
 */
export const VOYAGE_DIMENSIONS: Record<string, number> = {
  "voyage-multimodal-3.5": 1024,
  "voyage-multimodal-3": 1024,
  // Text-only models — included so VOYAGE_MODEL can be overridden if needed.
  // Note: text-only models hit a DIFFERENT endpoint (/v1/embeddings) and
  // embedTexts() in this file routes through /multimodalembeddings, so
  // overriding to one of these requires editing the URL too.
  "voyage-3.5": 1024,
  "voyage-3.5-lite": 1024,
  "voyage-3-large": 1024,
  "voyage-3": 1024,
};

export function voyageModel(): string {
  return process.env.VOYAGE_MODEL || DEFAULT_VOYAGE_MODEL;
}

export function voyageDimensions(): number {
  const model = voyageModel();
  const d = VOYAGE_DIMENSIONS[model];
  if (!d) {
    throw new Error(
      `Unknown Voyage model "${model}". Add its dimension to VOYAGE_DIMENSIONS in lib/embeddings.ts.`,
    );
  }
  return d;
}

function voyageApiKey(): string {
  const k = process.env.VOYAGE_API_KEY;
  if (!k) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Get a key at https://cloud.mongodb.com and put it in .env.local",
    );
  }
  return k;
}

export type InputType = "document" | "query";

/**
 * A single element in a multimodal `content` array. The shapes mirror the
 * MongoDB / Voyage multimodal embeddings API verbatim.
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string }
  | { type: "image_base64"; image_base64: string };

interface MultimodalRequestInput {
  content: ContentPart[];
}

interface MultimodalResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { text_tokens?: number; image_pixels?: number; total_tokens?: number };
}

/**
 * Core call into the MongoDB-hosted Voyage multimodal endpoint. Batches up to
 * 128 inputs per request (well below the 1000-input cap) and reassembles
 * defensively by the response's `index`.
 *
 * NOTE: per the API spec, a single request must use EITHER image_url OR
 * image_base64 across its inputs — not both. This helper does not enforce
 * that; pick one encoding per call site.
 */
export async function embedMultimodal(
  inputs: MultimodalRequestInput[],
  inputType: InputType,
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const model = voyageModel();
  const apiKey = voyageApiKey();

  const batchSize = 128;
  const out: number[][] = new Array(inputs.length);
  for (let start = 0; start < inputs.length; start += batchSize) {
    const slice = inputs.slice(start, start + batchSize);
    const res = await fetch(MULTIMODAL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        inputs: slice,
        input_type: inputType,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Voyage multimodal embeddings request failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as MultimodalResponse;
    for (const entry of json.data) {
      out[start + entry.index] = entry.embedding;
    }
  }
  return out;
}

/**
 * Embed a batch of plain-text strings. Implemented on top of `embedMultimodal`
 * by wrapping each string in a single-element text-content array — so report
 * bodies (text-only) and media captions (text + image) hit exactly the same
 * endpoint and the same model.
 */
export async function embedTexts(
  texts: string[],
  inputType: InputType,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const inputs: MultimodalRequestInput[] = texts.map((t) => ({
    content: [{ type: "text", text: t }],
  }));
  return embedMultimodal(inputs, inputType);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedTexts([text], "query");
  return v;
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return embedTexts(texts, "document");
}

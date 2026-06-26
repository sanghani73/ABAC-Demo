import { NextRequest } from "next/server";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { executeABACSearch } from "@/lib/queries";
import { ChatMessage, ChatPart, listChatModels, streamChat } from "@/lib/llm";
import { readImageWithMime } from "@/lib/imageMime";
import type { Report, SearchResult } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Streaming RAG endpoint. Every message re-runs ABAC retrieval so a persona
 * switch mid-conversation works correctly. The model only ever sees what
 * the persona's compiled policy set allows — same guarantee as the rest of
 * the app, applied to the LLM's input.
 *
 * Request body: {personaId, message, history?, model?}
 * Response: text/event-stream of:
 *   - event: "token"   data: {text: "..."}
 *   - event: "sources" data: {citations: [...], totalReturned, totalUnfiltered}
 *   - event: "done"    data: {}
 *   - event: "error"   data: {message}
 */
export async function POST(req: NextRequest) {
  let body: {
    personaId?: string;
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!body.personaId || !body.message) {
    return new Response("personaId and message are required", { status: 400 });
  }

  const model = body.model || listChatModels()[0];
  const personaId = body.personaId;
  const message = body.message;
  const history = body.history ?? [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );

      try {
        // 1) Retrieve with ABAC. Same code path as /api/search.
        const retrieval = await executeABACSearch({
          personaId,
          query: message,
          limit: 6,
        });

        // 2) Build the citations + context. Send sources first so the UI can
        //    render the provenance panel while tokens stream.
        const citations = retrieval.results.map(buildCitation);
        send("sources", {
          citations,
          totalReturned: retrieval.totalReturned,
          totalUnfiltered: retrieval.totalUnfiltered,
          personaId,
          model,
        });

        // 3) Compose the LLM messages: a system prompt that bounds the model
        //    to the retrieved set, prior turns, and the new question along
        //    with the retrieved snippets (text) and visible media (images).
        const systemPrompt = buildSystemPrompt(retrieval);
        const messages = buildMessages(history, message, retrieval);

        // 4) Stream.
        for await (const chunk of streamChat({
          model,
          system: systemPrompt,
          messages,
          maxTokens: 1024,
        })) {
          if (chunk) send("token", { text: chunk });
        }
        send("done", {});
      } catch (err) {
        send("error", { message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Prompt + context construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(retrieval: { results: SearchResult[] }): string {
  const ids = retrieval.results.map((r) => r.doc.reportId).filter(Boolean).join(", ");
  return [
    "You are an analytical assistant operating inside an ABAC-controlled environment.",
    "Answer the user's question using ONLY the provided context. Do not speculate, do not draw on general knowledge.",
    "If the context is empty or insufficient to answer, say so explicitly — do not guess.",
    "Cite supporting reports inline using the format [REPORT_ID] (e.g. [INTREP-2025-0003]).",
    `Available report ids: ${ids || "(none)"}.`,
    "When a field shows [REDACTED] or a media item is marked redacted, do not attempt to infer the underlying value — treat it as unknown.",
  ].join("\n");
}

function buildMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  retrieval: { results: SearchResult[] },
): ChatMessage[] {
  const messages: ChatMessage[] = history.map((h) => ({
    role: h.role,
    parts: [{ type: "text", text: h.content }],
  }));

  // The new user turn carries: the question, then the context as a single
  // text block, then any visible image media inlined as image content parts.
  const parts: ChatPart[] = [
    { type: "text", text: userMessage },
    { type: "text", text: "\n\n--- CONTEXT (only material the current user is permitted to see) ---\n" + formatContextText(retrieval.results) },
  ];

  for (const r of retrieval.results) {
    for (const m of (r.doc.mediaItems as Array<Record<string, unknown>> | undefined) ?? []) {
      if (m?.redacted === true) continue;
      const url = m?.url as string | undefined;
      const visual = url ? loadImageAsPart(url, m.caption as string | undefined, r.doc.reportId as string | undefined) : null;
      if (visual) parts.push(...visual);
    }
  }

  messages.push({ role: "user", parts });
  return messages;
}

function formatContextText(results: SearchResult[]): string {
  if (results.length === 0) {
    return "(No documents are accessible to this persona for this query.)";
  }
  return results
    .map((r) => {
      const d = r.doc as Partial<Report>;
      const lines: string[] = [];
      lines.push(`### ${d.reportId} — ${d.title ?? "(no title)"}`);
      lines.push(`Classification: ${d.classification ?? "?"} | Releasability: ${(d.releasability ?? []).join("/")} | Compartments: ${(d.compartments ?? []).join(", ") || "(none)"}`);
      if (d.summary) lines.push(`Summary: ${d.summary}`);
      if (d.body) lines.push(`Body: ${d.body}`);
      if (d.source_name) lines.push(`Source: ${d.source_name}`);
      if (d.grid_ref) lines.push(`Grid ref: ${d.grid_ref}`);
      if (r.redactedFields.length > 0) lines.push(`(Fields redacted by policy: ${r.redactedFields.join(", ")})`);
      if (r.omittedFields.length > 0) lines.push(`(Fields omitted by policy: ${r.omittedFields.join(", ")})`);
      const mediaSummary = ((d.mediaItems as Array<Record<string, unknown>> | undefined) ?? [])
        .map((m) => {
          if (m.redacted) return `${m.mediaId}: [REDACTED MEDIA — ${m.reason ?? "access denied"}]`;
          return `${m.mediaId} (${m.mediaType}): ${m.caption}`;
        });
      if (mediaSummary.length > 0) {
        lines.push("Attached media:");
        for (const s of mediaSummary) lines.push(`  - ${s}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Load a referenced public/media/* image as a {text-caption, image} pair so
 * the model knows which reportId the image belongs to. Returns null for
 * missing files or unsupported types — the model still gets the caption via
 * the text context above, so behaviour degrades gracefully.
 */
function loadImageAsPart(
  url: string,
  caption: string | undefined,
  reportId: string | undefined,
): ChatPart[] | null {
  const trimmed = url.replace(/^\//, "");
  const onDisk = join(process.cwd(), "public", trimmed);
  if (!existsSync(onDisk) || !statSync(onDisk).isFile()) return null;
  // Sniff the real format from magic bytes — extensions lie when the file
  // was downloaded from a source that re-encoded (e.g. .jpg actually WEBP).
  const sniffed = readImageWithMime(onDisk);
  if (!sniffed) return null;
  return [
    { type: "text", text: `\n[Attached image from ${reportId ?? "?"}: ${caption ?? ""}]` },
    { type: "image_base64", mediaType: sniffed.mime, base64: sniffed.buf.toString("base64") },
  ];
}

interface Citation {
  reportId: string;
  title: string;
  classification: string;
  redactedFields: string[];
  omittedFields: string[];
  redactedMediaIds: string[];
  matchedMediaIds: string[];
  matchSource: SearchResult["matchSource"];
  score?: number;
}

function buildCitation(r: SearchResult): Citation {
  const d = r.doc;
  return {
    reportId: d.reportId ?? "",
    title: d.title ?? "",
    classification: (d.classification as string) ?? "OFFICIAL",
    redactedFields: r.redactedFields,
    omittedFields: r.omittedFields,
    redactedMediaIds: r.redactedMediaIds,
    matchedMediaIds: r.matchedMediaIds,
    matchSource: r.matchSource,
    score: typeof d.score === "number" ? d.score : undefined,
  };
}

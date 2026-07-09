"use client";
import { useState } from "react";
import type { SearchResult } from "@/lib/types";

const CLASS_CLASS: Record<string, string> = {
  TOP_SECRET: "chip-ts",
  SECRET: "chip-s",
  OFFICIAL: "chip-off",
};

const ALL_FIELDS = ["source_name", "grid_ref", "originating_unit", "summary", "body"];

interface RawMedia {
  mediaId: string;
  mediaType: "image" | "video";
  redacted?: boolean;
  reason?: string;
  url?: string;
  caption?: string;
  capturedAt?: string;
  classification?: string;
  releasability?: string[];
  compartments?: string[];
}

export default function ReportCard({ result }: { result: SearchResult }) {
  const d = result.doc as Record<string, unknown>;
  const classification = (d.classification as string) ?? "OFFICIAL";

  const omittedFromList = ALL_FIELDS.filter((f) => !(f in d));
  const omitted = Array.from(new Set([...result.omittedFields, ...omittedFromList])).filter(
    (f) => f !== "body" && f !== "summary",
  );

  const mediaItems = ((d.mediaItems as RawMedia[] | undefined) ?? []).filter(Boolean);
  const visibleMediaCount = mediaItems.filter((m) => !m.redacted).length;
  const redactedMediaCount = mediaItems.length - visibleMediaCount;

  return (
    <div className="rounded-lg border border-edge bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-slate-500">{(d.reportId as string) ?? ""}</span>
        <span className={`chip ${CLASS_CLASS[classification]}`}>{classification.replace("_", " ")}</span>
        {(d.compartments as string[] | undefined)?.map((c) => (
          <span key={c} className="chip">{c}</span>
        ))}
        {(d.releasability as string[] | undefined) && (
          <span className="chip" title="Releasability">
            REL {((d.releasability as string[]) ?? []).join("/")}
          </span>
        )}
        {result.matchSource === "media" && (
          <span
            className="chip"
            style={{ background: "#EEF2FF", color: "#3730A3", borderColor: "#C7D2FE" }}
            title="Surfaced because an attached media item matched the query"
          >
            via media
          </span>
        )}
        {result.matchSource === "both" && (
          <span
            className="chip"
            style={{ background: "#ECFDF5", color: "#065F46", borderColor: "#A7F3D0" }}
            title="Both the report text and an attached media item matched"
          >
            text + media
          </span>
        )}
        {typeof d.score === "number" && (
          <span className="ml-auto chip" title="Vector search score">
            score {Number(d.score).toFixed(3)}
          </span>
        )}
      </div>
      <h3 className="font-semibold text-slate-900 mt-2">{(d.title as string) ?? "(no title)"}</h3>
      {d.summary !== undefined && (
        <p className="text-sm text-slate-700 mt-1">
          <FieldValue value={d.summary as string} redacted={result.redactedFields.includes("summary")} />
        </p>
      )}
      <details className="mt-2 text-sm text-slate-700">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Body</summary>
        <p className="mt-1">
          <FieldValue value={d.body as string | undefined} redacted={result.redactedFields.includes("body")} />
        </p>
      </details>

      <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
        <div>
          <div className="text-slate-500">Source</div>
          <FieldOrPlaceholder value={d.source_name} redacted={result.redactedFields.includes("source_name")} omitted={result.omittedFields.includes("source_name") || !("source_name" in d)} />
        </div>
        <div>
          <div className="text-slate-500">Grid ref</div>
          <FieldOrPlaceholder value={d.grid_ref} redacted={result.redactedFields.includes("grid_ref")} omitted={result.omittedFields.includes("grid_ref") || !("grid_ref" in d)} />
        </div>
        <div>
          <div className="text-slate-500">Originating unit</div>
          <FieldOrPlaceholder value={d.originating_unit} redacted={result.redactedFields.includes("originating_unit")} omitted={result.omittedFields.includes("originating_unit") || !("originating_unit" in d)} />
        </div>
      </div>

      {mediaItems.length > 0 && (
        <div className="mt-4 border-t border-edge pt-3">
          <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">Attached media</span>
            <span>· {visibleMediaCount} visible</span>
            {redactedMediaCount > 0 && (
              <span className="text-red-700">· {redactedMediaCount} redacted</span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {mediaItems.map((m) => (
              <MediaTile
                key={m.mediaId}
                item={m}
                matched={result.matchedMediaIds.includes(m.mediaId)}
              />
            ))}
          </div>
        </div>
      )}

      {(result.redactedFields.length > 0 || omitted.length > 0 || redactedMediaCount > 0) && (
        <div className="mt-3 text-xs text-slate-500 border-t border-edge pt-2">
          {result.redactedFields.length > 0 && (
            <div>
              <span className="text-slate-500">Redacted:</span>{" "}
              <span className="text-red-700">{result.redactedFields.join(", ")}</span>
            </div>
          )}
          {omitted.length > 0 && (
            <div>
              <span className="text-slate-500">Omitted:</span>{" "}
              <span className="text-amber-700">{omitted.join(", ")}</span>
            </div>
          )}
          {redactedMediaCount > 0 && (
            <div>
              <span className="text-slate-500">Media redacted:</span>{" "}
              <span className="text-red-700">
                {result.redactedMediaIds.join(", ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldValue({ value, redacted }: { value: string | undefined; redacted: boolean }) {
  if (redacted || value === "[REDACTED]") return <span className="redacted">[REDACTED]</span>;
  return <>{value ?? ""}</>;
}

function FieldOrPlaceholder({
  value,
  redacted,
  omitted,
}: {
  value: unknown;
  redacted: boolean;
  omitted: boolean;
}) {
  if (omitted) return <span className="text-amber-700 italic">omitted</span>;
  if (redacted || value === "[REDACTED]") return <span className="redacted">[REDACTED]</span>;
  return <span className="text-slate-800">{(value as string) ?? ""}</span>;
}

function MediaTile({ item, matched }: { item: RawMedia; matched: boolean }) {
  if (item.redacted) {
    return (
      <div className="media-tile media-tile-redacted">
        <div className="media-thumb media-thumb-redacted">
          <span className="media-lock">REDACTED</span>
          <span className="media-type-tag">{item.mediaType.toUpperCase()}</span>
        </div>
        <div className="mt-1 text-[11px] text-red-700 leading-snug">
          {item.reason ?? "Access denied by media policy"}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-slate-400">{item.mediaId}</div>
      </div>
    );
  }
  return (
    <div className={`media-tile ${matched ? "media-tile-matched" : ""}`}>
      <MediaThumb item={item} />
      {matched && (
        <div className="mt-1 text-[10px] font-semibold tracking-wider text-indigo-700 uppercase">
          ▸ matched the query
        </div>
      )}
      <div className="mt-1 text-[11px] text-slate-700 leading-snug">
        {item.caption ?? ""}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {item.classification && (
          <span className={`chip ${CLASS_CLASS[item.classification] ?? ""}`}>
            {item.classification.replace("_", " ")}
          </span>
        )}
        {item.compartments?.map((c) => (
          <span key={c} className="chip">{c}</span>
        ))}
        {item.releasability && item.releasability.length > 0 && (
          <span className="chip" title="Releasability">REL {item.releasability.join("/")}</span>
        )}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-slate-400">{item.mediaId}</div>
    </div>
  );
}

function MediaThumb({ item }: { item: RawMedia }) {
  const [errored, setErrored] = useState(false);
  if (errored || !item.url) {
    return (
      <div className="media-thumb media-thumb-placeholder">
        <span className="media-type-tag">{item.mediaType.toUpperCase()}</span>
        <span className="text-[10px] text-slate-500 mt-1">no preview file</span>
      </div>
    );
  }
  if (item.mediaType === "video") {
    return (
      <video
        className="media-thumb"
        src={item.url}
        controls
        muted
        playsInline
        preload="metadata"
        onError={() => setErrored(true)}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={item.url}
      alt={item.caption ?? item.mediaId}
      className="media-thumb"
      onError={() => setErrored(true)}
    />
  );
}

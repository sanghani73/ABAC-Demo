"use client";
import { useCallback, useEffect, useState } from "react";
import { usePersona } from "@/components/PersonaProvider";
import PersonaCard from "@/components/PersonaCard";
import ReportCard from "@/components/ReportCard";
import PipelinePanel from "@/components/PipelinePanel";
import ChatDrawer from "@/components/ChatDrawer";
import type { SearchResult } from "@/lib/types";

const SAMPLE_QUERIES = [
  "supply route disruption near Murmansk",
  "northern fleet activity",
  "OP NEPTUNE planning indicators",
  "logistics readiness in 3 Cdo Bde",
  "coalition exercise fuel",
];

export default function SearchPage() {
  const { active, activeId } = usePersona();
  // const [query, setQuery] = useState(SAMPLE_QUERIES[0]);
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pipeline, setPipeline] = useState<unknown[]>([]);
  const [mediaPipeline, setMediaPipeline] = useState<unknown[]>([]);
  const [totalUnfiltered, setTotalUnfiltered] = useState<number>(-1);
  const [mode, setMode] = useState<"semantic" | "browse">("browse");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPrefill, setChatPrefill] = useState<string | undefined>(undefined);

  const run = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    setError(null);
    try {
      const url = mode === "semantic" ? "/api/search" : "/api/browse";
      const body =
        mode === "semantic"
          ? { personaId: activeId, query, limit: 20 }
          : { personaId: activeId, limit: 50 };
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Request failed");
      setResults(data.results);
      setPipeline(data.pipeline);
      setMediaPipeline(data.mediaPipeline ?? []);
      setTotalUnfiltered(data.totalUnfiltered ?? -1);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
      setPipeline([]);
      setMediaPipeline([]);
    } finally {
      setLoading(false);
    }
  }, [activeId, query, mode]);

  // Re-run when the persona changes (so browse results re-shape live) or
  // when the user switches INTO browse mode. Switching into semantic mode
  // intentionally does NOT auto-run — the audience should see an empty
  // results area until they choose a query and press Search.
  useEffect(() => {
    if (!activeId) return;
    if (mode === "semantic") {
      // Clear stale state from the previous mode and wait for user input.
      setResults([]);
      setPipeline([]);
      setMediaPipeline([]);
      setTotalUnfiltered(-1);
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, mode]);

  return (
    <div className="grid grid-cols-12 gap-6">
      <aside className="col-span-12 lg:col-span-3 space-y-4">
        <PersonaCard persona={active} />
        <div className="rounded-lg border border-edge bg-white p-4 text-xs text-slate-600 shadow-sm">
          <div className="font-semibold text-slate-900 mb-2">How this demo works</div>
          <p className="mb-2">
            Each search runs the same MongoDB pipeline. The policy engine injects an ABAC{" "}
            <span className="text-accent font-semibold">$vectorSearch.filter</span> so the kNN never sees rows
            the persona can&apos;t access, and a <span className="text-accent font-semibold">$set</span> stage
            applies field-level redactions and omissions.
          </p>
          <p>
            Switch persona above to see the <em>same</em> query return different rows and different
            fields. Expand the pipeline panel below the results to see what Mongo actually ran.
          </p>
        </div>
      </aside>

      <section className="col-span-12 lg:col-span-9 space-y-4">
        <div className="rounded-lg border border-edge bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setMode("browse")}
              className={`px-3 py-1 rounded text-sm font-medium ${mode === "browse" ? "bg-accent text-white" : "border border-edge text-slate-700 hover:border-accent hover:text-accent"}`}
            >
              Browse all
            </button>
            <button
              onClick={() => setMode("semantic")}
              className={`px-3 py-1 rounded text-sm font-medium ${mode === "semantic" ? "bg-accent text-white" : "border border-edge text-slate-700 hover:border-accent hover:text-accent"}`}
            >
              Semantic search
            </button>
            <span className="ml-auto text-xs text-slate-500">
              {mode === "semantic" ? "$vectorSearch with ABAC pre-filter (Voyage embeddings)" : "$match with ABAC filter"}
            </span>
          </div>

          {mode === "semantic" && (
            <>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-white border border-edge rounded px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-accent"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run();
                  }}
                  placeholder="Natural language query — e.g. 'supply route disruption near Murmansk'"
                />
                <button
                  onClick={run}
                  className="px-4 py-2 bg-accent text-white rounded text-sm font-semibold hover:bg-accentEdge hover:text-accent disabled:opacity-60"
                  disabled={loading}
                >
                  {loading ? "Searching..." : "Search"}
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {SAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setQuery(q);
                      setTimeout(() => run(), 0);
                    }}
                    className="text-xs px-2 py-1 border border-edge rounded text-slate-600 hover:text-accent hover:border-accent"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <ResultsSummary
            mode={mode}
            shown={results.length}
            totalUnfiltered={totalUnfiltered}
            isAuditor={!!active?.isAuditor}
          />
          {mode === "semantic" && results.length > 0 && (
            <button
              onClick={() => {
                setChatPrefill(query);
                setChatOpen(true);
              }}
              className="ml-auto text-xs px-2 py-1 rounded border border-edge text-slate-700 hover:border-accent hover:text-accent"
              title="Open the chat drawer pre-loaded with this query"
            >
              Ask about these results →
            </button>
          )}
        </div>

        <div className="space-y-3">
          {results.map((r, i) => (
            <ReportCard key={(r.doc.reportId as string) ?? i} result={r} />
          ))}
          {!loading && results.length === 0 && (
            <div className="rounded-lg border border-edge bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
              No results visible to this persona for this query.
            </div>
          )}
        </div>

        <PipelinePanel
          pipeline={pipeline}
          label="Reports pipeline"
          subtitle="$vectorSearch over report bodies with ABAC pre-filter"
        />
        {mediaPipeline.length > 0 && (
          <PipelinePanel
            pipeline={mediaPipeline}
            label="Media pipeline"
            subtitle="$vectorSearch over the flattened media collection — same query vector, per-item ABAC"
          />
        )}
      </section>

      <button
        onClick={() => {
          setChatPrefill(undefined);
          setChatOpen((v) => !v);
        }}
        className="fixed bottom-6 right-6 z-30 px-4 py-3 rounded-full bg-accent text-white shadow-lg hover:bg-accentEdge hover:text-accent text-sm font-semibold"
      >
        {chatOpen ? "Close chat" : "Ask AI ▸"}
      </button>

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        prefilledQuery={chatPrefill}
      />
    </div>
  );
}

function ResultsSummary({
  mode,
  shown,
  totalUnfiltered,
  isAuditor,
}: {
  mode: string;
  shown: number;
  totalUnfiltered: number;
  isAuditor: boolean;
}) {
  if (totalUnfiltered < 0) return null;
  const hidden = Math.max(0, totalUnfiltered - shown);
  return (
    <div className="text-sm text-slate-600 flex items-center gap-3">
      <span>
        Showing <strong className="text-slate-900">{shown}</strong>{" "}
        {mode === "semantic" ? "matches" : "records"} visible to this persona
      </span>
      {hidden > 0 && !isAuditor && (
        <span className="chip" style={{ background: "#FEF3C7", color: "#92400E", borderColor: "#FDE68A" }}>
          {hidden} hidden by row-level policy
        </span>
      )}
      {isAuditor && (
        <span className="chip chip-accent">AUDITOR — row policies bypassed</span>
      )}
    </div>
  );
}

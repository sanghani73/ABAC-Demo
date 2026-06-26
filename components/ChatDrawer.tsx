"use client";
import { useEffect, useRef, useState } from "react";
import { usePersona } from "@/components/PersonaProvider";

interface Citation {
  reportId: string;
  title: string;
  classification: string;
  redactedFields: string[];
  omittedFields: string[];
  redactedMediaIds: string[];
  matchedMediaIds: string[];
  matchSource: "text" | "media" | "both";
  score?: number;
}

interface SourcesEvent {
  citations: Citation[];
  totalReturned: number;
  totalUnfiltered: number;
  personaId: string;
  model: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: SourcesEvent;
}

const CLASS_CLASS: Record<string, string> = {
  TOP_SECRET: "chip-ts",
  SECRET: "chip-s",
  OFFICIAL: "chip-off",
};

export default function ChatDrawer({
  open,
  onClose,
  prefilledQuery,
}: {
  open: boolean;
  onClose: () => void;
  prefilledQuery?: string;
}) {
  const { active, activeId } = usePersona();
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState<string>("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personaWarning, setPersonaWarning] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lastPersonaIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/chat/models")
      .then((r) => r.json())
      .then((d) => {
        const list = (d.models as string[]) ?? [];
        setModels(list);
        if (list.length > 0) setModel(list[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (prefilledQuery && open) setInput(prefilledQuery);
  }, [prefilledQuery, open]);

  // When the active persona changes, wipe the conversation. Continuing a
  // thread across personas would mix one user's answers into another user's
  // context window — the model would summarise material the new persona may
  // not be permitted to see, which would silently break the security story
  // the demo is making.
  useEffect(() => {
    if (lastPersonaIdRef.current && activeId && lastPersonaIdRef.current !== activeId) {
      setTurns([]);
      setInput("");
      setError(null);
      setPersonaWarning(
        `Chat reset — now operating as ${active?.name ?? activeId}.`,
      );
    }
    lastPersonaIdRef.current = activeId ?? null;
  }, [activeId, active?.name]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [turns, streaming]);

  const send = async () => {
    if (!input.trim() || !activeId || streaming) return;
    setError(null);

    const userTurn: Turn = { role: "user", content: input.trim() };
    const assistantTurn: Turn = { role: "assistant", content: "" };
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, userTurn, assistantTurn]);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personaId: activeId,
          message: userTurn.content,
          history,
          model,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Chat request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          handleEvent(chunk);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStreaming(false);
    }

    function handleEvent(chunk: string) {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) return;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        return;
      }
      if (eventName === "token" && typeof data.text === "string") {
        setTurns((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + (data.text as string) };
          }
          return next;
        });
      } else if (eventName === "sources") {
        setTurns((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, sources: data as unknown as SourcesEvent };
          }
          return next;
        });
      } else if (eventName === "error") {
        setError(String(data.message ?? "Unknown error"));
      }
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[460px] bg-white border-l border-edge shadow-2xl z-40 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-edge">
        <div className="text-sm font-semibold text-slate-900">Chat — RAG over your accessible data</div>
        <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-800 text-lg leading-none">×</button>
      </div>

      <div className="px-4 py-2 border-b border-edge text-xs text-slate-600 flex items-center gap-2 flex-wrap">
        <span>Persona:</span>
        <span className="chip">{active?.name ?? "(none)"}</span>
        <span className="ml-auto">Model:</span>
        <select
          className="input !w-auto !py-0.5"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {personaWarning && (
        <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
          {personaWarning}
          <button className="ml-2 underline" onClick={() => setPersonaWarning(null)}>dismiss</button>
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
        {turns.length === 0 && (
          <div className="text-slate-500 italic">
            Ask anything. The retrieval step uses the same ABAC pipeline as <em>Search</em> — the model only sees what {active?.name ?? "this persona"} is permitted to see.
          </div>
        )}
        {turns.map((t, i) => (
          <Turn key={i} turn={t} />
        ))}
        {streaming && (
          <div className="text-xs text-slate-400 italic">streaming…</div>
        )}
        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
        )}
      </div>

      <div className="border-t border-edge p-3">
        <div className="flex gap-2">
          <textarea
            className="input flex-1 resize-none"
            rows={2}
            placeholder="Ask a question about the accessible reports…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="px-3 py-2 bg-accent text-white rounded text-sm font-semibold hover:bg-accentEdge hover:text-accent disabled:opacity-60"
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Enter to send · Shift+Enter for newline · Retrieval re-runs on every message
        </div>
      </div>
    </div>
  );
}

function Turn({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-accent text-white px-3 py-2 text-sm whitespace-pre-wrap">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="max-w-[95%] rounded-lg bg-slate-50 border border-edge px-3 py-2 text-sm whitespace-pre-wrap text-slate-900">
        {turn.content || <span className="text-slate-400 italic">retrieving…</span>}
      </div>
      {turn.sources && <Sources sources={turn.sources} />}
    </div>
  );
}

function Sources({ sources }: { sources: SourcesEvent }) {
  if (sources.citations.length === 0) {
    return (
      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
        No documents were accessible for this query — the model was told to say so.
      </div>
    );
  }
  return (
    <details className="text-xs text-slate-600 border border-edge rounded">
      <summary className="cursor-pointer px-2 py-1 bg-slate-50">
        Sources ({sources.citations.length}) · retrieved with ABAC pre-filter
      </summary>
      <div className="p-2 space-y-2">
        {sources.citations.map((c) => (
          <div key={c.reportId} className="border-t border-edge first:border-t-0 pt-2 first:pt-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="font-mono text-[10px] text-slate-500">{c.reportId}</span>
              <span className={`chip ${CLASS_CLASS[c.classification] ?? ""}`}>
                {c.classification.replace("_", " ")}
              </span>
              {c.matchSource === "media" && (
                <span className="chip" style={{ background: "#EEF2FF", color: "#3730A3", borderColor: "#C7D2FE" }}>
                  via media
                </span>
              )}
              {c.matchSource === "both" && (
                <span className="chip" style={{ background: "#ECFDF5", color: "#065F46", borderColor: "#A7F3D0" }}>
                  text + media
                </span>
              )}
              {typeof c.score === "number" && (
                <span className="chip ml-auto">score {c.score.toFixed(3)}</span>
              )}
            </div>
            <div className="text-slate-800 mt-0.5">{c.title}</div>
            {(c.redactedFields.length > 0 || c.omittedFields.length > 0 || c.redactedMediaIds.length > 0) && (
              <div className="text-[10px] mt-1">
                {c.redactedFields.length > 0 && (
                  <span className="text-red-700 mr-2">redacted: {c.redactedFields.join(", ")}</span>
                )}
                {c.omittedFields.length > 0 && (
                  <span className="text-amber-700 mr-2">omitted: {c.omittedFields.join(", ")}</span>
                )}
                {c.redactedMediaIds.length > 0 && (
                  <span className="text-red-700">media redacted: {c.redactedMediaIds.join(", ")}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

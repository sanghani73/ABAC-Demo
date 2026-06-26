"use client";
import { useEffect, useState } from "react";
import { usePersona } from "./PersonaProvider";
import type { Persona, SearchResult } from "@/lib/types";

export default function TestAsPersonaPanel() {
  const { personas } = usePersona();
  const [testId, setTestId] = useState<string>("");
  const [counts, setCounts] = useState<Array<{ persona: Persona; count: number; redacted: number; omitted: number; error?: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (personas.length > 0) setTestId(personas[0].id);
  }, [personas]);

  const runAll = async () => {
    setLoading(true);
    const out: typeof counts = [];
    for (const p of personas) {
      try {
        const r = await fetch("/api/browse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId: p.id, limit: 200 }),
        });
        const data = await r.json();
        if (!r.ok) {
          out.push({ persona: p, count: 0, redacted: 0, omitted: 0, error: data.error });
          continue;
        }
        const results = data.results as SearchResult[];
        const redacted = results.reduce((acc, x) => acc + x.redactedFields.length, 0);
        const omitted = results.reduce((acc, x) => acc + x.omittedFields.length, 0);
        out.push({ persona: p, count: results.length, redacted, omitted });
      } catch (err) {
        out.push({ persona: p, count: 0, redacted: 0, omitted: 0, error: (err as Error).message });
      }
    }
    setCounts(out);
    setLoading(false);
  };

  return (
    <div className="rounded-lg border border-edge bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-sm text-slate-900">Test policies against all personas</h3>
        <button
          onClick={runAll}
          className="ml-auto text-xs px-3 py-1 bg-accent text-white rounded font-semibold hover:bg-accentEdge hover:text-accent disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Running..." : "Run preview"}
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-1">
        Browses the dataset as each persona using the current policy set, so you can see how a
        policy change affects visibility before going live.
      </p>
      {counts.length > 0 && (
        <table className="w-full text-sm mt-3">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="text-left py-1">Persona</th>
              <th className="text-right py-1">Rows</th>
              <th className="text-right py-1">Redacted fields</th>
              <th className="text-right py-1">Omitted fields</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.persona.id} className="border-t border-edge">
                <td className="py-1">
                  <div className="font-medium text-slate-900">{c.persona.role}</div>
                  <div className="text-xs text-slate-500">{c.persona.name}</div>
                </td>
                <td className="text-right text-slate-800">{c.count}</td>
                <td className="text-right text-red-700">{c.redacted}</td>
                <td className="text-right text-amber-700">{c.omitted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

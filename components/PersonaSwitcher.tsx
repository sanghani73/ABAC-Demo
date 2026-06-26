"use client";
import { usePersona } from "./PersonaProvider";

export default function PersonaSwitcher() {
  const { personas, activeId, setActiveId, active } = usePersona();

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-500">Persona</span>
      <select
        value={activeId}
        onChange={(e) => setActiveId(e.target.value)}
        className="bg-white border border-edge rounded px-2 py-1 text-slate-900 focus:outline-none focus:border-accent"
      >
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.role} — {p.name}
          </option>
        ))}
      </select>
      {active?.isAuditor && (
        <span className="chip chip-accent">AUDITOR</span>
      )}
    </div>
  );
}

"use client";
import type { Persona } from "@/lib/types";

const CLASS_CLASS: Record<string, string> = {
  TOP_SECRET: "chip-ts",
  SECRET: "chip-s",
  OFFICIAL: "chip-off",
};

export default function PersonaCard({ persona }: { persona: Persona | undefined }) {
  if (!persona) return null;
  return (
    <div className="rounded-lg border border-edge bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="font-semibold text-slate-900">{persona.name}</div>
        <span className={`chip ${CLASS_CLASS[persona.clearance] ?? ""}`}>
          {persona.clearance.replace("_", " ")}
        </span>
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{persona.role}</div>
      <p className="text-xs text-slate-600 mt-2 leading-relaxed">{persona.description}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-slate-500">Nationality</div>
          <div className="text-slate-800">{persona.nationality}</div>
        </div>
        <div>
          <div className="text-slate-500">Unit</div>
          <div className="text-slate-800">{persona.unit}</div>
        </div>
        <div className="col-span-2">
          <div className="text-slate-500">Compartments</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {persona.compartments.length === 0 ? (
              <span className="text-slate-400 italic">none</span>
            ) : (
              persona.compartments.map((c) => (
                <span key={c} className="chip">{c}</span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

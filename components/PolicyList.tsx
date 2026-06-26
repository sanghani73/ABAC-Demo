"use client";
import type { Policy } from "@/lib/types";

export default function PolicyList({
  policies,
  activeId,
  onSelect,
  onToggle,
  onDelete,
  onNew,
}: {
  policies: Policy[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onToggle: (p: Policy) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="space-y-2">
      <button
        onClick={onNew}
        className="w-full text-left px-3 py-2 bg-accentSoft text-accent border border-accentEdge rounded text-sm font-medium hover:bg-accent hover:text-white transition-colors"
      >
        + New policy
      </button>
      {policies.map((p) => {
        const isActive = p.policyId === activeId;
        return (
          <div
            key={p.policyId}
            className={`border rounded p-2 cursor-pointer shadow-sm transition-colors ${
              isActive ? "border-accent bg-accentSoft" : "border-edge bg-white hover:border-accent"
            }`}
            onClick={() => onSelect(p.policyId)}
          >
            <div className="flex items-center gap-2">
              <span className={`chip ${p.target === "row" ? "" : "chip-s"}`}>{p.target}</span>
              <span className={`chip ${p.effect === "allow" ? "chip-off" : p.effect === "deny" ? "chip-ts" : ""}`}>
                {p.effect}
              </span>
              {p.fieldPath && <span className="chip">{p.fieldPath}</span>}
              <label
                className="ml-auto text-xs flex items-center gap-1 text-slate-600"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={p.enabled !== false}
                  onChange={() => onToggle(p)}
                />
                on
              </label>
            </div>
            <div className="text-sm mt-1 font-medium text-slate-900">{p.name}</div>
            <div className="text-xs text-slate-500 line-clamp-2">{p.description}</div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono text-slate-500">{p.policyId}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete policy "${p.name}"?`)) onDelete(p.policyId);
                }}
                className="ml-auto text-xs text-red-700 hover:text-red-900"
              >
                delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

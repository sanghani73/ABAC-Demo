"use client";
import type { Persona } from "@/lib/types";

const CLASS_CLASS: Record<string, string> = {
  TOP_SECRET: "chip-ts",
  SECRET: "chip-s",
  OFFICIAL: "chip-off",
};

export default function UserList({
  users,
  activeId,
  onSelect,
  onDelete,
  onNew,
}: {
  users: Persona[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="space-y-2">
      <button
        onClick={onNew}
        className="w-full text-left px-3 py-2 bg-accentSoft text-accent border border-accentEdge rounded text-sm font-medium hover:bg-accent hover:text-white transition-colors"
      >
        + New user
      </button>
      {users.map((u) => {
        const isActive = u.id === activeId;
        return (
          <div
            key={u.id}
            className={`border rounded p-2 cursor-pointer shadow-sm transition-colors ${
              isActive ? "border-accent bg-accentSoft" : "border-edge bg-white hover:border-accent"
            }`}
            onClick={() => onSelect(u.id)}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`chip ${CLASS_CLASS[u.clearance] ?? ""}`}>
                {u.clearance.replace("_", " ")}
              </span>
              <span className="chip">{u.nationality}</span>
              <span className="chip">{u.unit}</span>
              {u.isAuditor && <span className="chip chip-accent">AUDITOR</span>}
            </div>
            <div className="text-sm mt-1 font-medium text-slate-900">{u.role}</div>
            <div className="text-xs text-slate-500">{u.name}</div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-mono text-slate-500">{u.id}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete user "${u.name}"?`)) onDelete(u.id);
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

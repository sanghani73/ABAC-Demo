"use client";
import { useEffect, useState } from "react";
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
  // Tick once a second so the validity countdown chips update live.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!policies.some((p) => p.validFrom || p.validUntil)) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [policies]);
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`chip ${p.target === "row" ? "" : "chip-s"}`}>{p.target}</span>
              <span className={`chip ${p.effect === "allow" ? "chip-off" : p.effect === "deny" ? "chip-ts" : ""}`}>
                {p.effect}
              </span>
              {p.fieldPath && <span className="chip">{p.fieldPath}</span>}
              <ValidityChip policy={p} />
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

/**
 * Renders a small status chip describing where the policy is in its
 * validity window relative to now. Returns null when both bounds are blank
 * (the common case — a permanent policy needs no chip).
 *
 * The clock used here is the browser's, not the server's. Server-side ABAC
 * decisions are the authority; this chip is informational.
 */
function ValidityChip({ policy }: { policy: Policy }) {
  if (!policy.validFrom && !policy.validUntil) return null;
  const now = Date.now();
  const from = policy.validFrom ? Date.parse(policy.validFrom) : null;
  const until = policy.validUntil ? Date.parse(policy.validUntil) : null;

  if (from !== null && !Number.isNaN(from) && now < from) {
    return (
      <span
        className="chip"
        style={{ background: "#EFF6FF", color: "#1E40AF", borderColor: "#BFDBFE" }}
        title={`Starts ${new Date(from).toLocaleString()}`}
      >
        starts in {formatDelta(from - now)}
      </span>
    );
  }
  if (until !== null && !Number.isNaN(until) && now > until) {
    return (
      <span
        className="chip"
        style={{ background: "#F1F5F9", color: "#475569", borderColor: "#CBD5E1" }}
        title={`Expired ${new Date(until).toLocaleString()}`}
      >
        expired {formatDelta(now - until)} ago
      </span>
    );
  }
  if (until !== null && !Number.isNaN(until)) {
    const remaining = until - now;
    const tight = remaining < 60_000;
    return (
      <span
        className="chip"
        style={
          tight
            ? { background: "#FEF2F2", color: "#991B1B", borderColor: "#FECACA" }
            : { background: "#ECFDF5", color: "#065F46", borderColor: "#A7F3D0" }
        }
        title={`Expires ${new Date(until).toLocaleString()}`}
      >
        expires in {formatDelta(remaining)}
      </span>
    );
  }
  // validFrom set, no validUntil, and we're past validFrom.
  return (
    <span
      className="chip"
      style={{ background: "#ECFDF5", color: "#065F46", borderColor: "#A7F3D0" }}
      title={`Started ${new Date(from ?? 0).toLocaleString()}`}
    >
      active
    </span>
  );
}

function formatDelta(ms: number): string {
  if (ms < 0) ms = -ms;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

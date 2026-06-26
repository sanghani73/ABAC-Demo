"use client";
import { useCallback, useEffect, useState } from "react";
import PolicyBuilder from "@/components/PolicyBuilder";
import PolicyList from "@/components/PolicyList";
import TestAsPersonaPanel from "@/components/TestAsPersonaPanel";
import type { Policy } from "@/lib/types";

export default function AdminPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/policies");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPolicies(data.policies);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = creating ? null : policies.find((p) => p.policyId === activeId) ?? null;

  const save = async (p: Policy) => {
    const r = await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    const data = await r.json();
    if (!r.ok) {
      alert(data.error || "Save failed");
      return;
    }
    setCreating(false);
    setActiveId(p.policyId);
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/policies/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    await load();
  };

  const toggle = async (p: Policy) => {
    await fetch(`/api/policies/${p.policyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !(p.enabled !== false) }),
    });
    await load();
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <aside className="col-span-12 lg:col-span-4 space-y-4">
        <PolicyList
          policies={policies}
          activeId={creating ? null : activeId}
          onSelect={(id) => {
            setCreating(false);
            setActiveId(id);
          }}
          onToggle={toggle}
          onDelete={remove}
          onNew={() => {
            setCreating(true);
            setActiveId(null);
          }}
        />
      </aside>

      <section className="col-span-12 lg:col-span-8 space-y-4">
        <div className="rounded-lg border border-edge bg-white p-4 shadow-sm">
          <h2 className="font-semibold mb-2 text-slate-900">
            {creating ? "Create policy" : active ? "Edit policy" : "Select a policy"}
          </h2>
          {error && <div className="text-red-700 text-sm mb-2">{error}</div>}
          {(creating || active) && (
            <PolicyBuilder
              initial={active ?? undefined}
              onSave={save}
              onCancel={() => {
                setCreating(false);
                setActiveId(null);
              }}
            />
          )}
          {!creating && !active && (
            <div className="text-sm text-slate-500">
              Pick a policy on the left to view or edit it, or click <em>+ New policy</em>.
            </div>
          )}
        </div>

        <TestAsPersonaPanel />
      </section>
    </div>
  );
}

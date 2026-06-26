"use client";
import { useCallback, useEffect, useState } from "react";
import UserBuilder from "@/components/UserBuilder";
import UserList from "@/components/UserList";
import type { Persona, Policy, SearchResult } from "@/lib/types";

interface PermissionsSummary {
  rowCount: number;
  redactedTotal: number;
  omittedTotal: number;
  applicableRowPolicies: Policy[];
  applicableFieldPolicies: Policy[];
  notApplicableRowPolicies: Policy[];
  loading: boolean;
  error?: string;
}

const EMPTY_SUMMARY: PermissionsSummary = {
  rowCount: 0,
  redactedTotal: 0,
  omittedTotal: 0,
  applicableRowPolicies: [],
  applicableFieldPolicies: [],
  notApplicableRowPolicies: [],
  loading: false,
};

export default function UsersAdminPage() {
  const [users, setUsers] = useState<Persona[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PermissionsSummary>(EMPTY_SUMMARY);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [uRes, pRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/policies"),
      ]);
      const uData = await uRes.json();
      const pData = await pRes.json();
      if (!uRes.ok) throw new Error(uData.error);
      if (!pRes.ok) throw new Error(pData.error);
      setUsers(uData.users);
      setPolicies(pData.policies);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = creating ? null : users.find((u) => u.id === activeId) ?? null;

  // Whenever a user is selected, browse the corpus as them to compute the
  // permissions summary. This is the audit panel — it shows in one place
  // what policies apply, how many rows are visible, and what's redacted.
  useEffect(() => {
    if (!active) {
      setSummary(EMPTY_SUMMARY);
      return;
    }
    let cancelled = false;
    setSummary((s) => ({ ...s, loading: true, error: undefined }));
    (async () => {
      try {
        const r = await fetch("/api/browse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId: active.id, limit: 500 }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (cancelled) return;
        const results = data.results as SearchResult[];
        const redactedTotal = results.reduce((acc, x) => acc + x.redactedFields.length, 0);
        const omittedTotal = results.reduce((acc, x) => acc + x.omittedFields.length, 0);
        const enabled = policies.filter((p) => p.enabled !== false);
        // Crude per-policy applicability: re-issue the same browse with
        // a single-policy override would be cleanest, but for the demo we
        // approximate by inspecting persona attributes against each policy.
        const { applicableRow, notApplicableRow, applicableField } = classifyPolicies(
          active,
          enabled,
        );
        setSummary({
          rowCount: results.length,
          redactedTotal,
          omittedTotal,
          applicableRowPolicies: applicableRow,
          applicableFieldPolicies: applicableField,
          notApplicableRowPolicies: notApplicableRow,
          loading: false,
        });
      } catch (err) {
        if (!cancelled) {
          setSummary({ ...EMPTY_SUMMARY, error: (err as Error).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, policies]);

  const save = async (p: Persona) => {
    const r = await fetch("/api/users", {
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
    setActiveId(p.id);
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    await load();
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <aside className="col-span-12 lg:col-span-4 space-y-4">
        <UserList
          users={users}
          activeId={creating ? null : activeId}
          onSelect={(id) => {
            setCreating(false);
            setActiveId(id);
          }}
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
            {creating ? "Create user" : active ? "Edit user" : "Select a user"}
          </h2>
          {error && <div className="text-red-700 text-sm mb-2">{error}</div>}
          {(creating || active) && (
            <UserBuilder
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
              Pick a user on the left to view or edit, or click <em>+ New user</em>.
            </div>
          )}
        </div>

        {active && (
          <PermissionsPanel user={active} summary={summary} totalPolicies={policies.length} />
        )}
      </section>
    </div>
  );
}

function PermissionsPanel({
  user,
  summary,
  totalPolicies,
}: {
  user: Persona;
  summary: PermissionsSummary;
  totalPolicies: number;
}) {
  return (
    <div className="rounded-lg border border-edge bg-white p-4 shadow-sm space-y-4">
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold text-slate-900 text-sm">Effective permissions</h3>
        <span className="text-xs text-slate-500">
          for {user.name} ({user.role}) against {totalPolicies} active{" "}
          {totalPolicies === 1 ? "policy" : "policies"}
        </span>
      </div>

      {summary.error && (
        <div className="text-red-700 text-sm">{summary.error}</div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Rows visible" value={summary.rowCount} />
        <Stat label="Fields redacted" value={summary.redactedTotal} tone="warn" />
        <Stat label="Fields omitted" value={summary.omittedTotal} tone="warn" />
      </div>

      <PolicyGroup
        title="Row policies — grant visibility"
        empty="No row policies apply — this persona sees nothing by default."
        policies={summary.applicableRowPolicies}
        accent="ok"
      />
      <PolicyGroup
        title="Row policies — would not grant"
        empty="All row policies are applicable to this persona."
        policies={summary.notApplicableRowPolicies}
        accent="muted"
      />
      <PolicyGroup
        title="Field policies — may redact or omit"
        empty="No field policies."
        policies={summary.applicableFieldPolicies}
        accent="warn"
      />

      {user.isAuditor && (
        <div className="text-xs text-slate-600 border-t border-edge pt-3">
          This user is flagged as an <strong>auditor</strong>. The policy engine bypasses row
          filtering and field redaction for them. In production this should be logged on
          every request.
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const colour =
    tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-accent" : "text-slate-900";
  return (
    <div className="border border-edge rounded p-3 bg-muted">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${colour}`}>{value}</div>
    </div>
  );
}

function PolicyGroup({
  title,
  empty,
  policies,
  accent,
}: {
  title: string;
  empty: string;
  policies: Policy[];
  accent: "ok" | "warn" | "muted";
}) {
  const headerColour =
    accent === "ok"
      ? "text-accent"
      : accent === "warn"
        ? "text-amber-700"
        : "text-slate-500";
  return (
    <div>
      <div className={`text-xs font-semibold uppercase tracking-wide ${headerColour}`}>
        {title} ({policies.length})
      </div>
      {policies.length === 0 ? (
        <div className="text-xs text-slate-500 italic mt-1">{empty}</div>
      ) : (
        <ul className="mt-1 space-y-1">
          {policies.map((p) => (
            <li
              key={p.policyId}
              className="text-sm border border-edge rounded px-2 py-1 flex items-baseline gap-2"
            >
              <span className="font-medium text-slate-900">{p.name}</span>
              {p.fieldPath && <span className="chip">{p.fieldPath}</span>}
              <span className={`chip ${p.effect === "allow" ? "chip-off" : p.effect === "deny" ? "chip-ts" : ""}`}>
                {p.effect}
              </span>
              <span className="ml-auto text-xs font-mono text-slate-500">{p.policyId}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Crude classifier that mirrors lib/policyEngine.ts:
 *   - a row "allow" policy is applicable iff every condition can be satisfied
 *     by *some* document for this persona (e.g. the persona has the matching
 *     nationality, etc.)
 *   - a field policy is applicable iff the persona is not auditor (since
 *     auditors bypass field redaction)
 *
 * This is intentionally an attribute-only check: it tells the operator "could
 * this policy ever fire for this persona", not "will it fire on this exact
 * dataset". The numeric stats above answer the latter.
 */
function classifyPolicies(persona: Persona, policies: Policy[]) {
  const applicableRow: Policy[] = [];
  const notApplicableRow: Policy[] = [];
  const applicableField: Policy[] = [];

  for (const p of policies) {
    if (p.target === "row" && p.effect === "allow") {
      if (canPersonaTrigger(persona, p)) applicableRow.push(p);
      else notApplicableRow.push(p);
    } else if (p.target === "field") {
      if (!persona.isAuditor) applicableField.push(p);
    }
  }
  return { applicableRow, notApplicableRow, applicableField };
}

function canPersonaTrigger(persona: Persona, p: Policy): boolean {
  // Without a doc we can only check persona-side preconditions. The conditions
  // here mirror the operators in lib/policyEngine.ts.
  for (const c of p.conditions) {
    switch (c.op) {
      case "always":
        break;
      case "clearance_gte":
        // Persona always has some clearance; the condition is doc-side.
        break;
      case "field_classification_gte":
        // Doc-side, can't pre-check.
        break;
      case "nationality_in_rel":
        // Persona-side: must have some nationality (always true).
        break;
      case "compartments_superset":
        // Persona-side: if they have no compartments, only docs without
        // compartments match. We mark applicable regardless — the row count
        // tells the operator the actual outcome.
        break;
      case "unit_eq":
        // Persona-side: unit must be set. Treat "*" (auditor) as wildcard,
        // i.e. inapplicable as a row constraint.
        if (!persona.unit || persona.unit === "*") return false;
        break;
      case "classification_eq":
        // Doc-side.
        break;
    }
  }
  return true;
}

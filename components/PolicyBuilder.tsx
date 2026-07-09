"use client";
import { useEffect, useMemo, useState } from "react";
import type { Condition, Operator, Policy } from "@/lib/types";

const OPERATORS: Array<{ op: Operator; label: string; valueLabel?: string }> = [
  { op: "clearance_gte", label: "user.clearance ≥ doc.classification" },
  { op: "field_classification_gte", label: "user.clearance ≥ doc.<field>", valueLabel: "doc field, e.g. source_classification" },
  { op: "nationality_in_rel", label: "user.nationality ∈ doc.releasability" },
  { op: "compartments_superset", label: "user.compartments ⊇ doc.compartments" },
  { op: "unit_eq", label: "user.unit == doc.originating_unit" },
  { op: "classification_eq", label: "doc.classification ==", valueLabel: "OFFICIAL | SECRET | TOP_SECRET" },
];

const EMPTY: Policy = {
  policyId: "",
  name: "",
  description: "",
  target: "row",
  effect: "allow",
  conditions: [],
  enabled: true,
  priority: 100,
};

export default function PolicyBuilder({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Policy | null;
  onSave: (p: Policy) => Promise<void>;
  onCancel: () => void;
}) {
  const [policy, setPolicy] = useState<Policy>(initial ? { ...initial } : { ...EMPTY });

  useEffect(() => {
    setPolicy(initial ? { ...initial } : { ...EMPTY });
  }, [initial]);

  const update = <K extends keyof Policy>(k: K, v: Policy[K]) =>
    setPolicy((p) => ({ ...p, [k]: v }));

  const addCondition = () =>
    setPolicy((p) => ({ ...p, conditions: [...p.conditions, { op: "clearance_gte" }] }));

  const updateCondition = (i: number, patch: Partial<Condition>) =>
    setPolicy((p) => ({
      ...p,
      conditions: p.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));

  const removeCondition = (i: number) =>
    setPolicy((p) => ({ ...p, conditions: p.conditions.filter((_, idx) => idx !== i) }));

  const json = useMemo(() => JSON.stringify(policy, null, 2), [policy]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policy.policyId || !policy.name) return;
    await onSave(policy);
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-12 gap-4">
      <div className="col-span-12 md:col-span-7 space-y-3">
        <Row>
          <Field label="Policy ID (slug)">
            <input
              className="input"
              value={policy.policyId}
              onChange={(e) => update("policyId", e.target.value.replace(/\s+/g, "-").toLowerCase())}
              placeholder="row-clearance-and-rel"
              required
            />
          </Field>
          <Field label="Name">
            <input
              className="input"
              value={policy.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Row access — clearance + releasability"
              required
            />
          </Field>
        </Row>

        <Field label="Description">
          <textarea
            className="input min-h-[60px]"
            value={policy.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            placeholder="What this policy does, in plain English"
          />
        </Field>

        <Row>
          <Field label="Target">
            <select
              className="input"
              value={policy.target}
              onChange={(e) => {
                const next = e.target.value as Policy["target"];
                // Coerce the effect to one that's valid for the new target so
                // we never leave the policy in an inconsistent state.
                const validEffect: Policy["effect"] =
                  next === "row" || next === "media" ? "allow" : "redact";
                setPolicy((p) => ({ ...p, target: next, effect: validEffect }));
              }}
            >
              <option value="row">Row (entire document)</option>
              <option value="field">Field</option>
              <option value="media">Media (single attached image/video)</option>
            </select>
          </Field>
          <Field label="Effect">
            <select
              className="input"
              value={policy.effect}
              onChange={(e) => update("effect", e.target.value as Policy["effect"])}
            >
              {policy.target === "row" && (
                <>
                  <option value="allow">Allow (persona may see row if conditions met)</option>
                  <option value="deny">Deny (hide row if conditions met)</option>
                </>
              )}
              {policy.target === "field" && (
                <>
                  <option value="redact">Redact (replace with [REDACTED])</option>
                  <option value="omit">Omit (remove field)</option>
                </>
              )}
              {policy.target === "media" && (
                <>
                  <option value="allow">Allow (persona may see item if conditions met)</option>
                  <option value="deny">Deny (replace item with redacted stub if conditions met)</option>
                </>
              )}
            </select>
          </Field>
        </Row>

        {policy.target === "field" && (
          <Field label="Field path">
            <input
              className="input"
              value={policy.fieldPath ?? ""}
              onChange={(e) => update("fieldPath", e.target.value)}
              placeholder="e.g. source_name, grid_ref"
              required
            />
          </Field>
        )}

        {policy.target === "media" && (
          <div className="text-xs text-slate-500 italic px-2 py-2 border border-dashed border-edge rounded">
            Media conditions are evaluated against the media item&apos;s OWN
            classification / releasability / compartments — not the parent
            report&apos;s. Use this to gate an individual image or video that&apos;s
            more sensitive than the report it&apos;s attached to.
          </div>
        )}

        <Row>
          <Field label="Priority">
            <input
              type="number"
              className="input"
              value={policy.priority ?? 100}
              onChange={(e) => update("priority", Number(e.target.value))}
            />
          </Field>
          <Field label="Enabled">
            <label className="flex items-center gap-2 text-sm pt-2">
              <input
                type="checkbox"
                checked={policy.enabled !== false}
                onChange={(e) => update("enabled", e.target.checked)}
              />
              Active
            </label>
          </Field>
        </Row>

        <Row>
          <Field label="Valid from (optional)">
            <input
              type="datetime-local"
              className="input"
              value={toLocalInput(policy.validFrom)}
              onChange={(e) =>
                update("validFrom", fromLocalInput(e.target.value))
              }
            />
            <ValidityShortcuts
              onSet={(iso) => update("validFrom", iso)}
              onClear={() => update("validFrom", undefined)}
            />
          </Field>
          <Field label="Valid until (optional)">
            <input
              type="datetime-local"
              className="input"
              value={toLocalInput(policy.validUntil)}
              onChange={(e) =>
                update("validUntil", fromLocalInput(e.target.value))
              }
            />
            <ValidityShortcuts
              onSet={(iso) => update("validUntil", iso)}
              onClear={() => update("validUntil", undefined)}
              future
            />
          </Field>
        </Row>
        <div className="text-xs text-slate-500 -mt-1">
          Server evaluates the validity window on every request. Leave both
          blank for a permanent policy.
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-slate-900 font-semibold">Conditions</span>
            <span className="text-xs text-slate-500">
              {policy.target === "row" && policy.effect === "allow" &&
                "ALL must hold for persona to see the row"}
              {policy.target === "row" && policy.effect === "deny" &&
                "ALL must hold for the row to be hidden"}
              {policy.target === "field" &&
                "ALL must hold for the persona to see this field — otherwise effect applies"}
              {policy.target === "media" && policy.effect === "allow" &&
                "ALL must hold for the persona to see the media item — evaluated against the item's own attributes"}
              {policy.target === "media" && policy.effect === "deny" &&
                "ALL must hold for the media item to be replaced with a redacted stub"}
            </span>
            <button
              type="button"
              onClick={addCondition}
              className="ml-auto text-xs px-2 py-1 border border-edge rounded text-slate-700 hover:text-accent hover:border-accent"
            >
              + Add condition
            </button>
          </div>
          <div className="space-y-2">
            {policy.conditions.length === 0 && (
              <div className="text-xs text-slate-500 italic px-2 py-3 border border-dashed border-edge rounded">
                No conditions — this policy will match all documents.
              </div>
            )}
            {policy.conditions.map((c, i) => {
              const spec = OPERATORS.find((o) => o.op === c.op);
              return (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="input flex-1"
                    value={c.op}
                    onChange={(e) => updateCondition(i, { op: e.target.value as Operator })}
                  >
                    {OPERATORS.map((o) => (
                      <option key={o.op} value={o.op}>{o.label}</option>
                    ))}
                  </select>
                  {spec?.valueLabel && (
                    <input
                      className="input flex-1"
                      value={c.value ?? ""}
                      onChange={(e) => updateCondition(i, { value: e.target.value })}
                      placeholder={spec.valueLabel}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeCondition(i)}
                    className="text-xs px-2 py-1 border border-edge rounded text-red-700 hover:bg-red-50 hover:border-red-300"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button type="submit" className="px-4 py-2 bg-accent text-white rounded text-sm font-semibold hover:bg-accentEdge hover:text-accent">
            Save policy
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-edge rounded text-sm text-slate-700 hover:border-accent hover:text-accent"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="col-span-12 md:col-span-5">
        <div className="text-xs text-slate-500 mb-1">Policy artefact (JSON)</div>
        <pre className="code bg-muted border border-edge rounded p-3 overflow-x-auto text-slate-800 min-h-[400px]">
{json}
        </pre>
      </div>
    </form>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-600 mb-1">{label}</div>
      {children}
    </div>
  );
}

/**
 * `datetime-local` inputs render a 24h "YYYY-MM-DDTHH:MM" string in the
 * browser's local time. We store the canonical UTC ISO string on the policy
 * so the server-side check is timezone-stable. These two helpers do the
 * round-trip.
 */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fromLocalInput(s: string): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Quick-set shortcuts for the validity inputs. Saves the demoer from
 * fiddling with a picker on stage — click "+15 min" to set an expiry that
 * the audience can watch tick down.
 */
function ValidityShortcuts({
  onSet,
  onClear,
  future = false,
}: {
  onSet: (iso: string) => void;
  onClear: () => void;
  /** `true` for the "valid until" picker — labels skew forward in time. */
  future?: boolean;
}) {
  const base = "text-xs px-2 py-0.5 border border-edge rounded text-slate-600 hover:text-accent hover:border-accent";
  const set = (minutes: number) =>
    onSet(new Date(Date.now() + minutes * 60_000).toISOString());
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <button type="button" className={base} onClick={() => set(0)}>now</button>
      {future ? (
        <>
          <button type="button" className={base} onClick={() => set(1)}>+1m</button>
          <button type="button" className={base} onClick={() => set(15)}>+15m</button>
          <button type="button" className={base} onClick={() => set(60)}>+1h</button>
          <button type="button" className={base} onClick={() => set(24 * 60)}>+1d</button>
        </>
      ) : (
        <>
          <button type="button" className={base} onClick={() => set(-15)}>-15m</button>
          <button type="button" className={base} onClick={() => set(-60)}>-1h</button>
        </>
      )}
      <button type="button" className={base} onClick={onClear}>clear</button>
    </div>
  );
}

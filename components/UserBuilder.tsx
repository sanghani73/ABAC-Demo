"use client";
import { useEffect, useMemo, useState } from "react";
import type { Classification, Nationality, Persona } from "@/lib/types";

const CLASSIFICATIONS: Classification[] = ["OFFICIAL", "SECRET", "TOP_SECRET"];
const NATIONALITIES: Nationality[] = ["GBR", "USA", "AUS", "CAN", "NZL"];

const EMPTY: Persona = {
  id: "",
  name: "",
  role: "",
  clearance: "OFFICIAL",
  nationality: "GBR",
  unit: "",
  compartments: [],
  description: "",
  isAuditor: false,
};

export default function UserBuilder({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Persona | null;
  onSave: (p: Persona) => Promise<void>;
  onCancel: () => void;
}) {
  const [user, setUser] = useState<Persona>(initial ? { ...initial } : { ...EMPTY });
  const [compartmentsText, setCompartmentsText] = useState<string>(
    (initial?.compartments ?? []).join(", "),
  );

  useEffect(() => {
    setUser(initial ? { ...initial } : { ...EMPTY });
    setCompartmentsText((initial?.compartments ?? []).join(", "));
  }, [initial]);

  const update = <K extends keyof Persona>(k: K, v: Persona[K]) =>
    setUser((p) => ({ ...p, [k]: v }));

  const json = useMemo(
    () =>
      JSON.stringify(
        {
          ...user,
          compartments: parseCompartments(compartmentsText),
        },
        null,
        2,
      ),
    [user, compartmentsText],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Persona = {
      ...user,
      compartments: parseCompartments(compartmentsText),
    };
    if (!payload.id || !payload.name || !payload.role) return;
    await onSave(payload);
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-12 gap-4">
      <div className="col-span-12 md:col-span-7 space-y-3">
        <Row>
          <Field label="User ID (slug)">
            <input
              className="input"
              value={user.id}
              onChange={(e) => update("id", e.target.value.replace(/\s+/g, "-").toLowerCase())}
              placeholder="us-liaison"
              required
            />
          </Field>
          <Field label="Display name">
            <input
              className="input"
              value={user.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Lt. Col. J. Carter"
              required
            />
          </Field>
        </Row>

        <Field label="Role">
          <input
            className="input"
            value={user.role}
            onChange={(e) => update("role", e.target.value)}
            placeholder="US Liaison Officer"
            required
          />
        </Field>

        <Row>
          <Field label="Clearance">
            <select
              className="input"
              value={user.clearance}
              onChange={(e) => update("clearance", e.target.value as Classification)}
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>{c.replace("_", " ")}</option>
              ))}
            </select>
          </Field>
          <Field label="Nationality">
            <select
              className="input"
              value={user.nationality}
              onChange={(e) => update("nationality", e.target.value as Nationality)}
            >
              {NATIONALITIES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </Field>
        </Row>

        <Row>
          <Field label="Unit">
            <input
              className="input"
              value={user.unit}
              onChange={(e) => update("unit", e.target.value)}
              placeholder="e.g. DI, 3_CDO_BDE, EXT, * for auditor"
              required
            />
          </Field>
          <Field label="Compartments (comma separated)">
            <input
              className="input"
              value={compartmentsText}
              onChange={(e) => setCompartmentsText(e.target.value)}
              placeholder="OP_NEPTUNE, OP_ORION"
            />
          </Field>
        </Row>

        <Field label="Description">
          <textarea
            className="input min-h-[80px]"
            value={user.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            placeholder="One-liner shown in the persona card and demo narrative."
          />
        </Field>

        <Field label="Audit role">
          <label className="flex items-center gap-2 text-sm pt-1 text-slate-700">
            <input
              type="checkbox"
              checked={user.isAuditor === true}
              onChange={(e) => update("isAuditor", e.target.checked)}
            />
            This user bypasses row policies and field redactions (logged in prod).
          </label>
        </Field>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            className="px-4 py-2 bg-accent text-white rounded text-sm font-semibold hover:bg-accentEdge hover:text-accent"
          >
            Save user
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
        <div className="text-xs text-slate-500 mb-1">User record (JSON)</div>
        <pre className="code bg-muted border border-edge rounded p-3 overflow-x-auto text-slate-800 min-h-[400px]">
{json}
        </pre>
      </div>
    </form>
  );
}

function parseCompartments(s: string): string[] {
  return s
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
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

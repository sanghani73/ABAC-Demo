"use client";
import { useState } from "react";

export default function PipelinePanel({
  pipeline,
  label = "MongoDB pipeline",
  subtitle = "Under the hood — what Mongo actually ran for this persona",
}: {
  pipeline: unknown[];
  label?: string;
  subtitle?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!pipeline || pipeline.length === 0) return null;
  return (
    <div className="rounded-lg border border-edge bg-white shadow-sm">
      <button
        className="w-full text-left px-4 py-2 flex items-center gap-2"
        onClick={() => setOpen(!open)}
      >
        <span className="text-slate-700 text-sm">
          {open ? "▾" : "▸"} {label} ({pipeline.length} stages)
        </span>
        <span className="ml-auto text-xs text-slate-500">{subtitle}</span>
      </button>
      {open && (
        <pre className="code px-4 pb-4 overflow-x-auto text-slate-800 bg-muted border-t border-edge">
{JSON.stringify(pipeline, null, 2)}
        </pre>
      )}
    </div>
  );
}

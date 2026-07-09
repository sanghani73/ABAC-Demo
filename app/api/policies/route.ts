import { NextRequest, NextResponse } from "next/server";
import { COLLECTIONS, getDb } from "@/lib/mongo";
import type { Policy } from "@/lib/types";

export async function GET() {
  try {
    const db = await getDb();
    const policies = await db
      .collection<Policy>(COLLECTIONS.policies)
      .find({})
      .sort({ priority: -1, name: 1 })
      .toArray();
    return NextResponse.json({ policies });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Policy;
    if (!body.policyId || !body.name || !body.target || !body.effect) {
      return NextResponse.json({ error: "policyId, name, target, effect are required" }, { status: 400 });
    }
    const db = await getDb();
    // Build $set + $unset explicitly so clearing a validity bound on the
    // client actually unsets it on an existing document (JSON.stringify
    // drops `undefined`, so a naive ...body spread would silently keep the
    // old value). Strip `_id` — Mongo rejects $set on it even when the
    // value matches the existing doc, and an upsert keyed on `policyId`
    // never needs it.
    const { _id, ...rest } = body as unknown as Record<string, unknown> & {
      _id?: unknown;
    };
    void _id;
    const set: Record<string, unknown> = {
      ...rest,
      enabled: body.enabled !== false,
      priority: body.priority ?? 100,
    };
    const unset: Record<string, ""> = {};
    for (const key of ["validFrom", "validUntil"] as const) {
      if (!body[key]) {
        delete set[key];
        unset[key] = "";
      }
    }
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;
    await db.collection(COLLECTIONS.policies).updateOne(
      { policyId: body.policyId },
      update,
      { upsert: true },
    );
    return NextResponse.json({ ok: true, policyId: body.policyId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

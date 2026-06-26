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
    await db.collection(COLLECTIONS.policies).updateOne(
      { policyId: body.policyId },
      {
        $set: {
          ...body,
          enabled: body.enabled !== false,
          priority: body.priority ?? 100,
        },
      },
      { upsert: true },
    );
    return NextResponse.json({ ok: true, policyId: body.policyId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

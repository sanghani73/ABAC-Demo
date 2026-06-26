import { NextRequest, NextResponse } from "next/server";
import { COLLECTIONS, getDb } from "@/lib/mongo";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ policyId: string }> },
) {
  try {
    const { policyId } = await params;
    const db = await getDb();
    const r = await db.collection(COLLECTIONS.policies).deleteOne({ policyId });
    return NextResponse.json({ ok: true, deletedCount: r.deletedCount });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ policyId: string }> },
) {
  try {
    const { policyId } = await params;
    const updates = (await req.json()) as Record<string, unknown>;
    const db = await getDb();
    await db.collection(COLLECTIONS.policies).updateOne({ policyId }, { $set: updates });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

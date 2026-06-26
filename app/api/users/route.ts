import { NextRequest, NextResponse } from "next/server";
import { COLLECTIONS, getDb } from "@/lib/mongo";
import type { Persona } from "@/lib/types";

export async function GET() {
  try {
    const db = await getDb();
    const users = await db
      .collection<Persona>(COLLECTIONS.users)
      .find({}, { projection: { _id: 0 } })
      .sort({ isAuditor: 1, role: 1 })
      .toArray();
    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Persona;
    if (!body.id || !body.name || !body.role) {
      return NextResponse.json({ error: "id, name, role are required" }, { status: 400 });
    }
    const db = await getDb();
    await db.collection(COLLECTIONS.users).updateOne(
      { id: body.id },
      {
        $set: {
          ...body,
          compartments: body.compartments ?? [],
          isAuditor: body.isAuditor === true,
        },
      },
      { upsert: true },
    );
    return NextResponse.json({ ok: true, id: body.id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

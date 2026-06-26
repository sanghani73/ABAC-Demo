import { NextResponse } from "next/server";
import { COLLECTIONS, getDb } from "@/lib/mongo";
import { PERSONAS } from "@/lib/personas";
import type { Persona } from "@/lib/types";

/**
 * Returns the list of personas (users) for the persona switcher.
 *
 * Reads from MongoDB so the user admin screen can add/edit/remove personas
 * at runtime. Falls back to the in-code seed list if the database is
 * unreachable or the users collection hasn't been seeded yet.
 */
export async function GET() {
  try {
    const db = await getDb();
    const users = (await db
      .collection<Persona>(COLLECTIONS.users)
      .find({}, { projection: { _id: 0 } })
      .toArray()) as Persona[];
    if (users.length > 0) return NextResponse.json({ personas: users });
    return NextResponse.json({ personas: PERSONAS });
  } catch {
    return NextResponse.json({ personas: PERSONAS });
  }
}

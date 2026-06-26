import { NextRequest, NextResponse } from "next/server";
import { executeABACSearch } from "@/lib/queries";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { personaId: string; limit?: number };
    if (!body.personaId) {
      return NextResponse.json({ error: "personaId is required" }, { status: 400 });
    }
    const result = await executeABACSearch({ personaId: body.personaId, limit: body.limit });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

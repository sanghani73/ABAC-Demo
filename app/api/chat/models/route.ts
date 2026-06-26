import { NextResponse } from "next/server";
import { listChatModels } from "@/lib/llm";

export async function GET() {
  return NextResponse.json({ models: listChatModels() });
}

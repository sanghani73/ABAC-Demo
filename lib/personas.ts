import { COLLECTIONS, getDb } from "./mongo";
import type { Persona } from "./types";

/**
 * The full set of compartments used by the seed dataset.
 *
 * The policy engine needs this to rewrite "user.compartments ⊇ doc.compartments"
 * into a $vectorSearch-compatible filter (which doesn't allow $expr): a doc is
 * visible iff doc.compartments has no element in (UNIVERSE − user.compartments).
 *
 * Keep this in sync with the compartments that appear in data/reports.seed.json
 * and the persona compartments stored in the users collection.
 */
export const COMPARTMENT_UNIVERSE: string[] = ["OP_NEPTUNE", "OP_ORION"];

/**
 * Fallback used by API routes when the users collection is unreachable or
 * hasn't been seeded. The authoritative list lives in MongoDB and is editable
 * via /admin/users.
 */
export const PERSONAS: Persona[] = [
  {
    id: "uk-analyst",
    name: "Maj. R. Whitcombe",
    role: "UK Joint Intelligence Analyst",
    clearance: "TOP_SECRET",
    nationality: "GBR",
    unit: "DI",
    compartments: ["OP_NEPTUNE", "OP_ORION"],
    description:
      "Top Secret, UK national, Defence Intelligence. Cleared into both active compartments — sees the broadest picture.",
  },
  {
    id: "us-liaison",
    name: "Lt. Col. J. Carter",
    role: "US Liaison Officer",
    clearance: "SECRET",
    nationality: "USA",
    unit: "LO-UK",
    compartments: ["OP_NEPTUNE"],
    description:
      "Secret, US national, embedded liaison. Sees Five Eyes material releasable to USA; one compartment only.",
  },
  {
    id: "uk-logistics",
    name: "Capt. S. Patel",
    role: "UK Logistics Officer, 3 Cdo Bde",
    clearance: "OFFICIAL",
    nationality: "GBR",
    unit: "3_CDO_BDE",
    compartments: [],
    description:
      "Official only, UK national, brigade logistics. Sees their own unit's records — and only OFFICIAL material.",
  },
  {
    id: "coalition-contractor",
    name: "Ms. K. Nguyen",
    role: "Coalition Contractor (AUS)",
    clearance: "OFFICIAL",
    nationality: "AUS",
    unit: "EXT",
    compartments: [],
    description:
      "Official only, Australian national, external contractor. Sees the bare minimum — the 'almost nothing' end of the matrix.",
  },
  {
    id: "auditor",
    name: "Mr. D. Holland",
    role: "Compliance Auditor",
    clearance: "TOP_SECRET",
    nationality: "GBR",
    unit: "*",
    compartments: ["*"],
    isAuditor: true,
    description:
      "Audit role. Sees everything — but their access is granted by an explicit auditor policy and is itself logged.",
  },
];

/**
 * Resolve a persona by id, reading from the users collection. Falls back to
 * the in-code seed list when the DB is unreachable or empty — keeps the demo
 * working before the seed script has been run.
 */
export async function getPersona(id: string): Promise<Persona | undefined> {
  try {
    const db = await getDb();
    const doc = await db
      .collection<Persona>(COLLECTIONS.users)
      .findOne({ id }, { projection: { _id: 0 } });
    if (doc) return doc as Persona;
  } catch {
    /* fall through to the in-code list */
  }
  return PERSONAS.find((p) => p.id === id);
}

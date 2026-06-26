# Architecture & Developer's Guide

This document is for engineers who need to understand, extend, or repurpose this demo. It assumes you've read `README.md` for the user-facing demo flow.

## 1. What this project is, in one paragraph

A Next.js application that demonstrates **attribute-based access control over MongoDB Atlas**, including how ABAC composes with Atlas Vector Search. There is a small **policy engine** that, on every request, compiles the active policy set against the active persona's attributes into MongoDB aggregation pipeline stages. Those stages are then injected into either a `$vectorSearch` (for semantic search) or a plain `$match` (for browse), so row-level access control and field-level redaction/omission are enforced **inside the database query itself**. The UI lets you switch persona to see the same query return different results, and a separate admin screen lets you edit policies and immediately preview their effect across every persona.

## 2. High-level architecture

```
                        ┌──────────────────────────────────────┐
                        │  Browser (React 19 / Next App Router)│
                        │   /search   ◄── persona switcher     │
                        │   /admin    ◄── policy builder + JSON│
                        └────────────────────┬─────────────────┘
                                             │ fetch
                                             ▼
                        ┌──────────────────────────────────────┐
                        │  Next.js API routes (Node runtime)   │
                        │   /api/search   /api/browse          │
                        │   /api/policies /api/personas        │
                        └────────────────────┬─────────────────┘
                                             │ invokes
                                             ▼
                        ┌──────────────────────────────────────┐
                        │  Policy engine (lib/policyEngine.ts) │
                        │   compilePolicies(persona, policies) │
                        │     → rowFilter   ($match-shaped)    │
                        │     → fieldSet    ($set stage)       │
                        └────────────────────┬─────────────────┘
                                             │ builds pipeline
                                             ▼
                        ┌──────────────────────────────────────┐
                        │  Queries layer (lib/queries.ts)      │
                        │   executeABACSearch(...)             │
                        │   ▸ $vectorSearch.filter = rowFilter │
                        │   ▸ $set = fieldSet                  │
                        │   ▸ runs aggregate                   │
                        └────────────────────┬─────────────────┘
                                             │ Node driver
                                             ▼
                        ┌──────────────────────────────────────┐
                        │  MongoDB Atlas                       │
                        │   reports       (collection)         │
                        │   policies      (collection)         │
                        │   reports_vector (Search index,      │
                        │      autoEmbed → Voyage AI)          │
                        └──────────────────────────────────────┘
```

The single deployable artefact is the Next.js app. There is **no separate backend service** — API routes and the policy engine all run in the same Node process as the React server components.

## 3. Request lifecycle (semantic search)

This is the most important flow in the demo. Walk through it once and the rest of the codebase is obvious.

1. User picks a persona in the header and types a natural-language query on `/search`.
2. The browser POSTs `{ personaId, query }` to `/api/search`.
3. `app/api/search/route.ts` calls `executeABACSearch(...)` in `lib/queries.ts`.
4. `executeABACSearch`:
   - Resolves the persona object from `lib/personas.ts`.
   - Loads all enabled policies from MongoDB.
   - Calls `compilePolicies(persona, policies)` in `lib/policyEngine.ts`, getting back a `rowFilter` and a `fieldSet`.
   - Embeds the query text via `embedQuery()` in `lib/embeddings.ts` (Voyage API, `input_type: "query"`) to get a 1024-dim vector.
   - Builds the aggregation pipeline:
     ```js
     [
       { $vectorSearch: {
           index: "reports_vector",
           path: "embedding",
           queryVector: [/* 1024-dim Voyage vector */],
           filter: rowFilter,    // ← ABAC pre-filter; kNN never sees blocked rows
           limit, numCandidates
       }},
       { $set: { score: { $meta: "vectorSearchScore" } } },
       { $set: fieldSet },                          // ← redactions / omissions per field
       { $project: { _id: 0, embedding: 0 } }       // ← strip raw vector from response
     ]
     ```
   - Runs the aggregation.
   - Re-evaluates the field policies client-side against each returned doc (`annotateDoc`) only to compute which fields were touched — the data is already redacted in Mongo, this step just produces the UI labels.
   - Returns a *display copy* of the pipeline with the raw query vector replaced by a `<1024-dim vector embedded from "...">` placeholder, so the pipeline reveal panel in the UI stays readable.
5. The route returns `{ persona, results, pipeline, totalReturned, totalUnfiltered }`.
6. `app/search/page.tsx` renders the result cards via `components/ReportCard.tsx`. The expandable `components/PipelinePanel.tsx` shows the (display copy of the) pipeline so the audience can see what Mongo actually ran.

Browse mode (`/api/browse`) is identical except `$vectorSearch` is replaced by `{ $match: rowFilter }` followed by `$sort` + `$limit`, and no Voyage call is made.

## 4. Directory layout

```
ABAC-Demo/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout — header, persona provider
│   ├── page.tsx                  # / → redirect to /search
│   ├── globals.css               # Tailwind base + custom chip / redacted styles
│   ├── search/
│   │   └── page.tsx              # Search & browse UI ("data access screen")
│   ├── admin/
│   │   ├── page.tsx              # Policy admin UI
│   │   └── users/page.tsx        # User admin UI + per-user permissions audit
│   └── api/
│       ├── personas/route.ts
│       ├── policies/route.ts
│       ├── policies/[policyId]/route.ts
│       ├── users/route.ts
│       ├── users/[id]/route.ts
│       ├── search/route.ts
│       └── browse/route.ts
├── components/                   # Client React components
│   ├── PersonaProvider.tsx
│   ├── PersonaSwitcher.tsx
│   ├── PersonaCard.tsx
│   ├── ReportCard.tsx
│   ├── PipelinePanel.tsx
│   ├── PolicyBuilder.tsx
│   ├── PolicyList.tsx
│   ├── TestAsPersonaPanel.tsx
│   ├── UserBuilder.tsx
│   └── UserList.tsx
├── lib/                          # Server-side logic
│   ├── types.ts                  # Shared TypeScript types
│   ├── personas.ts               # The 5 personas (in-code, not in DB)
│   ├── policyEngine.ts           # Policy → MongoDB pipeline compiler
│   ├── queries.ts                # Executes a search/browse with ABAC applied
│   ├── embeddings.ts             # Voyage AI client (document + query embeddings)
│   └── mongo.ts                  # MongoDB client, collection/index name constants
├── data/                         # Domain seed data
│   ├── reports.seed.json
│   ├── policies.seed.json
│   └── users.seed.json
├── scripts/                      # One-shot operational scripts
│   ├── seed.ts
│   └── waitForEmbeddings.ts
├── README.md
├── ARCHITECTURE.md               # ← this file
├── package.json
├── tsconfig.json
├── next.config.mjs
├── postcss.config.js
├── tailwind.config.ts
├── next-env.d.ts
├── .env.example
└── .gitignore
```

## 5. File-by-file reference

### Top-level configuration

| File | Purpose |
|------|---------|
| `package.json` | Dependencies and the `seed` / `seed:wait` / `dev` / `build` scripts. |
| `tsconfig.json` | TypeScript config; `paths` maps `@/*` to project root so imports read `@/lib/...` rather than relative. |
| `next.config.mjs` | Minimal Next.js config; React strict mode on, no other customisation. |
| `tailwind.config.ts` | Tailwind config with a small custom palette (`ink`, `panel`, `edge`, `accent`, classification colours `ts`, `s`, `official`). |
| `postcss.config.js` | Standard Tailwind + autoprefixer postcss pipeline. |
| `next-env.d.ts` | Next.js type stub — leave alone. |
| `.env.example` | Documents every environment variable; copy to `.env.local` for local dev. |
| `.gitignore` | Excludes `node_modules`, `.next`, `.env`, logs. |
| `README.md` | User-facing setup & demo script. |
| `ARCHITECTURE.md` | This document. |

### `app/` — Next.js routes

#### Layout & root

| File | Purpose |
|------|---------|
| `app/layout.tsx` | Root HTML layout. Wraps the tree in `PersonaProvider`, renders the top bar with nav (Search / Admin) and the persona switcher. Anything that needs the active persona on the client must be inside this provider. |
| `app/page.tsx` | Server component that immediately redirects `/` → `/search`. |
| `app/globals.css` | Tailwind imports plus three things worth knowing about: (1) the `.chip-ts / .chip-s / .chip-off` classification chip colours, (2) the `.redacted` style that paints `[REDACTED]` with a diagonal hatch so it reads as a deliberate redaction in the UI, and (3) baseline colours so the app renders before Tailwind loads. |

#### Pages

| File | Purpose |
|------|---------|
| `app/search/page.tsx` | The "data access screen". Owns search state (query, mode, results, pipeline). On persona change OR mode change, it re-runs the current query so the audience sees results re-shape instantly. Renders `PersonaCard`, a search box with sample-query pills, a result summary line ("X of Y visible", "N hidden by row-level policy"), the result cards, and the `PipelinePanel`. |
| `app/admin/page.tsx` | The policy admin screen. Loads the policy list, renders `PolicyList` on the left and the active policy in `PolicyBuilder` on the right. Below the builder is `TestAsPersonaPanel` for previewing the proposed policy set against every persona. |
| `app/admin/users/page.tsx` | The user admin screen. Renders `UserList` on the left and the active user in `UserBuilder` on the right. Below the builder is the **Effective permissions** panel: a three-stat summary (rows visible, fields redacted, fields omitted) computed by browsing the corpus as the selected user, plus a breakdown of which row policies grant visibility for this user, which row policies *don't*, and which field policies may fire. This is the answer to "what can this user actually see?" |

#### API routes

All API routes are Node-runtime (default). Each is small — they validate input, call into `lib/queries.ts` or directly into Mongo, and return JSON.

| File | Method(s) | What it does |
|------|-----------|--------------|
| `app/api/personas/route.ts` | `GET` | Returns the persona list read from the `users` collection in Mongo. Falls back to the in-code seed list (`lib/personas.ts` `PERSONAS`) if the DB is unreachable or empty — keeps the demo working before `npm run seed` has been run. |
| `app/api/policies/route.ts` | `GET` / `POST` | `GET` lists all policies sorted by priority then name. `POST` upserts a policy by `policyId` — same endpoint handles create and update. |
| `app/api/policies/[policyId]/route.ts` | `PATCH` / `DELETE` | `PATCH` is used for the enable/disable toggle. `DELETE` removes a policy. |
| `app/api/users/route.ts` | `GET` / `POST` | `GET` lists all users (personas) projected without `_id`. `POST` upserts by `id`. Drives the `/admin/users` screen and the persona switcher. |
| `app/api/users/[id]/route.ts` | `PATCH` / `DELETE` | `PATCH` for partial updates; `DELETE` removes a user. |
| `app/api/search/route.ts` | `POST` | Delegates to `executeABACSearch` with `query` set. Returns `{ persona, results, pipeline, totalReturned, totalUnfiltered }`. |
| `app/api/browse/route.ts` | `POST` | Same as `/api/search` but without a query — drives the "Browse all" mode, the `TestAsPersonaPanel` preview, and the `/admin/users` permissions audit. |

### `components/` — client React

| File | Purpose |
|------|---------|
| `components/PersonaProvider.tsx` | Context provider. Loads the persona list once on mount, persists the active persona id to `localStorage`, and exposes `usePersona()` to descendants. Lives at the root of the React tree so persona changes are reflected everywhere without prop drilling. |
| `components/PersonaSwitcher.tsx` | The dropdown in the header. Shows an `AUDITOR` chip when the active persona is the auditor — a deliberate visual cue during the demo. |
| `components/PersonaCard.tsx` | Side-panel card on the search page showing the active persona's name, role, clearance, nationality, unit, compartments, and a short description. This is what makes the *why* of each search result obvious to the audience. |
| `components/ReportCard.tsx` | Renders a single search result. Knows about three field states: `[REDACTED]` (shown with the hatched style), omitted (shown as italic "omitted"), and present. Includes the score chip when running in semantic mode, plus a footer summarising which fields were touched by policy. |
| `components/PipelinePanel.tsx` | Collapsed-by-default `<details>`-style panel below the search results. When expanded, dumps the raw aggregation pipeline as formatted JSON. This is the demo's "open the hood" moment — viewers can see the exact `$vectorSearch.filter` and `$set` stages that Mongo ran. |
| `components/PolicyBuilder.tsx` | The visual policy editor. Form fields for policy id, name, description, target (row/field), effect (allow/deny/redact/omit), field path, priority, enabled. Conditions are an ordered list rendered as one row per condition — operator dropdown + optional value field. A live JSON view on the right re-renders on every keystroke so engineering audiences see the underlying policy artefact. |
| `components/PolicyList.tsx` | Left rail on the admin page. One card per policy; clicking opens it in the builder. Each card has an inline enable/disable checkbox and a delete button. |
| `components/TestAsPersonaPanel.tsx` | Sits below the policy builder. When you click *Run preview*, it loops over every persona and calls `/api/browse`, then renders a small table of `{ persona, rows visible, redacted fields, omitted fields }`. The point: confirm the policy change before "saving to production". |
| `components/UserList.tsx` | Left rail of `/admin/users`. One card per user with chips for clearance / nationality / unit and an "AUDITOR" marker. Inline delete; selection opens the user in `UserBuilder`. |
| `components/UserBuilder.tsx` | Visual editor for a single user. Form fields for id, name, role, clearance, nationality, unit, compartments (comma-separated text), description, and the auditor flag. Live JSON view on the right mirroring the policy builder's pattern. |

### `lib/` — server-side logic

This is where the substance of the demo lives.

#### `lib/types.ts`

Shared TypeScript types. Key items:

- `Classification` — `"OFFICIAL" | "SECRET" | "TOP_SECRET"`, with a `CLASSIFICATION_RANK` map so the engine can do `>=` comparisons numerically.
- `Persona` — `{ id, name, role, clearance, nationality, unit, compartments, isAuditor?, description }`.
- `Operator` — the closed set of condition operators the engine understands:
  - `clearance_gte` — user's clearance ≥ doc's classification
  - `nationality_in_rel` — user's nationality is in doc's releasability list
  - `compartments_superset` — user's compartments ⊇ doc's compartments
  - `unit_eq` — user's unit equals doc's originating unit
  - `classification_eq` — doc's classification equals a literal (for narrowing field policies to a class)
  - `always` — always true (for catch-all policies)
- `Policy` — `{ policyId, name, description, target, effect, fieldPath?, conditions[], priority, enabled }`.
- `SearchResult` — what the API returns per row: the (possibly redacted) doc plus arrays of which fields were redacted/omitted, used by `ReportCard` to label them.

#### `lib/personas.ts`

The five demo personas plus the resolver used by the policy engine. Exports:
- `PERSONAS` — the in-code seed list used as a fallback when the database is unreachable or the `users` collection has not been seeded yet.
- `getPersona(id)` — **async** lookup that reads from the `users` collection in MongoDB. Falls back to `PERSONAS` on error or empty collection. This is the function `lib/queries.ts` calls on every request to materialise the active persona's attributes.
- `COMPARTMENT_UNIVERSE` — the closed list of compartment tags used in the seed dataset. The policy engine needs this to rewrite "user.compartments ⊇ doc.compartments" into a `$vectorSearch`-compatible filter; see the operator implementation in `lib/policyEngine.ts`.

The seeded list is also persisted to MongoDB by `scripts/seed.ts` (reading `data/users.seed.json`). After seeding, the `/admin/users` screen lets you add, edit, or remove users at runtime — the same way policies are managed.

#### `lib/mongo.ts`

MongoDB connection plumbing.
- `getClient()` — returns a module-scoped `MongoClient`. Cached on `globalThis` so Next.js dev-mode hot reloads don't keep opening new pools.
- `getDb()` — connects (idempotent) and returns the configured `Db`.
- `COLLECTIONS` — `{ reports, policies }` constants resolved from env.
- `VECTOR_INDEX`, `EMBEDDING_PATH` — names used in `$vectorSearch` calls.

Notable: missing `MONGODB_URI` is a warn-at-import, error-at-use pattern. That's deliberate so `next build` doesn't fail in environments where env vars are injected at deploy time.

#### `lib/embeddings.ts`

Hand-rolled HTTP client for **MongoDB's hosted Voyage embeddings endpoint** (`https://ai.mongodb.com/v1/embeddings`). The request/response shape is the Voyage API; MongoDB hosts the proxy so the same API key can be used for cluster integrations and direct embedding calls. Two public functions:
- `embedDocuments(texts)` — used by `scripts/seed.ts` to embed report bodies with `input_type: "document"`. Batches up to 128 inputs per request.
- `embedQuery(text)` — used by `lib/queries.ts` to embed the user's search text with `input_type: "query"` (which biases the embedding for retrieval).

The `input_type` distinction is important — Voyage's retrieval-tuned models produce noticeably better k-NN results when queries and documents are embedded with their correct types. See https://docs.voyageai.com/docs/embeddings.

Also exports:
- `voyageModel()` — reads `VOYAGE_MODEL` env or defaults to `voyage-3.5`.
- `voyageDimensions()` — looks up the dim count of the active model from `VOYAGE_DIMENSIONS`. Used by `scripts/seed.ts` to size the vector index. **If you add a model with a different dimensionality, update the table.**

The bearer token comes from `VOYAGE_API_KEY` — a key issued by MongoDB for the hosted endpoint, not a Voyage dashboard key.

#### `lib/policyEngine.ts`

The compiler. **Read this file first if you want to extend the demo.**

Public surface:

```ts
function compilePolicies(persona: Persona, policies: Policy[]): {
  rowFilter: Record<string, unknown>;
  fieldSet: Record<string, unknown>;
  fieldPoliciesApplied: Policy[];
};

function annotateDoc(persona, doc, fieldPolicies): {
  redacted: string[];
  omitted: string[];
};
```

Semantics:
- **Row policies** with `effect: "allow"` define who *may* see a row. The compiled row filter is the *union* of all allow policies (closed-by-default — if no allow policy matches the persona, they see nothing).
- **Row policies** with `effect: "deny"` are subtracted from that union via `$nor`.
- **Field policies** with `effect: "redact"` or `"omit"` describe the conditions the persona must satisfy to *see* the field; when those conditions fail for a specific document, the field is replaced with `[REDACTED]` or removed (`$$REMOVE`). Multiple field policies on the same path are composed via nested `$cond`s.
- **Auditor short-circuit** — if `persona.isAuditor`, row filter becomes `{}` and field set becomes `{}`. The auditor's access is itself granted by this single conditional; in a real system you'd want it logged.

Internal helpers (all unexported):
- `buildRowFilter` — combines allows/denies into the final `$match`-shaped object.
- `buildConditionsMatch` / `buildConditionMatch` — compile a condition into a top-level `$match` expression with persona attributes inlined.
- `buildFieldSet` — compiles field policies into a `$set` stage. Each policy becomes a `$cond` wrapped around whatever expression is already in place for that path, so multiple policies on one field nest correctly.
- `buildConditionsExpr` / `buildConditionExpr` — compile a condition into the `$expr`-style form used inside `$cond` / `$set`. This is a separate code path from `buildConditionMatch` because the syntax is different (`{ $in: [...] }` vs `{ field: { $in: ... } }`).
- `clearedClassifications` — given a clearance, returns the list of classifications they cover. Used to turn `clearance_gte` into a closed-form `{ $in: ["OFFICIAL", "SECRET", ...] }` rather than a dynamic comparison.
- `evaluateCondition` — pure JS evaluator used only by `annotateDoc` to compute the redacted/omitted labels for the UI. The data has already been redacted by Mongo at this point.

**To add a new operator** (say `cohort_eq`):
1. Add the case name to the `Operator` union in `types.ts`.
2. Add a case to `buildConditionMatch` (for row policies) and `buildConditionExpr` (for field policies).
3. Add the same case to `evaluateCondition` (for the UI annotation).
4. Add the operator to the dropdown in `components/PolicyBuilder.tsx` `OPERATORS`.

That's it — the engine and UI will pick it up immediately.

#### `lib/queries.ts`

The single execution entry point. Exports `executeABACSearch({ personaId, query, limit })` which:
1. Resolves the persona, loads enabled policies from Mongo, compiles them.
2. If a query is provided, embeds it via Voyage (`embedQuery`) to get a `queryVector`.
3. Picks `$vectorSearch` (with the `queryVector`) or plain `$match` (when no query).
4. Appends the field-set stage and a projection to drop `_id` and the raw `embedding` field.
5. Runs the aggregation.
6. Annotates each result with which fields were touched.
7. Computes `totalUnfiltered` — the count the same query would have returned with no policies applied — so the UI can say "N hidden by row-level policy". Reuses the already-computed `queryVector` so we don't double-bill Voyage.
8. Returns a *display copy* of the pipeline where the raw 1024-float vector is replaced by a `<1024-dim vector embedded from "...">` placeholder, so the pipeline reveal panel stays human-readable.

Both `/api/search` and `/api/browse` and the admin's `TestAsPersonaPanel` go through this one function, which means every UI surface in the demo is enforced by the same code path.

### `data/` — domain content

| File | Purpose |
|------|---------|
| `data/reports.seed.json` | 20 synthetic intelligence reports spanning the persona attribute matrix (different classifications, releasabilities, compartments, units). Field set: `reportId`, `title`, `body` (the field Atlas embeds), `summary`, `source_name`, `grid_ref`, `originating_unit`, `classification`, `releasability[]`, `compartments[]`, `created_at`. |
| `data/policies.seed.json` | 6 ABAC policies illustrating the demo points: clearance+releasability allow, +compartments allow, own-unit OFFICIAL allow, two field redactions for `source_name` (one of which is seeded disabled to demo the toggle moment), and a `grid_ref` omit. |

### `scripts/` — operational

| File | Purpose |
|------|---------|
| `scripts/seed.ts` | Run with `npm run seed`. Embeds every report body via the Voyage API, drops & re-creates the reports and policies collections, inserts the seed data (now with `embedding` populated), creates supporting B-tree indexes used by the policy engine's `$match` filters, and creates the Atlas Vector Search index (`type: vector` on `embedding`). Reads `.env.local` / `.env` via dotenv. |
| `scripts/waitForEmbeddings.ts` | Run with `npm run seed:wait`. Polls the Atlas vector index and re-runs a low-cost `$vectorSearch` until the result count matches the seed size. With manual embeddings the *vectors* are present at insert time — what we're waiting on is Atlas finishing the search-index build. The probe uses `embedQuery` against Voyage with a fixed test string. |

## 6. Data model

### `reports` collection

```jsonc
{
  "reportId":         "INTREP-2025-0001",      // human-readable id
  "title":            "...",
  "body":             "...",                   // ← the source text that gets embedded
  "summary":          "...",
  "source_name":      "...",                   // commonly redacted
  "grid_ref":         "71.40N 033.20E",        // commonly omitted
  "originating_unit": "DI",
  "classification":   "TOP_SECRET",            // OFFICIAL | SECRET | TOP_SECRET
  "releasability":    ["GBR"],                 // Five Eyes codes
  "compartments":     ["OP_NEPTUNE"],          // need-to-know tags
  "embedding":        [/* 1024 floats */],     // Voyage embedding of `body` (input_type=document)
  "created_at":       "2026-05-14T08:21:00Z"
}
```

The `embedding` field is populated by `scripts/seed.ts` at insert time. The search/browse APIs strip it from responses via `$project`.

Supporting indexes (created by `seed.ts`):
- `classification_1`, `releasability_1`, `compartments_1`, `originating_unit_1` — to keep `$match` fast in browse mode and as a hint when Mongo's optimiser decides whether to combine the filter with the vector index lookup.
- `reportId_1` — unique.

### `policies` collection

```jsonc
{
  "policyId":   "row-compartments",            // unique slug
  "name":       "...",
  "description":"...",
  "target":     "row",                          // "row" | "field"
  "effect":     "allow",                        // "allow" | "deny" | "redact" | "omit"
  "fieldPath":  "source_name",                  // only when target=field
  "conditions": [{ "op": "clearance_gte" }, { "op": "compartments_superset" }],
  "priority":   110,
  "enabled":    true
}
```

Conditions in a single policy are **AND**ed. Policies of the same target/effect are combined per the semantics in §5 (`policyEngine.ts`).

### `users` collection

```jsonc
{
  "id":            "us-liaison",          // unique slug; persisted in localStorage
  "name":          "Lt. Col. J. Carter",
  "role":          "US Liaison Officer",
  "clearance":     "SECRET",              // OFFICIAL | SECRET | TOP_SECRET
  "nationality":   "USA",                 // GBR | USA | AUS | CAN | NZL
  "unit":          "LO-UK",               // free-form string; "*" for wildcards (auditor)
  "compartments":  ["OP_NEPTUNE"],        // strings; must come from COMPARTMENT_UNIVERSE
  "isAuditor":     false,                 // optional; bypasses all row/field policies
  "description":   "..."                  // shown in PersonaCard and the user admin
}
```

Each request resolves the active user by id through `getPersona()` in `lib/personas.ts`. CRUD is exposed via `/api/users` and the visual builder at `/admin/users`. Index: `id` is unique.

### `reports_vector` — Atlas Vector Search index

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
    { "type": "filter", "path": "classification" },
    { "type": "filter", "path": "releasability" },
    { "type": "filter", "path": "compartments" },
    { "type": "filter", "path": "originating_unit" }
  ]
}
```

`numDimensions` must match the embedding model's output size — see `VOYAGE_DIMENSIONS` in `lib/embeddings.ts`. `voyage-3.5` (the default) returns 1024-dim vectors. If you switch model, update the table and re-run `npm run seed` so the index is recreated with the correct dimensionality.

Every ABAC attribute that appears in the policy engine's row filter is registered as a `filter` field — this is what lets `$vectorSearch.filter` execute as a true **pre-filter** rather than a post-filter pass.

## 7. Key concepts

### Manual (client-side) embeddings via MongoDB's hosted Voyage endpoint

This demo embeds documents and queries from the Node process — Atlas autoEmbed is **not** used (it is currently unavailable on M10 tiers).

- On seed, `scripts/seed.ts` calls `embedDocuments(bodies)` (`input_type: "document"`) and writes the vectors into the `embedding` field of each report before insert.
- On query, `lib/queries.ts` calls `embedQuery(text)` (`input_type: "query"`) and passes the resulting vector to `$vectorSearch` as `queryVector`.
- Both calls go to **MongoDB's hosted Voyage proxy** at `https://ai.mongodb.com/v1/embeddings`. The bearer token is a MongoDB-issued key set as `VOYAGE_API_KEY` in `.env.local` — there is no separate Voyage dashboard account to manage. The key is only ever read in Node-runtime code (the seed script and `lib/embeddings.ts`); it is never sent to the browser.

Why this approach (and not autoEmbed)?
- M10 doesn't support autoEmbed.
- Routing through `ai.mongodb.com` keeps the MongoDB account as the single point of key management — useful for the audience to know that, in production, an Atlas-bound key works for both autoEmbed (on higher tiers) and direct embedding calls (like this demo).
- It keeps the demo portable — anyone with an Atlas cluster and a MongoDB-issued embeddings key can run it.
- It makes the data flow easier to explain on stage ("we embed here, query there, ABAC filter here").

### ABAC pre-filter vs post-filter

Because the four ABAC attribute fields are registered as `filter` fields on the vector index, the row filter we pass to `$vectorSearch.filter` is applied **before** the kNN. Two consequences:

1. The kNN never even computes distances for documents the persona can't access — they're not candidates.
2. There is no leakage via result-count fingerprinting. (A post-filter approach would let an attacker infer that "the system holds N more docs about X than I can see", because the candidate set is filtered after-the-fact.)

For the auditor short-circuit, the row filter is `{}` — no restriction.

### Closed-by-default

If no allow policy matches the persona, the compiled row filter is `{ _id: { $exists: false } }` — matches nothing. This is the demo's stance: every persona must be granted access via at least one allow policy.

The five demo personas plus the seeded allow policies are constructed so that every persona has at least one allow path. Removing all enabled allows in the admin UI will (correctly) cause that persona to see nothing.

### Field policy composition

Multiple field policies on the same field path nest. The compiler walks them in iteration order; each policy's `$cond` becomes the *then* branch (existing expression) of the next one's wrapper. The semantic effect is: a field is shown only if **every** field policy on that path passes its conditions; the strictest effect among the failing ones is applied.

## 8. Extension points

### Add a new persona

Append to `lib/personas.ts`. No DB change required. The new persona will appear in the header dropdown and in `TestAsPersonaPanel`.

### Add a new ABAC attribute (e.g. `cohort`)

1. Add the field to `Persona` in `types.ts`.
2. Add a new operator (`cohort_eq`) — see the "To add a new operator" section in §5 above.
3. If you want it pre-filterable on vector search, add `{ "type": "filter", "path": "cohort" }` to the index definition in `scripts/seed.ts` and re-create the index.

### Add a new field policy effect (e.g. `mask`)

The current effects are `omit` (`$$REMOVE`) and `redact` (`"[REDACTED]"`). To add a transform — say, mask all but the last 4 of a number:
1. Extend the `Effect` type in `types.ts`.
2. In `buildFieldSet`, replace the `onFail` value with the appropriate Mongo aggregation expression (`{ $concat: [{ $substr: [...] }, "***"] }` etc.).
3. Add the option to the effect dropdown in `PolicyBuilder.tsx`.
4. Optionally extend `ReportCard.tsx` to label masked fields distinctly.

### Repurpose for another domain

1. Replace `data/reports.seed.json` with your dataset. Any shape works — the policy engine references fields by string path.
2. Update the vector index definition in `scripts/seed.ts`:
   - Change `path: "body"` to whatever your indexable text field is called.
   - Update the `filter` fields list to whatever attributes your policies will use.
3. Replace `lib/personas.ts` with personas matching the new domain.
4. Replace `data/policies.seed.json` to express your new policies.
5. Update `lib/policyEngine.ts` only if your domain needs new operators — most domains don't.
6. Update labels/copy in `app/search/page.tsx`, `components/PersonaCard.tsx`, and `components/ReportCard.tsx` to match the new domain's vocabulary.
7. Re-run `npm run seed && npm run seed:wait`.

The split between generic (`lib/`, `components/`, `app/`) and domain-specific (`data/*.json`, `lib/personas.ts`) is intentional — repurposing should not touch the policy engine.

## 9. Operational notes

- **Hot reload + Mongo client**: `getClient()` caches on `globalThis` so that dev-mode hot reloads don't leak connection pools.
- **Index build latency**: after `npm run seed`, expect 30s–a few minutes for Atlas to build the search index. The vectors themselves are already in Mongo at this point. Use `npm run seed:wait` to block until the index is queryable.
- **Cost**: `voyage-3.5` is $0.06/1M tokens; embedding 20 short reports plus a handful of demo queries costs fractions of a cent. Voyage's free tier (currently 200M tokens) easily covers many demo runs. Switch to `voyage-3.5-lite` for the cheapest footprint.
- **Query embedding latency**: every semantic search adds one Voyage round-trip (~150–400ms) before the Mongo aggregation. Acceptable for a demo; for production you'd cache popular queries.
- **Security note on the demo**: this is a demo. There is no auth — anyone with the URL can switch persona. In a real deployment the persona would be derived from an authenticated user's identity provider claims, and the `/api/policies` admin routes would be guarded. The Voyage API key is server-side only (Node-runtime route handlers and scripts) — it is never sent to the browser.

## 10. Where to look first when changing X

| If you want to change... | Edit |
|---|---|
| The persona list (at runtime) | `/admin/users` in the UI |
| The seed personas | `data/users.seed.json` and `lib/personas.ts` (then re-run `npm run seed`) |
| The seed dataset | `data/reports.seed.json` (then re-run `npm run seed`) |
| The seed policies | `data/policies.seed.json` (then re-run `npm run seed`) |
| The embedding model | `VOYAGE_MODEL` env var. If the new model has different dimensionality, update `VOYAGE_DIMENSIONS` in `lib/embeddings.ts` and re-run `npm run seed` so the index is recreated with the correct `numDimensions`. |
| How the row filter is compiled | `lib/policyEngine.ts` → `buildRowFilter`, `buildConditionMatch` |
| How a field is redacted/omitted | `lib/policyEngine.ts` → `buildFieldSet`, `buildConditionExpr` |
| The aggregation pipeline shape | `lib/queries.ts` → `executeABACSearch` |
| The search UI | `app/search/page.tsx` + `components/ReportCard.tsx` |
| The admin UI | `app/admin/page.tsx` + `components/PolicyBuilder.tsx` |
| The pipeline reveal | `components/PipelinePanel.tsx` |
| The classification colour palette | `tailwind.config.ts` + `app/globals.css` |

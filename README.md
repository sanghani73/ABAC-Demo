# ABAC Demo — MongoDB Atlas Vector Search

A small Next.js demo that shows attribute-based access control over MongoDB Atlas, including how ABAC composes with Atlas Vector Search using Voyage AI embeddings.

The narrative is a UK MoD intelligence-reports scenario, but the data model, persona attributes, and policy engine are domain-agnostic — swap the seed data and personas to repurpose for healthcare, finance, etc.

## What it shows

- **Row-level access control** — different personas see different documents from the same query
- **Field-level redaction & omission** — even within a returned document, sensitive fields are replaced with `[REDACTED]` or removed entirely depending on persona attributes
- **Semantic search with pre-filtered ABAC** — `$vectorSearch.filter` is built from the persona's policies, so the kNN never even sees rows the persona can't access ("what the model can't retrieve, it can't leak")
- **Manual Voyage embeddings via MongoDB's hosted endpoint** — document bodies are embedded by the seed script and stored in an `embedding` field; queries are embedded at search time by `lib/embeddings.ts`. Calls go to `https://ai.mongodb.com/v1/embeddings` (the MongoDB-hosted Voyage proxy) using a single MongoDB-issued API key. Works on Atlas M10 (no autoEmbed required).
- **Live policy admin** — visual builder + JSON view + "test as persona" preview that runs the proposed policy set against every persona before saving
- **Live user admin** — personas (users) are stored in MongoDB and edited via a visual builder; each user has an "effective permissions" panel that shows which policies apply, how many rows they can see, and how many fields are redacted/omitted
- **Chat (RAG) with ABAC retrieval** — a chat drawer on the search page sends the user's question through the same ABAC `$vectorSearch` pipeline as retrieval, then streams a response from a Grove-routed LLM (Claude or OpenAI, both vision-capable). The model only ever receives context the persona is permitted to see — including images for the multimodal moment.

## Why ABAC, not RBAC

A reasonable first question from any audience is "we already have role-based access control — why do we need this?" The honest answer is that ABAC isn't a *replacement* for RBAC, it's a **superset**: a role is just one attribute among many. Everything you can express with roles you can express here by adding `roles: string[]` to the persona and a `role_in` operator (we've deliberately *not* added that yet — see the section above for the field model). What ABAC gives you over pure RBAC:

- **Cross-cutting constraints without role explosion.** Real access rules in regulated domains stack: *clearance ≥ X* AND *nationality in releasability* AND *holds compartment Y* AND *member of unit Z*. Modelling every viable combination as a discrete role produces a combinatorial blow-up — the classic "5,000 roles managing 50 attributes" problem. ABAC keeps the inputs as attributes and composes them at evaluation time, so adding a new compartment or nationality is a single attribute change, not a role refactor.

- **Data-driven decisions, not directory-driven.** RBAC asks "is this user in this group?". ABAC asks "given this user's attributes *and this specific document's attributes*, is access permitted?". That second question is what `$vectorSearch.filter` evaluates — and it's a query expression, not a directory lookup. The result: a row can be allowed for user A and denied for user B *based on the row's own contents* (its classification, releasability, compartments, source classification). RBAC has no clean way to express this without exploding the role count to match the data shape.

- **Field-level and media-item-level access.** RBAC's unit of authorisation is "can this role read this resource?". A redaction or omission of *a specific field* — or of *a single image inside a report whose text is visible* — is awkward to express as a role. ABAC compiles that directly: this demo's `$set` stage swaps `source_name` for `[REDACTED]` only when the persona's clearance falls below the document's *own* `source_classification`, and `mediaItems[]` are gated per-item against their own attributes independently of the parent report.

- **"What the model can't retrieve, it can't leak."** Because the ABAC compile target is a Mongo query filter, the access decision is **pushed into the kNN's pre-filter**. Documents the persona can't see are not candidates for vector similarity — so a semantic search cannot return them, summarise them, or be tricked into leaking them via post-hoc reranking. Post-filter approaches (filter the RBAC-allowed result set *after* retrieval) cannot make this guarantee.

- **Live editable, no redeploy.** Policies are MongoDB documents on the same cluster as the data. Toggle a policy and the next request re-compiles. Same change feed, same backup, same RBAC (if you want to govern *who can edit policies*).

- **Audit answers "what does this user actually see?".** The user admin page browses the corpus as the selected persona and reports rows visible / fields redacted / fields omitted. RBAC audits typically answer "what role memberships does this user have?", which is one step removed from the effective access surface.

In short: RBAC tells the system *who someone is*. ABAC tells the system *what they're allowed to see, given who they are and what the data is*. For document-centric, classification-bearing data — defence, intelligence, healthcare, financial — the second is the only model that scales.

## Stack

- Next.js 15 (App Router) + React 19 + Tailwind
- MongoDB Node driver 6
- MongoDB Atlas with Vector Search (M10+ is sufficient)
- Voyage embeddings via MongoDB's hosted endpoint at `https://ai.mongodb.com/v1/embeddings` (model `voyage-3.5` by default — 1024 dims, cosine similarity)

## Prerequisites

1. **Atlas cluster** — M10 or above with Atlas Vector Search.
2. **MongoDB-issued Voyage API key** — generate one from your MongoDB / Atlas account. Calls go to MongoDB's hosted Voyage proxy at `https://ai.mongodb.com/v1/embeddings`, so you do not need a separate Voyage dashboard key. The key goes in `.env.local` as `VOYAGE_API_KEY`.
3. Node 20+ and npm.

## Setup

```sh
# 1. install deps
npm install

# 2. configure env
cp .env.example .env.local
# edit .env.local — set MONGODB_URI and VOYAGE_API_KEY

# 3. seed the data + create indexes (embeds bodies via Voyage at this step)
npm run seed

# 4. wait until the Atlas vector index has finished building
npm run seed:wait

# 5. run the dev server
npm run dev
# open http://localhost:3000
```

The seed creates two collections (`reports`, `policies`), supporting B-tree indexes used by the policy engine's `$match` filters, and a Vector Search index named `reports_vector` defined as:

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

If you change the embedding model to one with a different dimensionality, update `VOYAGE_DIMENSIONS` in `lib/embeddings.ts` and re-run `npm run seed` so the index is rebuilt with the correct `numDimensions`.

## Recommended demo flow — Browse → Search → Chat (~15 min)

This is the **full end-to-end script** that ties the three surfaces together and lands the natural progression a customer will recognise: *I can look at the data, I can search it, and I can have a conversation with it — and the same access controls apply to all three.*

The audience walks through the same physical screen the whole time. The persona switcher in the header is the only "input" you touch other than the search box and chat input. Switching persona re-runs every visible surface on the screen — the result list, the redactions, and the chat thread (which resets — see step 5).

Use the **UK Joint Intelligence Analyst** as the default starting persona. Keep the other four visible in the dropdown for the swaps below.

### 1. Browse — "What can this user even see?" (~1.5 min)

Open `/search`. The default mode is **Browse all** — a plain `$match` with the ABAC row filter, no vector search, no chat. Scroll the result list.

Point out:
- The result counter at the top: *"Showing N records visible to this persona"*.
- The classification chips and compartment chips on each card.
- The **Attached media** section on INTREP-2025-0017 — the UAV thermal video and still both visible to this persona.

Switch persona to **US Liaison Officer**. Same browse, no other input. The audience sees:
- The result count drops.
- INTREP-2025-0017's *thermal video* tile is now a red-hatched **REDACTED** stub with the policy's reason; the still image remains.
- A few reports have `[REDACTED]` source fields where `source_classification` is tighter than the document's overall classification.

Talk track: *"Same data, same screen. The persona's attributes flow into the policy engine and out come Mongo pipeline stages — row filter and field redactions, applied in the database. Nothing is filtered client-side. We haven't even talked to the LLM yet — this is plain access control over your data, before any AI is involved."*

### 2. Search — semantic retrieval with the same gate (~2.5 min)

Switch back to the **UK Joint Intelligence Analyst**. Click the **Semantic search** toggle. Type or click the sample pill:

> *supply route disruption near Murmansk*

Audience should see:
- 5+ results, ranked. A `score` chip on each card. The pipeline panel below shows the actual `$vectorSearch` with `path: "embedding"`, a placeholder for the query vector, and the **ABAC filter inside `$vectorSearch.filter`**.
- INTREP-2025-0003 surfaces near the top with its drone-still tile attached.

Switch persona to **US Liaison Officer**. Same query, no re-typing. Audience sees:
- The result count drops; the *"N hidden by row-level policy"* chip appears.
- INTREP-2025-0003 is still here (it's SECRET / USA-releasable) — but its drone still is the red-hatched REDACTED stub.
- The `source_name` on several cards reads `[REDACTED]`.

Now try a media-only query — type:

> *thermal imagery of a UAV at night*

As the UK Analyst: the card for INTREP-2025-0017 shows a `text + media` chip and the thermal video tile gets an indigo "matched the query" outline. As the US Liaison: the card shows up via the *still* (which the persona can see), the thermal video is the redacted stub. The Sources panel and the **Media pipeline** below the results both show the `$vectorSearch` against `media_vector` — same query vector as the reports search, different collection, same ABAC pre-filter.

Talk track: *"The kNN never even sees rows or media items this persona can't access — that's the difference between a pre-filter and a post-filter. Post-filter, you'd be telling the model 'here are 50 things' and then deciding what to remove; pre-filter, the database never returns them. What the model can't retrieve, it can't leak."*

### 3. Pop the hood — the pipeline (~1 min)

Expand the **Reports pipeline** panel. Walk through the three stages: `$vectorSearch` with the ABAC `filter`, the `$set` that applies `[REDACTED]` per field, the `$set` that maps over `mediaItems[]`. Then expand the **Media pipeline** — same shape, different collection.

Talk track: *"There's no special policy engine running outside the database. The persona's attributes are compiled into Mongo pipeline JSON. Same query planner, same vector index, same audit surface."*

### 4. Live policy edit (~1.5 min)

`/admin` in the top nav. Click the policy **"Field — source_name protected by source_classification"** and toggle it off. Back to `/search`, US Liaison Officer, same query. The `[REDACTED]` source values are now real. Toggle the policy back on; the next query is redacted again.

Talk track: *"Policies are MongoDB documents on the same cluster as the data. One bit changes and the next request — search, browse, or chat — recompiles. No redeploy, no cache invalidation."*

### 5. Chat — the natural next step (~4 min, the closing moment)

Back on `/search`, click **Ask AI ▸** in the bottom-right. The drawer slides in. Point out the persona chip and the model dropdown at the top — two models (Claude and OpenAI via the Grove gateway, both vision-capable).

Set persona to **UK Joint Intelligence Analyst**. Ask:

> *What's happening with supply convoys around Kola?*

Tokens stream in. A **Sources** panel appears under the answer with 3–6 cited reports — each with its real classification chip. The answer cites `[INTREP-2025-…]` IDs inline. Note: the citations include the report that carries the drone still, and the chat *also* saw the image (the chat route inlines visible media bytes as image content into the prompt).

**Switch persona to US Liaison Officer.** Audience sees the chat reset to a blank state — *"Chat reset — now operating as Lt. Col. J. Carter"*. This is the moment to call out:

> "We deliberately reset on persona change. Continuing a thread across personas would let one user's answers become context for another user's prompt — the model would summarise material the new persona may not see. The reset is the security story."

Ask the same question. Audience sees:
- A shorter, more cautious answer.
- The Sources panel cites fewer reports, with `[REDACTED]` source markers visible in the citation footer.
- The model says something like *"source attribution is restricted in the available context"* rather than naming a source — because the context it received already had `[REDACTED]` in the source field.
- If the answer would reference the thermal video: the model says it can't (the redacted item was a stub, not bytes).

**Switch persona to Coalition Contractor (AUS).** Ask the same question. Audience sees a one-liner:

> *"I don't have access to any reports relevant to that question."*

…because retrieval returned zero rows for this persona. The empty Sources panel reads *"No documents were accessible for this query — the model was told to say so."*

Talk track: *"Same model, same prompt template, same retrieval shape. The persona is the only input that changed. The ABAC pre-filter at retrieval is the security boundary — the prompt is a best-effort instruction, not a guarantee. This is the closing point: one engine, one policy set, three surfaces — browse, search, and now generative AI."*

### 6. Closing — the **Ask about these results →** pill (~30s)

Show one final detail: after running a semantic search, a small pill appears in the result summary row labelled *"Ask about these results →"*. Click it. The chat drawer opens **pre-loaded** with the same query. Send.

Talk track: *"This is the user journey we expect customers to recognise. Start by browsing what you have. Search for what you need. When you've narrowed in, ask the model to help reason over it. The platform makes that arc seamless — and the access controls travel with the user across every step."*

### Optional appendix — user admin / audit panel (~1.5 min)

If time allows, open `/admin/users`, click the **Coalition Contractor**, and show the **Effective permissions** panel: "rows visible: 1, fields redacted: 0, fields omitted: 0", plus the per-policy breakdown of which row policies grant visibility. This is the audit answer to *"what does this user actually see?"* — not "what attributes do they have?".

---

## Demo flow — detailed reference script (~12 min, search/admin only)

This script is designed to land four points in order: (1) the **same query** returns different rows per persona via row-level ABAC, (2) field-level **redaction** with `[REDACTED]`, (3) field-level **omission** of compartmented data, and (4) policies are **live-editable** without redeploying.

The five seeded personas (header dropdown, top → bottom):

| # | Persona | Clearance | Nationality | Unit | Compartments |
|---|---|---|---|---|---|
| 1 | UK Joint Intelligence Analyst — *Maj. R. Whitcombe* | TOP SECRET | GBR | DI | OP_NEPTUNE, OP_ORION |
| 2 | US Liaison Officer — *Lt. Col. J. Carter* | SECRET | USA | LO-UK | OP_NEPTUNE |
| 3 | UK Logistics Officer — *Capt. S. Patel* | OFFICIAL | GBR | 3_CDO_BDE | — |
| 4 | Coalition Contractor — *Ms. K. Nguyen* | OFFICIAL | AUS | EXT | — |
| 5 | Compliance Auditor — *Mr. D. Holland* | TOP SECRET | GBR | * | * |

The five seeded policies:

| # | Policy | Why it's there |
|---|---|---|
| 1 | Row — clearance AND nationality releasability | The classic ABAC gate. |
| 2 | Row — compartments need-to-know | Adds the "even if you're cleared and nationality matches, you still need the compartment" stack. |
| 3 | Row — own unit's OFFICIAL records | Lets the Logistics Officer see their own brigade's data without a wider clearance. |
| 4 | Field — source_name protected by source_classification | Redacts source attribution on docs whose source is more sensitive than the doc itself. |
| 5 | Field — precise grid_ref omitted for non-compartment holders | Omits `grid_ref` entirely if the persona lacks the compartments. |

The query used throughout: **`supply route disruption near Murmansk`** (it's one of the sample-query pills under the search box).

---

### Step 0 — Set the scene (30s)

Open `/admin`. Read the five policies aloud. Make the point that nothing is hard-coded — these are documents in a MongoDB collection, edited via the same database call as the data itself. Click *Run preview* at the bottom — the audience sees, in one table, how many rows each persona would see and how many fields would be redacted/omitted. This is the policy-author's test surface before going live.

### Step 1 — Full visibility (UK Joint Intel Analyst) (1 min)

Switch to `/search`. Persona = *UK Joint Intelligence Analyst* (default — top of dropdown). Click the **`supply route disruption near Murmansk`** sample query pill.

What the audience should see:
- 5+ results, with the top hits being reports tagged TOP SECRET / OP_NEPTUNE.
- Sources fully visible (`SIGINT/THRESHER`, `HUMINT/COBALT-7`, etc.).
- `grid_ref` values present (e.g. `68.45N 035.12E`).
- Counter at the top reads "Showing N matches visible to this persona" with no "hidden by policy" chip.

Talk track: "This is the analyst's view. Top Secret clearance, UK national, in the DI unit, holds both compartments. Everything is visible because every seeded policy passes."

### Step 2 — Field-level **redaction** (US Liaison Officer) (2 min)

**Without changing the query**, switch persona to *US Liaison Officer*.

What the audience should see (the **demo moment**):
- The Kola supply convoys report (INTREP-2025-0003) is still in the list — it's SECRET and US-releasable.
- The source field now shows **`[REDACTED]`** with the red diagonal-hatch styling — not the literal string `SIGINT/THRESHER`.
- The footer of that card says `Redacted: source_name`.
- A "hidden by row-level policy" amber chip appears in the result summary, because the TS-only reports dropped out.

Talk track: "Same query. Same MongoDB pipeline. But Lt. Col. Carter is SECRET, not TS — so the *report* is visible, but the *source* isn't. This isn't post-processing in the UI — the value `[REDACTED]` is what came out of the database. The application never saw `SIGINT/THRESHER`."

The same redaction also fires on **INTREP-2025-0008** (`RN/UKHO — Project ACHILLES`) and **INTREP-2025-0014** (`RN/MARSEC — Detachment SENTINEL`) — both SECRET docs with TS-classified sources.

### Step 3 — Field-level **omission** (still US Liaison) (1 min)

Stay on the US Liaison. Find the **Radar coverage gap — Norwegian coast** card (INTREP-2025-0014).

What the audience should see on that one card:
- The row is visible — it's SECRET and releasable to USA.
- `source_name` is `[REDACTED]` (the source is TS-classified).
- `grid_ref` shows **italic "omitted"** in amber — the doc is tagged `OP_ORION` and Carter only holds `OP_NEPTUNE`, so the compartment-superset check fails.
- The card footer says both `Redacted: source_name` and `Omitted: grid_ref`.

Now switch to the **UK Analyst** and look at the same report. Both fields are present — `RN/MARSEC — Detachment SENTINEL` and the precise grid reference. Switch back.

Talk track: "Two field treatments shipped. `[REDACTED]` replaces the value but leaves the field present — useful when the analyst needs to know that *something* was withheld. *Omitted* removes the field entirely; the application can't distinguish 'hidden by policy' from 'never existed'. Same engine, two different effects, both compiled into one `$set` stage. On this single document, both fire — for different reasons — driven by different attributes of the same persona."

(For contrast, point out that the other returned cards have `grid_ref` shown normally — those don't carry the OP_ORION compartment, so the field policy doesn't fire.)

### Step 4 — Pop the hood (1 min)

Click the **MongoDB pipeline** panel below the results. Expand it.

What to point at:
1. The `$vectorSearch` stage with `path: "embedding"` and a `queryVector` placeholder — *we embed once, in our middleware, via Voyage; we never round-trip embedded text to a managed service in this demo*.
2. The `filter` clause inside `$vectorSearch` — this is the **ABAC pre-filter**. The kNN never even considers documents this persona can't see. Make the point: in a post-filter design, an attacker could infer that "N more docs exist that I can't access" by hit-count differences. Here, they cannot.
3. The `$set` stage further down — a per-field `$cond` that swaps `source_name` for `[REDACTED]` when the persona's clearance falls below the field's `source_classification`. This is the field-level policy compiled into a Mongo expression.

Talk track: "Everything you've just seen is a deterministic compilation of the persona's attributes against the active policy set. Same engine, same pipeline shape, every time."

### Step 5 — Unit-scoped access (UK Logistics Officer) (1 min)

Switch persona to *UK Logistics Officer*. Same query, **no re-typing**.

What the audience should see:
- The result set collapses to OFFICIAL records — and only those originating from `3_CDO_BDE`. Reports like *Maintenance backlog, 3 Cdo Bde vehicle fleet* and *Cold weather training rotation* show.
- All TS/SECRET material is gone.
- The "N hidden by row-level policy" chip jumps.

Talk track: "Capt. Patel only has OFFICIAL clearance and isn't in any compartment, so policies 1 and 2 never fire for them. But policy 3 — 'own unit's OFFICIAL records' — does. ABAC composes; the persona is the *union* of what every applicable policy grants."

### Step 6 — The "can't retrieve, can't leak" moment (Coalition Contractor) (45s)

Switch persona to *Coalition Contractor (AUS)*. Same query.

What the audience should see:
- Almost no results. Possibly a single OFFICIAL OSINT report releasable to AUS.
- "X hidden by row-level policy" chip is very large.

Talk track: "Ms. Nguyen is an Australian contractor — OFFICIAL only, no unit, no compartments. The semantic search *cannot find* the supply-route reports she's asking about, because they aren't candidates in the kNN. The model can't leak what it can't retrieve."

### Step 7 — Auditor (45s)

Switch persona to *Compliance Auditor*. Same query.

What the audience should see:
- The **AUDITOR** chip appears in the persona switcher *and* in the result summary banner.
- All rows visible — including TS, all compartments. No redactions, no omissions.

Talk track: "The auditor bypass isn't a hard-coded backdoor. It's a single conditional in the policy engine — `if persona.isAuditor`, return empty filter — and in production that branch would emit an audit log line. The point: auditor access is itself a policy. Same data, same pipeline, the engine just gets a different input."

### Step 8 — Live policy editing (1.5 min)

Back to `/admin`. Click the policy **"Field — source_name protected by source_classification"**. Show the visual builder + JSON on the right. Toggle it **off** via the "on" checkbox.

Return to `/search`. Switch to *US Liaison Officer*. Re-run the same query.

What the audience should see:
- All sources now show their real values — `SIGINT/THRESHER`, `RN/UKHO — Project ACHILLES`, etc.
- The footer no longer reports `Redacted: source_name` on any card.
- The pipeline panel no longer has a `$cond` for `source_name`.

Go back to `/admin`, toggle the policy **on**. Show it returns immediately.

Talk track: "Policies live in MongoDB — same database, same change feed, same RBAC if you wanted to govern *who can edit policies*. We changed one bit and the entire downstream surface — search results, redactions, even the pipeline shape — updated on the next request. No redeploy, no cache invalidation, no schema migration."

### Step 8b — User admin (optional, ~1 min)

Open `/admin/users` from the top nav. The five seeded personas appear as cards on the left, each with chips for clearance / nationality / unit and an "AUDITOR" chip where applicable.

Click any user. The right pane shows:

- **The user builder** — same visual editor + JSON view pattern as policies. You can change attributes (e.g. drop the US Liaison's compartment, raise their clearance), click *Save user*, then jump to `/search` and pick them in the header dropdown. The next search uses the updated attributes — no redeploy.
- **Effective permissions panel** — a three-stat summary (rows visible, fields redacted, fields omitted) computed by browsing the corpus as that user, plus a list of which row policies grant visibility, which row policies *don't* apply, and which field policies may redact or omit. This is the audit answer to "what can this user actually see?"

Talk track: "Policies and users are both first-class objects in the same database. We could govern who can edit them with the same ABAC engine. And this audit panel is the answer to the auditor's question — not 'what attributes does this user have?' but 'what does this user effectively *see*?'"

### Step 8c — Chat with ABAC retrieval (optional, ~2 min)

Click the **Ask AI ▸** button in the bottom-right of `/search`. The chat drawer slides in. Persona name and model are shown at the top — the model dropdown lists what's configured via `GROVE_CHAT_MODELS` (typically a Claude and an OpenAI model, both vision-capable).

The closing demo arc: **Browse → Search → Chat**, all on the same screen, all bound by the same ABAC pipeline.

Ask:

> *What's happening with supply convoys around Kola?*

What the audience should see, as the **UK Joint Intelligence Analyst**:
- Tokens stream into the assistant turn.
- A "Sources" collapsible appears under the answer with 3–6 cited reports — each chip is the same classification/compartment chip used on the search results.
- The answer cites `[INTREP-2025-…]` IDs that round-trip to the existing ReportCard rendering.

**Switch persona to the US Liaison** and ask the same question. The audience should see:
- A shorter, less specific answer.
- The Sources panel shows the same questions retrieved fewer reports — and where `source_name` was redacted at retrieval, the model says "source attribution is restricted" rather than making one up.
- Any media attachments referenced in the answer are the ones the persona can see — items the persona can't see were replaced with a `{redacted: true, reason}` stub before the model ever saw them.

**Switch to the Coalition Contractor** and ask the same question. The answer should be a one-liner: *"I don't have access to any reports relevant to that question."*

Talk track: "Same model, same prompt, same retrieval shape. The persona is the *only* input that changed. The model can't leak what it never saw — the ABAC pre-filter at retrieval is the security boundary, the prompt is best-effort. This is the closing point of the demo: ABAC across browse, search, and now generative AI — one engine, one policy set, three surfaces."

### Step 9 — Q&A safety net

Audience questions usually fall into four buckets — short answers below.

- **"Can I see the seed policies and seed data?"** — Yes; they're in `data/policies.seed.json` and `data/reports.seed.json`. Both are loaded by `npm run seed` and live as ordinary Mongo documents from then on.
- **"What if the user is in a directory I already have (Okta / Entra / AD)?"** — Personas in this demo are static for clarity. In production, the persona object would be built from IdP claims on each request. The policy engine wouldn't change.
- **"Does this scale?"** — The row filter compiles to native Mongo `$match` operators; same query planner, same indexes. The vector index has every ABAC attribute registered as a `filter` field so pre-filtering is index-backed.
- **"What about logs?"** — Out of scope here, but the policy engine returns a structured pipeline per request — that's the audit artefact. In production you'd log `{persona, policySetVersion, rowFilter, fieldRedactions, resultIds}` to a separate collection or sink.

## Admin reference — Users and Policies

A concise field-by-field guide to the two admin screens (`/admin/users` and `/admin`). Useful when demoing to people who'd otherwise ask "what does that symbol mean?".

### User fields (`/admin/users`)

A user is a *persona* — the attributes the policy engine evaluates on every request.

| Field | Description |
|---|---|
| **User ID (slug)** | Stable identifier, lower-case, hyphenated. Used by the persona switcher and as the document key. |
| **Display name** | Free text. Shown in the header dropdown and on the persona card. |
| **Role** | Free text. Cosmetic only — narrative context, not policy input. |
| **Clearance** | One of `OFFICIAL`, `SECRET`, `TOP_SECRET`. Ranked numerically (1, 2, 3) so "≥" comparisons work. |
| **Nationality** | One of `GBR`, `USA`, `AUS`, `CAN`, `NZL`. Checked against each document's `releasability` list. |
| **Unit** | Free text (e.g. `DI`, `3_CDO_BDE`, `EXT`). Matched literally against `originating_unit`. Use `*` for auditor-style wildcard intent — but note the actual bypass is driven by the **Audit role** flag, not by `*`. |
| **Compartments** | Comma-separated list (e.g. `OP_NEPTUNE, OP_ORION`). The persona must hold every compartment a document is tagged with. |
| **Description** | Free text. Shown on the persona card and in the demo narrative. |
| **Audit role** | Checkbox. When set, the policy engine short-circuits — the user sees every row, no fields are redacted or omitted. In production this branch would emit an audit log line per request. |

### Policy fields (`/admin`)

A policy is a single ABAC rule. The active policy set (every enabled policy) is compiled on every request into MongoDB pipeline fragments.

| Field | Description |
|---|---|
| **Policy ID (slug)** | Stable identifier, lower-case, hyphenated. Unique per policy. |
| **Name** | Free text. Shown in the policy list and demo narrative. |
| **Description** | Free text. Shown in the builder and used as the human-readable "reason" when the policy denies a media item. |
| **Target** | What the policy controls. `Row` gates whole documents. `Field` gates a single scalar field on every matching document. `Media` gates a single attached image/video inside `mediaItems[]` — evaluated against the item's own attributes, not the parent report's. |
| **Effect** | What happens when conditions match. Depends on Target: <br/> • `Row` → `allow` (persona may see the row) or `deny` (hide the row). <br/> • `Field` → `redact` (replace with `[REDACTED]`) or `omit` (remove the field entirely). <br/> • `Media` → `allow` (persona may see the item) or `deny` (replace the item with a redacted stub showing the policy's description as the reason). |
| **Field path** | Only for Target = Field. The document field to gate (e.g. `source_name`, `grid_ref`). |
| **Priority** | Integer. Currently informational — used for stable ordering in the list. Not used for conflict resolution; row-level `allow`s union and `deny`s subtract regardless. |
| **Enabled** | Checkbox. Disabling a policy removes it from the compiled pipeline immediately on the next request — no redeploy. |
| **Conditions** | One or more rules ANDed together. See below. |

### Conditions — what each operator means

A condition is an expression of the form *user attribute* `op` *document attribute*. Multiple conditions on the same policy must ALL hold (logical AND). The dropdown shows the operator using mathematical shorthand; here's the plain-English version:

| Symbol in the UI | Plain English | What "value" field does |
|---|---|---|
| `user.clearance ≥ doc.classification` | The user's clearance level is at least as high as the document's classification. `OFFICIAL < SECRET < TOP_SECRET`. | — |
| `user.clearance ≥ doc.<field>` | Same comparison, but against a *named field* on the document rather than the default `classification` field. Use for things like source-level classification that's tighter than the document's overall classification. | The document field name to compare against, e.g. `source_classification`. Missing field counts as "not protected". |
| `user.nationality ∈ doc.releasability` | "∈" means *is a member of*. The user's nationality appears in the document's `releasability` array. | — |
| `user.compartments ⊇ doc.compartments` | "⊇" means *is a superset of*. The user holds every compartment the document is tagged with. A document with no compartments is visible to everyone (the empty set is a subset of any set). | — |
| `user.unit == doc.originating_unit` | "==" means *equals exactly*. The user's unit string matches the document's `originating_unit` literally. Case sensitive. | — |
| `doc.classification ==` | The document's classification equals a literal value (`OFFICIAL`, `SECRET`, or `TOP_SECRET`). | The literal classification string to match against. |

A condition list with **no entries** matches every document — useful only when you specifically want a "catch-all" policy (e.g. an `allow` rule with no restrictions).

### Adding a condition — what gets configured

Click *+ Add condition* under the Conditions section of the policy builder. For each row you choose:

1. **Operator** — one of the six entries above, from a single dropdown. The label uses the mathematical symbol; the table above is the decoder.
2. **Value** *(only for `field_classification_gte` and `classification_eq`)* — a free-text input appears next to the operator dropdown when the operator needs one. For `field_classification_gte` it's the document field name to compare against; for `classification_eq` it's the literal classification string.

The `×` button on the right removes that condition.

### Reading the semantics

- For a **row allow** policy, conditions describe **who is allowed to see the row**. If the user fails any condition, the row drops out (combined across all row-allow policies as a logical OR — any one allow grants visibility).
- For a **row deny** policy, conditions describe **who must be blocked**.
- For a **field redact/omit** policy, conditions describe **who is allowed to see the field**. If the user fails, the effect (redact or omit) is applied to that field on that specific document.
- For a **media allow** policy, conditions describe **who is allowed to see the media item**. Each `mediaItems[]` element is evaluated independently against its own classification, releasability and compartments — items the user fails are replaced with a `{redacted: true, reason}` stub. Multiple media policies AND together: an item must satisfy every one to be returned in full.

The right-hand panel of the builder shows the policy as JSON in real time — useful for showing the audience that policies are first-class documents stored in MongoDB, not code.

## Project layout

```
app/
  admin/page.tsx                 # policy admin UI
  admin/users/page.tsx           # user admin UI + per-user permissions audit
  search/page.tsx                # search + browse UI
  api/
    personas/route.ts            # GET — list personas (from users collection)
    policies/route.ts            # GET / POST policies
    policies/[policyId]/route.ts # PATCH / DELETE policy
    users/route.ts               # GET / POST users
    users/[id]/route.ts          # PATCH / DELETE user
    search/route.ts              # POST — vector search with ABAC
    browse/route.ts              # POST — browse with ABAC
components/
  PersonaProvider.tsx, PersonaSwitcher.tsx, PersonaCard.tsx
  ReportCard.tsx, PipelinePanel.tsx
  PolicyBuilder.tsx, PolicyList.tsx, TestAsPersonaPanel.tsx
  UserBuilder.tsx, UserList.tsx
lib/
  personas.ts                    # seed personas + DB-backed getPersona()
  policyEngine.ts                # ABAC → Mongo pipeline compiler
  queries.ts                     # executes a search/browse with policies applied
  embeddings.ts                  # Voyage AI client (document + query embeddings)
  mongo.ts, types.ts
data/
  reports.seed.json              # synthetic intel reports
  policies.seed.json             # ABAC policies
  users.seed.json                # personas (users) loaded into the users collection
scripts/
  seed.ts                        # embeds bodies, seeds collections, creates indexes
  waitForEmbeddings.ts           # blocks until the vector index is queryable
```

## Repurposing for another domain

The policy engine, admin UI, search UI, and persona model are all domain-agnostic. To re-skin:

1. Replace `data/reports.seed.json` with your dataset (any document shape works — the policy engine references field paths by name).
2. Replace `lib/personas.ts` with personas that match the new domain.
3. Adjust the attributes referenced by the policy engine's operators — see `lib/policyEngine.ts` `buildConditionMatch` / `buildConditionExpr`. New operators are easy to add (`role_in`, `cohort_eq`, `dept_eq`, etc.).
4. Update `data/policies.seed.json` to express your new domain's rules.
5. Re-run `npm run seed` and `npm run seed:wait`.

## How the policy engine works

For each request, given the active persona and the active policy set, it compiles two MongoDB pipeline fragments:

- **Row filter** — union of allow policies (closed-by-default), minus any deny policies, expressed as a single `$match`-shaped object. For semantic search it's passed verbatim as `$vectorSearch.filter` — a true pre-filter.
- **Field $set** — one `$set` stage that, for each policy'd field, replaces the value with `[REDACTED]` or `$$REMOVE` when the persona fails the policy's conditions for that specific document.

The same engine runs for both `$vectorSearch` and plain browse — so the audience sees a single source of truth.

## Configuration

- `MONGODB_URI` — Atlas connection string (required)
- `VOYAGE_API_KEY` — MongoDB-issued key for the hosted Voyage endpoint (`https://ai.mongodb.com/v1/embeddings`). Required.
- `VOYAGE_MODEL` — defaults to `voyage-3.5` (1024 dims). Other options: `voyage-3.5-lite`, `voyage-3-large`, `voyage-3`, `voyage-code-3`. Re-run `npm run seed` after changing.
- `MONGODB_DB` — defaults to `abac_demo`
- `MONGODB_REPORTS` — defaults to `reports`
- `MONGODB_POLICIES` — defaults to `policies`
- `MONGODB_USERS` — defaults to `users`
- `MONGODB_VECTOR_INDEX` — defaults to `reports_vector`
- `MONGODB_MEDIA_INDEX` — defaults to `media_index`
- `MONGODB_MEDIA_VECTOR_INDEX` — defaults to `media_vector`
- `GROVE_BASE_URL` — Grove gateway base URL (used by the chat drawer). Defaults to `https://grove-gateway-prod.azure-api.net/grove-foundry-prod`.
- `GROVE_API_KEY` — Grove gateway key. Required to use the chat drawer; the chat endpoint will return an error if missing.
- `GROVE_CHAT_MODELS` — comma-separated model ids surfaced in the chat drawer dropdown. Defaults to `claude-sonnet-4-6,gpt-5.5`. The chat route picks the OpenAI vs Anthropic path automatically based on the model id prefix.

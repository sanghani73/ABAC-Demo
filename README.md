# ABAC Demo — MongoDB Atlas Vector Search

A small Next.js demo that shows attribute-based access control over MongoDB Atlas, including how ABAC composes with Atlas Vector Search using Voyage AI embeddings.

The narrative is a UK MoD intelligence-reports scenario, but the data model, persona attributes, and policy engine are domain-agnostic — swap the seed data and personas to repurpose for healthcare, finance, etc.

## What it shows

- **Row-level access control** — different personas see different documents from the same query
- **Field-level redaction & omission** — even within a returned document, sensitive fields are replaced with `[REDACTED]` or removed entirely depending on persona attributes
- **Semantic search with pre-filtered ABAC** — `$vectorSearch.filter` is built from the persona's policies, so the kNN never even sees rows the persona can't access ("what the model can't retrieve, it can't leak")
- **MongoDB Voyage AI embeddings** — document bodies are embedded by the seed script and stored in an `embedding` field; queries are embedded at search time by `lib/embeddings.ts`. Calls go to `https://ai.mongodb.com/v1/embeddings` (the MongoDB-hosted Voyage proxy) using a single MongoDB-issued API key. Works on Atlas M10 (no autoEmbed required).
- **Live policy admin** — visual builder + JSON view + "test as persona" preview that runs the proposed policy set against every persona before saving
- **Live user admin** — personas (users) are stored in MongoDB and edited via a visual builder; each user has an "effective permissions" panel that shows which policies apply, how many rows they can see, and how many fields are redacted/omitted
- **Chat (RAG) with ABAC retrieval** — a chat drawer on the search page sends the user's question through the same ABAC `$vectorSearch` pipeline as retrieval, then streams a response from a Grove-routed LLM (Claude or OpenAI, both vision-capable). The model only ever receives context the persona is permitted to see — including images for the multimodal moment.
- **Temporal (time-bounded) policies** — each policy carries optional `validFrom` / `validUntil` ISO timestamps. The engine evaluates the window server-side on every request, so a policy can be set to expire in 30 seconds and the next query will visibly re-shape. Use case: contractor exercise windows, time-limited auditor grants, scheduled declassification.

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

## Recommended demo flow — Browse → Search → Chat (~17 min)

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

### 5. Time-bounded policy — the grant expires while we watch (~2 min)

The bridge between "policies are editable" and "policies are *governed*". A policy is going to expire on a wall clock — no human input, no redeploy — and the records it grants will disappear from the user's view.

Switch persona to **UK Logistics Officer** (*Capt. S. Patel*) and stay in **Browse all**. The audience sees ~9 records — a mix of OFFICIAL material that any GBR persona can see (port visits, Arctic Council statement, liaison roster, etc.) and 5 **SECRET** records originating from `3_CDO_BDE` (vehicle maintenance, cold weather rotation, fuel forecast, ammunition stockholding, UAV sightings). The persona only holds OFFICIAL clearance — the only reason Capt. Patel sees those five SECRET records is the **own-unit override**, which grants access to their own brigade's data for operational necessity.

Open `/admin` in a new tab. Find **"Row access — own unit's records (operational override)"**. Click the **Valid until** picker → **+1m**. Save.

The policy card's status chip starts counting down: *expires in 58s, 57s, 56s…*

Switch back to `/search` (Logistics Officer, browse-all). The 3 Cdo Bde records are still there — the policy is still active. Hit refresh / re-run the browse to demonstrate the records are still being returned by every query.

When the chip turns **red** at the 60-second mark, narrate that the operational window is about to close.

When the chip flips to slate-grey *expired Ns ago*, run **Browse all** one more time. **The five SECRET 3 Cdo Bde records are gone — the list drops from 9 to 4.** Capt. Patel's view of their own brigade's classified data has just been withdrawn — the operational window closed, the grant lapsed, and the database stopped returning those rows on the next query. Only the OFFICIAL records remain, granted by the standard clearance + releasability policy.

You can reinforce by switching to **Semantic search** and trying `logistics readiness in 3 Cdo Bde`. Zero results.

Talk track: *"This is what makes ABAC work for grants that have a real-world expiry — exercise windows, contractor access, time-limited audit. The validity window lives on the policy document. The engine evaluates it server-side on every request, against the database's own clock. The decision is tamper-proof — no client input feeds into the comparison — and the next request after the threshold returns a different answer. For free, no cleanup job, no scheduled task. The data isn't deleted; Capt. Patel simply no longer has a path to it."*

To restore for the rest of the demo: open the policy again, click **clear** under Valid until, save. (Or **+15m** if you want a safety margin.) The chip disappears and the policy is permanent again — the 3 Cdo Bde records come back on the next browse.

You can demonstrate the same mechanism for **granting** access by setting **Valid from** to a few seconds in the future — the policy is dormant until the moment passes, then activates. Same engine, opposite direction: "the exercise window opens at 08:00, access turns on automatically."

### 6. Chat — the natural next step (~4 min, the closing moment)

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

### 7. Closing — the **Ask about these results →** pill (~30s)

Show one final detail: after running a semantic search, a small pill appears in the result summary row labelled *"Ask about these results →"*. Click it. The chat drawer opens **pre-loaded** with the same query. Send.

Talk track: *"This is the user journey we expect customers to recognise. Start by browsing what you have. Search for what you need. When you've narrowed in, ask the model to help reason over it. The platform makes that arc seamless — and the access controls travel with the user across every step."*

### Optional appendix — user admin / audit panel (~1.5 min)

If time allows, open `/admin/users`, click the **Coalition Contractor**, and show the **Effective permissions** panel: "rows visible: 1, fields redacted: 0, fields omitted: 0", plus the per-policy breakdown of which row policies grant visibility. This is the audit answer to *"what does this user actually see?"* — not "what attributes do they have?".

---

## Seed data reference

What `npm run seed` loads into MongoDB. The full source is in `data/*.seed.json` — these tables are the at-a-glance version useful when demoing.

### Seeded personas (users)

Visible in the header dropdown, top → bottom.

| # | Persona | Clearance | Nationality | Unit | Compartments | Notes |
|---|---|---|---|---|---|---|
| 1 | UK Joint Intelligence Analyst — *Maj. R. Whitcombe* | TOP SECRET | GBR | DI | OP_NEPTUNE, OP_ORION | Broadest access; everything passes for this persona. |
| 2 | US Liaison Officer — *Lt. Col. J. Carter* | SECRET | USA | LO-UK | OP_NEPTUNE | Drives the redaction + per-item media gating demo moments. |
| 3 | UK Logistics Officer — *Capt. S. Patel* | OFFICIAL | GBR | 3_CDO_BDE | — | Demos the own-unit operational override — the only path their OFFICIAL clearance has to brigade SECRET data. Canonical persona for the temporal-policy expiry moment. |
| 4 | Coalition Contractor — *Ms. K. Nguyen* | OFFICIAL | AUS | EXT | — | The "can't retrieve, can't leak" moment — almost everything filters out. |
| 5 | Compliance Auditor — *Mr. D. Holland* | TOP SECRET | GBR | * | * | `isAuditor: true` — policy engine short-circuits. |

### Seeded policies

| # | Policy | Target / Effect | What it does |
|---|---|---|---|
| 1 | Row — clearance AND nationality releasability | row / allow | The classic ABAC gate: clearance covers classification, nationality is in releasability. |
| 2 | Row — compartments need-to-know | row / allow | Adds the compartments-superset check on top of policy 1. |
| 3 | Row — own unit's records (operational override) | row / allow | Operational-necessity grant: a persona can see records originating from their own unit even when their clearance / nationality would otherwise fail. Typically time-bounded for the duration of an exercise — the canonical temporal-policy demo target. |
| 4 | Field — source_name protected by source_classification | field / redact | Replaces `source_name` with `[REDACTED]` when the doc's `source_classification` exceeds the persona's clearance. |
| 5 | Field — precise grid_ref omitted for non-compartment holders | field / omit | Removes `grid_ref` entirely when the persona doesn't hold every compartment the doc is tagged with. |
| 6 | Media — clearance, releasability and compartments per item | media / allow | Per-item gating of `mediaItems[]` evaluated against the *item's own* attributes — not the parent report's. |

### Seeded reports

20 synthetic intelligence reports (`INTREP-2025-0001` through `INTREP-2025-0020`). Three of them carry attached media — those are the records that drive the multimodal moments. Highlights for the demo:

| Report ID | Title | Classification | Compartments | Notable for |
|---|---|---|---|---|
| INTREP-2025-0001 | Surface contact pattern shift, Barents approaches | TOP SECRET / GBR | OP_NEPTUNE | TS-only — only the UK Analyst and Auditor see it. |
| INTREP-2025-0003 | Supply convoy timings, Kola peninsula | SECRET / GBR-USA-CAN | OP_NEPTUNE | `source_classification: TOP_SECRET` — `source_name` redacts for the US Liaison. **Carries a TOP SECRET drone still** that the US Liaison cannot see. |
| INTREP-2025-0005 | Maintenance backlog, 3 Cdo Bde vehicle fleet | SECRET / Five Eyes | — | Logistics Officer's clearance is OFFICIAL — they only see this via the **own-unit override** policy. Disable / expire policy 3 and it vanishes from their view. |
| INTREP-2025-0010 | Allied port visit programme, Q3 | OFFICIAL / Five Eyes | — | **Carries an OFFICIAL dockside truck photo** — the language-disambiguation demo seed (UK persona searches "lorry", finds "truck"). |
| INTREP-2025-0014 | Radar coverage gap — Norwegian coast | SECRET / GBR-USA-CAN-NZL | OP_ORION | The single card where redaction *and* omission both fire for the US Liaison (source redacted, grid_ref omitted). |
| INTREP-2025-0017 | Adversary UAV sightings — northern training area | SECRET / GBR-USA-NZL | — | **Carries two media items** — see media table below. The cleanest per-item ABAC moment on a single report. |

### Seeded media items

Each `mediaItems[]` entry has its own classification / releasability / compartments — independently of the parent report. The media policy evaluates these per item.

| Media ID | Parent | Type | Caption | Classification | Releasability | Why it's there |
|---|---|---|---|---|---|---|
| MED-0003-A | INTREP-2025-0003 | image | Drone still: dispersed supply trucks on MSR east of Kola, dusk approach. | TOP SECRET | GBR | TS / GBR-only on a SECRET / GBR-USA-CAN report — US Liaison sees the report but the image is a redacted stub. |
| MED-0010-A | INTREP-2025-0010 | image | Dockside photograph: stores **truck** offloading at the Portsmouth jetty… | OFFICIAL | Five Eyes | Universally visible; the US-English **"truck"** caption seeds the multilingual / dialect demo (UK persona's "lorry" query matches it semantically). |
| MED-0017-A | INTREP-2025-0017 | image | Long-lens still of suspected adversary UAV transiting the northern training area at low level. | SECRET | GBR, USA, NZL | Visible to UK Analyst and US Liaison; AUS Contractor can't see the parent report at all. |
| MED-0017-B | INTREP-2025-0017 | video | Thermal video, 22 second clip: UAV pattern of life over picket position; sensor-specific signature visible. | TOP SECRET | GBR | The other item on the same report. UK Analyst sees both; **US Liaison sees the still but the thermal video is a redacted stub** — the cleanest single-card dual-result moment. |

### Sample queries to try

Each pre-loaded as a pill under the search box. The first three exercise the report-text vector index; the last three exercise the media vector index.

| Query | What it should surface |
|---|---|
| *supply route disruption near Murmansk* | The Kola-related reports (0002, 0003); INTREP-2025-0003 also pulls in the drone still as a "text + media" match for the UK Analyst. |
| *northern fleet activity* | TS-only reports 0001 and 0007 — only the UK Analyst and Auditor see them. |
| *OP NEPTUNE planning indicators* | OP_NEPTUNE-compartmented material — filters out for personas without that compartment. |
| *aerial drone view of a convoy on a road* | Targets MED-0003-A by caption — appears as "via media" for the UK Analyst, hidden entirely for the US Liaison. |
| *thermal imagery of a UAV at night* | Targets MED-0017-B — the thermal video. UK Analyst sees the report with the video tile outlined; US Liaison sees the report via the still and the video as a redacted stub. |
| *dockside photograph of supply lorries* | Targets MED-0010-A — the "lorry → truck" cross-dialect retrieval moment. |

### Where to edit

- Personas: `data/users.seed.json` — also editable live at `/admin/users`.
- Policies: `data/policies.seed.json` — also editable live at `/admin`.
- Reports + media: `data/reports.seed.json`. Re-run `npm run seed` after editing.
- Media files (optional): drop image files at the URLs referenced by each `mediaItems[].url` (under `public/`). When present, the seed script embeds them as text+image; when absent, embedding falls back to caption-only and the UI shows a placeholder tile.

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
| **Valid from / Valid until** | Optional ISO timestamps. A policy is treated as inactive when the current server time is outside the window. Either bound may be omitted (open-ended on that side). Quick-set shortcuts in the builder (`now`, `+15m`, `+1h`, `+1d`) make it easy to demonstrate a policy expiring live — the chip on each policy card counts down once a second. The decision itself is server-side and tamper-proof; the countdown is best-effort against the browser clock. |
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

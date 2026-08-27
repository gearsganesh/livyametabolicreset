# LIVYA Metabolic — prototype build notes

**Live prototype:** https://claude.ai/code/artifact/4e7e2d09-1085-47dd-a523-b6ae2157814a
**Offline copy:** this bundle — see `../README.md` for how to run it.

Built 22–24 Aug 2026. Single self-contained HTML page, no build step, no dependencies.
Everyone the app serves is a **client**. In the client's own portal a sub-admin is never called a sub-admin — they are that client's **Health Assistant**.

---

## Roles and access

Three roles, one sign-in page. Every rule is enforced in the app, and **Team → Who can do what** shows the same matrix to whoever is signed in.

| Action | Administrator | Sub-admin | Client |
|---|:--:|:--:|:--:|
| Sign in to the console | ✓ | ✓ | — |
| See every client and report | ✓ | ✓ | — |
| See their own reports | — | — | ✓ |
| Add a client / edit client details | ✓ | ✓ | — |
| **Delete a client** | ✓ | — | — |
| Add a report / review and edit an earlier one | ✓ | ✓ | — |
| **Delete a report** | ✓ | — | — |
| Upload to the file manager | ✓ | ✓ | — |
| Download a file | ✓ | ✓ | ✓ (own folder) |
| **Delete a file** | ✓ | — | — |
| Create and deactivate sub-admins | ✓ | — | — |
| **Reset a password — anyone's, including their own** | ✓ | — | — |
| **Design a programme / schedule tests and tracking** | ✓ | — | — |
| Assign a programme to a client | ✓ | ✓ | — |
| **Assign a client to a Health Assistant** | ✓ | — | — |
| Message a client | ✓ | ✓ | — |
| Message their Health Assistant | — | — | ✓ |
| See the clinic-wide Due queue | ✓ | ✓ | — |
| Log a daily check-in | ✓ | ✓ | ✓ (own, where the programme allows) |
| **Delete a daily check-in** | ✓ | — | — |
| Add a daily note | ✓ | ✓ | — |
| **Delete a daily note** | ✓ | — | — |
| Update the diet plan and chart | ✓ | ✓ | — |
| **Import a diet chart from a spreadsheet** | ✓ | — | — |
| Add a recipe to the library / attach a video / share it | ✓ | ✓ | — |
| **Delete a recipe** | ✓ | — | — |
| Request that a recipe be deleted | — | ✓ | — |
| **Approve or decline a deletion request** | ✓ | — | — |
| Download the health report and diet chart | ✓ | ✓ | ✓ |
| Search by name / record no. | ✓ | ✓ | — |

**Nobody sets anybody else's password.** Staff and clients choose their own on first sign-in; it is stretched with PBKDF2-SHA-256 (120,000 iterations, per-account salt) and only the hash is kept, on the device it was created on. An administrator can *reset* — one account, or every account at once from Team — which clears the credential and sends the person back through the create-your-own flow. It never reveals or sets one.

Every change is written to an **Activity** log with name, role and timestamp.

---

## Assignment and messaging

**Every client has one Health Assistant.** An administrator sets it on the client's *Details & access* tab; it shows on the roster card, on the client's *My plan*, and in the message thread header. Sub-admins cannot reassign.

**Assignment is a filter, not a wall.** Sub-admins still see every client — a clinic where an assistant is on leave must not lose access to their clients. What assignment changes is the *default view*: a sub-admin's roster and inbox both open on **Assigned to me**, with **Every client** one click away. Search always crosses the whole roster so cover is never blocked. If you want assignment to be a hard boundary instead, that is a server-side scoping rule and a deliberate decision about how cover works — not a UI change.

**One conversation per client.** The client talks to their Health Assistant; any administrator can read and answer the same thread. That means cover works and nothing is lost when an assistant changes, at the cost of the client's messages not being private from the administrator — which the composer says explicitly on both sides.

- **Client portal → Messages** — a single thread with their Health Assistant, named and titled as such.
- **Console → Messages** — an inbox of every client conversation with unread counts, filterable to *Assigned to me*, with the thread beside it and a jump to the client's record.
- **Client detail → Messages** — the same thread inside the client's record.
- Unread counts appear on the nav tab, on the inbox row, on the client's detail tab and on the roster card. Opening a thread marks it read.

Enter sends, Shift+Enter breaks a line, and a message shows *read* once the other side has opened it. Staff see system role names (Sub-admin); clients see **Health Assistant** and **Clinic administrator** — the client-facing vocabulary never leaks the internal one.

**Where this stops.** No push notifications, no email fallback, no typing indicators, and a thread only updates when the page re-renders — there is no live socket. A client messaging at 11pm gets no alert to anyone.

---

## Programmes and the test scheduler

A programme is the shape of the engagement: **name**, **duration in weeks**, **what it involves**, and a **tests & tracking schedule**. Duration drives the client's week counter and progress bar. A programme with clients enrolled cannot be deleted — retire it.

Each scheduled item has: **what** it is called, **how often** (daily through yearly), **type** (*report* — clears when a clinician saves a report; *daily log* — clears when a check-in is recorded), which **measurements** satisfy it, whether the **client can log it**, and a note. An *Add the standard four* button drops in Blood work monthly plus BP, sleep and steps daily.

**Due** is computed per item: most recent satisfying date, plus the period, against today. Never-recorded items are treated as due one period ago rather than overdue since day one. The queue surfaces in five places — the client's *What's due* card and a banner on *My health*, the clinic-wide **Due** tab with a live overdue count, the roster badge, and the client's Coaching tab.

**The prototype shows the queue; it does not send anything.** It is shaped as a list of (client, item, how overdue) so a daily cron can iterate it directly.

---

## Recipe library

Recipes are a library, not a feed. Every recipe stays on file whether or not it is shared, searchable by title or ingredient and filterable by *All / Shared / Library only / With video*.

**Creating and sharing are separate acts.** Adding a recipe puts it in the library. *Share* opens a panel with a switch for every client or a tick per client, and the card carries its own state — "Shared with every client", "Shared with Priya Nair", "In the library · not shared". The most recently shared recipe becomes that client's recipe of the day.

**Video links.** Admin and sub-admin can attach one; the provider is detected (YouTube, Vimeo, Drive, direct file) and it renders as a play card wherever the recipe appears, including the client's portal. The hosted page blocks external hosts, so the card opens the video in a new tab and shows the full URL as selectable text rather than embedding a player that would render as an empty box. Self-hosted, the same stored URL embeds inline — a CSP setting, not a code change.

**Deletion is asymmetric by design.** Sub-admins have making rights only: no delete button appears for them anywhere. *Request deletion* asks for a reason and routes to the administrator, who sees a flagged queue at the top of the Recipes tab, a count on the nav tab, and Approve / Decline per request. The recipe stays live until they decide; the requester can withdraw. Every step, including the reason, lands in the Activity log.

Worth deciding before real use: a YouTube link is free but public, and an unlisted link is not access control. If recipe videos are part of what clients pay for, they belong in the same object storage as the file manager, behind the same signed URLs.

---

## Downloads

Clients and staff can both download the **health report** and the **diet chart**, from the portal and from the console. Each is a self-contained HTML file laid out for A4 — Ctrl/Cmd+P → Save as PDF gives a finished document.

Health summary prints portrait, diet chart landscape so the full week fits across one page with the header row repeating. Deliberate page breaks, `break-inside` protection on every card and row, repeating table headers, a running footer carrying the client's name and record number, colour preserved, two-column layout held in print. Charts come through as vector SVG.

Saving takes whichever path is available: inside the hosted viewer, the downloads capability; anywhere else — this offline copy, your own host — an ordinary browser download. Where a viewer refuses `.html` it falls back to Markdown and says the charts were left out.

Two bugs this surfaced, both fixed and both affecting the app as well as the print: the print width (~703px on A4) was tripping the mobile breakpoint and collapsing every two-column layout, and the chart TARGET caption collided with the last value label exactly when a client got close to their target.

---

## Spreadsheet import

Drop an `.xlsx` or `.csv` onto the Coaching tab and the diet chart fills itself; nothing is written until an administrator has seen a preview of every cell.

An `.xlsx` is a ZIP of XML, so the reader walks the ZIP central directory, inflates each entry with `DecompressionStream('deflate-raw')`, and parses the worksheet XML with `DOMParser`. No library, nothing uploaded. Four layouts are recognised automatically — days across the top, meals across the top, one row per meal, and a single unnamed day — with alias tables for day and meal names, time normalisation, and labelled-cell extraction for calories, protein, favour, limit and notes. Apply offers *replace* or *fill empty only*; guidance text only fills blank fields so an import never discards what a coach wrote. Verified at 49 of 49 meals across all three grid layouts plus CSV.

---

## Architecture

| Layer | What it does |
|---|---|
| `AUTH` | PBKDF2-SHA-256 derivation, strength check, first-sign-in password creation. |
| `FILES` | File bytes in IndexedDB on the device; metadata in the shared record. |
| `STORE` | `localStorage` plus, when hosted, the artifact's `data/patients.json` with credentials stripped from the shared copy. Role capabilities, session, audit log, migrations v1 → v6. |
| `PDF` | Dependency-free PDF text extractor — inflates FlateDecode streams, walks content-stream text operators, tracks the text and transformation matrices, parses `ToUnicode` CMaps. |
| `PARSE` | Lines → marker registry: alias matching, reference-interval stripping, reversed column order, result flags, unit conversion, plausibility checks. |
| `SHEET` / `DIETIMPORT` | `.xlsx` and `.csv` readers; grid → diet chart with layout detection. |
| `SCHEDULE` | Last-done lookup, due arithmetic, per-client summary, clinic-wide queue. |
| `MSG` | Threads, unread counts, read receipts, inbox ordering, assistant lookup. |
| `EXPORT` | Print-ready health report and diet chart, plus Markdown fallbacks. |
| `saveAs` | One save path: the viewer's downloads capability if present, an anchor download otherwise. |
| `R` / `MARKERS` / `ENGINE` / `ADVISOR` | The clinical layer — 30-marker registry, derived indices, composite score, change analysis, findings and plan. |
| `PROG` / `COACH` / `RECIPE` | Programme manager, coaching workspace, recipe library with sharing and deletion requests. |
| `CHARTS` | Hand-built SVG throughout. |

**Data model (v6):** `recipe.sharedAll` / `sharedWith[]` / `deleteRequest` / `video` join `client.assistantId`, `client.messages[]`, `program.schedule[]`, `client.checkins[]`, `client.notes[]`, `client.diet`, `client.programId` / `programStart`, `DB.programs`, `DB.recipes`.

---

## Clinical decisions worth reviewing with a physician

- **South-Asian cutoffs throughout**: BMI 23 / 25; waist ≥ 90 cm (men), ≥ 80 cm (women); HOMA-IR 2.5. WHO bands shown as a secondary note.
- **Body fat has two competing standards.** The 2025 Indian consensus is the alert trigger; the Gallagher Asian thresholds sit above it. Both labelled by source, never averaged.
- **Four markers are advisory, not diagnostic**: fasting insulin, phase angle, InBody visceral fat *level*, FFMI.
- **Nothing is called progress until it clears a least-significant-change threshold** — HbA1c 0.3 points, LDL 12 mg/dL, body fat 2.0 points, visceral fat 15 cm².
- **Skeletal muscle index** uses the Janssen SMM ÷ height² bands, not the AWGS appendicular cutoffs, because InBody reports total SMM.
- The sarcopenic-obesity finding says "confirm with grip strength" — mass alone does not diagnose sarcopenia.
- **Self-logged readings never enter the clinical trend charts.** A home cuff and a clinic reading are not the same measurement. Check-ins satisfy the schedule and sit in their own table, range-checked on entry.
- **The diet chart stays a clinician's document.** Prefill supplies the two numbers the engine can defend; import reads what a dietitian already wrote. Neither invents food.

---

## Where a large language model belongs in production

The app runs entirely in the browser, so extraction and suggestions are deterministic rules — the right default for anything clinical. Five places genuinely benefit from a model, all server-side:

**1. Extraction fallback for scanned reports.** A third to a half of real uploads in India are photographs of printed sheets. Send the page image to Claude with a strict JSON schema and merge into the same review table:

```js
const res = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 2048,
  tools: [{
    name: "record_values",
    description: "Record every measurement found on this report.",
    input_schema: {
      type: "object",
      properties: {
        report_date: { type: "string" },
        source: { type: "string" },
        values: {
          type: "array",
          items: {
            type: "object",
            properties: {
              marker: { type: "string", enum: MARKER_KEYS },
              value:  { type: "number" },
              unit:   { type: "string" },
              printed_label: { type: "string" },
              confidence: { type: "string", enum: ["high", "low"] }
            },
            required: ["marker", "value", "unit", "printed_label"]
          }
        }
      },
      required: ["values"]
    }
  }],
  tool_choice: { type: "tool", name: "record_values" },
  messages: [{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: "image/png", data: pageImage } },
    { type: "text", text: "Extract every measurement. Use the printed unit; never infer a unit from magnitude. Mark anything unclear as low confidence." }
  ]}]
});
```

Sanity-check every value against the marker's plausible range afterwards, route everything to the clinician's review table, and let low-confidence rows arrive unticked.

**2. Rescuing a diet spreadsheet the rules cannot read** — merged cells, bilingual sheets, a photograph of a chart. Same `day.slot` schema, same preview table, same Apply button.

**3. Writing the reminder, not just listing it.** The Due queue decides *who and what*; a model decides *how it is worded* — right language, aware that this client has missed three days rather than one.

**4. Drafting a reply for the Health Assistant to approve.** Message volume is what kills coaching businesses: a client asks about a hotel buffet and it takes ten minutes to answer well. Give the model the thread plus that client's plan, targets and latest report, and have it draft — never send. The assistant edits and presses send, and their name is on it. This is the highest-leverage model use in the product and the one with the sharpest failure mode: the draft must never auto-send, and must never state a clinical threshold the engine did not produce.

**5. Turning the engine's output into the client's voice** — same clinical content, adapted to reading level, language (English / Hindi / Malayalam / Arabic) and tone.

What a model should **not** do: choose thresholds, decide whether a change is real, decide what is overdue, send a message, or publish anything to a client without a human's save.

---

## Known limitations of the prototype

- **The sign-in is a demonstration of the access model, not production authentication.** Every check runs in the browser. Production moves accounts, sessions and permission checks to a server, with rate limiting, email verification, token-based reset and staff two-factor.
- **No message notification and no live updates.** Threads refresh on re-render; nobody is alerted. No reminder is sent either — the Due queue exists, the job that reads it does not.
- **Messages are not private from the administrator**, by design so cover works. If clinical confidentiality between client and assistant is required, that is a different thread model.
- **File bytes stay on the device that uploaded them.** Metadata is shared; contents are in IndexedDB locally.
- Image-only PDFs yield no text — the app says so and offers paste or manual entry.
- **Spreadsheet import does not read merged cells, formatting or images**, and ignores `.xls`, Numbers files and PDFs.
- **Recipe videos are links, not embeds**, and a public video link is not access control.
- **Check-ins are one row per day.** Twice-daily BP needs a schema change, not a UI tweak.
- **Wearable data is still typed in.** Steps and sleep would come from Apple Health / Google Fit / Fitbit in production, which would clear those reminders automatically.
- Recipes have no image.

---

## Suggested next steps

1. Have a physician review the threshold table and the wording of the findings and plan.
2. Decide the deployment shape: standalone LIVYA product, module inside LIVYA ASSIST, or white-label for partner hospitals.
3. Move authentication and permissions server-side; add email invites, token-based reset, staff two-factor.
4. **Build the notification layer once, for both messages and reminders** — email, push and WhatsApp, with per-client quiet hours and a snooze. Without quiet hours, reminders get muted within a fortnight and messages become a source of resentment rather than adherence.
5. Move file storage to object storage with signed URLs, virus scanning and retention — then add recipe photographs, recipe video hosting, and file attachments in messages.
6. Wire wearable ingestion so steps and sleep clear themselves.
7. Add OCR + the Claude extraction fallback for scanned reports, and the model fallback for unreadable diet spreadsheets.
8. Add DEXA-specific markers (ALMI, android/gynoid ratio, VAT mass, T-score) — the parser aliases are already researched.
9. Decide whether assignment should scope visibility or only the default view, and how cover is handled when an assistant is on leave.
10. Work through data protection: India's DPDP Act and, for the GCC centres, the UAE and Saudi health-data rules. Messaging raises this again — a clinical conversation is a health record, needs the same retention and export rules as a report, and must be included in any subject-access request.

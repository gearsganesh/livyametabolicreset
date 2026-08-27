# LIVYA Metabolic — offline copy

A working prototype of the metabolic and obesity management app. One HTML file,
no build step, no dependencies, no server of its own. Everything it does — reading
lab PDFs, reading diet spreadsheets, drawing the charts, scoring, the clinical
findings — runs in your browser.

---

## Running it

**Mac** — double-click `start-mac-linux.command`.
If macOS blocks it: right-click → Open, then Open again. Or in Terminal, `cd` into
this folder and run `python3 serve.py`.

**Windows** — double-click `start-windows.bat`.
Needs Python 3 from [python.org](https://www.python.org/downloads/) with
"Add Python to PATH" ticked during setup.

**Linux** — `python3 serve.py` in this folder.

Your browser opens at `http://localhost:8080`. Stop the server with Ctrl+C.

### Why not just open index.html?

You can, but most of it will not work. Browsers give `file://` pages an opaque
origin, which switches off `localStorage` and `IndexedDB` — the two places this
prototype keeps its data. Nothing you did would survive a refresh, and uploaded
files would vanish. Served over `http://localhost` it behaves exactly as the
hosted version does.

Firefox is the exception: it allows local storage on `file://`, so opening
`index.html` directly works there. Chrome, Edge and Safari need the server.

---

## Signing in

No passwords are set. Pick an account, enter its email, and you will be asked to
create one — minimum 8 characters with a letter and a number.

| Account | Role | What they can do |
|---|---|---|
| `admin@livyagcc.com` | Administrator | Everything, including every delete |
| `anita@livyagcc.com` | Sub-admin | Adds and edits; no delete anywhere |
| `sana@livyagcc.com` | Sub-admin | Same |
| `rajesh.menon@example.com` | Client | His own reports, plan, files and messages |
| `priya.nair@example.com` | Client | Hers |

Passwords are stretched with PBKDF2-SHA-256 (120,000 iterations, per-account
salt) and only the hash is kept, in your browser. **This is a demonstration of
the access model, not production authentication** — every check runs client-side,
so anyone with developer tools can walk past it. Moving auth to a server is the
first item on the production list.

---

## Trying it out

Sign in as the administrator and:

1. **Clients → Rajesh Menon → Reports.** Drop `samples/sample-lab-report.pdf` and
   `samples/sample-inbody-sheet.pdf` on the upload zone together. The values are
   read out of the PDFs and shown in a review table before anything is saved —
   26 between the two files.
2. **Coaching → Import a diet chart.** Drop any of the three sample spreadsheets.
   They are the same week in three different layouts; all three read out 49 of 49
   meals. Check the preview, then Apply.
3. **Health view → Download report.** Open the saved file and print it to PDF.
   It is laid out for A4.
4. **Programmes.** Edit one and look at its Tests & tracking schedule. Then check
   the **Due** tab to see what that produces across every client.
5. **Messages.** Sign out, sign in as `rajesh.menon@example.com`, and reply.

---

## What is in the box

```
index.html                    the whole app — 345 KB, no dependencies
serve.py                      a local web server, standard library only
start-mac-linux.command       double-click launcher
start-windows.bat             double-click launcher
samples/
  sample-lab-report.pdf       Thyrocare-style panel, 17 analytes
  sample-inbody-sheet.pdf     InBody 570 body-composition sheet
  diet-chart-weekly.xlsx      days across the top, meals down the side
  diet-chart-transposed.xlsx  the same week, meals across the top
  diet-chart-long.xlsx        the same week, one row per meal
  diet-chart-weekly.csv       the same week as CSV
docs/
  build-notes.md              architecture, clinical decisions, limitations,
                              and where a language model belongs in production
```

---

## Where the data lives

- **Records** — client details, reports, programmes, notes, diet plans and
  charts, check-ins, recipes, messages, the audit log — in `localStorage`, keyed
  to whatever origin you serve from. Serve on port 8080 today and 9000 tomorrow
  and you will find two separate sets of data.
- **Uploaded file contents** — in `IndexedDB`, same origin rule.
- **Nothing leaves your machine.** No network calls except the Google Fonts
  stylesheet, which fails silently offline and falls back to your system fonts.

To start over: open your browser's developer tools → Application → Storage →
Clear site data, then reload. The seeded demo data comes back.

---

## Differences from the hosted version

| | Hosted | This copy |
|---|---|---|
| Data sync between devices | Yes, via the artifact's data file | No — this browser only |
| Downloads | Through the viewer's save prompt | Ordinary browser download |
| Fonts | IBM Plex from Google Fonts | Same, or system fonts offline |
| Everything else | — | Identical |

---

## Known limitations

These are prototype limits, not bugs. The full list with reasoning is in
`docs/build-notes.md`.

- Authentication is client-side and demonstrates the access model only.
- Uploaded file contents stay on the machine that uploaded them.
- Image-only PDFs yield no text — the app says so and offers paste or manual entry.
- Spreadsheet import does not read merged cells; `.xls`, Numbers files and PDFs
  are not supported.
- Recipe videos open in a new tab rather than embedding.
- Nothing is ever sent: no email, push or WhatsApp reminders, no message alerts.
- Wearable data is typed in, not pulled from Apple Health / Google Fit / Fitbit.

**Not a diagnosis.** The app organises measurements a clinician has already
ordered and flags patterns worth discussing. It does not replace clinical
judgement, and no medication decision should rest on anything it shows. The
thresholds it uses are listed in the build notes and should be reviewed by a
physician before this is used with real clients.

---

Built for LIVYA · V.K.T. Raju · August 2026

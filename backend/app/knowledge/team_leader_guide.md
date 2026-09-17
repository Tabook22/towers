# Insulator Inspector Pro — Complete Guide

This is the ground-truth reference for the in-app Help assistant. It documents exactly how the
app works today — screens, buttons, terminology, and the underlying logic — for both audiences of
the app: **Part A** for a team leader or team member running a field crew that inspects 132 kV
overhead-line insulator strings, and **Part B** for an admin (or reviewer) setting up and running
the whole operation. Answer using only what is written here; if something isn't covered, say so
plainly rather than guessing, and suggest the person check the in-app Help & guides page or ask
whoever administers their account.

---

# Part A — Team Leader & Crew Guide

## 1. Who uses this app, and what for

- **Team leader** and **team member** logins belong to a real-world field crew (a "Team", e.g.
  "Nabil-Team"). They only ever see their own team's towers, missions, and history — never
  another team's.
- **Admin** / **reviewer** logins see everything across all teams and towers (Field Tracker,
  all Teams, catalog management).
- The whole point of the app: replace a paper/Excel-based insulator inspection workflow with a
  live, GPS-tracked, photo-evidenced digital one. Every tower has up to 12 fixed "positions"
  (2 overhead-line circuits × 3 phases × 2 strings) that get screened and photographed.

## 2. Core vocabulary — read this before anything else

Getting these words right matters, because several of them sound similar but mean different
things:

- **Tower** — a physical structure in the catalog, identified by a Tower ID (e.g.
  `Ashoor-Saada-44`), with GPS coordinates and an `assigned_team_id` (which team currently owns
  it, or none/"Free").
- **Visit** (also called a **Mission** in the UI, numbered "Mission 1, 2, 3…" per team) — one
  inspection record for one tower. This is where the actual work happens: the 12-position
  checklist, screening results, evidence photos, weather/camera details. A tower can have
  multiple visits over time (repeat inspections are normal, not duplicates).
  `Visit.mission_status` is its own lifecycle: `planned` → `in_progress` → `completed`. This is
  separate from `visit_status` (see rollup below), which is about evidence/screening completeness.
- **Position** — one of the 12 fixed (OHL, Phase, String) slots on a visit, each with a Direction,
  a screening result, and up to 4 evidence images. A position only needs to be added when there's
  real data for it — the UI doesn't force pre-creating all 12 up front.
- **Mission plan** (a.k.a. **Outing plan**, `TeamOutingPlan` in the backend) — the team's named
  plan/checklist for one field night: which towers to visit and in what order. Saving it does
  **not** create any Visit — it's purely a plan. Picking a currently-unassigned tower into the
  plan auto-assigns it to the team as a side effect (one step instead of "claim, then plan").
- **Mission history** — the list of every Mission plan ever saved for a team, one row per field
  night, browsable/sortable/editable/deletable. Deleting one only removes that night's named plan
  — it never touches the team's tower assignments or any Visit data.
- **Field night** — the app's operating day is 18:00–18:00 Oman time (Asia/Muscat), not midnight
  to midnight. A shift starting at 11 PM and running past midnight is still "one field night".
- **Claim** (`NightTowerClaim`) — who's physically heading to a tower *tonight*. Separate from a
  Visit: a claim is the live board (claimed → en_route → on_site → done/skipped); a Visit is the
  actual inspection record, created when someone taps Start.
- **Rollup** — computed live from a Visit's positions/images, never stored, so it can't go stale:
  - `visit_status` is one of exactly three values: **"Evidence incomplete"** (some required photo
    still missing), **"Inspection incomplete"** (not every installed position has been screened
    yet), or **"Ready for review"** (every installed position screened, every required photo in).
  - `completion_pct` = screened positions ÷ installed positions.
  - `hotspots` = positions flagged with a hotspot finding.
- **Hotspot** — a position flagged as needing attention/review before the crew leaves site.
- **Site map colors**: green pin = free (unassigned), click to assign to your team; red pin =
  assigned to a team (name shown on the pin), click to unassign. A tower another team already
  owns can't be taken this way — that team's leader or an admin must release it first.
- **Team channel / "Tonight" feed** — a shared message thread per team per field night, tagged to
  the nearest tower automatically when GPS is on. Message kinds: `note`, `dispatch` (admin/
  reviewer), `access` (can't reach a tower), `weather` (wind/weather hold), `skip` (auto-posted
  when a tower is skipped), `hotspot`, `help`, and two system-generated kinds: `assign` /
  `unassign`, posted automatically whenever a tower is assigned or released — so hand-outs are
  always traceable in the same log, not something anyone has to remember to write down.
- **Handover** — a live-computed pack (done / still open / hotspots / where to start next) built
  from the outing plan, visits, claims, channel, and GPS — used to hand off to the next crew or
  shift. "End outing" only stamps the plan as ended plus a note; it never deletes or freezes data.

## 3. The team leader's actual daily routine

This is the real, verified sequence — not a guess:

1. **Sign in.** GPS tracking starts automatically for team_leader/team_member/inspector roles —
   it's not optional for these roles, and can't be turned off from the UI.
2. **Allow location** if prompted (a green "Allow GPS tracking" button appears at the top; tap it,
   then tap Allow on the OS popup). After that, tracking runs by itself, posting a position roughly
   every 10 seconds while the app is open in the foreground.
3. **Plan tonight (recommended, not required)** — on the Dashboard, the **Mission plan** card:
   name it (optional), pick towers from the pool (search, or "Add all"), set the order, tap
   **Save mission plan**. This organizes the night and feeds the "Next towers tonight" ordering
   below, but doesn't start any inspection or gate the next step — a tower already assigned to
   the team can be opened and started directly, with or without a saved mission plan.
4. **Work the queue — the actual daily driver** — open **Our team** in the left nav (this links
   straight to the leader's own team page). The **"Next towers tonight"** card ranks assigned,
   still-open towers by GPS distance and the mission plan order:
   - **I'll take it** — claims the tower so another crew member doesn't duplicate it.
   - **Go** — opens Google Maps navigation to it.
   - **Start** — the single tap that both creates the Visit *and* opens the inspection form.
     If the tower already has an open visit (shown as **Open** instead), tap that to resume
     it rather than creating a duplicate.
   - Progress buttons as the visit proceeds: **On my way → On site → Done**, or **Skip** with a
     typed reason (posts to the Tonight feed automatically).
5. **Do the inspection** inside the visit: fill the header (inspector, weather, camera/thermal
   settings), then add each position with **Add position** — pick, in order: **Tower type**
   (Suspension / Tension / Gantry; Direction greys out automatically for Suspension, since it
   doesn't need one), **OHL**, **Phase**, **String** (shown as "S1 — Outer" / "S2 — Inner"), and
   **Direction** if applicable (a line/segment name: Ashoor, Saada, Shaoon, Ittin, or Thumrait) —
   then its screening result, upload evidence photos per position. Further down each added
   position, the "Insulator record (official report)" panel has more optional fields (Manufacturer,
   Insulator type, GS side, String count, Inner/Outer, Pollution condition, Thermal/Visual
   indications) — only needed for a position that's actually going into the customer's official
   report. Watch the completion % and the Evidence banner — it tells you live what's left before
   "Ready for review".
6. **Repeat** down the queue. Dashboard KPIs, Mission history, and the Job map update live as
   towers are finished.
7. **End of outing**: open **Handover** on Our team, review what's open, tap **End outing** to
   close tonight's plan with a note for the next crew. The next crew can use **Continue last
   night** to pick up exactly where this one left off.

## 4. Screens and what's on them

- **Dashboard** (`/`) — Overview KPIs (towers, visits recorded, open hotspots, images pending),
  **Mission history**, **Mission plan**, **Site map**, and **Towers needing attention**.
- **Our team** (`/teams/{id}`, the leader's own team) — everything from the Dashboard plus:
  **Next towers tonight** (the daily-driver queue), the **Missions** table (every Visit for the
  team, with inline status/assignment editing and delete), **Job map**, **Handover**, the
  **Tonight** channel, and the **Daily progress log** (notes/photos/voice per field date).
- **Towers** (`/towers`) — the tower catalog; click a tower to open its detail page.
- **Tower detail** (`/towers/:id`) — tower info, its inspection visits, and **New inspection
  visit** to start one manually (an alternative to the Next-towers queue's Start button — both
  end up in the same place).
- **Visit detail** (`/visits/:id`) — the actual inspection form: header, positions, photos,
  evidence tracking, **Delete visit**, **Download tower report (PDF)**.
- **Reports** — per-tower PDF, official report (date range, either the whole team's campaign or
  one particular tower), and the Dashboard's Overall report (optionally filtered by area).
- **Help & guides** (`/help`) — the step-by-step guide this assistant lives on, reachable from
  the "Help me" button in the top bar on every screen.

Admin-only screens a team leader does not see: Field Tracker (all-teams live map), Teams list
(admin manages every team's roster/assignment from there), Image Archive, Team Progress.

## 5. Towers needing attention vs. Mission plan's status tags — a common point of confusion

These look similar but answer different questions:

- **Mission plan's tower pool** shows every tower assigned to the team, tagged with its real,
  live inspection status — Inspected (green) / In progress (amber) / **Not inspected yet** (red).
  This is not a setting and there is nothing to dismiss or remove by hand: it's read directly from
  whether a Visit exists for that tower yet, and it updates itself the moment someone taps Start
  (→ In progress) and finishes the inspection (→ Inspected). The list deliberately includes every
  assigned tower regardless of whether it's checked for tonight's mission — being checked for
  tonight and its inspection status are two independent things, so a tower can be picked for
  tonight and still correctly show "Not inspected yet" until the work actually happens.
- **Towers needing attention** (further down the Dashboard) only shows towers with an actually
  **open** mission right now (`mission_status` = planned or in_progress). A tower with no visit
  at all, or one that's Completed, automatically drops off this list — no manual removal needed.

## 6. GPS tracking — what it can and can't do

- The website refreshes the tracked position every 10 seconds and keeps the phone's screen from
  auto-locking while tracking is on.
- It **cannot** survive a phone call taking over the screen, the browser being switched away
  from, or the screen being manually locked — that's an OS-level suspension no website can
  override. When the phone is looked at again, tracking resumes itself automatically (no need to
  reopen the app).
- Common real-world cause of dropped tracking: aggressive Android battery managers (Xiaomi/MIUI,
  Huawei, some Samsung modes) killing background browser tabs. Fix: Settings → Battery → the
  browser app → no restrictions / unrestricted.
- For a crew that genuinely needs tracking to survive a locked screen or a call every time, there
  is a separate Android app (direct-install `.apk`, built via GitHub Actions) that runs tracking
  as a real Android foreground service instead of a website tab — ask an admin about it.
- A crew member is shown "stale" (grey, "Last seen …") after 2 minutes with no new position.
- The Field Tracker's live map (admin-only) bounds a still-open, multi-day tracking session to
  the selected field night by default, so an old un-closed session doesn't dump days of
  accumulated path onto today's board — the full history is still reachable via Previous
  missions or by picking that field night directly.

## 7. Troubleshooting quick answers

- **"Not inspected yet" still shows for a tower** — expected, see section 5; it means no visit
  has been started for that tower yet.
- **Tracking keeps dropping** — see section 6: check battery settings first; the Android app is
  the only way to guarantee it survives a locked screen or a call.
- **Started a visit on the wrong tower / by mistake** — open that tower's page (or the visit
  itself) and use **Delete visit**. This removes the visit and its positions/photos only — it
  never touches the tower's team assignment.
- **A tower is stuck assigned to another team** — that team's leader (or an admin) has to release
  it from their own Site map (click the red pin) before it can be picked up.
- **Can't reach a tower tonight** — post an **Access** message in the Tonight feed, or use
  **Skip** with a reason from the Next-towers queue; both are visible to dispatch/admin.
- **A duplicate or mistaken Mission plan** — open Mission history, tap the trash icon on that
  date's row. Towers stay assigned to the team; only the named plan for that night is removed.

## 8. Answering style for this assistant

- Be concise and step-by-step when the question is "how do I…".
- When multiple screens are involved, name the exact screen/button (e.g. "Our team → Next towers
  tonight → Start"), matching the wording actually in the app.
- If asked whether something is "done well" (e.g. is an inspection ready, is a tower properly
  planned), reason from the rollup logic in section 2: Ready for review requires zero images
  pending and every installed position screened — anything less is either "Evidence incomplete"
  or "Inspection incomplete".
- Never invent a screen, button, or field that isn't described here.

---

# Part B — Administrator Guide

For an **admin** (or **reviewer** — near-identical access, meant as a second set of eyes) setting
up the whole operation and running it day to day. Admin/reviewer logins see every team and every
tower; a team leader/member sees only their own.

## B1. Recommended setup order — start here

This is the order the app's own screens are designed around (e.g. the "Add a new team" dialog
picks a team leader from a dropdown of *already-created* leader logins, and auto-fills their name/
phone from that login):

1. **Build the tower catalog first** (Towers page) — either add towers one at a time, or bulk
   import a spreadsheet via **Import from Excel**. Set up Areas if the line spans more than one.
2. **Create each team leader's login** (Teams page → Team leaders section → **Add team leader**)
   — name, mobile, address, username, password (6+ characters). This creates their account before
   any team exists to link it to.
3. **Create the team and link that leader** (Teams page → **Add team**) — name the team, pick the
   team leader login from the dropdown (auto-fills their name/phone), optionally set a Mission
   description, primary line sector, and a daily target (towers/day).
4. **Assign towers to that team** — any of: select tower rows on the Towers page and use **Assign
   to team**; click a green (free) pin on any Site map and it assigns to that team; or let a team
   leader's own Mission plan auto-assign a picked tower on save.
5. **Hand off to the team leader.** From here it's their workflow (see Part A): they sign in, add
   their own crew members, plan nightly missions, and run inspections. An admin never has to do
   this step-by-step work personally — but can, from any team's own page, if needed.
6. **Monitor as it runs** — Field Tracker (live map, all teams), Team Progress (per-night stats),
   or open any team's own page directly to see/adjust their Missions, Job map, or Handover.
7. **Pull the official report — the full path, start to finish.** A tower only shows up in it once
   all of this has happened, in order: the tower is assigned to a team; the team leader or a crew
   member — signed into *their own login*, not an admin creating it for them — opened that tower
   and started a visit (this is what links the visit to the team; the step that trips people up
   most); at least one position on that visit got a Direction set or a photo uploaded (an untouched
   position is correctly left out, not a bug); and the date range used when generating covers when
   the work was recorded. See B7 below ("How to build the final report") for the full walkthrough —
   that's the one to point an admin at when a report comes back empty.

## B2. Managing the tower catalog (Towers page)

- **Add tower** — Tower ID (any format, no fixed list required), Voltage, Tower type, Area/
  Region, Line sector (free-text project label, e.g. "Ittin - Thumrait"), Location name, Height
  (m), plus GPS coordinates and an optional reference photo.
- **Import from Excel** — bulk-create or update towers from a spreadsheet.
- **Download Excel** — export the current catalog (also doubles as an import template).
- **Move towers on map** — a GPS editor to drag-place tower pins visually instead of typing
  coordinates.
- **Match IDs to pin numbers** — rewrites Tower IDs so the trailing number matches each tower's
  map pin number within its area (e.g. `Ashoor-Saada-100` with pin 67 becomes `Ashoor-Saada-67`).
- **Manage areas** (pencil icon next to the Area filter) — add, rename, or delete areas.
- Filters: Area, Line sector, Assigned team (including an "Unassigned" filter to find free towers).
- Select rows (checkboxes) for bulk **Assign to team** or **Delete selected**; **Delete all**
  wipes the whole catalog — inspection visits on those towers are deleted with them, and this
  cannot be undone.
- Click a tower's own row to open its detail page (edit details, see its inspection visits,
  start one manually).

## B3. Team photo uploads (Image Archive page)

A separate "Team photo uploads" section on the Image Archive page, for general photos that
aren't tied to one specific tower inspection — site conditions, equipment, handovers. Only an
admin or reviewer can upload or delete here; a team leader/member can view their own team's
photos read-only.

- **Upload images**: pick a team (required), choose one or more image files, optionally add a
  caption (applied to the whole batch). Date and GPS location are read automatically from each
  photo's own EXIF data when present; if a photo has neither, it's simply filed under today's
  date with no location shown.
- Browse with the Team / Year / Month / Day filters — independent of the tower-based archive
  below it, since these photos have no tower.
- A photo with a location shows a **Location** chip that opens the exact spot in Google Maps.
- Deleting a photo removes both the file and its thumbnail from the server — this cannot be
  undone.

## B4. Creating teams and team leaders (Teams page)

- **Team leaders** table — every team-leader login, independent of whether it's linked to a team
  yet ("Unassigned" if not). **Add team leader**: full name, mobile, address, username, password.
  Editing an existing leader can reset their password (leave blank to keep it) but never shows
  the current one back. Deleting a leader who already has real missions recorded deactivates
  their account instead of removing it, so the historical record stays intact.
- **Teams** table — **Add a new team**: team name (required), the linked team-leader login (name/
  phone auto-fill from it), a free-text Mission description, an optional primary line sector, and
  a daily target (towers/day) used as the working-plan quota shown against actual progress.
  Team **Status**: active / paused / completed.
- A team leader's login only ever sees their own team's data — this is enforced server-side, not
  just hidden in the UI, so it can't be worked around from the leader's own account.

## B5. Team members

- Either the team leader (from their own **Our team** page) or an admin (visiting that same team's
  page) can add a team member login: full name, mobile, job type (Drone Operator, Photographer,
  Recorder / Data Logger, Data Entry, Analyst, or a custom one), username, password.
- A team_member login's whole app is scoped to the missions assigned to them — no dashboard,
  towers catalog, archive, or reports; they see and act on their own work only.

## B6. Monitoring everything

- **Field Tracker** (admin/reviewer only) — the live, all-teams map: every crew's GPS position,
  breadcrumb trails, and the towers on the map. **New mission** closes the current tracking
  session and starts a clean one (useful to separate one outing's path from the next on the map;
  no GPS data is ever deleted — old sessions stay in **Previous missions**). Ops filters (Access /
  Hold / Skip / Hotspot / Help) surface trouble across every team at once. The same Tonight/crew
  channel messages team leaders see are visible here too, across all teams.
- **Team Progress** (admin/reviewer only) — a mission recap per team: start/end, distance, total
  time, minutes at each tower, travel between towers, and a comparison against the previous field
  night to see day-to-day improvement or slippage.
- **Any team's own page** (Teams → click a team) — the exact same Missions table, Job map,
  Handover pack, and Daily progress log a team leader sees for their own team. An admin can act on
  any of it directly (reassign a visit, change a mission's status, delete a mistaken visit) without
  needing the team leader to do it.

## B7. Reports

The Reports page is numbered, Section 1 through 6, each with a "use this when" line at the top —
point a confused admin at the section number rather than re-explaining the whole page.

### How to build the final report (the sequence that actually matters)

When an admin says a report is empty, missing, or "not working", walk them through this in order —
almost every case is steps 1–2:

1. **Tower exists and is assigned to a team** (Towers page — check "Assigned team" isn't blank).
2. **The visit was started from the team's own login, not created by the admin.** The team leader
   or a crew member has to open the tower and tap **Start visit** themselves — that's the action
   that links the visit to their team behind the scenes. A visit an admin adds or edits directly
   (for testing, importing, or fixing something) can end up with no team attached, which makes it
   invisible to every report scope (by tower, by team, or by area) even though the data exists.
3. **At least one position on that visit has a Direction set or a photo uploaded** — the report only
   turns a position into a "finding" once it has real recorded activity; an untouched slot is
   correctly skipped, not a bug.
4. **Save** — this happens automatically as the crew works; nothing extra needed. GPS tracking is
   also automatic in the background whenever their app is open with location on.
5. **Generate it**: Reports → Section 1 → Official report for the customer → pick By tower / By
   team / By line / Overall → set a date range. The moment both dates are in, a live preview
   appears ("This will include: N towers, N teams, N insulator findings, N hotspots") — check that
   before filling in the report number and sign-off fields, since it already tells you whether
   there's real data behind this scope/date range. Then fill those in and Generate.

If a report still comes back "No visits found" after all of that, it's almost always the date range
not covering the actual work dates, or step 2 (the visit's team link) — check those two first.

- **Section 1 — Official report for the customer** (admin/reviewer) — the customer's own template,
  filled in with real data, page design never touched. Four kinds, smallest to largest: **By tower**
  (pick one specific tower — its team is worked out automatically, no need to know which team owns
  it), **By team** (that team's whole campaign so far), **By line** (a whole transmission line, e.g.
  Ashoor-Saada — every team currently working any part of it, combined into one file — this is the
  Tower.area field; in this app a "line" and an "area" are the same thing), or **Overall (final
  report)** — every line, every team, every tower together. This last one is almost always the
  report to hand the customer as the final project report. A team leader reaches the "By team"
  version for just their own team via **Generate official report** on their own team page. Below
  the form, a **Report history** panel lists every report generated so far (report number, scope,
  date range, when) with a one-click re-download — check there before generating again if unsure
  whether something's already been sent, and note that redownloading never re-inserts a row or
  re-triggers the report-number-uniqueness check, so it can be clicked as many times as needed.
  A live preview also appears the moment a scope and both dates are picked — "This will include:
  N towers, N teams, N insulator findings, N hotspots" (or a clear "no visits found" warning) —
  before the report number or sign-off fields are even filled in, using the exact same
  "counts as a finding" rule the real report does, so the numbers never drift from what generating
  actually produces.
- **Section 2 — Team activity report** — not the customer template; an internal view of what each
  team has actually done, grouped team → day → tower → position, plus a filterable Excel download.
  This is the answer to "what did team X do so far".
- **Section 3 — Overall summary** — a quick internal PDF snapshot across all towers, optionally
  filtered by area, for the admin's own status check, not for the customer.
- **Section 4 — Field execution plan** (admin/reviewer) — the mobilization planning document, not an
  inspection report.
- **Section 5 — Custom report templates** (advanced) — upload a branded Word/PDF template; not
  needed for Section 1's official report, which already has its own fixed template.
- **Section 6 — Per-tower reports** — a one-off PDF/Word download for a single tower's latest visit
  only, separate from Section 1's official report.
- **Per-visit PDF** — from any individual inspection visit.

## B8. Accounts & security

- Every login can change their own password (avatar menu, top right → Change password).
- Deleting a login that already has real recorded work deactivates it instead of deleting it, so
  historical data (visits, GPS history, channel messages) is never silently orphaned.
- **Reviewer** is a second admin-equivalent role for most day-to-day screens — intended as a
  second set of eyes (e.g. QA), not a lesser role.

## B9. Optional add-ons an admin may want to set up

- **Help chat assistant** (this very chat) needs an Anthropic API key in the server's
  configuration to actually answer questions — without one it replies with a clear "not set up
  yet" message instead of failing.
- **Android app** for crews that need GPS tracking to survive a locked screen or a phone call —
  a real Android foreground service instead of a website tab. Built automatically via GitHub
  Actions as a direct-install `.apk` (no Play Store account needed); ask whoever manages the
  repository for the current download link.

## B10. Answering style for admin questions

- Lead with the recommended order (B1) when the question is about getting started or "what do I
  do first".
- Name the exact page and button, matching the wording actually in the app (e.g. "Teams page →
  Add team leader", not "the user management screen").
- Never invent a screen, button, or field that isn't described here.

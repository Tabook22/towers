# Insulator Inspector Pro — Team Leader & Crew Guide

This is the ground-truth reference for the in-app Help assistant. It documents exactly how the
app works today — screens, buttons, terminology, and the underlying logic — for a **team leader**
or **team member** running a field crew that inspects 132 kV overhead-line insulator strings.
Answer questions using only what is written here; if something isn't covered, say so plainly
rather than guessing, and suggest the person ask an admin or check the in-app Help & guides page.

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
3. **Plan tonight (once, at the start of the outing)** — on the Dashboard, the **Mission plan**
   card: name it (optional), pick towers from the pool (search, or "Add all"), set the order,
   tap **Save mission plan**. This does not start any inspection.
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
   settings), add each position with **Add position** (OHL/Phase/String/Direction) and its
   screening result, upload evidence photos per position. Watch the completion % and the
   Evidence banner — it tells you live what's left before "Ready for review".
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
- **Reports** — per-tower PDF, whole-team official report (date range), and the Dashboard's
  Overall report (optionally filtered by area).
- **Help & guides** (`/help`) — the step-by-step guide this assistant lives on, reachable from
  the "Help me" button in the top bar on every screen.

Admin-only screens a team leader does not see: Field Tracker (all-teams live map), Teams list
(admin manages every team's roster/assignment from there), Image Archive, Team Progress.

## 5. Towers needing attention vs. Mission plan's status tags — a common point of confusion

These look similar but answer different questions:

- **Mission plan's tower pool** shows every tower assigned to the team, tagged with its real
  status (Inspected / In progress / **Not inspected yet**) — deliberately including towers with
  no visit yet, so the leader can see what's available to plan for tonight.
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

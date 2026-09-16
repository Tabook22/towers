import { useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineRounded';
import { HelpChatWidget } from '../components/HelpChatWidget';
import { useAuth } from '../auth/AuthContext';

function StepNumber({ n }: { n: number }) {
  return (
    <Chip
      label={n}
      size="small"
      sx={{
        fontWeight: 800,
        bgcolor: 'primary.main',
        color: '#fff',
        minWidth: 28,
        flexShrink: 0,
      }}
    />
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
      <StepNumber n={n} />
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
          {children}
        </Typography>
      </Box>
    </Stack>
  );
}

function Section({
  title,
  subtitle,
  defaultExpanded,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  return (
    <Accordion defaultExpanded={defaultExpanded} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>{children}</AccordionDetails>
    </Accordion>
  );
}

export function HelpPage() {
  const { user } = useAuth();
  const isAdminRole = user?.role === 'admin' || user?.role === 'reviewer';
  const [tab, setTab] = useState(isAdminRole ? 0 : 1);

  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <HelpOutlineIcon color="primary" sx={{ fontSize: 32 }} />
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Help &amp; guides
          </Typography>
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Step-by-step guides for setting up and running the whole operation — for admins, team
          leaders, and crew alike.
        </Typography>
      </Box>

      <HelpChatWidget />

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="For Admins" />
        <Tab label="For Team Leaders & Crew" />
      </Tabs>

      {tab === 0 && <AdminGuide />}

      {tab === 1 && (
      <>
      <Section
        title="1. Signing in and GPS tracking"
        subtitle="What happens the moment you log in"
        defaultExpanded
      >
        <Step n={1} title="Sign in with your username and password.">
          Team leader and team member logins only ever see their own team&apos;s towers and
          missions — nothing from other crews.
        </Step>
        <Step n={2} title="Allow location when asked.">
          A green button labelled <strong>Allow GPS tracking</strong> appears at the top if the
          phone hasn&apos;t granted location yet. Tap it, then tap <strong>Allow</strong> on the
          popup that appears at the top of the screen. Tracking then runs by itself every 10
          seconds — dispatch can see your live position and the path is saved to this outing&apos;s
          record automatically.
        </Step>
        <Step n={3} title="Keep the tab open and the screen on while tracking matters.">
          A website can keep the screen from auto-locking while it&apos;s open, and it resumes on
          its own the moment you look at the phone again — but it genuinely cannot keep sending
          GPS through a phone call, the app being switched away from, or the screen being
          manually locked. If your phone keeps dropping tracking, check{' '}
          <strong>Settings → Battery → [your browser] → no restrictions</strong> — some phones
          (Xiaomi/MIUI, Huawei, some Samsung modes especially) kill background browser tabs
          aggressively by default.
        </Step>
        <Alert severity="info" sx={{ mt: 1 }}>
          The green chip at the top of the screen (next to your name) shows your tracking status
          at a glance: <strong>Live · Xs</strong> means it&apos;s working right now.
        </Alert>
      </Section>

      <Section
        title="2. Planning tonight's mission"
        subtitle="Do this once, before heading out"
      >
        <Step n={1} title="Open Dashboard (or Our team) and find the Mission plan card.">
          It lists every tower already assigned to your team.
        </Step>
        <Step n={2} title="Pick the towers for tonight.">
          Use the search box to add specific towers, or tap <strong>Add all</strong> to include
          everything your team has. Untick anything you don&apos;t plan to reach tonight.
        </Step>
        <Step n={3} title="Set the order (optional) and give it a name.">
          Drag order isn&apos;t required — the crew is guided by the smarter "Next towers
          tonight" queue anyway (see section 3), this order is just a reference route.
        </Step>
        <Step n={4} title='Tap "Save mission plan".'>
          This does <strong>not</strong> start any inspection yet — it&apos;s only the plan/
          checklist for tonight. The crew sees it on the map and in Next towers.
        </Step>
        <Alert severity="info" sx={{ mt: 1 }}>
          Picking a tower that isn&apos;t assigned to any team yet assigns it to yours
          automatically when you save — no separate "claim" step needed.
        </Alert>
      </Section>

      <Section
        title="3. Working the queue — your actual daily routine"
        subtitle='Open "Our team" in the left nav for this — it is the main screen you use all outing'
      >
        <Step n={1} title='Find the "Next towers tonight" card on Our team.'>
          It already ranks your assigned, still-open towers by GPS distance and your mission plan
          order — you don&apos;t have to figure out what to do next, just work down the list.
        </Step>
        <Step n={2} title={'Tap "I\'ll take it" on the tower you\'re heading to.'}>
          This claims it so another car on your team doesn&apos;t drive to the same place.
        </Step>
        <Step n={3} title='Tap "Go" for driving directions.'>
          Opens Google Maps navigation straight from wherever you are to that tower.
        </Step>
        <Step n={4} title='Once there, tap "Start".'>
          This single tap creates the inspection visit <em>and</em> opens the inspection form —
          there is no separate "add to mission" step. If the tower already has an open visit from
          a previous night, the button says <strong>Open</strong> instead — use that to resume it
          rather than starting a duplicate.
        </Step>
        <Step n={5} title="Fill in the inspection (see section 4), then update your status.">
          Back on the queue: <strong>On my way → On site → Done</strong> as you progress, or{' '}
          <strong>Skip</strong> with a reason if you genuinely can&apos;t get to it — that reason
          posts to the team&apos;s Tonight feed automatically so dispatch sees it.
        </Step>
        <Step n={6} title="Repeat down the list until it's empty.">
          The Dashboard&apos;s KPIs, Mission history, and the Job map all update live as you
          finish each one.
        </Step>
      </Section>

      <Section title="4. Doing the inspection itself" subtitle="What's inside the visit form">
        <Step n={1} title="Fill in the visit header.">
          Inspector name, weather, camera/thermal settings — whatever your site requires.
        </Step>
        <Step n={2} title='Add each insulator string with "Add position".'>
          Pick OHL / Phase / String / Direction, then record the screening result for it. A
          position only needs to be added once you actually have data for it — you don&apos;t
          have to pre-create all 12 up front.
        </Step>
        <Step n={3} title="Upload evidence photos per position.">
          The <strong>Images pending</strong> count on your Dashboard tracks exactly this — it
          won&apos;t clear to zero until every required photo is in.
        </Step>
        <Step n={4} title="Watch the completion % and Evidence banner at the top of the visit.">
          It tells you live how much is left before this tower can be marked "Ready for review".
        </Step>
      </Section>

      <Section title="5. Mission history — reviewing or fixing a past plan">
        <Step n={1} title="Open the Mission history card (Dashboard or Our team).">
          Every mission your team has ever planned, one row per field night, newest first — sort
          by date, name, or tower count using the column headers.
        </Step>
        <Step n={2} title='Tap the pencil ("View / edit") on any row.'>
          The Mission plan card below switches to that date so you can review or change it — an
          info banner reminds you which night you&apos;re looking at, with a{' '}
          <strong>Back to tonight</strong> button to return.
        </Step>
        <Step n={3} title='Tap "Add mission" to plan a future date.'>
          Pick any date — if a mission already exists for it, it opens for editing instead of
          creating a duplicate.
        </Step>
        <Step n={4} title="Delete a mistaken or duplicate mission with the trash icon.">
          This only removes that night&apos;s named plan — any towers already assigned to your
          team stay assigned, and nothing about their inspection history is touched.
        </Step>
      </Section>

      <Section title="6. The Tonight feed (team channel)">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          A shared message thread for your whole crew and dispatch, tagged to the nearest tower
          automatically when GPS is on. Use it instead of a separate WhatsApp group.
        </Typography>
        <Stack spacing={0.5} sx={{ pl: 1 }}>
          <Typography variant="body2">
            • <strong>Access</strong> — can&apos;t reach a tower (locked gate, blocked road, etc.)
          </Typography>
          <Typography variant="body2">
            • <strong>Hold</strong> — weather or wind stopping work
          </Typography>
          <Typography variant="body2">
            • <strong>Skip</strong> — posted automatically when you skip a tower in the queue
          </Typography>
          <Typography variant="body2">
            • <strong>Hotspot</strong> — flag something that needs review before you leave site
          </Typography>
          <Typography variant="body2">• <strong>Help</strong> — need assistance now</Typography>
          <Typography variant="body2">
            • Photos and voice notes can be attached to any message
          </Typography>
        </Stack>
      </Section>

      <Section title="7. Ending the outing and handover">
        <Step n={1} title="Open Handover on Our team.">
          It builds a live pack of what&apos;s done, what&apos;s still open, and any hotspots —
          so the next crew (even a different login) knows exactly where to pick up.
        </Step>
        <Step n={2} title={'Tap "End outing" when you\'re done for the night.'}>
          This just records that tonight is closed and stores a handover note — it does not
          delete or lock anything, and GPS/mission data stays exactly as recorded.
        </Step>
        <Step n={3} title="Next crew: use Continue last night.">
          Picks straight back up from the previous handover without re-planning from scratch.
        </Step>
      </Section>

      <Section title="8. Assigning and unassigning towers (Site map)">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          On the Site map (Dashboard or Our team), every pin is colored:
        </Typography>
        <Stack spacing={0.5} sx={{ pl: 1, mb: 1 }}>
          <Typography variant="body2">
            • <span style={{ color: '#2e7d32', fontWeight: 700 }}>Green</span> — free; click to
            assign it to your team
          </Typography>
          <Typography variant="body2">
            • <span style={{ color: '#d32f2f', fontWeight: 700 }}>Red</span> — assigned (team name
            on the pin); click to unassign so another team can take an unfinished tower
          </Typography>
        </Stack>
        <Alert severity="info">
          A tower another team already owns can&apos;t be taken this way — that team&apos;s
          leader or an admin has to release it first. Every assign/unassign is logged to the
          Tonight feed automatically, so it&apos;s always traceable who changed what and when.
        </Alert>
      </Section>

      <Section title="9. Reports">
        <Step n={1} title="Per-tower PDF.">
          Open any tower and use <strong>Download tower report (PDF)</strong> from its inspection
          visit page.
        </Step>
        <Step n={2} title="Official report — one tower or the whole team.">
          On Our team, use <strong>Generate official report</strong> for a formatted report across
          a date range — leave Tower on "All towers" for the whole team's campaign, or pick one
          tower for a single-tower report, both in the customer's own template.
        </Step>
        <Step n={3} title='Overall report (all towers/areas).'>
          The <strong>Overall report</strong> button on the Dashboard, optionally filtered by
          area.
        </Step>
      </Section>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
          Quick answers
        </Typography>
        <Stack spacing={2} divider={<Divider flexItem />}>
          <Box>
            <Typography sx={{ fontWeight: 700 }}>
              Why does a tower still say "Not inspected yet" in Mission plan?
            </Typography>
            <Typography variant="body2" color="text.secondary">
              That list intentionally shows every tower assigned to your team with its real
              status, so you can see what&apos;s left to plan for. It&apos;s different from{' '}
              <strong>Towers needing attention</strong> further down the Dashboard, which only
              shows towers with an actual open visit right now — a tower drops off that one
              automatically once it&apos;s finished, or stays off it until you actually start it.
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 700 }}>My tracking keeps stopping.</Typography>
            <Typography variant="body2" color="text.secondary">
              See section 1, step 3 — check your phone&apos;s battery settings for the browser.
              If your team needs tracking to survive a locked screen or a phone call every time,
              ask about the Android app, which runs tracking as a real background service instead
              of a website tab.
            </Typography>
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 700 }}>
              I started a visit on the wrong tower / by mistake.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Open that tower&apos;s page and use <strong>Delete visit</strong> from the visit
              itself — this removes the visit and its positions/photos, but never touches the
              tower's assignment to your team.
            </Typography>
          </Box>
        </Stack>
      </Paper>
      </>
      )}
    </Stack>
  );
}

function AdminGuide() {
  return (
    <>
      <Alert severity="info" sx={{ mb: -1 }}>
        Recommended reading order: start with section 1 below if you&apos;re setting this up for
        the first time — it&apos;s the exact order the app&apos;s own screens expect.
      </Alert>

      <Section
        title="1. Recommended setup order — start here"
        subtitle="What to do first, second, third…"
        defaultExpanded
      >
        <Step n={1} title="Build the tower catalog first (Towers page).">
          Add towers one at a time, or bulk-import a spreadsheet with <strong>Import from
          Excel</strong>. Set up Areas first if the line spans more than one (pencil icon next to
          the Area filter).
        </Step>
        <Step n={2} title="Create each team leader's login.">
          Teams page → Team leaders section → <strong>Add team leader</strong>: name, mobile,
          address, username, password (6+ characters). Do this before creating the team itself.
        </Step>
        <Step n={3} title="Create the team and link that leader.">
          Teams page → <strong>Add team</strong>: team name, then pick the team leader login from
          the dropdown — their name and phone fill in automatically. Optionally add a Mission
          description, a primary line sector, and a daily target (towers/day).
        </Step>
        <Step n={4} title="Assign towers to that team.">
          Any of: select tower rows on the Towers page and use <strong>Assign to team</strong>;
          click a green (free) pin on any Site map; or let the team leader's own Mission plan
          auto-assign a picked tower when they save it.
        </Step>
        <Step n={5} title="Hand off to the team leader.">
          From here it&apos;s their day-to-day workflow (see the "For Team Leaders & Crew" tab):
          sign in, add crew members, plan nightly missions, run inspections. You never have to do
          this step-by-step yourself — but you can, from any team&apos;s own page, any time.
        </Step>
        <Step n={6} title="Monitor as it runs.">
          Field Tracker (live map, all teams), Team Progress (per-night stats), or open any
          team&apos;s own page directly to see or adjust their Missions, Job map, or Handover.
        </Step>
        <Step n={7} title="Pull reports as needed.">
          Overall, per-team, per-visit, or from your own custom Word/PDF templates.
        </Step>
      </Section>

      <Section title="2. Managing the tower catalog" subtitle="Towers page">
        <Step n={1} title="Add tower.">
          Tower ID (any format — no fixed list required), Voltage, Tower type, Area/Region, Line
          sector (a free-text project label, e.g. "Ittin - Thumrait"), Location name, Height (m),
          plus GPS coordinates and an optional reference photo.
        </Step>
        <Step n={2} title="Import from Excel / Download Excel.">
          Bulk-create or update towers from a spreadsheet; Download Excel exports the current
          catalog and doubles as an import template.
        </Step>
        <Step n={3} title="Move towers on map.">
          A GPS editor to drag-place tower pins visually instead of typing coordinates.
        </Step>
        <Step n={4} title="Match IDs to pin numbers.">
          Rewrites Tower IDs so the trailing number matches each tower&apos;s map pin number
          within its area — e.g. <em>Ashoor-Saada-100</em> with pin 67 becomes{' '}
          <em>Ashoor-Saada-67</em>.
        </Step>
        <Step n={5} title="Bulk actions and filters.">
          Select rows for <strong>Assign to team</strong> or <strong>Delete selected</strong>;
          filter by Area, Line sector, or Assigned team (including an "Unassigned" filter to find
          free towers). <strong>Delete all</strong> wipes the whole catalog — inspection visits on
          those towers go with it, and this can&apos;t be undone.
        </Step>
      </Section>

      <Section title="3. Team photo uploads" subtitle="Image Archive page">
        <Typography variant="body2" color="text.secondary">
          A separate section on the Image Archive page for general photos not tied to one
          specific tower inspection — site conditions, equipment, handovers. Only an admin or
          reviewer can upload or delete here; a team leader/member sees their own team&apos;s
          photos read-only.
        </Typography>
        <Step n={1} title="Upload images.">
          Pick a team (required), choose one or more image files, optionally add a caption
          (applied to the whole batch). Date and GPS location are read automatically from each
          photo&apos;s own EXIF data when present — no location shown if the photo has neither.
        </Step>
        <Step n={2} title="Browse and manage.">
          Filter by Team / Year / Month / Day, independent of the tower-based archive below it. A
          photo with a location shows a clickable <strong>Location</strong> chip that opens it in
          Google Maps. Deleting a photo removes the file and its thumbnail — this can&apos;t be
          undone.
        </Step>
      </Section>

      <Section title="4. Creating teams and team leaders" subtitle="Teams page">
        <Step n={1} title="Team leaders table.">
          Every team-leader login, whether or not it&apos;s linked to a team yet (shown as
          "Unassigned" if not). Editing one can reset their password (leave it blank to keep the
          current one — it&apos;s never shown back to you).
        </Step>
        <Step n={2} title="Teams table.">
          Name, linked leader, Mission description, primary line sector, daily target, and Status
          (active / paused / completed).
        </Step>
        <Step n={3} title="Deleting a leader with real history.">
          If they already have missions recorded, deleting deactivates the account instead of
          removing it, so the historical record stays intact.
        </Step>
      </Section>

      <Section title="5. Team members">
        <Typography variant="body2" color="text.secondary">
          Either the team leader (from their own Our team page) or an admin (visiting that same
          team&apos;s page) can add a member: full name, mobile, job type (Drone Operator,
          Photographer, Recorder / Data Logger, Data Entry, Analyst, or a custom one), username,
          password. A team_member login's whole app is scoped to the missions assigned to them —
          no dashboard, towers catalog, archive, or reports.
        </Typography>
      </Section>

      <Section title="6. Monitoring everything">
        <Step n={1} title="Field Tracker.">
          The live, all-teams map: every crew's GPS position, breadcrumb trails, and towers.{' '}
          <strong>New mission</strong> starts a clean tracking session on the map (nothing is ever
          deleted — old sessions stay under Previous missions). Ops filters (Access / Hold / Skip
          / Hotspot / Help) surface trouble across every team at once, and the same crew channel
          messages team leaders see are visible here too.
        </Step>
        <Step n={2} title="Team Progress.">
          A mission recap per team — start/end, distance, total time, minutes at each tower,
          travel between towers — compared against the previous field night.
        </Step>
        <Step n={3} title="Any team's own page.">
          The exact same Missions table, Job map, Handover pack, and Daily progress log a team
          leader sees. You can act on any of it directly — reassign a visit, change its status,
          delete a mistaken one — without needing the team leader to do it.
        </Step>
      </Section>

      <Section title="7. Reports">
        <Step n={1} title="Overall report (Dashboard).">
          PDF across all towers, optionally filtered by area.
        </Step>
        <Step n={2} title="Generate official report (a team's own page).">
          A formatted report over a chosen date range — either that team's whole campaign, or a
          single particular tower, by picking it from the Tower dropdown in the dialog.
        </Step>
        <Step n={3} title="Custom Word/PDF templates (Reports page).">
          Upload your own branded <code>.docx</code> or a fillable PDF form once — it becomes the
          active template of that kind (Word and PDF are tracked separately, so both can be active
          at once), and every visit offers it as an extra download alongside the built-in fixed
          layout. Download the starter template from the same page as a working example.
        </Step>
      </Section>

      <Section title="8. Accounts & security">
        <Typography variant="body2" color="text.secondary">
          Every login can change their own password from the avatar menu, top right. Deleting a
          login that already has real recorded work deactivates it instead, so historical data
          (visits, GPS history, channel messages) is never silently orphaned. <strong>Reviewer</strong>{' '}
          is a second admin-equivalent role for most day-to-day screens — a second set of eyes,
          not a lesser account.
        </Typography>
      </Section>

      <Section title="9. Optional add-ons">
        <Step n={1} title="Help chat assistant.">
          This very chat needs an Anthropic API key in the server&apos;s configuration to answer
          questions — without one it replies with a clear "not set up yet" message instead of
          failing.
        </Step>
        <Step n={2} title="Android app.">
          For crews that need GPS tracking to survive a locked screen or a phone call — a real
          Android foreground service instead of a website tab. Built automatically as a
          direct-install <code>.apk</code> (no Play Store account needed); ask whoever manages the
          repository for the current download link.
        </Step>
      </Section>
    </>
  );
}

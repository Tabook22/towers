import type { ReactNode } from 'react';
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
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineRounded';
import { HelpChatWidget } from '../components/HelpChatWidget';

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
          Step-by-step guides for running a field team — mainly written for team leaders and
          crew, but useful for anyone finding their way around the app.
        </Typography>
      </Box>

      <HelpChatWidget />

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
        <Step n={2} title="Whole-team official report.">
          On Our team, use <strong>Generate official report</strong> for a formatted report across
          a date range.
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
    </Stack>
  );
}

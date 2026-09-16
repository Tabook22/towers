import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownwardRounded';
import CheckCircleIcon from '@mui/icons-material/CheckCircleRounded';
import HourglassBottomIcon from '@mui/icons-material/HourglassBottomRounded';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { useOutingPlan, useSaveOutingPlan } from '../api/hooks';
import type { TeamJobMapTower, Tower } from '../api/types';

// t.status is the tower's INSPECTION progress this team has made on it (has a Visit been started
// yet?) — nothing to do with whether it's assigned to the team or picked for tonight's mission.
// Green tick = inspected, red = not inspected yet, amber = started but not finished.
const VISIT_STATUS_CONFIG: Record<TeamJobMapTower['status'], { label: string; color: string; icon: React.ReactElement }> = {
  completed: { label: 'Inspected', color: '#2e7d32', icon: <CheckCircleIcon fontSize="small" /> },
  in_progress: { label: 'In progress', color: '#f57c00', icon: <HourglassBottomIcon fontSize="small" /> },
  pending: { label: 'Not inspected yet', color: '#d32f2f', icon: <RadioButtonUncheckedIcon fontSize="small" /> },
};

function VisitStatusTag({ status }: { status: TeamJobMapTower['status'] }) {
  const cfg = VISIT_STATUS_CONFIG[status];
  return (
    <Chip
      size="small"
      icon={cfg.icon}
      label={cfg.label}
      sx={{
        backgroundColor: `${cfg.color}1f`,
        color: cfg.color,
        border: `1px solid ${cfg.color}55`,
        fontWeight: 700,
        '& .MuiChip-icon': { color: cfg.color },
      }}
    />
  );
}

export function OutingPlanCard({
  teamId,
  fieldDate,
  assignedTowers,
  catalogTowers,
  canEdit,
}: {
  teamId: number;
  fieldDate?: string;
  assignedTowers: TeamJobMapTower[];
  // Every active tower (any team, or none). When given, the picker below also offers unassigned
  // towers, not just ones already assigned to this team — picking one assigns it as part of
  // saving the plan (see save_outing_plan), so a leader doesn't need a separate claim step first.
  catalogTowers?: Tower[];
  canEdit: boolean;
}) {
  const { data: plan, isLoading } = useOutingPlan(teamId, fieldDate);
  const save = useSaveOutingPlan(teamId);
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (plan) {
      setSelected(plan.tower_ids);
      setName(plan.name || '');
      setStartTime((plan.start_time || '').slice(0, 5));
      setEndTime((plan.end_time || '').slice(0, 5));
    }
  }, [plan]);

  const missionDate = plan?.field_date || fieldDate;
  const missionDateLabel = missionDate
    ? new Date(`${missionDate}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : undefined;

  // Addable pool: towers already assigned to this team, plus any unassigned tower from the wider
  // catalog (never one already claimed by another team — save_outing_plan enforces that too).
  const pool = useMemo(() => {
    const byIdMap = new Map<number, TeamJobMapTower>();
    for (const t of assignedTowers) byIdMap.set(t.id, t);
    for (const t of catalogTowers || []) {
      if (byIdMap.has(t.id) || t.assigned_team_id != null) continue;
      byIdMap.set(t.id, { id: t.id, tower_id: t.tower_id, area: t.area, latitude: t.latitude, longitude: t.longitude, status: 'pending', visit_id: null });
    }
    return Array.from(byIdMap.values());
  }, [assignedTowers, catalogTowers]);

  const assignedIds = useMemo(() => new Set(assignedTowers.map((t) => t.id)), [assignedTowers]);
  const byId = useMemo(() => new Map(pool.map((t) => [t.id, t])), [pool]);
  const ordered = selected.map((id) => byId.get(id)).filter((t): t is TeamJobMapTower => Boolean(t));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rest = pool.filter((t) => !selected.includes(t.id));
    const matched = !q
      ? rest
      : rest.filter((t) => t.tower_id.toLowerCase().includes(q) || (t.area || '').toLowerCase().includes(q));
    // Numeric sort so "Ashoor-Saada-2" sorts before "-10" instead of after it, the way a plain
    // string sort would ("-10" < "-2" alphabetically) — matches how a leader actually reads tower
    // numbers down a line.
    return matched
      .slice()
      .sort((a, b) => a.tower_id.localeCompare(b.tower_id, undefined, { numeric: true }));
  }, [pool, search, selected]);

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const move = (id: number, dir: -1 | 1) => {
    setSelected((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const dirty =
    name.trim() !== (plan?.name || '') ||
    startTime !== (plan?.start_time || '').slice(0, 5) ||
    endTime !== (plan?.end_time || '').slice(0, 5) ||
    JSON.stringify(selected) !== JSON.stringify(plan?.tower_ids || []);

  const title = name.trim() || plan?.name || "Tonight's mission";

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Mission plan
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {canEdit
                ? 'Name tonight’s mission, pick the towers to visit, and set the order. The crew sees this list on the map and in Next towers.'
                : title}
            </Typography>
          </Box>
          <Chip
            color={selected.length ? 'primary' : 'default'}
            label={
              selected.length
                ? `${title} · ${selected.length} tower${selected.length === 1 ? '' : 's'}`
                : 'No towers yet'
            }
          />
        </Stack>

        {pool.length === 0 && (
          <Alert severity="info">
            {catalogTowers
              ? 'No active towers exist yet — add towers on the Towers page first.'
              : 'No towers are assigned to this team yet. An admin must assign towers on the Towers page first; then the leader can plan tonight’s mission.'}
          </Alert>
        )}

        {pool.length > 0 && (
          <>
            {canEdit && (
              <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
                <TextField
                  label="Mission name"
                  placeholder="e.g. exam, Ashoor-Saada night 1"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={{ flex: 2, minWidth: 220 }}
                />
                <TextField
                  label="Date"
                  value={missionDateLabel || ''}
                  disabled
                  sx={{ minWidth: 160 }}
                />
                <TextField
                  label="Start time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ minWidth: 140 }}
                />
                <TextField
                  label="End time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={{ minWidth: 140 }}
                />
              </Stack>
            )}
            {!canEdit && (plan?.name || missionDateLabel || plan?.start_time || plan?.end_time) && (
              <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
                {plan?.name && (
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {plan.name}
                  </Typography>
                )}
                {missionDateLabel && (
                  <Typography variant="body2" color="text.secondary">
                    {missionDateLabel}
                  </Typography>
                )}
                {(plan?.start_time || plan?.end_time) && (
                  <Typography variant="body2" color="text.secondary">
                    {(plan?.start_time || '').slice(0, 5) || '—'} – {(plan?.end_time || '').slice(0, 5) || '—'}
                  </Typography>
                )}
              </Stack>
            )}

            {ordered.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                  Visit order
                </Typography>
                <Box sx={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 1 }}>
                  {ordered.map((t, i) => (
                    <Stack
                      key={t.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', px: 1, py: 0.5, borderBottom: '1px solid rgba(0,0,0,0.06)' }}
                    >
                      <Chip size="small" color="primary" label={i + 1} sx={{ minWidth: 36 }} />
                      <Typography sx={{ fontWeight: 700, minWidth: 140 }}>{t.tower_id}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                        {t.area || '—'}
                      </Typography>
                      <VisitStatusTag status={t.status} />
                      {canEdit && (
                        <>
                          <IconButton size="small" disabled={i === 0} onClick={() => move(t.id, -1)} aria-label="Move up">
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            disabled={i === ordered.length - 1}
                            onClick={() => move(t.id, 1)}
                            aria-label="Move down"
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                          <Button size="small" onClick={() => toggle(t.id)}>
                            Remove
                          </Button>
                        </>
                      )}
                    </Stack>
                  ))}
                </Box>
              </Box>
            )}

            <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                placeholder="Search tower ID or area to add"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ minWidth: 220, flex: 1 }}
              />
              {canEdit && (
                <>
                  <Button size="small" onClick={() => setSelected(assignedTowers.map((t) => t.id))}>
                    Add all
                  </Button>
                  <Button size="small" onClick={() => setSelected([])}>
                    Clear
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!dirty || save.isPending || isLoading}
                    onClick={() =>
                      save.mutate({
                        field_date: fieldDate,
                        tower_ids: selected,
                        name: name.trim() || undefined,
                        start_time: startTime || null,
                        end_time: endTime || null,
                      })
                    }
                  >
                    Save mission plan
                  </Button>
                </>
              )}
            </Stack>
            {canEdit && (
              <Box sx={{ maxHeight: 240, overflowY: 'auto', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 1 }}>
                {filtered.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                    {selected.length === pool.length ? 'All available towers are already on the plan.' : 'No matching towers.'}
                  </Typography>
                )}
                {filtered.map((t) => (
                  <Stack
                    key={t.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', px: 1, py: 0.5, cursor: 'pointer' }}
                    onClick={() => toggle(t.id)}
                  >
                    <Checkbox size="small" checked={false} />
                    <Typography sx={{ fontWeight: 700, minWidth: 140 }}>{t.tower_id}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                      {t.area || '—'}
                    </Typography>
                    {assignedIds.has(t.id) ? (
                      <VisitStatusTag status={t.status} />
                    ) : (
                      <Chip size="small" label="Unassigned — will assign to us" color="primary" variant="outlined" />
                    )}
                  </Stack>
                ))}
              </Box>
            )}
            {canEdit && dirty && (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
                Unsaved changes — tap Save mission plan.
              </Typography>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

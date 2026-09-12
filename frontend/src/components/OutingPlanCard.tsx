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
import { useOutingPlan, useSaveOutingPlan } from '../api/hooks';
import type { TeamJobMapTower } from '../api/types';

export function OutingPlanCard({
  teamId,
  fieldDate,
  assignedTowers,
  canEdit,
}: {
  teamId: number;
  fieldDate?: string;
  assignedTowers: TeamJobMapTower[];
  canEdit: boolean;
}) {
  const { data: plan, isLoading } = useOutingPlan(teamId, fieldDate);
  const save = useSaveOutingPlan(teamId);
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (plan) {
      setSelected(plan.tower_ids);
      setName(plan.name || '');
    }
  }, [plan]);

  const byId = useMemo(() => new Map(assignedTowers.map((t) => [t.id, t])), [assignedTowers]);
  const ordered = selected.map((id) => byId.get(id)).filter((t): t is TeamJobMapTower => Boolean(t));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rest = assignedTowers.filter((t) => !selected.includes(t.id));
    if (!q) return rest;
    return rest.filter(
      (t) => t.tower_id.toLowerCase().includes(q) || (t.area || '').toLowerCase().includes(q),
    );
  }, [assignedTowers, search, selected]);

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
    name.trim() !== (plan?.name || '') || JSON.stringify(selected) !== JSON.stringify(plan?.tower_ids || []);

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

        {assignedTowers.length === 0 && (
          <Alert severity="info">
            No towers are assigned to this team yet. An admin must assign towers on the Towers page
            first; then the leader can plan tonight’s mission.
          </Alert>
        )}

        {assignedTowers.length > 0 && (
          <>
            {canEdit && (
              <TextField
                label="Mission name"
                placeholder="e.g. exam, Ashoor-Saada night 1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth
                sx={{ mb: 1.5 }}
              />
            )}
            {!canEdit && plan?.name && (
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                {plan.name}
              </Typography>
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
                      <Chip size="small" label={t.status.replace('_', ' ')} variant="outlined" />
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
                      save.mutate({ field_date: fieldDate, tower_ids: selected, name: name.trim() || undefined })
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
                    {selected.length === assignedTowers.length
                      ? 'All assigned towers are already on the plan.'
                      : 'No matching towers.'}
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
                    <Chip size="small" label={t.status.replace('_', ' ')} variant="outlined" />
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

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
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
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (plan) setSelected(plan.tower_ids);
  }, [plan]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assignedTowers;
    return assignedTowers.filter(
      (t) => t.tower_id.toLowerCase().includes(q) || (t.area || '').toLowerCase().includes(q),
    );
  }, [assignedTowers, search]);

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const dirty =
    JSON.stringify([...selected].sort()) !== JSON.stringify([...(plan?.tower_ids || [])].sort());

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Tonight&apos;s visit
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {canEdit
                ? 'Pick the towers this team will inspect before leaving for site. They appear on the team map and in Next towers.'
                : 'Towers the team leader selected for this field night.'}
            </Typography>
          </Box>
          <Chip
            color={selected.length ? 'primary' : 'default'}
            label={`${selected.length} tower${selected.length === 1 ? '' : 's'} selected`}
          />
        </Stack>

        {assignedTowers.length === 0 && (
          <Alert severity="info">
            No towers are assigned to this team yet. An admin must assign towers on the Towers page
            first; then the leader can choose tonight&apos;s subset.
          </Alert>
        )}

        {assignedTowers.length > 0 && (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                placeholder="Search tower ID or area"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                sx={{ minWidth: 220, flex: 1 }}
              />
              {canEdit && (
                <>
                  <Button size="small" onClick={() => setSelected(filtered.map((t) => t.id))}>
                    Select listed
                  </Button>
                  <Button size="small" onClick={() => setSelected([])}>
                    Clear
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!dirty || save.isPending || isLoading}
                    onClick={() =>
                      save.mutate({ field_date: fieldDate, tower_ids: selected })
                    }
                  >
                    Save tonight&apos;s towers
                  </Button>
                </>
              )}
            </Stack>
            <Box sx={{ maxHeight: 280, overflowY: 'auto', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 1 }}>
              {filtered.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <Stack
                    key={t.id}
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: 'center',
                      px: 1,
                      py: 0.5,
                      bgcolor: on ? 'rgba(13,71,92,0.08)' : 'transparent',
                      cursor: canEdit ? 'pointer' : 'default',
                    }}
                    onClick={() => canEdit && toggle(t.id)}
                  >
                    <Checkbox size="small" checked={on} disabled={!canEdit} />
                    <Typography sx={{ fontWeight: 700, minWidth: 140 }}>{t.tower_id}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                      {t.area || '—'}
                    </Typography>
                    <Chip size="small" label={t.status.replace('_', ' ')} variant="outlined" />
                  </Stack>
                );
              })}
            </Box>
            {canEdit && dirty && (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
                Unsaved changes — tap Save tonight&apos;s towers.
              </Typography>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

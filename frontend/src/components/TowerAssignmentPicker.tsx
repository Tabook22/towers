import { useState, type Dispatch, type SetStateAction } from 'react';
import { Box, Checkbox, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import type { DashboardTowerRow, TowerWithStats } from '../api/types';
import { TowersOverviewMap } from './TowersOverviewMap';

interface Props {
  /** Every active tower (unfiltered) — the component does its own Area/Line-sector/search filtering. */
  towers: TowerWithStats[];
  areas: string[] | undefined;
  /** The team this picker is assigning towers TO — towers already on it show as selected/normal
   * rather than "on <team>"; omit when creating a brand-new team (nothing is "mine" yet). */
  currentTeamId?: number;
  selected: Set<number>;
  setSelected: Dispatch<SetStateAction<Set<number>>>;
  title?: string;
  description?: string;
}

/** The tick-box way to assign towers to a team — pick an area/line sector to narrow the list, then
 * check individual towers or "select all" the filtered group. A tower already on another team is
 * shown (not hidden) with a chip saying so, for a full picture of who has what — but it's locked,
 * not selectable: this picker only ever hands out towers that are actually free (unassigned, or
 * already this team's own), never takes one away from another team. Move a tower off another team
 * first (from that team's own page, or the Towers page) if you want to reassign it here.
 *
 * Purely a selection UI: it doesn't call the bulk-assign API itself, so it can be dropped into
 * either the create/edit Team dialog (TeamsPage.tsx, where the team may not exist yet — the caller
 * applies the selection after saving) or a team's own detail page (TeamDetailPage.tsx, where the
 * caller can apply it immediately). */
export function TowerAssignmentPicker({ towers, areas, currentTeamId, selected, setSelected, title, description }: Props) {
  const [towerArea, setTowerArea] = useState('');
  const [towerLineSector, setTowerLineSector] = useState('');
  const [towerSearch, setTowerSearch] = useState('');

  const lineSectorOptions = Array.from(new Set(towers.map((t) => t.line_sector).filter((s): s is string => !!s))).sort();
  const filteredTowers = towers.filter((t) => {
    if (towerArea && t.area !== towerArea) return false;
    if (towerLineSector && t.line_sector !== towerLineSector) return false;
    if (towerSearch && !t.tower_id.toLowerCase().includes(towerSearch.trim().toLowerCase())) return false;
    return true;
  });
  const isLocked = (t: TowerWithStats) => t.assigned_team_id != null && t.assigned_team_id !== currentTeamId;
  const eligibleFiltered = filteredTowers.filter((t) => !isLocked(t));
  const selectedTowers = towers.filter((t) => selected.has(t.id));
  const selectedTowerRows: DashboardTowerRow[] = selectedTowers.map((t) => ({
    tower: t,
    latest_visit: null,
    rollup: t.latest_visit_status
      ? {
          visit_status: t.latest_visit_status,
          hotspots: t.open_hotspots,
          possible_positions: 0,
          installed: 0,
          screened: 0,
          inconclusive: 0,
          images_pending: 0,
          completion_pct: 0,
        }
      : null,
  }));

  const titleText = title ?? 'Assign towers to this team';
  const descriptionText =
    description ??
    'Pick an area (and optionally a line sector) to see every one of its towers, then "select all" to grab the ' +
      'whole group in one click — or tick individual towers, in any order. Only unassigned towers (or ones already ' +
      "this team's own) can be picked here; a tower already on another team shows locked. This is what the team " +
      'is responsible for inspecting; it drives their Job Map and progress.';

  return (
    <Box>
      {titleText && (
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {titleText}
        </Typography>
      )}
      {descriptionText && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {descriptionText}
        </Typography>
      )}
      <Stack direction="row" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <TextField select size="small" label="Area" value={towerArea} onChange={(e) => setTowerArea(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All areas</MenuItem>
          {areas?.map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Line sector"
          value={towerLineSector}
          onChange={(e) => setTowerLineSector(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All line sectors</MenuItem>
          {lineSectorOptions.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search tower ID"
          value={towerSearch}
          onChange={(e) => setTowerSearch(e.target.value)}
          sx={{ minWidth: 140 }}
        />
      </Stack>
      <Paper variant="outlined" sx={{ maxHeight: 280, overflow: 'auto' }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            px: 1,
            py: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'grey.50',
            position: 'sticky',
            top: 0,
            cursor: 'pointer',
          }}
          onClick={() =>
            setSelected((prev) => {
              const allChecked = eligibleFiltered.length > 0 && eligibleFiltered.every((t) => prev.has(t.id));
              const next = new Set(prev);
              eligibleFiltered.forEach((t) => (allChecked ? next.delete(t.id) : next.add(t.id)));
              return next;
            })
          }
        >
          <Checkbox
            size="small"
            indeterminate={eligibleFiltered.some((t) => selected.has(t.id)) && !eligibleFiltered.every((t) => selected.has(t.id))}
            checked={eligibleFiltered.length > 0 && eligibleFiltered.every((t) => selected.has(t.id))}
            disabled={eligibleFiltered.length === 0}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setSelected((prev) => {
                const next = new Set(prev);
                eligibleFiltered.forEach((t) => (e.target.checked ? next.add(t.id) : next.delete(t.id)));
                return next;
              })
            }
          />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Select all {eligibleFiltered.length}
            {towerArea || towerLineSector || towerSearch ? ' filtered' : ''}
            {eligibleFiltered.length !== filteredTowers.length ? ` (${filteredTowers.length - eligibleFiltered.length} locked)` : ''}
          </Typography>
        </Stack>
        {filteredTowers.map((t) => {
          const locked = isLocked(t);
          return (
            <Stack
              key={t.id}
              direction="row"
              sx={{
                alignItems: 'center',
                px: 1,
                cursor: locked ? 'not-allowed' : 'pointer',
                opacity: locked ? 0.6 : 1,
                '&:hover': locked ? undefined : { bgcolor: 'action.hover' },
              }}
              onClick={() => {
                if (locked) return;
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
                  return next;
                });
              }}
            >
              <Checkbox
                size="small"
                checked={selected.has(t.id)}
                disabled={locked}
                onClick={(e) => e.stopPropagation()}
                onChange={() => {}}
              />
              <Typography variant="body2" sx={{ flex: 1 }}>
                {t.tower_id}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                {[t.area, t.line_sector].filter(Boolean).join(' · ') || '-'}
              </Typography>
              {locked ? (
                <Chip size="small" variant="outlined" label={`🔒 on ${t.assigned_team_name}`} />
              ) : t.assigned_team_id == null ? (
                <Chip size="small" variant="outlined" label="Unassigned" />
              ) : null}
            </Stack>
          );
        })}
        {filteredTowers.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1.5 }}>
            No towers match this filter.
          </Typography>
        )}
      </Paper>
      {selected.size > 0 && (
        <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 0.5 }}>
          {selected.size} tower{selected.size === 1 ? '' : 's'} selected.
        </Typography>
      )}

      {selected.size > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Where the {selected.size} selected tower{selected.size === 1 ? '' : 's'} actually are — click a pin for its details.
          </Typography>
          <TowersOverviewMap rows={selectedTowerRows} height={220} />
        </Box>
      )}
    </Box>
  );
}

import { tr, useLanguage, locale } from '../i18n';
import { localInspectionDate } from '../utils/teamTowerWork';
import { useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { useDeleteOutingPlan, useOutingPlans } from '../api/hooks';
import type { OutingPlanSummary } from '../api/types';
import { StepBadge } from './StepBadge';
import { DashboardSection } from './DashboardSection';

type SortKey = 'field_date' | 'name' | 'tower_count';

export function missionDateLabel(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString(locale(), {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function timeRange(p: OutingPlanSummary) {
  if (!p.start_time && !p.end_time) return '—';
  return `${(p.start_time || '').slice(0, 5) || '—'} – ${(p.end_time || '').slice(0, 5) || '—'}`;
}

/** A team leader's full mission history: every named plan ever saved for this team, one row per
 * field night — listable, sortable, and editable/deletable/addable here. Picking "Edit" (or
 * "Plan another mission") just points the Mission plan card below at a different `field_date`; the actual
 * create/update/save flow still lives there (save_outing_plan handles both new and existing
 * dates identically), so this component only needs to list, sort, delete, and hand off a date. */
export function MissionHistoryCard({
  teamId,
  canEdit,
  selectedDate,
  onSelectDate,
  step,
}: {
  teamId: number;
  canEdit: boolean;
  selectedDate?: string;
  onSelectDate: (fieldDate: string) => void;
  step?: number;
}) {
  useLanguage();
  const { data: plans, isLoading } = useOutingPlans(teamId);
  const del = useDeleteOutingPlan(teamId);
  const [sortKey, setSortKey] = useState<SortKey>('field_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState(() => localInspectionDate());
  const [deleteTarget, setDeleteTarget] = useState<OutingPlanSummary | null>(null);

  const existingDates = useMemo(() => new Set((plans || []).map((p) => p.field_date)), [plans]);

  const sorted = useMemo(() => {
    const rows = [...(plans || [])];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortKey === 'tower_count') cmp = a.tower_count - b.tower_count;
      else cmp = a.field_date.localeCompare(b.field_date);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [plans, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'field_date' ? 'desc' : 'asc');
    }
  };

  return (
    <>
    <DashboardSection defaultExpanded={false} tone="violet" icon={<HistoryRoundedIcon />}
      title={tr("Mission plan history")} eyebrow={tr("PREVIOUS MISSIONS")}
      description={tr("Find earlier mission plans and reopen their dates, towers and route order.")}
      badge={step != null ? <StepBadge n={step} /> : undefined}>

        {canEdit && (
          <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 1.5 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              onClick={() => {
                setAddDate(localInspectionDate());
                setAddOpen(true);
              }}
            >{tr("Plan another mission")}</Button>
          </Stack>
        )}
        {isLoading && <LinearProgress sx={{ mb: 1 }} />}
        <TableContainer sx={{ maxHeight: 320 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>
                  <TableSortLabel
                    active={sortKey === 'field_date'}
                    direction={sortKey === 'field_date' ? sortDir : 'desc'}
                    onClick={() => toggleSort('field_date')}
                  >{tr("Date")}</TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel active={sortKey === 'name'} direction={sortKey === 'name' ? sortDir : 'asc'} onClick={() => toggleSort('name')}>{tr("Mission plan")}</TableSortLabel>
                </TableCell>
                <TableCell>{tr("Time")}</TableCell>
                <TableCell align="center">
                  <TableSortLabel
                    active={sortKey === 'tower_count'}
                    direction={sortKey === 'tower_count' ? sortDir : 'asc'}
                    onClick={() => toggleSort('tower_count')}
                  >{tr("Towers")}</TableSortLabel>
                </TableCell>
                <TableCell align="right">{tr("Actions")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((p) => (
                <TableRow key={p.field_date} hover selected={p.field_date === selectedDate}>
                  <TableCell sx={{ fontWeight: p.field_date === selectedDate ? 700 : 400 }}>{missionDateLabel(p.field_date)}</TableCell>
                  <TableCell>
                    {p.name || (
                      <Typography variant="body2" color="text.secondary" component="span">{tr("Untitled")}</Typography>
                    )}
                  </TableCell>
                  <TableCell>{timeRange(p)}</TableCell>
                  <TableCell align="center">{p.tower_count}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={tr("View / edit")}>
                      <IconButton size="small" onClick={() => onSelectDate(p.field_date)}>
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canEdit && (
                      <Tooltip title={tr("Delete mission plan")}>
                        <IconButton size="small" color="error" onClick={() => setDeleteTarget(p)}>
                          <DeleteRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{tr("No mission plans yet.")}</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
    </DashboardSection>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr("Plan another mission")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            type="date"
            label={tr("Date")}
            value={addDate}
            onChange={(e) => setAddDate(e.target.value)}
            sx={{ mt: 1 }}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={
              existingDates.has(addDate) ? tr("A mission plan already exists on this date — it will open for editing.") : ' '
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>{tr("Cancel")}</Button>
          <Button
            variant="contained"
            disabled={!addDate}
            onClick={() => {
              onSelectDate(addDate);
              setAddOpen(false);
            }}
          >
            {existingDates.has(addDate) ? tr("Open") : tr("Create")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr("Delete mission plan?")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{tr("Delete the mission plan for ")}{deleteTarget ? missionDateLabel(deleteTarget.field_date) : ''}
            {deleteTarget?.name ? ` ("${deleteTarget.name}")` : ''}{tr("? Towers already assigned to this team stay assigned — only the named plan for that night is removed. This can't be undone.")}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{tr("Cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={del.isPending}
            onClick={() => {
              if (!deleteTarget) return;
              const deletedDate = deleteTarget.field_date;
              del.mutate(deletedDate, {
                onSuccess: () => {
                  setDeleteTarget(null);
                  if (selectedDate === deletedDate) onSelectDate('');
                },
              });
            }}
          >{tr("Delete")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

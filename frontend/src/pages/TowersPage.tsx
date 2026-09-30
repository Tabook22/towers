import { tr, useLanguage } from '../i18n';
import { useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/AddRounded';
import SearchIcon from '@mui/icons-material/SearchRounded';
import EditIcon from '@mui/icons-material/EditRounded';
import ArchiveIcon from '@mui/icons-material/InventoryRounded';
import UploadFileIcon from '@mui/icons-material/UploadFileRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import TableChartIcon from '@mui/icons-material/TableChartRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import EditLocationAltIcon from '@mui/icons-material/EditLocationAltRounded';
import CheckIcon from '@mui/icons-material/CheckRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import { useNavigate } from 'react-router-dom';
import {
  useAreas,
  useAreasFull,
  useBulkAssignTowers,
  useBulkDeleteTowers,
  useClearTowerPhoto,
  useCreateArea,
  useCreateTower,
  useDeactivateTower,
  useDeleteArea,
  useImportTowers,
  useMatchPinIds,
  useTeams,
  useTowers,
  useUpdateArea,
  useUpdateTower,
  useUploadTowerPhoto,
} from '../api/hooks';
import { mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getPermissionLevel, type DashboardTowerRow, type Tower, type TowerWithStats } from '../api/types';
import { VisitStatusChip } from '../components/Badges';
import { MapPicker } from '../components/MapPicker';
import { TowerActionsDialog } from '../components/TowerActionsDialog';
import { TowersOverviewMap } from '../components/TowersOverviewMap';
import { TowersGpsEditorDialog } from '../components/TowersGpsEditorDialog';
import { ExpandableImage } from '../components/ExpandableImage';
import { ResizableDialogPaper } from '../components/ResizableDialogPaper';
import { HorizontalBarChart, type BarDatum } from '../components/HorizontalBarChart';
import { colorForTeam } from '../components/towerMapPins';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

interface TowerFormState {
  tower_id: string;
  voltage: string;
  tower_type: string;
  area: string;
  line_sector: string;
  location_name: string;
  height_m: number | null;
  latitude: number | null;
  longitude: number | null;
  notes: string;
}

const emptyForm: TowerFormState = {
  tower_id: '',
  voltage: '132 kV',
  tower_type: '',
  area: '',
  line_sector: '',
  location_name: '',
  height_m: null,
  latitude: null,
  longitude: null,
  notes: '',
};

// Standard transmission/distribution voltage classes (IEC/Gulf-grid ladder plus the common North
// American series), curated from Electrical4U's transmission-voltage overview and Wikipedia's
// "Ultra high voltage transmission" — see the chat message that introduced this list for sources.
const VOLTAGE_OPTIONS = [
  '11 kV',
  '33 kV',
  '66 kV',
  '69 kV',
  '110 kV',
  '115 kV',
  '132 kV',
  '138 kV',
  '161 kV',
  '220 kV',
  '230 kV',
  '275 kV',
  '330 kV',
  '345 kV',
  '400 kV',
  '500 kV',
  '765 kV',
  '800 kV (UHV)',
  '1000 kV (UHV)',
];

// Functional classification of transmission towers — the category most relevant to insulator
// inspection, since it determines the insulator string configuration (suspension insulators hang
// vertically on tangent towers; strain/tension insulators pull horizontally on angle/dead-end
// towers). Curated from saVRee's and KP Green Engineering's transmission-tower breakdowns.
const TOWER_TYPE_OPTIONS = [
  'Suspension (Tangent) Tower',
  'Angle Tower — Small (2°–10°)',
  'Angle Tower — Medium (10°–30°)',
  'Angle Tower — Large (30°–60°)',
  'Tension / Strain Tower',
  'Dead-End (Terminal / Anchor) Tower',
  'Transposition Tower',
  'River Crossing Tower',
  'Railway Crossing Tower',
  'Road Crossing Tower',
];

export function TowersPage() {
  useLanguage();
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('');
  const [lineSector, setLineSector] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TowerWithStats | null>(null);
  const [form, setForm] = useState<TowerFormState>(emptyForm);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [towerActionId, setTowerActionId] = useState<number | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState('');

  const navigate = useNavigate();
  const { user } = useAuth();
  const theme = useTheme();
  // A restricted admin's "manage_towers" level: everything below (bulk assign/delete/import/move,
  // and editing an existing tower's details) requires "full" on the backend — only creating a new
  // tower is "add"-level (routers/towers.py's create_tower vs. its other endpoints).
  const towersLevel =
    user?.role === 'admin'
      ? user.is_super_admin
        ? 'full'
        : getPermissionLevel(user.permissions, 'manage_towers')
      : user?.role === 'reviewer'
        ? 'full'
        : 'view';
  const canImport = towersLevel === 'full';
  const canEditCatalog = towersLevel === 'full';
  const canAddTower = towersLevel === 'add' || towersLevel === 'full';
  const isTeamLeader = user?.role === 'team_leader';
  const debouncedSearch = useDebouncedValue(search);
  const { data: towers, isLoading } = useTowers({
    search: debouncedSearch || undefined,
    area: area || undefined,
    limit: 5000,
  });
  const actionTower = towers?.find(t => t.id === towerActionId);
  const { data: areas } = useAreas();
  const createTower = useCreateTower();
  const updateTower = useUpdateTower();
  const deactivateTower = useDeactivateTower();
  const uploadPhoto = useUploadTowerPhoto();
  const importTowers = useImportTowers();
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const clearPhoto = useClearTowerPhoto();
  const photoInputRef = useRef<HTMLInputElement>(null);

  // ---------- Area catalog management (add/rename/delete) — see backend routers/areas.py. ----------
  const [areasDialogOpen, setAreasDialogOpen] = useState(false);
  const { data: areasFull } = useAreasFull();
  const createArea = useCreateArea();
  const updateArea = useUpdateArea();
  const deleteArea = useDeleteArea();
  const [newAreaName, setNewAreaName] = useState('');
  const [areaError, setAreaError] = useState<string | null>(null);
  const [editingAreaId, setEditingAreaId] = useState<number | null>(null);
  const [editAreaName, setEditAreaName] = useState('');

  // Which team is responsible for each tower — the actual assignment, set via the bulk-assign
  // action below (checkboxes + "Assign to team"). Separate concept from line_sector, which is just
  // a descriptive label.
  const { data: teams } = useTeams();
  const bulkAssign = useBulkAssignTowers();
  const bulkDelete = useBulkDeleteTowers();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteAll, setDeleteAll] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [gpsEditorOpen, setGpsEditorOpen] = useState(false);
  const matchPinIds = useMatchPinIds();
  const [renumberMsg, setRenumberMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTeamId, setAssignTeamId] = useState('');
  const [teamFilter, setTeamFilter] = useState(''); // '' = all, 'unassigned', or a team id

  // "Line sector" groups towers by physical line/OHL (e.g. "Ashoor-Saada OHL") — a finer-grained
  // split than Area, useful for viewing/filtering one specific line's towers on the map below.
  const lineSectorOptions = Array.from(new Set((towers || []).map((t) => t.line_sector).filter((s): s is string => !!s))).sort();
  let visibleTowers = lineSector ? (towers || []).filter((t) => t.line_sector === lineSector) : towers;
  if (teamFilter === 'unassigned') visibleTowers = (visibleTowers || []).filter((t) => t.assigned_team_id == null);
  else if (teamFilter) visibleTowers = (visibleTowers || []).filter((t) => t.assigned_team_id === Number(teamFilter));
  const mapRows: DashboardTowerRow[] = (visibleTowers || []).map((t) => ({
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

  // These two overview charts read the current search/area result set (before the line-sector/team
  // quick filters below it), so they stay a stable "whole picture" summary rather than shrinking to
  // whatever the quick filters narrow the table down to.
  const towersByLine: BarDatum[] = Array.from(
    (towers || []).reduce((acc, t) => {
      const key = t.line_sector || 'No line sector';
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map<string, number>()),
  )
    .map(([label, value]) => ({ label, value, color: theme.palette.primary.main }))
    .sort((a, b) => b.value - a.value);

  const completedByTeam: BarDatum[] = (() => {
    const counts = new Map<number, { name: string; count: number }>();
    for (const t of (teams || []).filter((tm) => tm.is_active)) {
      counts.set(t.id, { name: t.name, count: 0 });
    }
    for (const t of towers || []) {
      if (t.assigned_team_id == null || t.latest_visit_mission_status !== 'completed') continue;
      const existing = counts.get(t.assigned_team_id);
      if (existing) existing.count += 1;
      else counts.set(t.assigned_team_id, { name: t.assigned_team_name || `Team ${t.assigned_team_id}`, count: 1 });
    }
    return Array.from(counts, ([id, { name, count }]) => ({ label: name, value: count, color: colorForTeam(id) })).sort(
      (a, b) => b.value - a.value,
    );
  })();

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setErrorMsg(null);
    setDialogOpen(true);
  };

  const openEdit = (t: TowerWithStats) => {
    setEditing(t);
    setForm({
      tower_id: t.tower_id,
      voltage: t.voltage || '',
      tower_type: t.tower_type || '',
      area: t.area || '',
      line_sector: t.line_sector || '',
      location_name: t.location_name || '',
      height_m: t.height_m,
      latitude: t.latitude,
      longitude: t.longitude,
      notes: t.notes || '',
    });
    setErrorMsg(null);
    setDialogOpen(true);
  };

  const handlePhotoFile = async (file: File | null) => {
    if (!file || !editing) return;
    const updated = await uploadPhoto.mutateAsync({ id: editing.id, file });
    setEditing((e) => (e ? { ...e, ...updated } : e));
  };

  const handleClearPhoto = async () => {
    if (!editing) return;
    const updated = await clearPhoto.mutateAsync(editing.id);
    setEditing((e) => (e ? { ...e, ...updated } : e));
  };

  const handleSave = async () => {
    setErrorMsg(null);
    const payload: Partial<Tower> = {
      tower_id: form.tower_id.trim(),
      voltage: form.voltage || null,
      tower_type: form.tower_type || null,
      area: form.area || null,
      line_sector: form.line_sector || null,
      location_name: form.location_name || null,
      height_m: form.height_m,
      latitude: form.latitude,
      longitude: form.longitude,
      notes: form.notes || null,
    };
    try {
      if (editing) {
        await updateTower.mutateAsync({ id: editing.id, payload });
      } else {
        await createTower.mutateAsync(payload);
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const message =
        typeof detail === 'string'
          ? detail
          : Array.isArray(detail)
            ? detail.map((d) => (typeof d === 'string' ? d : (d as { msg?: string })?.msg || '')).filter(Boolean).join(' ')
            : 'Could not save tower';
      setErrorMsg(message);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>{tr("Manage Towers")}</Typography>
          <Typography color="text.secondary">{tr("Add any number of towers with any Tower ID — no fixed list or format required.")}</Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          {canImport && (
            <>
              <Button
                variant="outlined"
                startIcon={<DownloadRoundedIcon />}
                component="a"
                href={mediaUrl('/api/towers/export.xlsx')}
              >{tr("Download Excel")}</Button>
              <Button
                variant="outlined"
                startIcon={<EditLocationAltIcon />}
                onClick={() => setGpsEditorOpen(true)}
                disabled={!towers?.length}
              >{tr("Move towers on map")}</Button>
              <Button
                variant="outlined"
                startIcon={<TableChartIcon />}
                onClick={() => {
                  setImportFile(null);
                  setImportError(null);
                  importTowers.reset();
                  setImportOpen(true);
                }}
              >{tr("Import from Excel")}</Button>
              <Button
                variant="outlined"
                disabled={!towers?.length || matchPinIds.isPending}
                onClick={() => {
                  const scope = area ? `towers in ${area}` : 'all towers';
                  if (
                    !window.confirm(
                      tr("Match Tower IDs to pin numbers for {0}?\n\nExample: Ashoor-Saada-100 with pin 67 becomes Ashoor-Saada-67.", [scope]),
                    )
                  ) {
                    return;
                  }
                  setRenumberMsg(null);
                  matchPinIds.mutate(area ? { area } : {}, {
                    onSuccess: (r) =>
                      setRenumberMsg(
                        `Updated ${r.updated} Tower ID${r.updated === 1 ? '' : 's'} to match pin numbers (${r.unchanged} already matched).`,
                      ),
                    onError: (err: unknown) => {
                      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                      setRenumberMsg(typeof detail === 'string' ? detail : 'Could not match IDs to pin numbers');
                    },
                  });
                }}
              >
                {matchPinIds.isPending ? tr("Matching IDs…") : tr("Match IDs to pin numbers")}
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => {
                  setDeleteAll(true);
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
                disabled={!towers?.length}
              >{tr("Delete all")}</Button>
            </>
          )}
          {canAddTower && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{tr("Add tower")}</Button>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={2}>
        <TextField
          size="small"
          placeholder={tr("Search by Tower ID or area…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 280 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <TextField
          select
          size="small"
          label={tr("Area")}
          value={area}
          onChange={(e) => setArea(e.target.value)}
          sx={{ minWidth: 180 }}
          slotProps={{
            select: {
              endAdornment: canImport && (
                <Tooltip title={tr("Add, rename, or delete areas")}>
                  <IconButton
                    size="small"
                    sx={{ mr: 2 }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAreasDialogOpen(true);
                    }}
                  >
                    <EditLocationAltIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ),
            },
          }}
        >
          <MenuItem value="">{tr("All areas")}</MenuItem>
          {areas?.map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={tr("Line sector")}
          value={lineSector}
          onChange={(e) => setLineSector(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{tr("All line sectors")}</MenuItem>
          {lineSectorOptions.map((s) => (
            <MenuItem key={s} value={s}>
              {tr(s)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={tr("Assigned team")}
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">{tr("All teams")}</MenuItem>
          <MenuItem value="unassigned">{tr("Unassigned")}</MenuItem>
          {teams?.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {renumberMsg && (
        <Alert
          severity={renumberMsg.startsWith('Updated') ? 'success' : 'error'}
          onClose={() => setRenumberMsg(null)}
        >
          {renumberMsg}
        </Alert>
      )}

      {selected.size > 0 && canImport && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1.5, bgcolor: 'primary.50', borderRadius: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {selected.size}{tr(" tower")}{selected.size === 1 ? '' : tr("s")}{tr(" selected")}</Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<GroupsIcon fontSize="small" />}
            onClick={() => {
              setAssignTeamId('');
              setAssignOpen(true);
            }}
          >{tr("Assign to team")}</Button>
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={() => {
              setDeleteAll(false);
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >{tr("Delete selected")}</Button>
          <Button size="small" onClick={() => setSelected(new Set())}>{tr("Clear selection")}</Button>
        </Stack>
      )}

      {actionTower && <TowerActionsDialog key={actionTower.id} tower={actionTower} canManage={canEditCatalog}
        ownTeamId={isTeamLeader ? user?.team_id : null} onClose={() => setTowerActionId(null)}
        onSuccess={setAssignmentMessage} onEdit={() => { setTowerActionId(null); openEdit(actionTower); }} />}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>{tr("Tower locations")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{tr("Click a tower pin or table row to view its details, open inspections, or choose an assignment action.")}</Typography>
          {(isTeamLeader || canEditCatalog) && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">{tr("Each team has its own pin color (see the legend on the map below) and a ✓ marks a tower whose inspection is complete. The number in the circle is the Tower ID number (Ashoor-Saada-2 → 2).")}</Typography>
            </Stack>
          )}
          {assignmentMessage && <Alert severity="success" sx={{ mb: 1 }} onClose={() => setAssignmentMessage('')}>{tr(assignmentMessage)}</Alert>}
          <TowersOverviewMap
            rows={mapRows}
            height={380}
            onTowerClick={(row) => setTowerActionId(row.tower.id)}
          />
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <InsightsRoundedIcon color="primary" fontSize="small" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{tr("Towers per line")}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr("How the current search/area result is split across each line sector.")}</Typography>
              <HorizontalBarChart data={towersByLine} emptyMessage="No towers to summarize yet." />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <CheckIcon color="success" fontSize="small" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{tr("Towers completed per team")}</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr("Assigned towers whose latest visit is fully completed, by team.")}</Typography>
              <HorizontalBarChart data={completedByTeam} emptyMessage="No completed towers yet." />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Accordion defaultExpanded disableGutters variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{tr("All towers (")}{(visibleTowers || []).length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0 }}>
      <TableContainer component={Paper} variant="outlined" sx={{ border: 0 }}>
        <Table>
          <TableHead>
            <TableRow>
              {canImport && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={selected.size > 0 && selected.size < (visibleTowers?.length || 0)}
                    checked={!!visibleTowers?.length && selected.size === visibleTowers.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(visibleTowers?.map((t) => t.id)) : new Set())}
                  />
                </TableCell>
              )}
              <TableCell>{tr("Tower ID")}</TableCell>
              <TableCell>{tr("Voltage")}</TableCell>
              <TableCell>{tr("Type")}</TableCell>
              <TableCell>{tr("Area")}</TableCell>
              <TableCell>{tr("Line sector")}</TableCell>
              <TableCell>{tr("Assigned team")}</TableCell>
              <TableCell align="center">{tr("Visits")}</TableCell>
              <TableCell align="center">{tr("Open hotspots")}</TableCell>
              <TableCell>{tr("Latest visit status")}</TableCell>
              <TableCell align="right">{tr("Actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleTowers?.map((t) => (
              <TableRow
                key={t.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => setTowerActionId(t.id)}
              >
                {canImport && (
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      size="small"
                      checked={selected.has(t.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        })
                      }
                    />
                  </TableCell>
                )}
                <TableCell sx={{ fontWeight: 700 }}>{t.tower_id}</TableCell>
                <TableCell>{t.voltage || '-'}</TableCell>
                <TableCell>{t.tower_type || '-'}</TableCell>
                <TableCell>{t.area || '-'}</TableCell>
                <TableCell>{t.line_sector || '-'}</TableCell>
                <TableCell>
                  {t.assigned_team_name ? (
                    <Chip size="small" color="primary" variant="outlined" label={t.assigned_team_name} />
                  ) : (
                    <Typography variant="caption" color="text.secondary">{tr("Unassigned")}</Typography>
                  )}
                </TableCell>
                <TableCell align="center">{t.visit_count}</TableCell>
                <TableCell align="center">{t.open_hotspots || 0}</TableCell>
                <TableCell>
                  <VisitStatusChip status={t.latest_visit_status} />
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  {canEditCatalog ? (
                    <>
                      {t.assigned_team_id != null && (
                        <Button
                          size="small"
                          onClick={() => setTowerActionId(t.id)}
                        >{tr("Unassign")}</Button>
                      )}
                      <Tooltip title={tr("Edit tower details")}>
                        <IconButton size="small" onClick={() => openEdit(t)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={tr("Inspection visits")}>
                        <IconButton size="small" onClick={() => navigate(`/towers/${t.id}`)}>
                          <CellTowerIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={tr("Deactivate tower")}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            if (confirm(tr("Deactivate tower {0}?", [t.tower_id]))) deactivateTower.mutate(t.id);
                          }}
                        >
                          <ArchiveIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : isTeamLeader && t.assigned_team_id == null ? (
                    <Button size="small" onClick={() => setTowerActionId(t.id)}>{tr("Add to my team")}</Button>
                  ) : isTeamLeader && t.assigned_team_id === user?.team_id ? (
                    <Button
                      size="small"
                      onClick={() => setTowerActionId(t.id)}
                    >{tr("Unassign")}</Button>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {t.assigned_team_name || '—'}
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && visibleTowers?.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} align="center">
                  {lineSector ? tr("No towers on this line sector.") : tr("No towers found — add your first one.")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
        </AccordionDetails>
      </Accordion>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperComponent={ResizableDialogPaper}
      >
        <DialogTitle>{editing ? tr("Edit tower {0}", [editing.tower_id]) : tr("Add a new tower")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {errorMsg && <Alert severity="error">{tr(errorMsg)}</Alert>}
            <TextField
              label={tr("Tower ID")}
              helperText={tr("Any format you want — this is not restricted to a fixed list.")}
              value={form.tower_id}
              onChange={(e) => setForm((f) => ({ ...f, tower_id: e.target.value }))}
              autoFocus
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label={tr("Voltage")}
                value={form.voltage}
                onChange={(e) => setForm((f) => ({ ...f, voltage: e.target.value }))}
                fullWidth
              >
                <MenuItem value="">—</MenuItem>
                {VOLTAGE_OPTIONS.map((v) => (
                  <MenuItem key={v} value={v}>
                    {tr(v)}
                  </MenuItem>
                ))}
                {form.voltage && !VOLTAGE_OPTIONS.includes(form.voltage) && (
                  <MenuItem value={form.voltage}>{form.voltage}{tr(" (existing)")}</MenuItem>
                )}
              </TextField>
              <TextField
                select
                label={tr("Tower type")}
                value={form.tower_type}
                onChange={(e) => setForm((f) => ({ ...f, tower_type: e.target.value }))}
                fullWidth
              >
                <MenuItem value="">—</MenuItem>
                {TOWER_TYPE_OPTIONS.map((t) => (
                  <MenuItem key={t} value={t}>
                    {tr(t)}
                  </MenuItem>
                ))}
                {form.tower_type && !TOWER_TYPE_OPTIONS.includes(form.tower_type) && (
                  <MenuItem value={form.tower_type}>{form.tower_type}{tr(" (existing)")}</MenuItem>
                )}
              </TextField>
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label={tr("Area / Region")}
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                helperText={
                  <>{tr("Managed via the pencil icon next to the Area filter above")}</>
                }
                fullWidth
              >
                <MenuItem value="">—</MenuItem>
                {areas?.map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))}
                {form.area && !areas?.includes(form.area) && <MenuItem value={form.area}>{form.area}{tr(" (existing)")}</MenuItem>}
              </TextField>
              <TextField
                label={tr("Line sector (optional)")}
                helperText={tr("Named line segment for project planning docs, e.g. “Ittin - Thumrait”")}
                value={form.line_sector}
                onChange={(e) => setForm((f) => ({ ...f, line_sector: e.target.value }))}
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label={tr("Location name")}
                helperText={tr("Site/landmark name, e.g. “Al Ain Corridor, Pole 14”")}
                value={form.location_name}
                onChange={(e) => setForm((f) => ({ ...f, location_name: e.target.value }))}
                fullWidth
              />
              <TextField
                label={tr("Height (m)")}
                type="number"
                value={form.height_m ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, height_m: e.target.value ? Number(e.target.value) : null }))}
                sx={{ minWidth: 140 }}
              />
            </Stack>
            <TextField
              label={tr("Notes")}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              multiline
              minRows={2}
              fullWidth
            />

            <Typography variant="subtitle2">{tr("Tower photo")}</Typography>
            {editing ? (
              <Stack spacing={1.5}>
                {editing.photo_path ? (
                  <ExpandableImage
                    src={mediaUrl(`/api/towers/${editing.id}/photo/thumbnail`, editing.photo_uploaded_at)}
                    alt={editing.tower_id}
                    height={160}
                  />
                ) : (
                  <Box
                    sx={{
                      height: 100,
                      borderRadius: 2,
                      bgcolor: 'grey.100',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CellTowerIcon color="disabled" />
                  </Box>
                )}
                <Stack direction="row" spacing={2}>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => handlePhotoFile(e.target.files?.[0] || null)}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<UploadFileIcon fontSize="small" />}
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadPhoto.isPending}
                  >
                    {editing.photo_path ? tr("Replace photo") : tr("Upload photo")}
                  </Button>
                  {editing.photo_path && (
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteOutlineIcon fontSize="small" />}
                      onClick={handleClearPhoto}
                      disabled={clearPhoto.isPending}
                    >{tr("Remove")}</Button>
                  )}
                </Stack>
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">{tr("Save the tower first, then reopen it here to add a photo.")}</Typography>
            )}

            <Typography variant="subtitle2">{tr("Tower GPS location")}</Typography>
            <MapPicker
              key={editing?.id ?? 'new'}
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={(lat, lng) => setForm((f) => ({ ...f, latitude: lat, longitude: lng }))}
              label={form.tower_id || tr("New tower")}
              highlight
              height={420}
              currentId={editing?.id}
              otherTowers={(towers || [])
                .filter((t) => t.id !== editing?.id && t.latitude != null && t.longitude != null)
                .map((t) => ({
                  id: t.id,
                  tower_id: t.tower_id,
                  area: t.area,
                  latitude: t.latitude,
                  longitude: t.longitude,
                }))}
              onSelectOther={(id) => {
                const t = (towers || []).find((x) => x.id === id);
                if (t) openEdit(t);
              }}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label={tr("Latitude")}
                type="number"
                value={form.latitude ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value ? Number(e.target.value) : null }))}
                fullWidth
              />
              <TextField
                label={tr("Longitude")}
                type="number"
                value={form.longitude ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value ? Number(e.target.value) : null }))}
                fullWidth
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDialogOpen(false)}>{tr("Cancel")}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!form.tower_id.trim() || createTower.isPending || updateTower.isPending}
          >{tr("Save")}</Button>
        </DialogActions>
      </Dialog>

      {canImport && (
        <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>{tr("Import towers from Excel")}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">{tr("Upload a spreadsheet with one row per tower. A Tower ID that already exists gets its fields updated; a new one gets created — nothing is deleted.")}</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadRoundedIcon fontSize="small" />}
                  component="a"
                  href={mediaUrl('/api/towers/export.xlsx')}
                >{tr("Download current towers")}</Button>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<DownloadRoundedIcon fontSize="small" />}
                  component="a"
                  href={mediaUrl('/api/towers/import/template')}
                >{tr("Blank template")}</Button>
              </Stack>

              {importError && <Alert severity="error">{tr(importError)}</Alert>}

              {importTowers.data && (
                <Alert severity={importTowers.data.warnings.length > 0 ? 'warning' : 'success'}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {importTowers.data.created}{tr(" created, ")}{importTowers.data.updated}{tr(" updated.")}</Typography>
                  {importTowers.data.warnings.length > 0 && (
                    <Stack component="ul" spacing={0.25} sx={{ mt: 1, mb: 0, pl: 2 }}>
                      {importTowers.data.warnings.map((w, i) => (
                        <Typography key={i} component="li" variant="caption">
                          {w}
                        </Typography>
                      ))}
                    </Stack>
                  )}
                </Alert>
              )}

              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] || null);
                  setImportError(null);
                }}
              />
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => importFileRef.current?.click()}
              >
                {importFile ? importFile.name : tr("Choose .xlsx file")}
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setImportOpen(false)}>{tr("Close")}</Button>
            <Button
              variant="contained"
              disabled={!importFile || importTowers.isPending}
              onClick={() => {
                if (!importFile) return;
                setImportError(null);
                importTowers.mutate(importFile, {
                  onSuccess: () => setImportFile(null),
                  onError: (err: unknown) => {
                    const message =
                      (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                      'Could not import that file';
                    setImportError(message);
                  },
                });
              }}
            >
              {importTowers.isPending ? tr("Importing…") : tr("Upload & import")}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr("Assign ")}{selected.size}{tr(" tower")}{selected.size === 1 ? '' : tr("s")}{tr(" to a team")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">{tr("That team becomes responsible for inspecting and fixing these towers — they'll show up on the team's Job Map, and progress is measured against them.")}</Typography>
            <TextField select label={tr("Team")} value={assignTeamId} onChange={(e) => setAssignTeamId(e.target.value)}>
              <MenuItem value="">
                <em>{tr("Unassign (remove from any team)")}</em>
              </MenuItem>
              {teams?.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)}>{tr("Cancel")}</Button>
          <Button
            variant="contained"
            disabled={bulkAssign.isPending}
            onClick={() => {
              bulkAssign.mutate(
                { tower_ids: Array.from(selected), team_id: assignTeamId ? Number(assignTeamId) : null },
                {
                  onSuccess: () => {
                    setAssignOpen(false);
                    setSelected(new Set());
                  },
                },
              );
            }}
          >
            {bulkAssign.isPending ? tr("Assigning…") : assignTeamId ? tr("Assign") : tr("Unassign")}
          </Button>
        </DialogActions>
      </Dialog>

      <TowersGpsEditorDialog
        open={gpsEditorOpen}
        onClose={() => setGpsEditorOpen(false)}
        towers={towers || []}
      />

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{deleteAll ? tr("Delete all towers") : tr("Delete {0} selected tower{1}", [selected.size, selected.size === 1 ? '' : tr("s")])}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="error">
              {deleteAll ? tr("This permanently deletes every tower in the catalog ({0}), including inspection visits and photos on those towers. This cannot be undone.", [towers?.length ?? 0]) : tr("This permanently deletes {0} tower{1} and any inspection visits and photos on them. This cannot be undone.", [selected.size, selected.size === 1 ? '' : tr("s")])}
            </Alert>
            {deleteError && <Alert severity="error">{tr(deleteError)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>{tr("Cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={bulkDelete.isPending || (!deleteAll && selected.size === 0)}
            onClick={() => {
              setDeleteError(null);
              bulkDelete.mutate(
                deleteAll ? { delete_all: true } : { tower_ids: Array.from(selected) },
                {
                  onSuccess: (res) => {
                    setDeleteOpen(false);
                    setSelected(new Set());
                    setDeleteAll(false);
                    if (!res.deleted) setDeleteError(tr("No towers were deleted."));
                  },
                  onError: (err: unknown) => {
                    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
                    setDeleteError(typeof detail === 'string' ? detail : tr("Could not delete those towers"));
                  },
                },
              );
            }}
          >
            {bulkDelete.isPending ? tr("Deleting…") : deleteAll ? tr("Delete all towers") : tr("Delete selected")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={areasDialogOpen} onClose={() => setAreasDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr("Manage areas")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">{tr("Areas are the named regions a tower's line runs through — e.g. \"Ashoor-Saada\", \"Ittin-Thumrait\". Renaming one updates every tower already using it; deleting one clears it off any tower that was.")}</Typography>
            {areaError && <Alert severity="error">{tr(areaError)}</Alert>}
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                label={tr("New area name")}
                value={newAreaName}
                onChange={(e) => setNewAreaName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !newAreaName.trim()) return;
                  setAreaError(null);
                  createArea.mutate(
                    { name: newAreaName.trim() },
                    {
                      onSuccess: () => setNewAreaName(''),
                      onError: (err: unknown) => {
                        const message =
                          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not add this area';
                        setAreaError(message);
                      },
                    },
                  );
                }}
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                disabled={!newAreaName.trim() || createArea.isPending}
                onClick={() => {
                  setAreaError(null);
                  createArea.mutate(
                    { name: newAreaName.trim() },
                    {
                      onSuccess: () => setNewAreaName(''),
                      onError: (err: unknown) => {
                        const message =
                          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not add this area';
                        setAreaError(message);
                      },
                    },
                  );
                }}
              >{tr("Add")}</Button>
            </Stack>

            <Stack component={Paper} variant="outlined" spacing={0} sx={{ maxHeight: 320, overflow: 'auto' }}>
              {areasFull?.map((a) => (
                <Stack
                  key={a.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  {editingAreaId === a.id ? (
                    <>
                      <TextField
                        size="small"
                        fullWidth
                        autoFocus
                        value={editAreaName}
                        onChange={(e) => setEditAreaName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editAreaName.trim()) {
                            updateArea.mutate(
                              { id: a.id, payload: { name: editAreaName.trim() } },
                              { onSuccess: () => setEditingAreaId(null) },
                            );
                          }
                          if (e.key === 'Escape') setEditingAreaId(null);
                        }}
                      />
                      <Tooltip title={tr("Save")}>
                        <IconButton
                          size="small"
                          color="primary"
                          disabled={!editAreaName.trim() || updateArea.isPending}
                          onClick={() =>
                            updateArea.mutate(
                              { id: a.id, payload: { name: editAreaName.trim() } },
                              { onSuccess: () => setEditingAreaId(null) },
                            )
                          }
                        >
                          <CheckIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={tr("Cancel")}>
                        <IconButton size="small" onClick={() => setEditingAreaId(null)}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>
                        {a.name}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={tr("{0} tower{1}", [a.tower_count, a.tower_count === 1 ? '' : tr("s")])}
                      />
                      <Tooltip title={tr("Rename")}>
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEditingAreaId(a.id);
                            setEditAreaName(a.name);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={tr("Delete area")}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={deleteArea.isPending}
                            onClick={() => {
                              const message =
                                a.tower_count > 0
                                  ? `${a.tower_count} tower${a.tower_count === 1 ? '' : 's'} still use "${a.name}" — deleting will clear it from ` +
                                    `${a.tower_count === 1 ? 'that tower' : 'those towers'} (they'll show as no-area) and permanently delete the area. Continue?`
                                  : `Delete area "${a.name}"? This can't be undone.`;
                              if (window.confirm(message)) deleteArea.mutate(a.id);
                            }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </>
                  )}
                </Stack>
              ))}
              {areasFull?.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>{tr("No areas yet — add the first one above.")}</Typography>
              )}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAreasDialogOpen(false)}>{tr("Done")}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

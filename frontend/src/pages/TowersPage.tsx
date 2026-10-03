import { tr, useLanguage } from '../i18n';
import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/AddRounded';
import SearchIcon from '@mui/icons-material/SearchRounded';
import EditIcon from '@mui/icons-material/EditRounded';
import ArchiveIcon from '@mui/icons-material/InventoryRounded';
import UploadFileIcon from '@mui/icons-material/UploadFileRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import TransmissionTowerIcon from '../components/TransmissionTowerIcon';
import TableChartIcon from '@mui/icons-material/TableChartRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import GroupsIcon from '@mui/icons-material/GroupsRounded';
import EditLocationAltIcon from '@mui/icons-material/EditLocationAltRounded';
import CheckIcon from '@mui/icons-material/CheckRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import MapRounded from '@mui/icons-material/MapRounded';
import RouteRounded from '@mui/icons-material/RouteRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';
import LocalFireDepartmentRounded from '@mui/icons-material/LocalFireDepartmentRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import FilterAltRounded from '@mui/icons-material/FilterAltRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import { DashboardSection } from '../components/DashboardSection';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import { useNavigate } from 'react-router-dom';
import {
  useAreas,
  useAreasFull,
  useBulkAssignTowers,
  useBulkDeleteTowers,
  useBulkSetTowerLine,
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
import { PROJECT_LINES, UNASSIGNED_LINE, towerLineKey, towerLineOptions, towerLineSummary, towersOnLine } from '../utils/towerLines';

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
  const registerRef = useRef<HTMLDivElement>(null);
  const [registerExpanded, setRegisterExpanded] = useState(true);
  const bulkSetLine = useBulkSetTowerLine();
  const [lineAssignmentRows, setLineAssignmentRows] = useState<TowerWithStats[]>([]);
  const [lineAssignmentOpen, setLineAssignmentOpen] = useState(false);
  const [targetLine, setTargetLine] = useState('');
  const [lineAssignmentError, setLineAssignmentError] = useState('');
  const [lineAssignmentMessage, setLineAssignmentMessage] = useState('');

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
  const { data: towers, isLoading, refetch: refreshTowers } = useTowers({
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
  const lineSectorOptions = towerLineOptions(towers || []);
  let visibleTowers = towersOnLine(towers || [], lineSector);
  if (teamFilter === 'unassigned') visibleTowers = (visibleTowers || []).filter((t) => t.assigned_team_id == null);
  else if (teamFilter) visibleTowers = (visibleTowers || []).filter((t) => t.assigned_team_id === Number(teamFilter));
  const selectedTowers = visibleTowers.filter(tower => selected.has(tower.id));
  const lineLabel = lineSector === UNASSIGNED_LINE ? tr('Line not assigned') : lineSector;
  const selectChartLine = (datum: BarDatum) => {
    setLineSector(datum.id || '');
    // Chart counts include every team in the current search/area scope.
    setTeamFilter('');
    setSelected(new Set());
    setRegisterExpanded(true);
    requestAnimationFrame(() => {
      registerRef.current?.focus({ preventScroll: true });
      registerRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
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
  const towersByLine: BarDatum[] = towerLineSummary(towers || [])
    .map(item => ({ ...item, label: tr(item.label), color: item.id === UNASSIGNED_LINE ? theme.palette.warning.main : theme.palette.primary.main }));
  const missingLineCount = towersByLine.find(item => item.id === UNASSIGNED_LINE)?.value || 0;

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
      line_sector: form.line_sector.trim() || null,
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
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><Box sx={{ p: 1.5, display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 3 }}><TransmissionTowerIcon sx={{ fontSize: 34 }} /></Box><Typography variant="h4" sx={{ fontWeight: 800 }}>{tr("Towers")}</Typography></Stack>
          <Typography color="text.secondary">{tr("Every tower, its crew and its inspection story — connected in one place.")}</Typography>
        </Box>
        {canAddTower && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{tr("Add tower")}</Button>}
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
        {[
          { label: tr('Matching towers'), value: visibleTowers?.length || 0, icon: <TransmissionTowerIcon />, color: theme.palette.primary.main },
          { label: tr('Assigned to a team'), value: (visibleTowers || []).filter(t => t.assigned_team_id != null).length, icon: <GroupsIcon />, color: theme.palette.info.main },
          { label: tr('Completed missions'), value: (visibleTowers || []).filter(t => t.latest_visit_mission_status === 'completed').length, icon: <FactCheckRounded />, color: theme.palette.success.main },
          { label: tr('Open hotspots'), value: (visibleTowers || []).reduce((total, t) => total + (t.open_hotspots || 0), 0), icon: <LocalFireDepartmentRounded />, color: theme.palette.warning.main },
        ].map(item => <Paper key={item.label} variant="outlined" sx={{ p: { xs: 1.5, md: 2.5 }, borderRadius: '20px', borderTop: `3px solid ${item.color}` }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ display: 'grid', placeItems: 'center', width: 46, height: 46, flexShrink: 0, borderRadius: 3, color: item.color, bgcolor: alpha(item.color, .1) }}>{item.icon}</Box>
            <Box><Typography variant="h5" sx={{ fontWeight: 800 }}>{isLoading ? '—' : item.value}</Typography><Typography variant="body2" color="text.secondary">{item.label}</Typography></Box>
          </Stack>
        </Paper>)}
      </Box>

      <DashboardSection icon={<FilterAltRounded />} title={tr('Find your towers')} description={tr('Search by tower ID, then narrow by area, line or team. The register and map follow your filters.')} tone="teal" compact>
      <Box sx={{ p: { xs: 2, md: 3 }, '& .MuiOutlinedInput-root': { borderRadius: '14px', minHeight: 48 } }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
        <TextField
          size="small"
          label={tr("Search towers")}
          placeholder={tr("Search by Tower ID or area…")}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelected(new Set()); }}
          sx={{ flex: 1, minWidth: { xs: 0, md: 240 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <TextField
          select
          size="small"
          label={tr("Area")}
          value={area}
          onChange={(e) => { setArea(e.target.value); setSelected(new Set()); }}
          sx={{ minWidth: 180 }}
          slotProps={{
            inputLabel: { shrink: true },
            select: {
              displayEmpty: true,
              renderValue: () => area || tr('All areas'),
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
          slotProps={{ inputLabel: { shrink: true }, input: { startAdornment: <InputAdornment position="start"><RouteRounded fontSize="small" /></InputAdornment> }, select: { displayEmpty: true, renderValue: () => lineLabel || tr('All line sectors') } }}
          value={lineSector}
          onChange={(e) => { setLineSector(e.target.value); setSelected(new Set()); }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{tr("All line sectors")}</MenuItem>
          <MenuItem value={UNASSIGNED_LINE}>{tr('Line not assigned')}</MenuItem>
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
          slotProps={{ inputLabel: { shrink: true }, input: { startAdornment: <InputAdornment position="start"><GroupsIcon fontSize="small" /></InputAdornment> }, select: { displayEmpty: true, renderValue: () => teamFilter === 'unassigned' ? tr('Unassigned') : teams?.find(t => String(t.id) === String(teamFilter))?.name || tr('All teams') } }}
          value={teamFilter}
          onChange={(e) => { setTeamFilter(e.target.value); setSelected(new Set()); }}
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

      <Stack direction="row" role="status" aria-live="polite" sx={{ mt: 2, gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip size="small" icon={<TransmissionTowerIcon />} label={tr('Matching towers: {0}', [visibleTowers?.length || 0])} />
        {lineSector && <Chip size="small" icon={<RouteRounded />} color={lineSector === UNASSIGNED_LINE ? 'warning' : 'primary'} label={lineLabel} onDelete={() => { setLineSector(''); setSelected(new Set()); }} />}
        {(search || area || lineSector || teamFilter) && <Button size="small" startIcon={<RestartAltRounded />} onClick={() => { setSearch(''); setArea(''); setLineSector(''); setTeamFilter(''); setSelected(new Set()); }}>{tr('Clear filters')}</Button>}
      </Stack>
      </Box>
      </DashboardSection>

      {renumberMsg && (
        <Alert
          severity={renumberMsg.startsWith('Updated') ? 'success' : 'error'}
          onClose={() => setRenumberMsg(null)}
        >
          {renumberMsg}
        </Alert>
      )}

      {lineAssignmentMessage && <Alert severity="success" onClose={() => setLineAssignmentMessage('')}>{lineAssignmentMessage}</Alert>}
      {lineSector === UNASSIGNED_LINE && <Alert severity="warning">
        {tr('These towers have no saved line assignment. They are not a separate line. Verify the line, then select the towers and choose Assign to line.')}
      </Alert>}

      {selectedTowers.length > 0 && canImport && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1, p: 2, bgcolor: alpha(theme.palette.primary.main, .08), borderRadius: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {selectedTowers.length}{tr(" tower")}{selectedTowers.length === 1 ? '' : tr("s")}{tr(" selected")}</Typography>
          <Button size="small" variant="contained" startIcon={<RouteRounded />} onClick={() => {
            setLineAssignmentRows([...selectedTowers]); setTargetLine(''); setLineAssignmentError(''); setLineAssignmentOpen(true);
          }}>{tr('Assign to line')}</Button>
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

      <Box ref={registerRef} tabIndex={-1} sx={{ scrollMarginTop: 80 }} aria-label={tr('Tower register')}>
      <DashboardSection expanded={registerExpanded} onExpandedChange={setRegisterExpanded} icon={<TransmissionTowerIcon />} title={tr('Tower register')} description={canImport ? tr('Open a tower to see its details and inspection history. Select rows to manage line and team assignments.') : tr('Open a tower to see its details and inspection history.')} eyebrow={tr('THE ASSETS BEHIND THE FIELDWORK')} tone="teal" badge={<Chip size="small" label={tr('Matching towers: {0}', [visibleTowers?.length || 0])} sx={{ color: 'white', bgcolor: '#ffffff20' }} />}>
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '16px', '& .MuiIconButton-root': { borderRadius: 2, minWidth: 38, minHeight: 38 } }}>
        <Table>
          <TableHead>
            <TableRow>
              {canImport && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={selectedTowers.length > 0 && selectedTowers.length < visibleTowers.length}
                    checked={!!visibleTowers.length && selectedTowers.length === visibleTowers.length}
                    slotProps={{ input: { 'aria-label': tr('Select all matching towers') } }}
                    onChange={(e) => setSelected(e.target.checked ? new Set(visibleTowers?.map((t) => t.id)) : new Set())}
                  />
                </TableCell>
              )}
              <TableCell>{tr("Tower ID")}</TableCell>
              <TableCell><Stack direction="row" spacing={.5} sx={{ alignItems: 'center' }}><RouteRounded fontSize="small" /><span>{tr('Location / line')}</span></Stack></TableCell>
              <TableCell><Stack direction="row" spacing={.5} sx={{ alignItems: 'center' }}><GroupsIcon fontSize="small" /><span>{tr('Assigned team')}</span></Stack></TableCell>
              <TableCell><Stack direction="row" spacing={.5} sx={{ alignItems: 'center' }}><FactCheckRounded fontSize="small" /><span>{tr('Inspection progress')}</span></Stack></TableCell>
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
                      slotProps={{ input: { 'aria-label': tr('Select tower {0}', [t.tower_id]) } }}
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
                <TableCell sx={{ minWidth: 210 }}><Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><Box sx={{ width: 42, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.primary.main, .08), color: 'primary.main', flexShrink: 0 }}><TransmissionTowerIcon /></Box><Box><Button sx={{ p: 0, minWidth: 0, textAlign: 'start', fontWeight: 800, justifyContent: 'flex-start' }} onClick={(e) => { e.stopPropagation(); setTowerActionId(t.id); }}>{t.tower_id}</Button><Stack direction="row" spacing={.5} sx={{ alignItems: 'center', mt: .5, color: 'text.secondary' }}><BoltRounded sx={{ fontSize: 15 }} /><Typography variant="caption">{t.voltage || '—'}</Typography></Stack>{t.tower_type && <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{t.tower_type}</Typography>}</Box></Stack></TableCell>
                <TableCell sx={{ minWidth: 120 }}><Typography variant="body2">{t.area || '—'}</Typography><Typography variant="caption" color="text.secondary">{t.line_sector || '—'}</Typography>{t.location_name && <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">{t.location_name}</Typography>}</TableCell>
                <TableCell>
                  {t.assigned_team_name ? (
                    <Chip size="small" icon={<GroupsIcon />} color="primary" variant="outlined" label={t.assigned_team_name} />
                  ) : (
                    <Typography variant="caption" color="text.secondary">{tr("Unassigned")}</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ minWidth: 180 }}>
                  <VisitStatusChip status={t.latest_visit_status} />
                  <Stack direction="row" sx={{ gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="text.secondary">{tr('Visits: {0}', [t.visit_count])}</Typography>
                    {t.open_hotspots > 0 && <Chip size="small" icon={<LocalFireDepartmentRounded />} label={tr('Hotspots: {0}', [t.open_hotspots])} color="warning" variant="outlined" />}
                  </Stack>
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
                          <TransmissionTowerIcon fontSize="small" />
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
                <TableCell colSpan={canImport ? 6 : 5} align="center">
                  {lineSector ? tr("No towers on this line sector.") : tr("No towers found — add your first one.")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      </DashboardSection>
      </Box>

      <DashboardSection icon={<MapRounded />} title={tr('Tower locations')} description={tr('Click a tower pin or table row to view its details, open inspections, or choose an assignment action.')} eyebrow={tr('EXPLORE THE NETWORK')} tone="blue">
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
      </DashboardSection>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <DashboardSection icon={<RouteRounded />} title={tr('Towers per line')} description={tr('Click a line to see its towers in the register and map. Counts follow the current search and area.')} tone="violet" compact>
            <Box sx={{ p: 2.5 }}>
              <HorizontalBarChart data={towersByLine} emptyMessage={tr('No towers to summarize yet.')} onSelect={selectChartLine} selectedId={lineSector}
                selectionLabel={item => tr('View {0} towers: {1}', [item.value, item.label])} />
              {missingLineCount > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                {tr('Line not assigned means the line field is empty, not another transmission line. Click it to review those towers.')}
              </Typography>}
            </Box>
          </DashboardSection>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <DashboardSection icon={<InsightsRoundedIcon />} title={tr('Towers completed per team')} description={tr('Assigned towers whose latest visit is fully completed, by team.')} tone="green" compact>
            <Box sx={{ p: 2.5 }}>
              <HorizontalBarChart data={completedByTeam} emptyMessage="No completed towers yet." />
            </Box>
          </DashboardSection>
        </Grid>
      </Grid>

      {canImport && <DashboardSection icon={<SettingsRounded />} title={tr('Tower catalog tools')} description={tr('Import or export tower records, update map locations and maintain the catalog.')} tone="amber" defaultExpanded={false}>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
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
        </Stack>
      </DashboardSection>}

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
                select
                required={!editing}
                label={tr('Line')}
                helperText={tr('Choose the confirmed transmission line. Existing unassigned records can be reviewed later.')}
                value={form.line_sector}
                onChange={(e) => setForm((f) => ({ ...f, line_sector: e.target.value }))}
                fullWidth
              >
                <MenuItem value="">{tr('Line not assigned')}</MenuItem>
                {PROJECT_LINES.map(line => <MenuItem key={line} value={line}>{line}</MenuItem>)}
                {form.line_sector && !PROJECT_LINES.some(line => line === form.line_sector) && <MenuItem value={form.line_sector}>{form.line_sector}{tr(' (existing)')}</MenuItem>}
              </TextField>
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
                    <TransmissionTowerIcon color="disabled" />
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
            disabled={!form.tower_id.trim() || (!editing && !form.line_sector) || createTower.isPending || updateTower.isPending}
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

      <Dialog open={lineAssignmentOpen} onClose={() => { if (!bulkSetLine.isPending) setLineAssignmentOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle>{tr('Assign {0} towers to a line', [lineAssignmentRows.length])}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">{tr('Only the line assignment changes. Tower IDs, inspections, photos, team assignments and issued report files stay unchanged.')}</Alert>
            <TextField select required label={tr('Confirmed line')} value={targetLine} disabled={bulkSetLine.isPending} onChange={event => setTargetLine(event.target.value)}>
              {PROJECT_LINES.map(line => <MenuItem key={line} value={line}>{line}</MenuItem>)}
            </TextField>
            <Typography variant="body2" color="text.secondary">{tr('Review every selected tower before saving. Names can help identify a line, but are not proof of the physical assignment.')}</Typography>
            <TableContainer sx={{ maxHeight: 260 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow><TableCell>{tr('Tower ID')}</TableCell><TableCell>{tr('Current line')}</TableCell></TableRow></TableHead>
                <TableBody>{lineAssignmentRows.map(tower => <TableRow key={tower.id}><TableCell>{tower.tower_id}</TableCell><TableCell>{towerLineKey(tower) === UNASSIGNED_LINE ? tr('Line not assigned') : tower.line_sector}</TableCell></TableRow>)}</TableBody>
              </Table>
            </TableContainer>
            {lineAssignmentError && <Alert severity="error" action={<Button color="inherit" disabled={bulkSetLine.isPending} onClick={() => {
              setLineAssignmentOpen(false); setSelected(new Set()); void refreshTowers();
            }}>{tr('Refresh and review')}</Button>}>{lineAssignmentError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={bulkSetLine.isPending} onClick={() => setLineAssignmentOpen(false)}>{tr('Cancel')}</Button>
          <Button variant="contained" disabled={!targetLine || !lineAssignmentRows.length || bulkSetLine.isPending} onClick={() => {
            setLineAssignmentError('');
            bulkSetLine.mutate({ towers: lineAssignmentRows.map(tower => ({ tower_id: tower.id, expected_line_sector: tower.line_sector ?? null })), line_sector: targetLine }, {
              onSuccess: () => {
                setLineAssignmentOpen(false); setSelected(new Set()); setLineSector(targetLine);
                setLineAssignmentMessage(tr('Assigned {0} towers to {1}. Inspection data was not changed.', [lineAssignmentRows.length, targetLine]));
              },
              onError: (error: unknown) => {
                const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
                setLineAssignmentError(typeof detail === 'string' ? tr(detail) : tr('Could not assign the line. Refresh and review the selected towers.'));
              },
            });
          }}>{bulkSetLine.isPending ? tr('Saving…') : tr('Confirm line assignment')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tr("Assign ")}{selectedTowers.length}{tr(" tower")}{selectedTowers.length === 1 ? '' : tr("s")}{tr(" to a team")}</DialogTitle>
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
            disabled={bulkAssign.isPending || !selectedTowers.length}
            onClick={() => {
              bulkAssign.mutate(
                { tower_ids: selectedTowers.map(tower => tower.id), team_id: assignTeamId ? Number(assignTeamId) : null },
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
        <DialogTitle>{deleteAll ? tr("Delete all towers") : tr("Delete {0} selected tower{1}", [selectedTowers.length, selectedTowers.length === 1 ? '' : tr("s")])}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="error">
              {deleteAll ? tr("This permanently deletes every tower in the catalog ({0}), including inspection visits and photos on those towers. This cannot be undone.", [towers?.length ?? 0]) : tr("This permanently deletes {0} tower{1} and any inspection visits and photos on them. This cannot be undone.", [selectedTowers.length, selectedTowers.length === 1 ? '' : tr("s")])}
            </Alert>
            {deleteError && <Alert severity="error">{tr(deleteError)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>{tr("Cancel")}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={bulkDelete.isPending || (!deleteAll && selectedTowers.length === 0)}
            onClick={() => {
              setDeleteError(null);
              bulkDelete.mutate(
                deleteAll ? { delete_all: true } : { tower_ids: selectedTowers.map(tower => tower.id) },
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

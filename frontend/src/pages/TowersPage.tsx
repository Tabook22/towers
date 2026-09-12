import { useRef, useState } from 'react';
import {
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
import { useNavigate } from 'react-router-dom';
import {
  useAreas,
  useAreasFull,
  useBulkAssignTowers,
  useClaimTowerForTeam,
  useClearTowerPhoto,
  useCreateArea,
  useCreateTower,
  useDeactivateTower,
  useDeleteArea,
  useImportTowers,
  useTeams,
  useTowers,
  useUpdateArea,
  useUpdateTower,
  useUploadTowerPhoto,
} from '../api/hooks';
import { mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { DashboardTowerRow, Tower, TowerWithStats } from '../api/types';
import { VisitStatusChip } from '../components/Badges';
import { MapPicker } from '../components/MapPicker';
import { TowersOverviewMap } from '../components/TowersOverviewMap';
import { ExpandableImage } from '../components/ExpandableImage';
import { ResizableDialogPaper } from '../components/ResizableDialogPaper';
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
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('');
  const [lineSector, setLineSector] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TowerWithStats | null>(null);
  const [form, setForm] = useState<TowerFormState>(emptyForm);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  const navigate = useNavigate();
  const { user } = useAuth();
  const canImport = user?.role === 'admin' || user?.role === 'reviewer';
  const canEditCatalog = canImport;
  const isTeamLeader = user?.role === 'team_leader';
  const debouncedSearch = useDebouncedValue(search);
  const { data: towers, isLoading } = useTowers({ search: debouncedSearch || undefined, area: area || undefined });
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
  const claimForTeam = useClaimTowerForTeam();
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
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Could not save tower';
      setErrorMsg(message);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Manage Towers
          </Typography>
          <Typography color="text.secondary">
            Add any number of towers with any Tower ID — no fixed list or format required.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          {canImport && (
            <>
              <Button
                variant="outlined"
                startIcon={<DownloadRoundedIcon />}
                component="a"
                href={mediaUrl('/api/towers/export.xlsx')}
              >
                Download Excel
              </Button>
              <Button
                variant="outlined"
                startIcon={<TableChartIcon />}
                onClick={() => {
                  setImportFile(null);
                  setImportError(null);
                  importTowers.reset();
                  setImportOpen(true);
                }}
              >
                Import from Excel
              </Button>
            </>
          )}
          {canEditCatalog && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              Add tower
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack direction="row" spacing={2}>
        <TextField
          size="small"
          placeholder="Search by Tower ID or area…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 280 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <TextField
          select
          size="small"
          label="Area"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          sx={{ minWidth: 180 }}
          slotProps={{
            select: {
              endAdornment: canImport && (
                <Tooltip title="Add, rename, or delete areas">
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
          value={lineSector}
          onChange={(e) => setLineSector(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All line sectors</MenuItem>
          {lineSectorOptions.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Assigned team"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All teams</MenuItem>
          <MenuItem value="unassigned">Unassigned</MenuItem>
          {teams?.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {selected.size > 0 && canImport && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1.5, bgcolor: 'primary.50', borderRadius: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {selected.size} tower{selected.size === 1 ? '' : 's'} selected
          </Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<GroupsIcon fontSize="small" />}
            onClick={() => {
              setAssignTeamId('');
              setAssignOpen(true);
            }}
          >
            Assign to team
          </Button>
          <Button size="small" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </Stack>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Tower locations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {canEditCatalog
              ? 'Click a pin to edit that tower. Only an admin can change, delete, or deactivate catalog towers.'
              : isTeamLeader
                ? 'Green pins are free — click one to assign it to your team. Red pins show which team holds them. You cannot edit or delete towers — that is admin only.'
                : 'Registered towers with GPS. Catalog edits are admin only.'}
          </Typography>
          {isTeamLeader && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Green = free. Red = assigned (team name on the pin). Click a green pin to take it.
            </Typography>
          )}
          {claimMsg && (
            <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setClaimMsg(null)}>
              {claimMsg}
            </Alert>
          )}
          <TowersOverviewMap
            rows={mapRows}
            height={380}
            onTowerClick={(row) => {
              const t = visibleTowers?.find((x) => x.id === row.tower.id);
              if (!t) return;
              if (canEditCatalog) {
                openEdit(t);
                return;
              }
              if (!isTeamLeader) return;
              if (t.assigned_team_id != null) {
                setClaimMsg(
                  t.assigned_team_id === user?.team_id
                    ? `${t.tower_id} is already on your team.`
                    : `${t.tower_id} belongs to ${t.assigned_team_name || 'another team'}. They must release it first.`,
                );
                return;
              }
              setClaimMsg(null);
              claimForTeam.mutate(t.id, {
                onError: (err: unknown) => {
                  const message =
                    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                    'Could not add that tower';
                  setClaimMsg(String(message));
                },
              });
            }}
          />
        </CardContent>
      </Card>

      <TableContainer component={Paper} variant="outlined">
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
              <TableCell>Tower ID</TableCell>
              <TableCell>Voltage</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Area</TableCell>
              <TableCell>Line sector</TableCell>
              <TableCell>Assigned team</TableCell>
              <TableCell align="center">Visits</TableCell>
              <TableCell align="center">Open hotspots</TableCell>
              <TableCell>Latest visit status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleTowers?.map((t) => (
              <TableRow key={t.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/towers/${t.id}`)}>
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
                    <Typography variant="caption" color="text.secondary">
                      Unassigned
                    </Typography>
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
                      <Tooltip title="Edit tower">
                        <IconButton size="small" onClick={() => openEdit(t)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Deactivate tower">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            if (confirm(`Deactivate tower ${t.tower_id}?`)) deactivateTower.mutate(t.id);
                          }}
                        >
                          <ArchiveIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  ) : isTeamLeader && t.assigned_team_id == null ? (
                    <Button size="small" onClick={() => claimForTeam.mutate(t.id)}>
                      Add to my team
                    </Button>
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
                  {lineSector ? 'No towers on this line sector.' : 'No towers found — add your first one.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperComponent={ResizableDialogPaper}
      >
        <DialogTitle>{editing ? `Edit tower ${editing.tower_id}` : 'Add a new tower'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {errorMsg && <Alert severity="error">{errorMsg}</Alert>}
            <TextField
              label="Tower ID"
              helperText="Any format you want — this is not restricted to a fixed list."
              value={form.tower_id}
              onChange={(e) => setForm((f) => ({ ...f, tower_id: e.target.value }))}
              autoFocus
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Voltage"
                value={form.voltage}
                onChange={(e) => setForm((f) => ({ ...f, voltage: e.target.value }))}
                fullWidth
              >
                <MenuItem value="">—</MenuItem>
                {VOLTAGE_OPTIONS.map((v) => (
                  <MenuItem key={v} value={v}>
                    {v}
                  </MenuItem>
                ))}
                {form.voltage && !VOLTAGE_OPTIONS.includes(form.voltage) && (
                  <MenuItem value={form.voltage}>{form.voltage} (existing)</MenuItem>
                )}
              </TextField>
              <TextField
                select
                label="Tower type"
                value={form.tower_type}
                onChange={(e) => setForm((f) => ({ ...f, tower_type: e.target.value }))}
                fullWidth
              >
                <MenuItem value="">—</MenuItem>
                {TOWER_TYPE_OPTIONS.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
                {form.tower_type && !TOWER_TYPE_OPTIONS.includes(form.tower_type) && (
                  <MenuItem value={form.tower_type}>{form.tower_type} (existing)</MenuItem>
                )}
              </TextField>
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Area / Region"
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                helperText={
                  <>
                    Managed via the pencil icon next to the Area filter above
                  </>
                }
                fullWidth
              >
                <MenuItem value="">—</MenuItem>
                {areas?.map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))}
                {form.area && !areas?.includes(form.area) && <MenuItem value={form.area}>{form.area} (existing)</MenuItem>}
              </TextField>
              <TextField
                label="Line sector (optional)"
                helperText="Named line segment for project planning docs, e.g. “Ittin - Thumrait”"
                value={form.line_sector}
                onChange={(e) => setForm((f) => ({ ...f, line_sector: e.target.value }))}
                fullWidth
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Location name"
                helperText="Site/landmark name, e.g. “Al Ain Corridor, Pole 14”"
                value={form.location_name}
                onChange={(e) => setForm((f) => ({ ...f, location_name: e.target.value }))}
                fullWidth
              />
              <TextField
                label="Height (m)"
                type="number"
                value={form.height_m ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, height_m: e.target.value ? Number(e.target.value) : null }))}
                sx={{ minWidth: 140 }}
              />
            </Stack>
            <TextField
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              multiline
              minRows={2}
              fullWidth
            />

            <Typography variant="subtitle2">Tower photo</Typography>
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
                    {editing.photo_path ? 'Replace photo' : 'Upload photo'}
                  </Button>
                  {editing.photo_path && (
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteOutlineIcon fontSize="small" />}
                      onClick={handleClearPhoto}
                      disabled={clearPhoto.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </Stack>
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Save the tower first, then reopen it here to add a photo.
              </Typography>
            )}

            <Typography variant="subtitle2">Tower GPS location</Typography>
            <MapPicker
              latitude={form.latitude}
              longitude={form.longitude}
              onChange={(lat, lng) => setForm((f) => ({ ...f, latitude: lat, longitude: lng }))}
              label={form.tower_id}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Latitude"
                type="number"
                value={form.latitude ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value ? Number(e.target.value) : null }))}
                fullWidth
              />
              <TextField
                label="Longitude"
                type="number"
                value={form.longitude ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value ? Number(e.target.value) : null }))}
                fullWidth
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!form.tower_id.trim() || createTower.isPending || updateTower.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {canImport && (
        <Dialog open={importOpen} onClose={() => setImportOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Import towers from Excel</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Upload a spreadsheet with one row per tower. A Tower ID that already exists gets its
                fields updated; a new one gets created — nothing is deleted.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadRoundedIcon fontSize="small" />}
                  component="a"
                  href={mediaUrl('/api/towers/export.xlsx')}
                >
                  Download current towers
                </Button>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<DownloadRoundedIcon fontSize="small" />}
                  component="a"
                  href={mediaUrl('/api/towers/import/template')}
                >
                  Blank template
                </Button>
              </Stack>

              {importError && <Alert severity="error">{importError}</Alert>}

              {importTowers.data && (
                <Alert severity={importTowers.data.warnings.length > 0 ? 'warning' : 'success'}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {importTowers.data.created} created, {importTowers.data.updated} updated.
                  </Typography>
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
                {importFile ? importFile.name : 'Choose .xlsx file'}
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setImportOpen(false)}>Close</Button>
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
              {importTowers.isPending ? 'Importing…' : 'Upload & import'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Assign {selected.size} tower{selected.size === 1 ? '' : 's'} to a team</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              That team becomes responsible for inspecting and fixing these towers — they'll show up
              on the team's Job Map, and progress is measured against them.
            </Typography>
            <TextField select label="Team" value={assignTeamId} onChange={(e) => setAssignTeamId(e.target.value)}>
              <MenuItem value="">
                <em>Unassign (remove from any team)</em>
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
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
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
            {bulkAssign.isPending ? 'Assigning…' : assignTeamId ? 'Assign' : 'Unassign'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={areasDialogOpen} onClose={() => setAreasDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Manage areas</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Areas are the named regions a tower's line runs through — e.g. "Ashoor-Saada", "Ittin-Thumrait".
              Renaming one updates every tower already using it; deleting one clears it off any tower that was.
            </Typography>
            {areaError && <Alert severity="error">{areaError}</Alert>}
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                label="New area name"
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
              >
                Add
              </Button>
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
                      <Tooltip title="Save">
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
                      <Tooltip title="Cancel">
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
                        label={`${a.tower_count} tower${a.tower_count === 1 ? '' : 's'}`}
                      />
                      <Tooltip title="Rename">
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
                      <Tooltip title="Delete area">
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
                <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                  No areas yet — add the first one above.
                </Typography>
              )}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAreasDialogOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

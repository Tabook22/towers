import { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Chip,
  Paper,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FolderIcon from '@mui/icons-material/FolderRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import UploadFileIcon from '@mui/icons-material/UploadFileRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import CellTowerRoundedIcon from '@mui/icons-material/CellTowerRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import {
  useArchive,
  useDeleteTeamArchiveImage,
  useTeamArchiveImages,
  useTeams,
  useTowers,
  useUploadTeamArchiveImages,
} from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { mediaUrl } from '../api/client';
import { EvidenceChip } from '../components/Badges';
import { ImageLightbox } from '../components/ImageLightbox';
import type { ImageRow, TeamArchiveImage } from '../api/types';

const months = [
  '01 - January', '02 - February', '03 - March', '04 - April', '05 - May', '06 - June',
  '07 - July', '08 - August', '09 - September', '10 - October', '11 - November', '12 - December',
];

// One clickable thumbnail — either the original photo or its annotated (marked-up) copy. Shared by
// both slots in a row so they look and behave identically; only the URLs/labels differ.
function Thumb({
  label,
  thumbUrl,
  onClick,
}: {
  label: string;
  thumbUrl: string;
  onClick: () => void;
}) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Box
        component="button"
        onClick={onClick}
        sx={{
          display: 'block',
          width: 96,
          height: 96,
          p: 0,
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 1.5,
          overflow: 'hidden',
          cursor: 'pointer',
          bgcolor: 'grey.900',
          '&:hover': { opacity: 0.85 },
        }}
      >
        <Box component="img" src={thumbUrl} alt={label} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

const monthName = (m: number) =>
  new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: 'long' });
const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

interface PositionGroup {
  key: string;
  ohl: string;
  phase: string;
  string: string;
  direction: string | null;
  images: ImageRow[];
}
interface TowerGroup {
  key: string;
  towerCode: string;
  positions: PositionGroup[];
}
interface LineGroup {
  key: string;
  area: string;
  towers: TowerGroup[];
}
interface MonthGroup {
  key: string;
  year: number;
  month: number;
  lines: LineGroup[];
}
interface TeamGroup {
  key: string;
  teamName: string;
  months: MonthGroup[];
}

/** Team → Year/Month → Line (Tower.area) → Tower → Insulator (position) — the exact grouping an
 * admin browsing the archive actually thinks in, built client-side from the already-filtered,
 * already-team/tower-scoped list the API returns (see routers/archive.browse_archive). */
function buildArchiveTree(images: ImageRow[]): TeamGroup[] {
  const teams = new Map<string, TeamGroup>();
  for (const img of images) {
    const teamKey = img.team_name || 'Unassigned (no team)';
    let team = teams.get(teamKey);
    if (!team) {
      team = { key: teamKey, teamName: teamKey, months: [] };
      teams.set(teamKey, team);
    }

    const d = img.capture_date ? new Date(`${img.capture_date}T00:00:00`) : null;
    const year = d ? d.getFullYear() : 0;
    const month = d ? d.getMonth() + 1 : 0;
    const monthKey = `${year}-${month}`;
    let monthGroup = team.months.find((m) => m.key === monthKey);
    if (!monthGroup) {
      monthGroup = { key: monthKey, year, month, lines: [] };
      team.months.push(monthGroup);
    }

    const areaKey = img.area || 'No line set';
    let line = monthGroup.lines.find((l) => l.key === areaKey);
    if (!line) {
      line = { key: areaKey, area: areaKey, towers: [] };
      monthGroup.lines.push(line);
    }

    const towerCode = img.tower_code || 'Unknown tower';
    let tower = line.towers.find((t) => t.key === towerCode);
    if (!tower) {
      tower = { key: towerCode, towerCode, positions: [] };
      line.towers.push(tower);
    }

    const posKey = img.position_code || `${img.ohl}-${img.phase}-${img.string}`;
    let pos = tower.positions.find((p) => p.key === posKey);
    if (!pos) {
      pos = {
        key: posKey,
        ohl: img.ohl || '',
        phase: img.phase || '',
        string: img.string || '',
        direction: img.direction ?? null,
        images: [],
      };
      tower.positions.push(pos);
    }
    pos.images.push(img);
  }

  const out = Array.from(teams.values());
  out.sort((a, b) => a.teamName.localeCompare(b.teamName));
  for (const team of out) {
    team.months.sort((a, b) => b.year - a.year || b.month - a.month);
    for (const m of team.months) {
      m.lines.sort((a, b) => a.area.localeCompare(b.area));
      for (const l of m.lines) {
        l.towers.sort((a, b) => naturalCompare(a.towerCode, b.towerCode));
        for (const t of l.towers) {
          t.positions.sort((a, b) => naturalCompare(a.key, b.key));
        }
      }
    }
  }
  return out;
}

export function ArchivePage() {
  const [year, setYear] = useState<string>('');
  const [month, setMonth] = useState<string>('');
  const [day, setDay] = useState<string>('');
  const [towerId, setTowerId] = useState<string>('');
  const [archiveTeamId, setArchiveTeamId] = useState<string>('');
  const { data: towers } = useTowers({ include_inactive: true });

  const { data: images, isLoading } = useArchive({
    year: year ? Number(year) : undefined,
    month: month ? Number(month) : undefined,
    day: day ? Number(day) : undefined,
    tower_id: towerId ? Number(towerId) : undefined,
    team_id: archiveTeamId ? Number(archiveTeamId) : undefined,
  });
  const archiveTree = useMemo(() => buildArchiveTree(images || []), [images]);

  // Which image's original/annotated version is currently enlarged, if any.
  const [lightbox, setLightbox] = useState<{ image: ImageRow; variant: 'original' | 'annotated' } | null>(null);

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

  // ---------- Team photo uploads — separate dataset from the per-position evidence above, so it
  // gets its own filters rather than overloading the tower-archive ones. ----------
  const { user } = useAuth();
  const canUpload = user?.role === 'admin' || user?.role === 'reviewer';
  const { data: teams } = useTeams();
  const [teamFilter, setTeamFilter] = useState('');
  const [teamYear, setTeamYear] = useState('');
  const [teamMonth, setTeamMonth] = useState('');
  const [teamDay, setTeamDay] = useState('');
  const { data: teamImages, isLoading: teamImagesLoading } = useTeamArchiveImages({
    team_id: teamFilter ? Number(teamFilter) : undefined,
    year: teamYear ? Number(teamYear) : undefined,
    month: teamMonth ? Number(teamMonth) : undefined,
    day: teamDay ? Number(teamDay) : undefined,
  });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTeamId, setUploadTeamId] = useState('');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadCaption, setUploadCaption] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadMutation = useUploadTeamArchiveImages(uploadTeamId ? Number(uploadTeamId) : 0);
  const deleteTeamImage = useDeleteTeamArchiveImage();
  const [teamLightbox, setTeamLightbox] = useState<TeamArchiveImage | null>(null);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Image Archive
        </Typography>
        <Typography color="text.secondary">
          Inspection photos are grouped by team, then year/month, then line, then tower, then
          insulator — browse the archive here.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Team photo uploads
              </Typography>
              <Typography variant="body2" color="text.secondary">
                General photos for a team — site conditions, equipment, handovers — not tied to
                one specific tower inspection. Auto-filed by year/month/day, with location pulled
                from the photo itself when available.
              </Typography>
            </Box>
            {canUpload && (
              <Button
                variant="contained"
                startIcon={<UploadFileIcon />}
                onClick={() => {
                  setUploadTeamId(teamFilter || '');
                  setUploadFiles([]);
                  setUploadCaption('');
                  setUploadError(null);
                  uploadMutation.reset();
                  setUploadOpen(true);
                }}
              >
                Upload images
              </Button>
            )}
          </Stack>

          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
            <TextField select size="small" label="Team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All teams</MenuItem>
              {teams?.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Year" value={teamYear} onChange={(e) => setTeamYear(e.target.value)} sx={{ minWidth: 120 }}>
              <MenuItem value="">Any</MenuItem>
              {years.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Month" value={teamMonth} onChange={(e) => setTeamMonth(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">Any</MenuItem>
              {months.map((m, i) => (
                <MenuItem key={m} value={i + 1}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Day"
              type="number"
              value={teamDay}
              onChange={(e) => setTeamDay(e.target.value)}
              sx={{ minWidth: 100 }}
              slotProps={{ htmlInput: { min: 1, max: 31 } }}
            />
          </Stack>

          {!teamImagesLoading && teamImages && teamImages.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No team photos match these filters.
            </Typography>
          )}

          <Stack spacing={1.5}>
            {teamImages?.map((img) => (
              <Paper key={img.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Box
                    component="button"
                    onClick={() => setTeamLightbox(img)}
                    sx={{
                      display: 'block',
                      width: 96,
                      height: 96,
                      p: 0,
                      border: '1px solid rgba(0,0,0,0.15)',
                      borderRadius: 1.5,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      bgcolor: 'grey.900',
                      flexShrink: 0,
                      '&:hover': { opacity: 0.85 },
                    }}
                  >
                    <Box
                      component="img"
                      src={mediaUrl(
                        img.has_thumbnail ? `/api/archive/team-images/${img.id}/thumbnail` : `/api/archive/team-images/${img.id}/file`,
                        img.uploaded_at,
                      )}
                      alt={img.original_filename || 'Team photo'}
                      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 220 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
                      <Chip size="small" color="primary" variant="outlined" label={img.team_name || 'Unknown team'} />
                      {img.latitude != null && img.longitude != null && (
                        <Chip
                          size="small"
                          icon={<PlaceRoundedIcon fontSize="small" />}
                          label="Location"
                          component="a"
                          href={`https://www.google.com/maps/search/?api=1&query=${img.latitude},${img.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          clickable
                        />
                      )}
                    </Stack>
                    {img.caption && (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {img.caption}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {img.capture_date}
                      {img.original_filename ? ` · ${img.original_filename}` : ''}
                      {img.uploaded_by_name ? ` · uploaded by ${img.uploaded_by_name}` : ''}
                    </Typography>
                  </Box>
                  {canUpload && (
                    <Tooltip title="Delete photo">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          if (window.confirm('Delete this photo? This cannot be undone.')) deleteTeamImage.mutate(img.id);
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Inspection photos
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Grouped by team, then year/month, then line, then tower, then insulator — expand down
            to the one you need. Use the filters to narrow it down first.
          </Typography>
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <TextField select size="small" label="Team" value={archiveTeamId} onChange={(e) => setArchiveTeamId(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All teams</MenuItem>
              {teams?.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Year" value={year} onChange={(e) => setYear(e.target.value)} sx={{ minWidth: 120 }}>
              <MenuItem value="">Any</MenuItem>
              {years.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Month" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">Any</MenuItem>
              {months.map((m, i) => (
                <MenuItem key={m} value={i + 1}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Day"
              type="number"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              sx={{ minWidth: 100 }}
              slotProps={{ htmlInput: { min: 1, max: 31 } }}
            />
            <TextField select size="small" label="Tower" value={towerId} onChange={(e) => setTowerId(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">All towers</MenuItem>
              {towers?.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.tower_id}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      {!isLoading && images && images.length === 0 && (
        <Stack spacing={1} sx={{ py: 6, color: 'text.secondary', alignItems: 'center' }}>
          <FolderIcon fontSize="large" />
          <Typography>No archived images match these filters.</Typography>
        </Stack>
      )}

      <Stack spacing={1.5}>
        {archiveTree.map((team) => (
          <Accordion key={team.key} defaultExpanded={archiveTree.length === 1}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <GroupsRoundedIcon fontSize="small" color="primary" />
                <Typography sx={{ fontWeight: 700 }}>{team.teamName}</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.5}>
                {team.months.map((m) => (
                  <Accordion key={m.key} variant="outlined" disableGutters>
                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                      <Typography sx={{ fontWeight: 600 }}>
                        {m.year ? `${monthName(m.month)} ${m.year}` : 'Unknown date'}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={1.5}>
                        {m.lines.map((line) => (
                          <Accordion key={line.key} variant="outlined" disableGutters>
                            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <RouteRoundedIcon fontSize="small" color="action" />
                                <Typography sx={{ fontWeight: 600 }}>{line.area}</Typography>
                              </Stack>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Stack spacing={1.5}>
                                {line.towers.map((tower) => (
                                  <Accordion key={tower.key} variant="outlined" disableGutters>
                                    <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                        <CellTowerRoundedIcon fontSize="small" color="action" />
                                        <Typography sx={{ fontWeight: 600 }}>{tower.towerCode}</Typography>
                                      </Stack>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                      <Stack spacing={2} divider={<Box sx={{ borderBottom: 1, borderColor: 'divider' }} />}>
                                        {tower.positions.map((pos) => (
                                          <Box key={pos.key}>
                                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                                              <BoltRoundedIcon fontSize="small" color="action" />
                                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                                {pos.ohl} {pos.phase} {pos.string}
                                                {pos.direction ? ` — ${pos.direction}` : ''}
                                              </Typography>
                                            </Stack>
                                            <Stack spacing={1.5}>
                                              {pos.images.map((img) => (
                                                <Paper key={img.id} variant="outlined" sx={{ p: 2 }}>
                                                  <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <Stack direction="row" spacing={1.5}>
                                                      <Thumb
                                                        label="Original"
                                                        thumbUrl={mediaUrl(`/api/images/${img.id}/thumbnail`, img.uploaded_at)}
                                                        onClick={() => setLightbox({ image: img, variant: 'original' })}
                                                      />
                                                      {img.annotated_path && (
                                                        <Thumb
                                                          label="Annotated"
                                                          thumbUrl={mediaUrl(`/api/images/${img.id}/annotation/thumbnail`, img.annotated_uploaded_at)}
                                                          onClick={() => setLightbox({ image: img, variant: 'annotated' })}
                                                        />
                                                      )}
                                                    </Stack>

                                                    <Box sx={{ flex: 1, minWidth: 220 }}>
                                                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
                                                        <Chip size="small" label={img.image_type} />
                                                        <EvidenceChip status={img.evidence_status} />
                                                        {img.annotated_path && (
                                                          <Chip size="small" icon={<EditRoundedIcon fontSize="small" />} label="Annotated" variant="outlined" color="primary" />
                                                        )}
                                                        {img.sequence > 1 && <Chip size="small" label={`extra #${img.sequence}`} variant="outlined" />}
                                                      </Stack>
                                                      <Typography variant="body2" sx={{ wordBreak: 'break-all', fontWeight: 600 }}>
                                                        {img.image_code}
                                                      </Typography>
                                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                        {img.capture_date} {img.capture_time?.slice(0, 5)}
                                                        {img.original_filename ? ` · ${img.original_filename}` : ''}
                                                      </Typography>
                                                    </Box>
                                                  </Stack>
                                                </Paper>
                                              ))}
                                            </Stack>
                                          </Box>
                                        ))}
                                      </Stack>
                                    </AccordionDetails>
                                  </Accordion>
                                ))}
                              </Stack>
                            </AccordionDetails>
                          </Accordion>
                        ))}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>

      {lightbox && (
        <ImageLightbox
          open
          onClose={() => setLightbox(null)}
          title={`${lightbox.image.image_code || lightbox.image.image_type} — ${lightbox.variant === 'annotated' ? 'Annotated' : 'Original'}`}
          subtitle={`${lightbox.image.capture_date || ''} ${lightbox.image.capture_time?.slice(0, 5) || ''}`.trim()}
          imageUrl={mediaUrl(
            `/api/images/${lightbox.image.id}/${lightbox.variant === 'annotated' ? 'annotation' : 'file'}`,
            lightbox.variant === 'annotated' ? lightbox.image.annotated_uploaded_at : lightbox.image.uploaded_at,
          )}
        />
      )}

      {teamLightbox && (
        <ImageLightbox
          open
          onClose={() => setTeamLightbox(null)}
          title={teamLightbox.team_name || 'Team photo'}
          subtitle={`${teamLightbox.capture_date}${teamLightbox.caption ? ` — ${teamLightbox.caption}` : ''}`}
          imageUrl={mediaUrl(`/api/archive/team-images/${teamLightbox.id}/file`, teamLightbox.uploaded_at)}
        />
      )}

      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Upload team photos</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {uploadError && <Alert severity="error">{uploadError}</Alert>}
            <TextField
              select
              label="Team"
              value={uploadTeamId}
              onChange={(e) => setUploadTeamId(e.target.value)}
              required
              fullWidth
            >
              <MenuItem value="">Choose a team…</MenuItem>
              {teams?.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
              {uploadFiles.length > 0 ? `${uploadFiles.length} file${uploadFiles.length === 1 ? '' : 's'} selected` : 'Choose images'}
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
              />
            </Button>
            <TextField
              label="Caption (optional)"
              value={uploadCaption}
              onChange={(e) => setUploadCaption(e.target.value)}
              fullWidth
              helperText="Applied to every photo in this batch, if given."
            />
            <Typography variant="caption" color="text.secondary">
              Date and location are read automatically from each photo when available, otherwise
              it's filed under today's date with no location.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!uploadTeamId || uploadFiles.length === 0 || uploadMutation.isPending}
            onClick={() => {
              setUploadError(null);
              uploadMutation.mutate(
                { files: uploadFiles, caption: uploadCaption.trim() || undefined },
                {
                  onSuccess: () => {
                    setUploadOpen(false);
                    setTeamFilter(uploadTeamId);
                  },
                  onError: (err) => {
                    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                    setUploadError(typeof detail === 'string' ? detail : 'Could not upload these photos');
                  },
                },
              );
            }}
          >
            {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

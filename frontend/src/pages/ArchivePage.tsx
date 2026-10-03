import { tr, useLanguage, locale } from '../i18n';
import { useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, LinearProgress, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import { teamArchiveImageType, teamArchiveFileKey, teamArchiveRelativePath } from '../utils/teamArchiveUpload';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import CompareRounded from '@mui/icons-material/CompareRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import { DashboardSection } from '../components/DashboardSection';
import UploadFileIcon from '@mui/icons-material/UploadFileRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import PlaceRoundedIcon from '@mui/icons-material/PlaceRounded';
import { useDeleteTeamArchiveImage, useTeamArchiveImages, useTeams, useUploadTeamArchiveImages } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { mediaUrl } from '../api/client';
import { ImageLightbox } from '../components/ImageLightbox';
import { InspectionEvidenceArchive } from '../components/InspectionEvidenceArchive';
import type { TeamArchiveImage } from '../api/types';

const months = [
  '01 - January', '02 - February', '03 - March', '04 - April', '05 - May', '06 - June',
  '07 - July', '08 - August', '09 - September', '10 - October', '11 - November', '12 - December',
];

export function ArchivePage() {
  useLanguage();
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);
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
  const [selectionNotice, setSelectionNotice] = useState('');
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadMutation = useUploadTeamArchiveImages(uploadTeamId ? Number(uploadTeamId) : 0);
  const deleteTeamImage = useDeleteTeamArchiveImage();
  const addUploadFiles = (selected: FileList | null) => {
    const incoming = Array.from(selected || []);
    const accepted = incoming.filter(file => teamArchiveImageType(file));
    setSelectionNotice(incoming.length === accepted.length ? '' : tr('{0} unsupported or empty files skipped. Supported: JPG, PNG, TIFF and WebP.', [incoming.length - accepted.length]));
    setUploadFiles(current => [...new Map([...current, ...accepted].map(file => [teamArchiveFileKey(file), file])).values()]);
    setUploadError(null);
  };
  const uploadGroups = Array.from((teamImages || []).reduce((groups, img) => {
    const date = img.upload_date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(img.uploaded_at.endsWith('Z') ? img.uploaded_at : `${img.uploaded_at}Z`));
    const key = `${date}/${img.team_id}`;
    const group = groups.get(key) || { date, team: img.team_name || tr('Unknown team'), images: [] as TeamArchiveImage[] };
    group.images.push(img); groups.set(key, group); return groups;
  }, new Map<string, { date: string; team: string; images: TeamArchiveImage[] }>()).entries());
  const folderPath = (img: TeamArchiveImage) => {
    const path = (img.relative_path || img.original_filename || '').replaceAll('\\', '/');
    const parts = path.split('/').filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join('/') : tr('Individual images');
  };
  const [teamLightbox, setTeamLightbox] = useState<TeamArchiveImage | null>(null);

  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}><Box sx={{ display: 'grid', placeItems: 'center', p: 1.5, borderRadius: '18px', bgcolor: 'primary.main', color: 'primary.contrastText' }}><PhotoLibraryRounded sx={{ fontSize: 34 }} /></Box><Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>{tr("Image Archive")}</Typography></Stack>
        <Typography color="text.secondary">{tr("Review the full picture: thermal, RGB, annotations and additional evidence for every insulator.")}</Typography>
      </Box>
      <DashboardSection icon={<PhotoLibraryRounded />} title={tr('From field capture to clear evidence')} description={tr('Follow the images from the crew to the tower, then review each insulator in context.')} eyebrow={tr('YOUR EVIDENCE WORKSPACE')} tone="teal">
        <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
          {[
            { icon: <SearchRounded />, title: tr('1 · Find the inspection'), description: tr('Choose a team, tower or saved report. Use dates or search to narrow the collection.'), color: '#a77a29' },
            { icon: <CompareRounded />, title: tr('2 · Compare the evidence'), description: tr('Expand a team, tower and insulator. Compare thermal and RGB images, including extra captures.'), color: '#278095' },
            { icon: <FactCheckRounded />, title: tr('3 · Review the details'), description: tr('Open a thumbnail for a closer view, inspect annotations, or open its linked report.'), color: '#7a68ac' },
          ].map(step => <Paper component="li" variant="outlined" key={step.title} sx={{ p: 2.5, borderRadius: '20px', borderTop: `3px solid ${step.color}` }}>
            <Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: '14px', bgcolor: `${step.color}18`, color: step.color, mb: 2, '& svg': { fontSize: 28 } }}>{step.icon}</Box>
            <Typography sx={{ fontWeight: 800, mb: 1 }}>{step.title}</Typography><Typography variant="body2" color="text.secondary">{step.description}</Typography>
          </Paper>)}
        </Box>
      </DashboardSection>
      <InspectionEvidenceArchive />
      <DashboardSection icon={<GroupsRounded />} title={tr('General team uploads')} description={tr('Site conditions, equipment and handover photos, organized by upload year, month, day and team.')} eyebrow={tr('THE WIDER FIELD PICTURE')} tone="amber" defaultExpanded={false}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{tr("Team photo uploads")}</Typography>
              <Typography variant="body2" color="text.secondary">{tr("Upload individual images or a folder. Both are filed by upload date in Oman time, then team. Original capture dates and GPS stay with each photo.")}</Typography>
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
                  setSelectionNotice('');
                  setUploadProgress({ done: 0, total: 0 });
                  uploadMutation.reset();
                  setUploadOpen(true);
                }}
              >{tr("Upload images")}</Button>
            )}
          </Stack>

          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: '18px', '& .MuiOutlinedInput-root': { borderRadius: '12px', minHeight: 48 } }}>
            <TextField select size="small" label={tr("Team")} slotProps={{ inputLabel: { shrink: true }, input: { startAdornment: <InputAdornment position="start"><GroupsRounded fontSize="small" /></InputAdornment> }, select: { displayEmpty: true, renderValue: () => teams?.find(t => String(t.id) === String(teamFilter))?.name || tr('All teams') } }} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">{tr("All teams")}</MenuItem>
              {teams?.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label={tr("Upload year")} slotProps={{ inputLabel: { shrink: true }, input: { startAdornment: <InputAdornment position="start"><CalendarMonthRounded fontSize="small" /></InputAdornment> }, select: { displayEmpty: true, renderValue: () => teamYear || tr('Any') } }} value={teamYear} onChange={(e) => setTeamYear(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">{tr("Any")}</MenuItem>
              {years.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label={tr("Upload month")} value={teamMonth} onChange={(e) => setTeamMonth(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">{tr("Any")}</MenuItem>
              {months.map((m, i) => (
                <MenuItem key={m} value={i + 1}>
                  {new Date(2000, i, 1).toLocaleString(locale(), { month: 'long' })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={tr("Upload day")}
              type="number"
              value={teamDay}
              onChange={(e) => setTeamDay(e.target.value)}
              sx={{ minWidth: 145 }}
              slotProps={{ htmlInput: { min: 1, max: 31 } }}
            />
          </Stack>

          {(teamFilter || teamYear || teamMonth || teamDay) && <Button startIcon={<RestartAltRounded />} onClick={() => { setTeamFilter(''); setTeamYear(''); setTeamMonth(''); setTeamDay(''); }} sx={{ mb: 2 }}>{tr('Clear filters')}</Button>}
          {teamImagesLoading && <Typography role="status" color="text.secondary">{tr('Loading team photos…')}</Typography>}
          {!teamImagesLoading && teamImages && teamImages.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{tr("No team photos match these filters.")}</Typography>
          )}

          <Stack spacing={1.5}>
            {uploadGroups.map(([key, group]) => <Box key={key}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: '14px' }}>
                <FolderOpenRounded color="primary" /><Typography sx={{ fontWeight: 800 }}>{group.date.split('-').join(' / ')} / {group.team}</Typography><Chip size="small" label={tr('{0} images', [group.images.length])} />
              </Stack>
              <Stack spacing={1.5}>{Array.from(group.images.reduce((folders, img) => {
                const folder = folderPath(img);
                const images = folders.get(folder) || [];
                images.push(img); folders.set(folder, images); return folders;
              }, new Map<string, TeamArchiveImage[]>()).entries()).map(([folder, images]) => <Box key={folder}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, px: 1 }}>
                  <FolderOpenRounded fontSize="small" color="primary" />
                  <Typography variant="body2" sx={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{tr('Folder: {0}', [folder])}</Typography>
                  <Chip size="small" variant="outlined" label={tr('{0} images', [images.length])} />
                </Stack>
                <Stack spacing={1.5}>{images.map((img) => (
              <Paper key={img.id} variant="outlined" sx={{ p: 2, borderRadius: '18px' }}>
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
                      alt={img.original_filename || tr("Team photo")}
                      sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 220 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
                      <Chip size="small" icon={<GroupsRounded />} color="primary" variant="outlined" label={img.team_name || tr("Unknown team")} />
                      {img.latitude != null && img.longitude != null && (
                        <Chip
                          size="small"
                          icon={<PlaceRoundedIcon fontSize="small" />}
                          label={tr("Location")}
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
                      {tr('Uploaded: {0}', [img.upload_date || group.date])}{' · '}{tr('Captured: {0}', [img.capture_date])}
                      {img.uploaded_by_name ? tr(" · uploaded by {0}", [img.uploaded_by_name]) : ''}
                    </Typography>
                    <Chip size="small" variant="outlined" icon={<FolderOpenRounded />} label={img.relative_path || img.original_filename || tr('Individual image')} sx={{ mt: 1, maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }} />
                  </Box>
                  {canUpload && (
                    <Tooltip title={tr("Delete photo")}>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          if (window.confirm(tr("Delete this photo? This cannot be undone."))) deleteTeamImage.mutate(img.id);
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Paper>
                ))}</Stack>
              </Box>)}</Stack></Box>)}
          </Stack>
      </DashboardSection>
      {teamLightbox && (
        <ImageLightbox
          open
          onClose={() => setTeamLightbox(null)}
          title={teamLightbox.team_name || tr("Team photo")}
          subtitle={`${teamLightbox.capture_date}${teamLightbox.caption ? ` — ${teamLightbox.caption}` : ''}`}
          imageUrl={mediaUrl(`/api/archive/team-images/${teamLightbox.id}/file`, teamLightbox.uploaded_at)}
        />
      )}

      <Dialog open={uploadOpen} onClose={() => { if (!uploadMutation.isPending) setUploadOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle>{tr("Upload team photos")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {uploadError && <Alert severity="error">{tr(uploadError)} {tr('Completed batches stay saved. After a connection error, check the archive before retrying.')}</Alert>}
            <Alert severity="info" icon={<FolderOpenRounded />}>{tr('Filed automatically: upload year / month / day / team (Oman time). Capture dates are preserved separately.')}</Alert>
            <TextField
              select
              disabled={uploadMutation.isPending}
              label={tr("Team")}
              value={uploadTeamId}
              onChange={(e) => setUploadTeamId(e.target.value)}
              required
              fullWidth
            >
              <MenuItem value="">{tr("Choose a team…")}</MenuItem>
              {teams?.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button fullWidth variant="outlined" component="label" startIcon={<UploadFileIcon />} disabled={uploadMutation.isPending} sx={{ minHeight: 64, borderRadius: '16px' }}>
                {tr('Choose images')}
                <input aria-label={tr('Choose images')} type="file" accept="image/jpeg,image/png,image/tiff,image/webp,.tif,.tiff" multiple hidden disabled={uploadMutation.isPending} onChange={e => { addUploadFiles(e.target.files); e.target.value = ''; }} />
              </Button>
              <Button fullWidth variant="outlined" component="label" startIcon={<FolderOpenRounded />} disabled={uploadMutation.isPending} sx={{ minHeight: 64, borderRadius: '16px' }}>
                {tr('Choose folder')}
                <input aria-label={tr('Choose folder')} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} disabled={uploadMutation.isPending} onChange={e => { addUploadFiles(e.target.files); e.target.value = ''; }} />
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">{tr('Folder selection includes images in subfolders. You can add more images or folders before uploading.')}</Typography>
            <Alert severity="success" icon={<FolderOpenRounded />}>{tr('The selected folder path is kept with each image so you can trace its original arrangement.')}</Alert>
            {selectionNotice && <Alert severity="warning">{selectionNotice}</Alert>}
            {!!uploadFiles.length && <Paper variant="outlined" sx={{ p: 2, borderRadius: '16px' }}>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}><Typography sx={{ fontWeight: 700 }}>{tr('{0} images selected', [uploadFiles.length])}</Typography><Button size="small" disabled={uploadMutation.isPending} onClick={() => setUploadFiles([])}>{tr('Clear selection')}</Button></Stack>
              <Box sx={{ maxHeight: 190, overflow: 'auto' }}>{uploadFiles.map(file => <Typography key={teamArchiveFileKey(file)} variant="body2" sx={{ py: .5, overflowWrap: 'anywhere' }}><FolderOpenRounded sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: .5 }} />{teamArchiveRelativePath(file)}</Typography>)}</Box>
            </Paper>}
            {uploadMutation.isPending && <Box role="status"><LinearProgress variant="determinate" value={uploadProgress.total ? uploadProgress.done / uploadProgress.total * 100 : 0} /><Typography variant="body2" sx={{ mt: 1 }}>{tr('Uploaded {0} of {1} images. Keep this window open.', [uploadProgress.done, uploadProgress.total])}</Typography></Box>}
            <TextField
              disabled={uploadMutation.isPending}
              label={tr("Caption (optional)")}
              value={uploadCaption}
              onChange={(e) => setUploadCaption(e.target.value)}
              fullWidth
              helperText={tr("Applied to every photo in this batch, if given.")}
            />
            <Typography variant="caption" color="text.secondary">{tr("Images are stored under the upload date. Capture date and location are read from each photo when available.")}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={uploadMutation.isPending} onClick={() => setUploadOpen(false)}>{tr("Cancel")}</Button>
          <Button
            variant="contained"
            disabled={!uploadTeamId || uploadFiles.length === 0 || uploadMutation.isPending}
            onClick={() => {
              setUploadError(null);
              setUploadProgress({ done: 0, total: uploadFiles.length });
              uploadMutation.mutate(
                { files: uploadFiles, caption: uploadCaption.trim() || undefined,
                  onBatchUploaded: (batch, done) => { setUploadProgress(progress => ({ ...progress, done })); setUploadFiles(current => current.slice(batch.length)); }
                },
                {
                  onSuccess: () => {
                    setUploadOpen(false);
                    setTeamFilter(uploadTeamId);
                    setTeamYear(''); setTeamMonth(''); setTeamDay('');
                  },
                  onError: (err) => {
                    const typed = err as { response?: { data?: { detail?: string } } };
                    const detail = typed?.response?.data?.detail;
                    setUploadError(typeof detail === 'string' ? detail : typed?.response ? tr("Could not upload these photos") : tr("The local API is unavailable. Start the local server and try again."));
                  },
                },
              );
            }}
          >
            {uploadMutation.isPending ? tr("Uploading…") : tr("Upload")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

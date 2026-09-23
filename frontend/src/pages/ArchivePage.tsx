import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
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
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadMutation = useUploadTeamArchiveImages(uploadTeamId ? Number(uploadTeamId) : 0);
  const deleteTeamImage = useDeleteTeamArchiveImage();
  const [teamLightbox, setTeamLightbox] = useState<TeamArchiveImage | null>(null);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>Image Archive</Typography>
        <Typography color="text.secondary">Review the full picture: thermal, RGB, annotations and additional evidence for every insulator.</Typography>
      </Box>
      <InspectionEvidenceArchive />
      <Accordion disableGutters slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="h6">General team uploads</Typography></AccordionSummary>
        <AccordionDetails>
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
        </AccordionDetails>
      </Accordion>
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

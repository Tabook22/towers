import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadIcon from '@mui/icons-material/UploadFileRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import SwapHorizIcon from '@mui/icons-material/SwapHorizRounded';
import PlaceIcon from '@mui/icons-material/PlaceRounded';
import { useDeleteVisitPhoto, usePromoteVisitPhoto, useUploadVisitPhoto, useVisitPhotos } from '../api/hooks';
import { mediaUrl } from '../api/client';
import { ImageLightbox } from './ImageLightbox';
import type { Position, VisitPhoto } from '../api/types';

const IMAGE_TYPES = ['TH Full', 'TH Close', 'RGB Full', 'RGB Close'];

const positionLabel = (p: Position) => `${p.ohl} ${p.phase} ${p.string}${p.direction ? ` ${p.direction}` : ''}`;

/** The free-form "drop a photo in, no setup needed" gallery on a visit — separate from the formal
 * Position/Image checklist above (which needs a position + direction + image type picked first).
 * Any signed-in user can upload here, captioned or not; EXIF GPS/timestamp are picked up
 * automatically server-side when present. Lives directly on the visit page — a visit's photos are
 * part of the visit, not a separate place to remember to check.
 *
 * Tagging a photo to an insulator at upload time (optional) groups the gallery by insulator, so
 * it's obvious at a glance which photos belong to which — and a photo here can also be "promoted"
 * straight into that position's official checklist slot: e.g. a closer look turns up a better shot
 * than what was originally uploaded for TH Full, so instead of re-uploading from the camera roll,
 * just point at the one already sitting in this gallery. */
export function VisitPhotosSection({ visitId, positions }: { visitId: number; positions: Position[] }) {
  const { data: photos, isLoading } = useVisitPhotos(visitId);
  const upload = useUploadVisitPhoto(visitId);
  const del = useDeleteVisitPhoto(visitId);
  const promote = usePromoteVisitPhoto(visitId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [uploadPositionId, setUploadPositionId] = useState('');
  const [lightboxPhoto, setLightboxPhoto] = useState<VisitPhoto | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<VisitPhoto | null>(null);
  const [promotePositionId, setPromotePositionId] = useState('');
  const [promoteImageId, setPromoteImageId] = useState('');
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const fileUrl = (p: VisitPhoto) => mediaUrl(`/api/visits/${visitId}/photos/${p.id}/file`, p.uploaded_at);
  const thumbUrl = (p: VisitPhoto) => mediaUrl(`/api/visits/${visitId}/photos/${p.id}/thumbnail`, p.uploaded_at);

  // Only positions with a Direction set can take images — matches the same rule the formal
  // upload flow enforces.
  const usablePositions = positions.filter((p) => p.direction);
  const positionById = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  const groups = useMemo(() => {
    const byPosition = new Map<number, VisitPhoto[]>();
    const ungrouped: VisitPhoto[] = [];
    for (const p of photos || []) {
      if (p.position_id) {
        const list = byPosition.get(p.position_id) || [];
        list.push(p);
        byPosition.set(p.position_id, list);
      } else {
        ungrouped.push(p);
      }
    }
    const sections = Array.from(byPosition.entries())
      .map(([positionId, items]) => ({
        key: String(positionId),
        label: items[0].position_code || (positionById.get(positionId) ? positionLabel(positionById.get(positionId)!) : `Position #${positionId}`),
        items,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (ungrouped.length > 0) sections.push({ key: 'ungrouped', label: 'Ungrouped', items: ungrouped });
    return sections;
  }, [photos, positionById]);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const positionId = uploadPositionId ? Number(uploadPositionId) : undefined;
    Array.from(files).forEach((file) => upload.mutate({ file, caption: captionDraft.trim() || undefined, positionId }));
    setCaptionDraft('');
  };

  const openPromote = (p: VisitPhoto) => {
    setPromoteTarget(p);
    setPromotePositionId(p.position_id ? String(p.position_id) : '');
    setPromoteImageId('');
    setPromoteError(null);
  };

  // The specific checklist slots (type + sequence, e.g. "TH Full — #2 (extra)") available on
  // whichever position is picked above — lets the user replace any existing image, not just the
  // baseline for a type.
  const promotePosition = promotePositionId ? positionById.get(Number(promotePositionId)) : undefined;
  const slotOptions = useMemo(() => {
    if (!promotePosition) return [];
    const typeOrder = (t: string) => IMAGE_TYPES.indexOf(t);
    return [...promotePosition.images]
      .sort((a, b) => typeOrder(a.image_type) - typeOrder(b.image_type) || a.sequence - b.sequence)
      .map((img) => ({
        id: img.id,
        // Lead with the actual generated image code (e.g. ARSD92-OHL1-R-S1-EN-0001, -0001-2) —
        // that's the number printed on each evidence card, so it's what's recognizable at a glance.
        label: `${img.image_code || img.image_type} — ${img.image_type}${img.file_path ? '' : ' — empty'}`,
      }));
  }, [promotePosition]);

  const renderThumb = (p: VisitPhoto) => (
    <Grid key={p.id} size={{ xs: 6, sm: 4, md: 3, lg: 2 }}>
      <Box sx={{ position: 'relative' }}>
        <Box
          component="img"
          src={thumbUrl(p)}
          alt={p.caption || p.original_filename || 'Visit photo'}
          onClick={() => setLightboxPhoto(p)}
          sx={{
            width: '100%',
            aspectRatio: '1 / 1',
            objectFit: 'cover',
            borderRadius: 2,
            cursor: 'pointer',
            border: '1px solid rgba(0,0,0,0.1)',
          }}
        />
        <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 4, right: 4 }}>
          <Tooltip title="Use as a position's official image">
            <IconButton
              size="small"
              onClick={() => openPromote(p)}
              sx={{ bgcolor: 'rgba(255,255,255,0.85)', '&:hover': { bgcolor: 'white' } }}
            >
              <SwapHorizIcon fontSize="small" color="primary" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete photo">
            <IconButton
              size="small"
              onClick={() => {
                if (window.confirm('Delete this photo?')) del.mutate(p.id);
              }}
              sx={{ bgcolor: 'rgba(255,255,255,0.85)', '&:hover': { bgcolor: 'white' } }}
            >
              <DeleteIcon fontSize="small" color="error" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
      {p.caption && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
          {p.caption}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {new Date(p.captured_at || p.uploaded_at).toLocaleString()}
      </Typography>
    </Grid>
  );

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          Photos
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Anything that doesn't fit the position checklist above — an overview shot, a site
          condition, anything worth attaching. Tag a photo to an insulator when uploading to keep the
          gallery grouped by which one it's for. Found a better shot on closer look? Use the swap
          icon to make it a position's official evidence image instead of uploading again.
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Caption (optional)"
            sx={{ flexGrow: 1, minWidth: 160 }}
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="Tag to insulator (optional)"
            sx={{ minWidth: 200 }}
            value={uploadPositionId}
            onChange={(e) => setUploadPositionId(e.target.value)}
          >
            <MenuItem value="">Ungrouped</MenuItem>
            {usablePositions.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {positionLabel(p)}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="contained" startIcon={<UploadIcon />} onClick={() => fileInputRef.current?.click()} sx={{ flexShrink: 0 }}>
            Upload photos
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </Stack>

        {(isLoading || upload.isPending) && <LinearProgress sx={{ mb: 2 }} />}

        {!isLoading && groups.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            No photos uploaded yet.
          </Typography>
        )}

        <Stack spacing={2.5}>
          {groups.map((g) => (
            <Box key={g.key}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                {g.key !== 'ungrouped' && <PlaceIcon fontSize="small" color="action" />}
                <Chip size="small" label={g.label} variant={g.key === 'ungrouped' ? 'outlined' : 'filled'} color={g.key === 'ungrouped' ? 'default' : 'primary'} />
                <Typography variant="caption" color="text.secondary">
                  {g.items.length} photo{g.items.length === 1 ? '' : 's'}
                </Typography>
              </Stack>
              <Grid container spacing={1.5}>
                {g.items.map(renderThumb)}
              </Grid>
              <Divider sx={{ mt: 2.5 }} />
            </Box>
          ))}
        </Stack>
      </CardContent>

      {lightboxPhoto && (
        <ImageLightbox
          open
          onClose={() => setLightboxPhoto(null)}
          title={lightboxPhoto.original_filename || 'Visit photo'}
          imageUrl={fileUrl(lightboxPhoto)}
          subtitle={lightboxPhoto.caption || new Date(lightboxPhoto.captured_at || lightboxPhoto.uploaded_at).toLocaleString()}
        />
      )}

      {promoteTarget && (
        <Dialog open onClose={() => setPromoteTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Use this photo as…</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Box
                component="img"
                src={thumbUrl(promoteTarget)}
                alt="Selected photo"
                sx={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 2, bgcolor: 'grey.100' }}
              />
              {promoteError && <Alert severity="error">{promoteError}</Alert>}
              {usablePositions.length === 0 ? (
                <Alert severity="info">
                  No positions have a Direction set yet — set one on a position above before assigning
                  images to it.
                </Alert>
              ) : (
                <>
                  <TextField
                    select
                    label="Position"
                    size="small"
                    value={promotePositionId}
                    onChange={(e) => {
                      setPromotePositionId(e.target.value);
                      setPromoteImageId('');
                    }}
                  >
                    <MenuItem value="" disabled>
                      Choose a position
                    </MenuItem>
                    {usablePositions.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {positionLabel(p)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="Image to replace"
                    size="small"
                    value={promoteImageId}
                    onChange={(e) => setPromoteImageId(e.target.value)}
                    disabled={!promotePositionId}
                  >
                    <MenuItem value="" disabled>
                      {promotePositionId ? 'Choose which image' : 'Pick a position first'}
                    </MenuItem>
                    {slotOptions.map((opt) => (
                      <MenuItem key={opt.id} value={opt.id}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Typography variant="caption" color="text.secondary">
                    This replaces whatever's in that exact slot. The photo stays here in the gallery
                    afterward too — using it here doesn't remove it.
                  </Typography>
                </>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPromoteTarget(null)}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!promotePositionId || !promoteImageId || promote.isPending}
              onClick={() => {
                setPromoteError(null);
                promote.mutate(
                  { photoId: promoteTarget.id, imageId: Number(promoteImageId) },
                  {
                    onSuccess: () => setPromoteTarget(null),
                    onError: (err: unknown) => {
                      const message =
                        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                        'Could not use this photo for that slot';
                      setPromoteError(message);
                    },
                  },
                );
              }}
            >
              Replace
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Card>
  );
}

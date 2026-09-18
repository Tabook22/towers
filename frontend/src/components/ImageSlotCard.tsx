import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFileRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineRounded';
import RoomIcon from '@mui/icons-material/RoomRounded';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ThermostatIcon from '@mui/icons-material/ThermostatRounded';
import PhotoCameraIcon from '@mui/icons-material/PhotoCameraRounded';
import SwapHorizIcon from '@mui/icons-material/SwapHorizRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import type { ImageRow } from '../api/types';
import { EvidenceChip } from './Badges';
import { MapPicker } from './MapPicker';
import { ImageAnnotator } from './ImageAnnotator';
import { mediaUrl } from '../api/client';
import { ResizableDialogPaper } from './ResizableDialogPaper';
import { useOffline } from '../offline/OfflineProvider';
import { LOCAL_FILE_SENTINEL } from '../offline/types';

interface Props {
  image: ImageRow;
  onUpload: (file: File, meta: { captureDate?: string; captureTime?: string; latitude?: number; longitude?: number }) => void;
  onUpdate: (payload: Partial<ImageRow>) => void;
  onClearFile: () => void;
  onSaveAnnotation: (blob: Blob) => Promise<void> | void;
  annotationSaving?: boolean;
  disabled?: boolean;
  /** Supplied only for sequence > 1 (extra gallery shots) — fully removes the image instead of just
   * clearing its file. Baseline (sequence 1) slots never get this: they're the fixed evidence slot
   * the roll-up counts, so they can only be cleared/replaced, never deleted (see backend §delete_image). */
  onDelete?: () => void;
  /** Re-tags this photo as a different image_type — see backend §retype_image for what happens to
   * the vacated slot (reset to empty if it was a baseline, removed if it was an extra). */
  onRetype?: (newType: string) => void;
  /** The other image types this photo could be moved to (i.e. every type except its own). */
  otherTypes?: string[];
  /** Extras only (sequence > 1): swaps this photo's content with the current primary (sequence 1)
   * image for the same type — the old primary becomes an extra instead of being lost. */
  onMakePrimary?: () => void;
}

export function ImageSlotCard({
  image,
  onUpload,
  onUpdate,
  onClearFile,
  onSaveAnnotation,
  annotationSaving,
  disabled,
  onDelete,
  onRetype,
  otherTypes,
  onMakePrimary,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [annotatorOpen, setAnnotatorOpen] = useState(false);
  const [retypeAnchor, setRetypeAnchor] = useState<HTMLElement | null>(null);
  const isThermal = image.image_type.startsWith('TH');
  const { previewUrlForImage } = useOffline();
  const localPreview = previewUrlForImage(image.id);
  const queuedOnPhone = Boolean(localPreview) || image.file_path === LOCAL_FILE_SENTINEL;

  // Draft locally, commit on blur — native date/time inputs fire onChange per keystroke/segment,
  // and committing each one straight to the API (like the buttons below do, fine for a single
  // discrete click) would trigger a PATCH + full visit refetch per keystroke. Same fix as
  // PositionPanel's Tmax/Tref/notes fields, see the comment there for why local state is safe here.
  const [dateDraft, setDateDraft] = useState(image.capture_date || '');
  const [timeDraft, setTimeDraft] = useState(image.capture_time?.slice(0, 5) || '');
  // A fresh upload can bring EXIF-derived date/time in from the server — resync the draft when
  // that happens (uploaded_at only changes on an actual upload, never on unrelated re-renders).
  useEffect(() => {
    setDateDraft(image.capture_date || '');
    setTimeDraft(image.capture_time?.slice(0, 5) || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.uploaded_at]);

  const handleFile = (file: File | null) => {
    if (!file) return;
    onUpload(file, {
      captureDate: image.capture_date || undefined,
      captureTime: image.capture_time || undefined,
      latitude: image.latitude ?? undefined,
      longitude: image.longitude ?? undefined,
    });
  };

  return (
    <Box
      sx={{
        border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 2,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          height: 130,
          bgcolor: isThermal ? '#241016' : '#0f1c24',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {localPreview || (image.thumbnail_path && image.thumbnail_path !== LOCAL_FILE_SENTINEL) ? (
          <Box
            component="img"
            src={
              localPreview ||
              mediaUrl(
                image.annotated_thumbnail_path
                  ? `/api/images/${image.id}/annotation/thumbnail`
                  : `/api/images/${image.id}/thumbnail`,
                image.annotated_thumbnail_path ? image.annotated_uploaded_at : image.uploaded_at,
              )
            }
            alt={image.image_type}
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Stack spacing={0.5} sx={{ color: 'rgba(255,255,255,0.6)', alignItems: 'center' }}>
            {isThermal ? <ThermostatIcon /> : <PhotoCameraIcon />}
            <Typography variant="caption">No image uploaded</Typography>
          </Stack>
        )}
        {queuedOnPhone && (
          <Chip
            label="On this phone"
            size="small"
            color="warning"
            sx={{ position: 'absolute', bottom: 6, right: 6 }}
          />
        )}
        {image.annotated_path && (
          <Tooltip title="This photo has a marked-up annotation">
            <EditRoundedIcon
              fontSize="small"
              sx={{ position: 'absolute', bottom: 6, left: 6, color: 'white', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))' }}
            />
          </Tooltip>
        )}
        {image.sequence > 1 && (
          <Chip
            label={`extra #${image.sequence}`}
            size="small"
            sx={{ position: 'absolute', top: 6, left: 6, bgcolor: 'rgba(255,255,255,0.85)' }}
          />
        )}
        {image.file_path && image.file_path !== LOCAL_FILE_SENTINEL && (
          <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 6, right: 6 }}>
            <Tooltip title="Enlarge & annotate">
              <IconButton
                size="small"
                onClick={() => setAnnotatorOpen(true)}
                sx={{ bgcolor: 'rgba(255,255,255,0.85)' }}
              >
                <OpenInFullIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {onRetype && otherTypes && otherTypes.length > 0 && (
              <Tooltip title="Change image type">
                <IconButton
                  size="small"
                  onClick={(e) => setRetypeAnchor(e.currentTarget)}
                  sx={{ bgcolor: 'rgba(255,255,255,0.85)' }}
                >
                  <SwapHorizIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onMakePrimary && image.sequence > 1 && (
              <Tooltip title="Make this the chosen image for this slot">
                <IconButton size="small" onClick={onMakePrimary} sx={{ bgcolor: 'rgba(255,255,255,0.85)' }}>
                  <StarRoundedIcon fontSize="small" sx={{ color: '#f5a623' }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Delete image">
              <IconButton size="small" onClick={onDelete || onClearFile} sx={{ bgcolor: 'rgba(255,255,255,0.85)' }}>
                <DeleteOutlineIcon fontSize="small" color="error" />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Box>

      <Box sx={{ p: 1.25 }}>
        <Stack direction="row" sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {image.image_type}
          </Typography>
          <EvidenceChip status={image.evidence_status} />
        </Stack>
        {image.image_code && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, wordBreak: 'break-all' }}>
            {image.image_code}
          </Typography>
        )}

        <Stack spacing={1}>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              type="date"
              label="Capture date"
              value={dateDraft}
              onChange={(e) => setDateDraft(e.target.value)}
              onBlur={() => {
                if (dateDraft !== (image.capture_date || '')) onUpdate({ capture_date: dateDraft });
              }}
              slotProps={{ inputLabel: { shrink: true } }}
              fullWidth
              disabled={disabled}
            />
            <TextField
              size="small"
              type="time"
              label="Capture time"
              value={timeDraft}
              onChange={(e) => setTimeDraft(e.target.value)}
              onBlur={() => {
                const prev = image.capture_time?.slice(0, 5) || '';
                if (timeDraft !== prev) onUpdate({ capture_time: timeDraft ? `${timeDraft}:00` : undefined });
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 60 } }}
              fullWidth
              disabled={disabled}
            />
          </Stack>
          <Button
            size="small"
            variant="text"
            startIcon={<RoomIcon fontSize="small" />}
            onClick={() => setMapOpen(true)}
            disabled={disabled}
          >
            {image.latitude != null ? `${image.latitude.toFixed(5)}, ${image.longitude?.toFixed(5)}` : 'Set GPS location'}
          </Button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
          <Button
            size="small"
            variant="outlined"
            startIcon={<UploadFileIcon fontSize="small" />}
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
          >
            {image.file_path ? 'Replace image' : 'Upload image'}
          </Button>
        </Stack>
      </Box>

      {onRetype && otherTypes && (
        <Menu anchorEl={retypeAnchor} open={!!retypeAnchor} onClose={() => setRetypeAnchor(null)}>
          {otherTypes.map((t) => (
            <MenuItem
              key={t}
              onClick={() => {
                onRetype(t);
                setRetypeAnchor(null);
              }}
            >
              <ListItemIcon>
                <SwapHorizIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Move to {t}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
      )}

      <Dialog open={mapOpen} onClose={() => setMapOpen(false)} maxWidth="sm" fullWidth PaperComponent={ResizableDialogPaper}>
        <DialogTitle>{image.image_type} — capture location</DialogTitle>
        <DialogContent>
          <MapPicker
            latitude={image.latitude}
            longitude={image.longitude}
            onChange={(lat, lng) => onUpdate({ latitude: lat, longitude: lng })}
            height={320}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMapOpen(false)} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>

      {image.file_path && (
        <ImageAnnotator
          open={annotatorOpen}
          onClose={() => setAnnotatorOpen(false)}
          title={`${image.image_type} — ${image.image_code || ''}`}
          imageId={image.id}
          imageUrl={mediaUrl(
            image.annotated_path ? `/api/images/${image.id}/annotation` : `/api/images/${image.id}/file`,
            image.annotated_path ? image.annotated_uploaded_at : image.uploaded_at,
          )}
          originalUrl={
            image.annotated_path ? mediaUrl(`/api/images/${image.id}/file`, image.uploaded_at) : undefined
          }
          saving={annotationSaving}
          onSave={async (blob) => {
            await onSaveAnnotation(blob);
            setAnnotatorOpen(false);
          }}
        />
      )}
    </Box>
  );
}

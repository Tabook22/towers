import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
  Chip,
  Paper,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/FolderRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { useArchive, useTowers } from '../api/hooks';
import { mediaUrl } from '../api/client';
import { EvidenceChip } from '../components/Badges';
import { ImageLightbox } from '../components/ImageLightbox';
import type { ImageRow } from '../api/types';

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

export function ArchivePage() {
  const [year, setYear] = useState<string>('');
  const [month, setMonth] = useState<string>('');
  const [day, setDay] = useState<string>('');
  const [towerId, setTowerId] = useState<string>('');
  const { data: towers } = useTowers({ include_inactive: true });

  const { data: images, isLoading } = useArchive({
    year: year ? Number(year) : undefined,
    month: month ? Number(month) : undefined,
    day: day ? Number(day) : undefined,
    tower_id: towerId ? Number(towerId) : undefined,
  });

  // Which image's original/annotated version is currently enlarged, if any.
  const [lightbox, setLightbox] = useState<{ image: ImageRow; variant: 'original' | 'annotated' } | null>(null);

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Image Archive
        </Typography>
        <Typography color="text.secondary">
          Every upload is auto-filed under year / month / day / tower — browse the archive here.
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
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
        {images?.map((img) => (
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
    </Stack>
  );
}

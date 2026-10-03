import { useState } from 'react';
import { Alert, Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import BrokenImageOutlined from '@mui/icons-material/BrokenImageOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import type { Position } from '../api/types';
import type { DraftImage } from '../api/visitEntry';
import { mediaUrl } from '../api/client';
import { useOffline } from '../offline/OfflineProvider';
import { LOCAL_FILE_SENTINEL } from '../offline/types';
import { positionPhotos } from '../utils/positionGallery';
import { positionLabel } from '../utils/positionChanges';
import { tr, useLanguage } from '../i18n';
import { ImageLightbox } from './ImageLightbox';
import { ThermalProcessButton } from './ThermalProcessButton';

function PreviewImage({ src, alt, thumbnail = false }: { src: string; alt: string; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  return !src || failed ? <Stack sx={{ height: '100%', alignItems: 'center', justifyContent: 'center', color: '#c7d9df', p: .5 }}>
    <BrokenImageOutlined fontSize="small" />{!thumbnail && <Typography>{tr('Image preview unavailable')}</Typography>}
  </Stack> : <Box component="img" src={src} alt={alt} loading={thumbnail ? 'lazy' : 'eager'} onError={() => setFailed(true)}
    sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />;
}

/** Previews and the existing thermal-editor handoff; uploads still use the visit workflow. */
export function PositionImageGallery({ position, stagedImages, showEmpty = false }: {
  position: Position; stagedImages: DraftImage[]; showEmpty?: boolean;
}) {
  useLanguage();
  const { previewUrlForImage } = useOffline();
  const photos = positionPhotos(position, stagedImages);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [annotated, setAnnotated] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const selected = photos.find(p => p.key === selectedKey);
  const index = photos.findIndex(p => p.key === selectedKey);
  const label = positionLabel(position);
  const select = (key: string) => { setSelectedKey(key); setAnnotated(false); setEnlarged(false); };
  const source = (photo: typeof photos[number], thumb = false, annotation = false) => {
    if (photo.draft) return mediaUrl(`/api/visits/${position.visit_id}/entry/images/${photo.draft.id}`);
    const image = photo.image!;
    if (!annotation) {
      const local = previewUrlForImage(image.id);
      if (local) return local;
      if (image.file_path === LOCAL_FILE_SENTINEL) return '';
    }
    return mediaUrl(`/api/images/${image.id}/${annotation ? 'annotation' : thumb && image.thumbnail_path ? 'thumbnail' : 'file'}`, annotation ? image.annotated_uploaded_at : image.uploaded_at);
  };
  const image = selected?.image;
  const thermal = selected?.type === 'TH Full' || selected?.type === 'TH Close';
  const thermalNeedsSync = !!image && (image.file_path === LOCAL_FILE_SENTINEL || !!previewUrlForImage(image.id));
  const detail = (title: string, value: string | number | null | undefined) => <Box key={title}>
    <Typography component="dt" variant="caption" color="text.secondary">{tr(title)}</Typography>
    <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value ?? '—'}</Typography>
  </Box>;
  if (!photos.length) return showEmpty ? <Stack direction="row" spacing={.5} sx={{ minHeight: 72, alignItems: 'center', color: '#52686c' }}>
    <PhotoCameraRounded fontSize="small" /><Typography variant="caption">{tr('No photos for this position yet')}</Typography>
  </Stack> : null;
  return <>
    <Box role="group" aria-label={tr('Position photos: {0}', [label])} sx={{ display: 'flex', gap: .5, overflowX: 'auto', maxWidth: 230, minWidth: 0, minHeight: 72, py: .25 }}>
      {photos.map(photo => <Tooltip key={photo.key} title={`${tr(photo.type)} · ${photo.filename || label} · ${tr(photo.draft ? 'Draft' : photo.reportIncluded ? 'Included in report' : 'Supporting evidence only')}`}>
        <ButtonBase aria-label={tr('Preview {0}: {1}', [tr(photo.type), photo.filename || photo.key])} onClick={() => select(photo.key)}
          sx={{ flexShrink: 0, alignSelf: 'flex-start', display: 'flex', flexDirection: 'column', width: 44, borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: photo.draft ? '#c98b27' : '#a9c4cc', bgcolor: '#eef5f5', '&:focus-visible': { outline: '3px solid #087b88', outlineOffset: 1 } }}>
          <Box sx={{ width: '100%', height: 40, bgcolor: '#10232d', position: 'relative' }}>
            <PreviewImage key={source(photo, true)} src={source(photo, true)} alt={tr(photo.type)} thumbnail />
            {photo.draft && <Box sx={{ position: 'absolute', top: 2, right: 2, width: 7, height: 7, borderRadius: '50%', bgcolor: '#ffc35b' }} />}
          </Box>
          <Typography component="span" sx={{ fontSize: 9, lineHeight: '16px', color: '#193d48', fontWeight: 700, whiteSpace: 'nowrap' }}>{photo.type}</Typography>
        </ButtonBase>
      </Tooltip>)}
    </Box>
    <Dialog open={!!selected} onClose={() => setSelectedKey(null)} fullWidth maxWidth="lg" aria-labelledby={`position-image-title-${position.id}`}>
      {selected && <>
        <DialogTitle id={`position-image-title-${position.id}`} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <PhotoCameraRounded color="primary" sx={{ mt: .5 }} /><Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography component="span" sx={{ display: 'block', fontWeight: 800 }}>{tr('Position image details')} · {tr(selected.type)}</Typography>
            <Typography component="span" variant="body2"><bdi>{label}</bdi></Typography>
          </Box><IconButton aria-label={tr('Close image preview')} onClick={() => setSelectedKey(null)}><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.7fr) minmax(260px, 1fr)' }, gap: 2 }}>
          <Stack spacing={1}>
            <Box sx={{ bgcolor: '#10232d', borderRadius: 2, height: { xs: 260, md: 'min(52vh, 560px)' }, overflow: 'hidden' }}>
              <PreviewImage key={source(selected, false, annotated)} src={source(selected, false, annotated)} alt={`${tr(selected.type)} · ${label}`} />
            </Box>
            <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
              <Button startIcon={<OpenInFullRounded />} onClick={() => setEnlarged(true)} disabled={!source(selected, false, annotated)}>{tr('Enlarge image')}</Button>
              {image?.annotated_path && <Button onClick={() => setAnnotated(!annotated)}>{tr(annotated ? 'View original' : 'View annotation')}</Button>}
            </Stack>
            {thermal && <Stack spacing={1} sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2, alignItems: 'flex-start' }}>
              <ThermalProcessButton key={selected.key} imageId={image?.id ?? 0} disabled={!image?.file_path || !!selected.draft || thermalNeedsSync} />
              <Typography variant="caption" color="text.secondary">{tr(selected.draft
                ? 'Confirm the visit before processing this draft thermal photo.'
                : thermalNeedsSync ? 'Sync this photo before opening the thermal editor.'
                : 'Opens the original image in the thermal app. Save the processed result back as an annotation; the original stays unchanged.')}</Typography>
            </Stack>}
          </Stack>
          <Stack spacing={1.5}>
            <Chip sx={{ alignSelf: 'flex-start' }} color={selected.draft ? 'warning' : 'info'} variant="outlined" label={tr(selected.draft ? 'Draft' : selected.reportIncluded ? 'Included in report' : 'Supporting evidence only')} />
            {selected.draft && <Alert severity="info">{tr('Draft photo. Capture metadata and report selection are available after confirming the visit.')}</Alert>}
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              {detail('Filename', selected.filename)}{detail('Image code', image?.image_code)}
              {detail('Image type', tr(selected.type))}{detail('Evidence status', selected.draft ? tr('Draft') : tr(image?.evidence_status || ''))}
              {detail('Capture date', image?.capture_date)}{detail('Capture time', image?.capture_time)}
              {detail('Latitude', image?.latitude)}{detail('Longitude', image?.longitude)}
              {detail('Uploaded at', image?.uploaded_at)}{detail('File size', image?.file_size != null ? `${(image.file_size / 1024).toFixed(1)} KB` : null)}
            </Box>
            <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Typography variant="subtitle2">{tr('Current position readings')}</Typography>
              <Typography variant="body2"><bdi>Tmax: {position.tmax_c ?? '—'} °C · Tref: {position.tref_c ?? '—'} °C</bdi></Typography>
              <Typography variant="body2"><bdi>ΔT: {position.tmax_c != null && position.tref_c != null ? Math.round((position.tmax_c - position.tref_c) * 100) / 100 : '—'} °C</bdi></Typography>
              <Typography variant="body2">{tr(position.screening_result)}</Typography>
              {position.inspector_notes && <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{position.inspector_notes}</Typography>}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button disabled={index <= 0} onClick={() => select(photos[index - 1].key)}>{tr('Previous image')}</Button>
          <Typography variant="caption">{tr('Image {0} of {1}', [index + 1, photos.length])}</Typography>
          <Button disabled={index >= photos.length - 1} onClick={() => select(photos[index + 1].key)}>{tr('Next image')}</Button>
          <Button onClick={() => setSelectedKey(null)}>{tr('Close')}</Button>
        </DialogActions>
        {enlarged && <ImageLightbox open onClose={() => setEnlarged(false)} title={`${tr(selected.type)} · ${label}`} imageUrl={source(selected, false, annotated)} subtitle={selected.filename || undefined} />}
      </>}
    </Dialog>
  </>;
}

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, Typography } from '@mui/material';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import { useReplaceArchiveImage } from '../api/hooks';
import { mediaUrl } from '../api/client';
import type { ImageRow } from '../api/types';
import { evidenceLabels } from '../utils/archiveEvidence';
import { reportError } from '../utils/reportLibrary';

function CandidatePreview({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <Typography color="white" sx={{ p: 3 }}>This browser cannot preview this file. The server will validate it before saving.</Typography>
    : url && <Box component="img" src={url} alt="Replacement preview" onError={() => setFailed(true)} sx={{ width: '100%', height: 260, objectFit: 'contain' }} />;
}

export function ReplaceEvidenceDialog({ image, onClose, onReplaced }: { image: ImageRow; onClose: () => void; onReplaced: () => void }) {
  const replace = useReplaceArchiveImage();
  const [file, setFile] = useState<File | null>(null);
  const [selection, setSelection] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!file || replace.isPending) return;
    setError(null);
    try { await replace.mutateAsync({ image, file }); onReplaced(); }
    catch (err) { setError(await reportError(err, 'Could not confirm the replacement. Check your connection and refresh the archive before retrying.')); }
  };
  return <Dialog open onClose={() => { if (!replace.isPending) onClose(); }} maxWidth="md" fullWidth aria-labelledby="replace-evidence-title">
    <DialogTitle id="replace-evidence-title">Replace {evidenceLabels[image.image_type]?.toLowerCase() || 'image'}</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2.5}>
        <Box><Typography sx={{ fontWeight: 700 }}>{image.team_name} · {image.tower_code}</Typography><Typography color="text.secondary">{image.ohl} {image.phase} {image.string}{image.direction ? ` — ${image.direction}` : ''}</Typography><Chip size="small" variant="outlined" sx={{ mt: 1 }} label={image.sequence === 1 ? 'Primary report image' : `Supplementary capture ${image.sequence - 1}`} /></Box>
        <Alert severity="info">{image.sequence === 1 ? 'New reports will use the replacement in this same image slot.' : 'This replaces the supplementary capture; the primary report image stays as it is.'} Previously saved report documents keep their original images. Generate a new report to include changes.</Alert>
        {image.annotated_path && <Alert severity="warning">The existing annotation belongs to the current image and will be cleared from this slot. You can annotate the replacement from its inspection page.</Alert>}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2,minmax(0,1fr))' }, gap: 2 }}>
          <Box sx={{ minWidth: 0 }}><Typography variant="subtitle2" sx={{ mb: 1 }}>Current image</Typography><Box sx={{ bgcolor: '#101e28', borderRadius: 2, overflow: 'hidden', height: 260 }}><Box component="img" src={mediaUrl(`/api/images/${image.id}/file`, image.uploaded_at)} alt="Current evidence" sx={{ width: '100%', height: '100%', objectFit: 'contain' }} /></Box><Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{image.original_filename}</Typography></Box>
          <Box sx={{ minWidth: 0 }}><Typography variant="subtitle2" sx={{ mb: 1 }}>Replacement preview</Typography><Box sx={{ bgcolor: '#101e28', borderRadius: 2, overflow: 'hidden', height: 260, display: 'grid', placeItems: 'center' }}>{file ? <CandidatePreview key={selection} url={previewUrl} /> : <Typography color="white" sx={{ p: 3, textAlign: 'center' }}>Choose the clearer image to compare it here.</Typography>}</Box><Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : 'JPEG, PNG, TIFF or WebP'}</Typography></Box>
        </Box>
        <Button component="label" variant="outlined" startIcon={<UploadFileRoundedIcon />} disabled={replace.isPending}>
          {file ? 'Choose another image' : 'Choose replacement image'}
          <input type="file" hidden accept="image/jpeg,image/png,image/tiff,image/x-tiff,image/webp,.tif,.tiff" disabled={replace.isPending} onChange={e => {
            const candidate = e.target.files?.[0]; e.target.value = '';
            if (!candidate) return;
            const type = candidate.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp' } as Record<string,string>)[candidate.name.split('.').pop()?.toLowerCase() || ''];
            if (!['image/jpeg','image/png','image/tiff','image/x-tiff','image/webp'].includes(type)) { setError('Choose a JPEG, PNG, TIFF or WebP image.'); return; }
            setFile(candidate.type ? candidate : new File([candidate], candidate.name, { type })); setPreviewUrl(URL.createObjectURL(candidate)); setSelection(n => n + 1); setError(null);
          }} />
        </Button>
        {replace.isPending && <Box role="status"><LinearProgress /><Typography variant="body2" sx={{ mt: 1 }}>Uploading and saving the replacement…</Typography></Box>}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ p: 2.5 }}><Button disabled={replace.isPending} onClick={onClose}>Cancel</Button><Button variant="contained" startIcon={<SwapHorizRoundedIcon />} disabled={!file || replace.isPending} onClick={() => void save()}>{replace.isPending ? 'Saving…' : 'Replace image'}</Button></DialogActions>
  </Dialog>;
}

import { tr, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import PhotoCameraOutlined from '@mui/icons-material/PhotoCameraOutlined';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import type { DraftImage } from '../api/visitEntry';
import type { Position } from '../api/types';
import { evidenceStatusForPosition, positionError, positionLabel } from '../utils/positionChanges';
import { uniqueEvidenceFiles } from '../utils/evidenceDuplicates';

interface UploadItem { file: File; type: string; baselineId?: number; token: string }

export function PositionEvidenceUpload({ position, types, disabled, onUpload, onExtra, onBusyChange, onStage, stagedImages = [], compact = false }: {
  stagedImages?: DraftImage[];
  compact?: boolean;
  onStage?: (type: string, file: File, token: string) => Promise<unknown>;
  position: Position; types: string[]; disabled?: boolean;
  onUpload: (id: number, file: File, meta: Record<string, unknown>) => Promise<unknown>;
  onExtra: (type: string, file: File, meta: Record<string, unknown>) => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  useLanguage();
  const fileInput = useRef<HTMLInputElement>(null);
  const typeRef = useRef(types[0]);
  const lock = useRef(false);
  const [remaining, setRemaining] = useState<UploadItem[]>([]);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [duplicateCount, setDuplicateCount] = useState(0);
  useEffect(() => {
    if (!remaining.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [remaining.length]);
  const upload = async (items: UploadItem[]) => {
    if (lock.current) return;
    lock.current = true; setUploading(true); setError(''); onBusyChange?.(true);
    let pending = [...items]; setRemaining(pending);
    try {
      while (pending.length) {
        const item = pending[0];
        setProgress(tr("{0} file(s) remaining · {1}", [pending.length, item.file.name]));
        if (onStage) await onStage(item.type, item.file, item.token);
        else if (item.baselineId != null) await onUpload(item.baselineId, item.file, { requestToken: item.token });
        else await onExtra(item.type, item.file, { requestToken: item.token });
        pending = pending.slice(1); setRemaining(pending);
      }
      setProgress(onStage ? tr("Photos uploaded to your draft. They join the report only after you confirm the visit.") : tr("Files uploaded or queued on this device. Check sync status before reporting."));
      onBusyChange?.(false);
    } catch (err) {
      setError(positionError(err, tr("Upload stopped. Unsent files are kept here. Retry or remove them from this upload queue.")));
    } finally { lock.current = false; setUploading(false); }
  };
  return <Stack spacing={1.5}>
    {compact ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><PhotoCameraOutlined sx={{ color: 'primary.main', fontSize: 20 }} /><Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{tr('Photo evidence')}</Typography><Typography variant="caption" color="text.secondary" sx={{ marginInlineStart: 'auto' }}>{tr('Tap to add photos')}</Typography></Stack>
      : <Typography variant="subtitle2">{tr("Add evidence · ")}<bdi dir="ltr">{positionLabel(position)}</bdi></Typography>}
    <Box sx={compact ? { display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1 } : { display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {types.map(type => {
        const images = position.images.filter(i => i.image_type === type && i.file_path);
        const stagedCount = stagedImages.filter(i => i.position_key === position.id && i.image_type === type).length;
        const baseline = position.images.find(i => i.image_type === type && i.sequence === 1);
        const label = stagedCount ? tr("{0} confirmed · {1} draft", [images.length, stagedCount]) : images.length ? tr("{0} image(s)", [images.length]) : evidenceStatusForPosition(position, type, baseline) === 'NOT REQUIRED' ? tr("Optional") : tr("Missing");
        const hasEvidence = images.length + stagedCount > 0;
        return <Button key={type} size="small" variant="outlined" aria-label={`${tr(type)} · ${label}`} sx={compact ? { minHeight: 88, minWidth: 0, px: 1.25, py: 1.5, borderRadius: '12px', borderColor: 'divider', bgcolor: 'background.paper', justifyContent: 'flex-start', textAlign: 'start', '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' } } : { minHeight: 44 }} startIcon={compact ? undefined : <AddPhotoAlternateIcon />} disabled={disabled || uploading || !position.direction || remaining.length > 0}
          onClick={() => { typeRef.current = type; fileInput.current?.click(); }}>
          {compact ? <Stack spacing={.65} sx={{ minWidth: 0 }}>
            {hasEvidence ? <CheckCircleRounded sx={{ fontSize: 20, color: 'success.main' }} /> : <AddPhotoAlternateIcon sx={{ fontSize: 20, color: 'primary.main' }} />}
            <Typography variant="caption" sx={{ fontWeight: 800, lineHeight: 1.25 }}>{tr(({ 'TH Full': 'Thermal · full', 'TH Close': 'Thermal · close', 'RGB Full': 'Visual · full', 'RGB Close': 'Visual · close' } as Record<string, string>)[type] || type)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.25 }}>{label}</Typography>
          </Stack> : <>{tr(type)} · {label}</>}
        </Button>;
      })}
    </Box>
    <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={async e => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      const type = typeRef.current;
      const baseline = position.images.find(i => i.image_type === type && i.sequence === 1 && !i.file_path);
      if (!files.length || lock.current) return;
      const items = (selected: File[]) => selected.map((file, index) => ({ file, type, baselineId: index === 0 ? baseline?.id : undefined, token: crypto.randomUUID() }));
      setDuplicateCount(0); setUploading(true); setRemaining(items(files)); onBusyChange?.(true);
      let selected = files;
      try {
        const existing = [...position.images.filter(i => i.image_type === type && i.file_path), ...stagedImages.filter(i => i.position_key === position.id && i.image_type === type)]
          .map(i => i.checksum).filter((checksum): checksum is string => !!checksum);
        const result = await uniqueEvidenceFiles(files, existing);
        selected = result.files; setDuplicateCount(result.skipped);
      } catch { /* Send the original files if hashing fails; the server still deduplicates them. */ }
      setUploading(false); setRemaining([]);
      if (selected.length) void upload(items(selected));
      else { setProgress(''); onBusyChange?.(false); }
    }} />
    {duplicateCount > 0 && <Alert severity="info">{tr('{0} duplicate file(s) skipped. Existing evidence was preserved.', [duplicateCount])}</Alert>}
    {progress && <Typography variant="caption" role="status">{tr(progress)}</Typography>}
    {error && <Alert severity="error">{tr(error)}<Stack direction="row" spacing={1}><Button disabled={uploading} onClick={() => void upload(remaining)}>{tr("Retry unsent files")}</Button><Button disabled={uploading} onClick={() => { setRemaining([]); setError(''); setProgress(''); onBusyChange?.(false); }}>{tr("Remove unsent files from queue")}</Button></Stack></Alert>}
  </Stack>;
}

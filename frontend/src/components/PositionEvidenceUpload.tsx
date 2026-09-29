import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import type { Position } from '../api/types';
import { positionError, positionLabel } from '../utils/positionChanges';

interface UploadItem { file: File; type: string; baselineId?: number; token: string }

export function PositionEvidenceUpload({ position, types, disabled, onUpload, onExtra, onBusyChange, onStage }: {
  onStage?: (type: string, file: File, token: string) => Promise<unknown>;
  position: Position; types: string[]; disabled?: boolean;
  onUpload: (id: number, file: File, meta: Record<string, unknown>) => Promise<unknown>;
  onExtra: (type: string, file: File, meta: Record<string, unknown>) => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const typeRef = useRef(types[0]);
  const lock = useRef(false);
  const [remaining, setRemaining] = useState<UploadItem[]>([]);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
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
        setProgress(`${pending.length} file(s) remaining · ${item.file.name}`);
        if (onStage) await onStage(item.type, item.file, item.token);
        else if (item.baselineId != null) await onUpload(item.baselineId, item.file, { requestToken: item.token });
        else await onExtra(item.type, item.file, { requestToken: item.token });
        pending = pending.slice(1); setRemaining(pending);
      }
      setProgress(onStage ? 'Photos uploaded to your draft. They join the report only after you confirm the visit.' : 'Files uploaded or queued on this device. Check sync status before reporting.');
      onBusyChange?.(false);
    } catch (err) {
      setError(positionError(err, 'Upload stopped. Unsent files are kept here. Retry or remove them from this upload queue.'));
    } finally { lock.current = false; setUploading(false); }
  };
  return <Stack spacing={1}>
    <Typography variant="subtitle2">Add evidence · {positionLabel(position)}</Typography>
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
      {types.map(type => {
        const images = position.images.filter(i => i.image_type === type && i.file_path);
        const baseline = position.images.find(i => i.image_type === type && i.sequence === 1);
        return <Button key={type} size="small" variant="outlined" startIcon={<AddPhotoAlternateIcon />} disabled={disabled || !position.direction || remaining.length > 0}
          onClick={() => { typeRef.current = type; fileInput.current?.click(); }}>
          {type} · {images.length ? `${images.length} image(s)` : baseline?.evidence_status === 'NOT REQUIRED' ? 'Optional' : 'Missing'}
        </Button>;
      })}
    </Stack>
    <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={e => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      const type = typeRef.current;
      const baseline = position.images.find(i => i.image_type === type && i.sequence === 1 && !i.file_path);
      if (files.length) void upload(files.map((file, index) => ({ file, type, baselineId: index === 0 ? baseline?.id : undefined, token: crypto.randomUUID() })));
    }} />
    {progress && <Typography variant="caption" role="status">{progress}</Typography>}
    {error && <Alert severity="error">{error}<Stack direction="row" spacing={1}><Button disabled={uploading} onClick={() => void upload(remaining)}>Retry unsent files</Button><Button disabled={uploading} onClick={() => { setRemaining([]); setError(''); setProgress(''); onBusyChange?.(false); }}>Remove unsent files from queue</Button></Stack></Alert>}
  </Stack>;
}

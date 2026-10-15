import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { CloudUploadRounded, DeleteOutlineRounded } from '@mui/icons-material';
import { API_BASE_URL } from '../api/client';
import { useReportLogo, useSaveReportLogo } from '../api/reportBranding';
import { tr, useLanguage } from '../i18n';

export function ReportLogoSettings() {
  useLanguage();
  const query = useReportLogo();
  const save = useSaveReportLogo();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const src = preview || (query.data?.logo_url ? new URL(query.data.logo_url, API_BASE_URL).toString() : null);
  const submit = (next: File | null) => {
    setError(''); setNotice('');
    save.mutate(next, {
      onSuccess: () => { setFile(null); setNotice(next ? 'Report logo saved.' : 'Report logo removed.'); },
      onError: () => setError('Could not save the report logo. Please try again.'),
    });
  };
  return <Card><CardContent>
    <Stack spacing={2.5}>
      <Box><Typography variant="h6" sx={{ fontWeight: 700 }}>{tr('Report logo')}</Typography>
        <Typography variant="body2" color="text.secondary">{tr('Show your company logo in the Reports header and customer report headers.')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{tr('This is your organization logo, also used by the sign-in page and organization-branded PDF exports. Previously issued Word and PDF files keep their saved layout.')}</Typography>
      </Box>
      {query.isError && <Alert severity="error" action={<Button onClick={() => void query.refetch()}>{tr('Retry')}</Button>}>{tr('Could not load the report logo.')}</Alert>}
      {error && <Alert severity="error">{tr(error)}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{tr(notice)}</Alert>}
      <Box sx={{ bgcolor: '#fff', border: 1, borderColor: 'divider', borderRadius: 2, width: 220, height: 140, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {src ? <Box component="img" src={src} alt={tr('Company report logo')} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <Typography sx={{ color: '#5a6b78' }}>{tr(query.isLoading ? 'Loading…' : 'No report logo uploaded')}</Typography>}
      </Box>
      <Typography variant="caption" color="text.secondary">{tr('PNG, JPG or WebP, up to 5 MB. The logo keeps its proportions. Transparent PNG is recommended.')}</Typography>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
        const selected = event.target.files?.[0]; event.target.value = '';
        if (!selected) return;
        setError(''); setNotice('');
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)) { setError('Choose a valid PNG, JPG or WebP logo.'); return; }
        if (selected.size > 5 * 1024 * 1024) { setError('Choose a logo smaller than 5 MB.'); return; }
        setFile(selected);
      }} />
      {file && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{file.name}</Typography>}
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" startIcon={<CloudUploadRounded />} disabled={query.isLoading || query.isError || save.isPending} onClick={() => input.current?.click()}>{tr(src ? 'Replace logo' : 'Upload logo')}</Button>
        <Button variant="contained" disabled={!file || save.isPending} onClick={() => submit(file)}>{tr(save.isPending ? 'Saving…' : 'Save report logo')}</Button>
        {file && <Button disabled={save.isPending} onClick={() => setFile(null)}>{tr('Cancel')}</Button>}
        {query.data?.logo_url && <Button color="error" startIcon={<DeleteOutlineRounded />} disabled={save.isPending} onClick={() => submit(null)}>{tr('Remove logo')}</Button>}
      </Stack>
    </Stack>
  </CardContent></Card>;
}

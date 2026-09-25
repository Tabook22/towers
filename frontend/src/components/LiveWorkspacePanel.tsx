import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import DrawRounded from '@mui/icons-material/DrawRounded';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import UndoRounded from '@mui/icons-material/UndoRounded';
import FiberManualRecordRounded from '@mui/icons-material/FiberManualRecordRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { downloadBlob, paintBoard, type BoardMark, type BoardPoint } from '../utils/liveBoard';
import { recordingSupported } from '../utils/liveRecorder';
import { LiveWorkspace } from '../utils/liveWorkspace';

const colors = ['#163e4c', '#de4848', '#197c68', '#346ad4', '#9651b6'];
export function LiveWorkspacePanel({ workspace, state, connected }: { workspace: LiveWorkspace; state: ReturnType<LiveWorkspace['getSnapshot']>; connected: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draft = useRef<BoardMark | null>(null);
  const [color, setColor] = useState(colors[0]);
  const [width, setWidth] = useState(4);
  const [text, setText] = useState('');
  const [tool, setTool] = useState<'pen' | 'text'>('pen');
  const [zoom, setZoom] = useState(100);
  const [remove, setRemove] = useState('');
  const ready = connected && state.ready;
  const attempt = (fn: () => void) => { try { fn(); } catch (e) { workspace.message(e instanceof Error ? e.message : 'Please try again.'); } };
  const paint = useCallback(() => { const ctx = canvas.current?.getContext('2d'); if (ctx) paintBoard(ctx, [...state.marks, ...(draft.current ? [draft.current] : [])], 1000, 527); }, [state.marks]);
  useEffect(paint, [paint]);
  useEffect(() => { if (!ready) { draft.current = null; paint(); } }, [ready, paint]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>): BoardPoint => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Number(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)).toFixed(4)), Number(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)).toFixed(4))];
  };
  const finish = () => { const mark = draft.current; draft.current = null; if (mark && ready) attempt(() => workspace.addMark(mark)); paint(); };
  const phaseLabel = { idle: 'Recording off', requesting: 'Waiting for recording permission', requested: 'Recording permission requested', approved: 'Permission received — ready to record', 'peer-approved': 'Recording approved — waiting to start', recording: 'You are recording', 'peer-recording': 'Your colleague is recording' }[state.phase];
  const isRecording = state.phase === 'recording' || state.phase === 'peer-recording';
  return <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ p: 2, gap: 1.5, bgcolor: 'action.hover', alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
      <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>Work it out together</Typography><Typography variant="body2" color="text.secondary">A shared pad, private documents, and recordings you can keep.</Typography></Box>
      <Chip size="small" color={ready ? 'success' : 'default'} label={ready ? 'Tools connected' : connected ? 'Waiting for colleague’s tools…' : 'Session tools offline'} />
    </Stack>
    <Stack spacing={2} sx={{ p: 2 }}>
      {state.message && <Alert severity="info" onClose={() => workspace.message('')}>{state.message}</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,2fr) minmax(240px,1fr)' }, gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}><DrawRounded color="primary" /><Typography sx={{ fontWeight: 800, flex: 1 }}>Shared drawing pad</Typography><Button size="small" disabled={!state.marks.length} startIcon={<DownloadRounded />} onClick={() => canvas.current?.toBlob(blob => { if (blob) downloadBlob(blob, 'live-help-drawing.png'); })}>Save PNG</Button></Stack>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: .75, alignItems: 'center', mb: 1 }}>
            <Button size="small" variant={tool === 'pen' ? 'contained' : 'outlined'} onClick={() => setTool('pen')} disabled={!ready}>Draw</Button><Button size="small" variant={tool === 'text' ? 'contained' : 'outlined'} onClick={() => setTool('text')} disabled={!ready}>Write</Button>
            {colors.map(c => <Tooltip title={`Ink ${c}`} key={c}><IconButton size="small" aria-label={`Ink ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} sx={{ border: color === c ? '2px solid' : '2px solid transparent', borderColor: color === c ? 'primary.main' : undefined }}><Box sx={{ width: 17, height: 17, bgcolor: c, borderRadius: '50%' }} /></IconButton></Tooltip>)}
            <Button size="small" onClick={() => setWidth(w => w === 2 ? 4 : w === 4 ? 8 : 2)}>Pen {width === 2 ? 'fine' : width === 4 ? 'medium' : 'bold'}</Button>
            <Tooltip title="Undo your last mark"><span><IconButton aria-label="Undo your last mark" disabled={!ready} onClick={() => attempt(() => workspace.undo())}><UndoRounded /></IconButton></span></Tooltip>
            <Button size="small" aria-label="Zoom drawing out" disabled={zoom <= 100} onClick={() => setZoom(z => z - 25)}>−</Button><Typography variant="caption">{zoom}%</Typography><Button size="small" aria-label="Zoom drawing in" disabled={zoom >= 200} onClick={() => setZoom(z => z + 25)}>+</Button>
          </Stack>
          {tool === 'text' && <TextField fullWidth size="small" label="Write a label, then tap the pad to place it" value={text} onChange={e => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 160, dir: 'auto' } }} sx={{ mb: 1 }} />}
          <Box sx={{ overflow: 'auto', borderRadius: 2, border: '1px solid #dad8cf', maxHeight: 500 }}>
            <canvas ref={canvas} width={1000} height={527} aria-label="Shared drawing pad: use Draw or Write, then draw with a mouse, pen or touch" role="img"
              style={{ width: `${zoom}%`, display: 'block', background: '#fffcf5', touchAction: ready ? 'none' : 'auto', cursor: ready ? 'crosshair' : 'default' }}
              onPointerDown={e => {
                if (!ready || e.button !== 0) return;
                const p = point(e); const mark: BoardMark = { id: crypto.randomUUID(), color, width, points: [p] };
                if (tool === 'text') { if (text.trim()) { attempt(() => workspace.addMark({ ...mark, text: text.trim() })); setText(''); } return; }
                e.currentTarget.setPointerCapture(e.pointerId); draft.current = mark; paint();
              }}
              onPointerMove={e => { if (draft.current && draft.current.points.length < 512) { draft.current.points.push(point(e)); paint(); } }}
              onPointerUp={e => { finish(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
              onPointerCancel={() => { draft.current = null; paint(); }} />
          </Box>
          <Typography variant="caption" color="text.secondary">Both people can draw. Each stroke is shared when you lift the pen. Undo removes only your own marks. Save the pad before leaving.</Typography>
        </Box>
        <Stack spacing={1.25} sx={{ minWidth: 0 }}>
          <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}><AttachFileRounded color="primary" /><Typography sx={{ fontWeight: 800 }}>Session documents</Typography></Stack>
          <Button component="label" variant="outlined" disabled={!ready} startIcon={<AttachFileRounded />}>Share a document<input hidden type="file" disabled={!ready} onChange={e => { const f = e.target.files?.[0]; if (f) attempt(() => workspace.offerFile(f)); e.target.value = ''; }} /></Button>
          <Typography variant="caption" color="text.secondary">PDF, Word, spreadsheets, photos and other files. Up to 20 MB each, five per person. Your colleague chooses whether to receive each file.</Typography>
          {!state.files.length && <Box sx={{ p: 3, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}><Typography variant="body2" color="text.secondary">Keep the reference document beside your conversation.</Typography></Box>}
          <Stack spacing={1} sx={{ maxHeight: 320, overflowY: 'auto' }}>{state.files.map(f => <Paper variant="outlined" key={f.id} sx={{ p: 1.5, borderRadius: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{f.name}</Typography><Typography variant="caption" color="text.secondary">{f.own ? 'You sent' : 'From your colleague'} · {(f.size / 1024 / 1024).toFixed(2)} MB</Typography>
            {f.status === 'transferring' && <><LinearProgress variant="determinate" value={f.progress} sx={{ my: 1 }} /><Typography variant="caption">{f.progress}% transferred</Typography></>}
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', mt: .5 }}>
              {f.status === 'offered' && !f.own && <Button size="small" disabled={!ready} onClick={() => attempt(() => workspace.acceptFile(f.id))}>Receive file</Button>}
              {['offered', 'transferring'].includes(f.status) && <Button size="small" disabled={!ready} onClick={() => workspace.cancelFile(f.id)}>{f.own || f.status === 'transferring' ? 'Cancel' : 'Decline'}</Button>}
              {f.status === 'offered' && f.own && <Typography variant="caption">Waiting for acceptance</Typography>}
              {f.blob && <Button size="small" startIcon={<DownloadRounded />} onClick={() => downloadBlob(f.blob!, f.name)}>Download</Button>}
              {f.status === 'ready' && <Chip size="small" color="success" label={f.own ? 'Delivered' : 'Received'} />}
              {['declined', 'failed'].includes(f.status) && <Typography variant="caption" color="text.secondary">{f.status === 'failed' ? 'Transfer interrupted — send again' : 'Declined or cancelled'}</Typography>}
            </Stack>
          </Paper>)}</Stack>
          <Typography variant="caption" color="text.secondary">Documents stay in this session. Download anything you need before a new call or page refresh.</Typography>
        </Stack>
      </Box>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: isRecording ? 'error.main' : 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Box><Typography sx={{ fontWeight: 800 }}><FiberManualRecordRounded sx={{ fontSize: 14, mr: 1, color: isRecording ? 'error.main' : 'text.disabled' }} />{phaseLabel}</Typography><Typography variant="caption" color="text.secondary">Records both shared views, the drawing pad and enabled microphones. Documents and chat text are not included.</Typography></Box>
          {state.phase === 'idle' ? <Tooltip title={recordingSupported() ? 'Ask your colleague before recording' : 'Recording needs a supported browser such as desktop Chrome or Edge'}><span><Button variant="outlined" disabled={!ready || !recordingSupported()} startIcon={<FiberManualRecordRounded />} onClick={() => attempt(() => workspace.requestRecording())}>Request recording</Button></span></Tooltip> : <Stack direction="row" spacing={1}>{state.phase === 'approved' && <Button variant="contained" color="error" onClick={() => attempt(() => workspace.startRecording())}>Start recording</Button>}<Button color="error" startIcon={<StopRounded />} onClick={() => workspace.stopRecording()}>{isRecording ? 'Stop recording' : 'Cancel recording'}</Button></Stack>}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Either person can stop recording. Videos are saved on the recorder’s device for download, up to 20 minutes or 150 MB per recording. Keep this tab open and visible while recording.</Typography>
        {state.recordings.map(r => <Stack key={r.id} direction="row" sx={{ mt: 1.5, p: 1, bgcolor: 'action.hover', borderRadius: 2, alignItems: 'center', gap: 1, flexWrap: 'wrap' }}><Box sx={{ flex: 1, minWidth: 160 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere', fontWeight: 700 }}>Saved session recording</Typography><Typography variant="caption">{(r.blob.size / 1024 / 1024).toFixed(1)} MB · download before refreshing</Typography></Box><Button startIcon={<DownloadRounded />} onClick={() => downloadBlob(r.blob, r.name)}>Download video</Button>{remove === r.id ? <><Button color="error" onClick={() => { workspace.removeRecording(r.id); setRemove(''); }}>Confirm removal</Button><Button onClick={() => setRemove('')}>Keep</Button></> : <Tooltip title="Remove this local recording"><IconButton aria-label="Remove this local recording" onClick={() => setRemove(r.id)}><DeleteOutlineRounded /></IconButton></Tooltip>}</Stack>)}
      </Paper>
    </Stack>
  </Paper>;
}

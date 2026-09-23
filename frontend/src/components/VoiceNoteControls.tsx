import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import MicIcon from '@mui/icons-material/MicRounded';
import StopIcon from '@mui/icons-material/StopRounded';

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<{ isFinal?: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export function VoiceNoteControls({
  disabled,
  saving,
  onRecorded,
  compact = false,
}: {
  disabled?: boolean;
  saving?: boolean;
  compact?: boolean;
  onRecorded: (blob: Blob, durationSeconds: number, liveTranscript: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const mounted = useRef(true);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechRec | null>(null);
  const transcriptRef = useRef('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recRef.current) {
        recRef.current.onstop = null;
        if (recRef.current.state !== 'inactive') recRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      speechRef.current?.stop();
    };
  }, []);

  const stop = () => {
    recRef.current?.stop();
    speechRef.current?.stop();
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = async () => {
    if (starting) return;
    setError(null);
    transcriptRef.current = '';
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio. Type the note instead.');
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' });
        const duration = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
        if (blob.size < 200) {
          setError('Recording was empty — try again closer to the phone.');
          return;
        }
        onRecorded(blob, duration, transcriptRef.current.trim());
      };
      const Ctor = speechCtor();
      if (Ctor) {
        const speech = new Ctor();
        speech.lang = navigator.language || 'en-US';
        speech.continuous = true;
        speech.interimResults = true;
        speech.onresult = (ev) => {
          let text = '';
          for (let i = 0; i < ev.results.length; i += 1) {
            text += ev.results[i][0].transcript;
          }
          transcriptRef.current = text;
        };
        speech.onerror = () => undefined;
        speechRef.current = speech;
        try {
          speech.start();
        } catch {
          speechRef.current = null;
        }
      }
      startedAt.current = Date.now();
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
      rec.start(250);
      setRecording(true);
    } catch {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (timerRef.current) window.clearInterval(timerRef.current);
      setError('Microphone permission denied — allow the mic, or type the note.');
    } finally {
      if (mounted.current) setStarting(false);
    }
  };

  return (
    <Stack spacing={0.5} sx={{ flexShrink: 0 }}>
      {recording && compact ? (
        <Stack sx={{ alignItems: 'center' }}><Tooltip title="Stop and preview recording"><IconButton aria-label="Stop and preview recording" color="error" onClick={stop}><StopIcon /></IconButton></Tooltip><Typography variant="caption" color="error" sx={{ fontSize: 10 }}>{seconds}s</Typography></Stack>
      ) : recording ? (
        <Button
          variant="contained"
          color="error"
          startIcon={<StopIcon />}
          onClick={stop}
          disabled={saving}
        >
          Stop {seconds}s
        </Button>
      ) : compact ? (
        <Tooltip title="Record voice note"><span><IconButton aria-label="Record voice note" onClick={() => void start()} disabled={disabled || saving || starting} color="primary"><MicIcon /></IconButton></span></Tooltip>
      ) : (
        <Button
          variant="outlined"
          startIcon={<MicIcon />}
          onClick={() => void start()}
          disabled={disabled || saving || starting}
        >
          {saving ? 'Saving…' : 'Record'}
        </Button>
      )}
      {recording && !compact && (
        <Chip size="small" color="error" label={compact ? 'Recording… stop to preview' : 'Recording — speak the daily note'} />
      )}
      {error && (
        <Alert severity="warning" onClose={() => setError(null)} sx={{ py: 0 }}>
          <Typography variant="caption">{error}</Typography>
        </Alert>
      )}
    </Stack>
  );
}

export function VoiceNotePlayer({ src, duration }: { src: string; duration: number | null }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
      <audio src={src} controls preload="none" style={{ height: 36, maxWidth: '100%' }} />
      {duration != null && duration > 0 && (
        <Typography variant="caption" color="text.secondary">
          {duration}s
        </Typography>
      )}
    </Stack>
  );
}

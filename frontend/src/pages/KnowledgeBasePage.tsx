import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import DownloadIcon from '@mui/icons-material/DownloadRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import {
  useDeleteKnowledgeDocument,
  useKnowledgeDocuments,
  useTeams,
  useTranscribeForKnowledgeBase,
  useUploadKnowledgeDocument,
} from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { mediaUrl } from '../api/client';
import { VoiceNoteControls } from '../components/VoiceNoteControls';

function formatSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeBasePage() {
  const { user } = useAuth();
  const { data: docs, isLoading } = useKnowledgeDocuments();
  const { data: teams } = useTeams();
  const upload = useUploadKnowledgeDocument();
  const deleteDoc = useDeleteKnowledgeDocument();
  const transcribe = useTranscribeForKnowledgeBase();

  const canManage =
    user?.role === 'reviewer' ||
    user?.role === 'team_leader' ||
    (user?.role === 'admin' && (user.is_super_admin || user.permissions.includes('manage_knowledge_base')));
  const isAdminOrReviewer = user?.role === 'admin' || user?.role === 'reviewer';

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [bodyText, setBodyText] = useState('');
  const [saveAs, setSaveAs] = useState<'txt' | 'pdf'>('txt');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setMode('file');
    setTitle('');
    setDescription('');
    setTeamId('');
    setFile(null);
    setBodyText('');
    setSaveAs('txt');
    setError(null);
  };

  const handleRecorded = (blob: Blob, _duration: number, liveTranscript: string) => {
    setError(null);
    if (liveTranscript.trim()) {
      // The browser's own live speech-to-text already produced text — no need for a round trip.
      setBodyText((prev) => (prev ? `${prev}\n${liveTranscript.trim()}` : liveTranscript.trim()));
      return;
    }
    transcribe.mutate(blob, {
      onSuccess: (data) => setBodyText((prev) => (prev ? `${prev}\n${data.transcript}` : data.transcript)),
      onError: (err: unknown) => {
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(detail || 'Could not transcribe that recording — type the note instead.');
      },
    });
  };

  const submit = () => {
    setError(null);
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (mode === 'file' && !file) {
      setError('Choose a file to upload.');
      return;
    }
    if (mode === 'text' && !bodyText.trim()) {
      setError('Write, paste, or record some text first.');
      return;
    }
    upload.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        team_id: teamId ? Number(teamId) : null,
        file: mode === 'file' ? file || undefined : undefined,
        text_content: mode === 'text' ? bodyText.trim() : undefined,
        save_as: saveAs,
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || 'Could not save this document.');
        },
      },
    );
  };

  const canDelete = (doc: { team_id: number | null }) => {
    if (isAdminOrReviewer) return true;
    if (user?.role === 'team_leader') return doc.team_id === user.team_id;
    return false;
  };

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Knowledge base
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Field reports, incident write-ups, and reference files the help assistant can search when
            answering questions like "has this happened before".
          </Typography>
        </Box>
        {canManage && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            Add document
          </Button>
        )}
      </Stack>

      <TableContainer sx={{ mt: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Team</TableCell>
              <TableCell>Uploaded by</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Size</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(docs || []).map((doc) => (
              <TableRow key={doc.id} hover>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <DescriptionRoundedIcon fontSize="small" color="action" />
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {doc.title}
                      </Typography>
                      {doc.description && (
                        <Typography variant="caption" color="text.secondary">
                          {doc.description}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell>
                  {doc.team_name ? <Chip size="small" label={doc.team_name} /> : <Chip size="small" variant="outlined" label="Company-wide" />}
                </TableCell>
                <TableCell>{doc.uploaded_by_name || '—'}</TableCell>
                <TableCell>{new Date(doc.uploaded_at).toLocaleDateString()}</TableCell>
                <TableCell>{formatSize(doc.file_size)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Download original file">
                    <IconButton size="small" component="a" href={mediaUrl(`/api/knowledge-base/${doc.id}/file`)} target="_blank" rel="noreferrer">
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {canDelete(doc) && (
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => deleteDoc.mutate(doc.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (docs || []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary">
                    No documents yet — upload a field report or incident write-up to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add to knowledge base</DialogTitle>
        <Tabs value={mode} onChange={(_e, v) => setMode(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="file" label="Upload file" />
          <Tab value="text" label="Write / record" />
        </Tabs>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Title" fullWidth autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
            <TextField
              label="Description (optional)"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {isAdminOrReviewer && (
              <TextField select label="Team (optional)" fullWidth value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <MenuItem value="">Company-wide (visible to every team)</MenuItem>
                {(teams || []).map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {user?.role === 'team_leader' && (
              <Alert severity="info">This will be filed under your own team only.</Alert>
            )}

            {mode === 'file' ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.md"
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
                  {file ? file.name : 'Choose file (PDF, Word, .txt, .md)'}
                </Button>
              </>
            ) : (
              <>
                <TextField
                  label="Write or paste the report text"
                  fullWidth
                  multiline
                  minRows={5}
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="Type here, paste from elsewhere, or record your voice below and it'll appear here to review."
                />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <VoiceNoteControls saving={transcribe.isPending} onRecorded={handleRecorded} />
                  {transcribe.isPending && (
                    <Typography variant="caption" color="text.secondary">
                      Transcribing…
                    </Typography>
                  )}
                </Stack>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Save as
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={saveAs}
                    onChange={(_e, v) => v && setSaveAs(v)}
                  >
                    <ToggleButton value="txt">Text file (.txt)</ToggleButton>
                    <ToggleButton value="pdf">PDF</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={upload.isPending}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

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
import EditIcon from '@mui/icons-material/EditRounded';
import DownloadIcon from '@mui/icons-material/DownloadRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  useDeleteKnowledgeDocument,
  useKnowledgeDocumentDetail,
  useKnowledgeDocuments,
  useTeams,
  useTranscribeForKnowledgeBase,
  useUpdateKnowledgeDocument,
  useUploadKnowledgeDocument,
} from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { getPermissionLevel } from '../api/types';
import { mediaUrl } from '../api/client';
import { VoiceNoteControls, VoiceNotePlayer } from '../components/VoiceNoteControls';
import { DocumentPreviewDialog } from '../components/DocumentPreviewDialog';
import { ResizableDialogPaper } from '../components/ResizableDialogPaper';
import { RichTextEditor, type RichTextEditorHandle } from '../components/richtext/RichTextEditor';
import { isRichTextEmpty, plainTextToHtml, stripInlineImageTokens, withInlineImageTokens } from '../components/richtext/htmlUtils';

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

  // Mirrors routers/knowledge_base.py's _can_manage ("add" level lets an admin upload) vs.
  // _can_modify ("full" level to edit/delete an existing document) — reviewer/team_leader are
  // unconditional on the backend for both, same here.
  const kbLevel =
    user?.role === 'admin'
      ? user.is_super_admin
        ? 'full'
        : getPermissionLevel(user.permissions, 'manage_knowledge_base')
      : 'view';
  const canManage = user?.role === 'reviewer' || user?.role === 'team_leader' || kbLevel === 'add' || kbLevel === 'full';
  const canManageFull = user?.role === 'reviewer' || user?.role === 'team_leader' || kbLevel === 'full';
  const isAdminOrReviewer = user?.role === 'admin' || user?.role === 'reviewer';

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [bodyHtml, setBodyHtml] = useState('<p></p>');
  const [saveAs, setSaveAs] = useState<'txt' | 'pdf'>('txt');
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  const reset = () => {
    setMode('file');
    setTitle('');
    setDescription('');
    setTeamId('');
    setFile(null);
    setBodyHtml('<p></p>');
    setSaveAs('txt');
    setVoiceBlob(null);
    setVoiceDuration(null);
    setError(null);
  };

  const handleRecorded = (blob: Blob, duration: number, liveTranscript: string) => {
    setError(null);
    setVoiceBlob(blob);
    setVoiceDuration(duration);
    if (liveTranscript.trim()) {
      // The browser's own live speech-to-text already produced text — no need for a round trip.
      editorRef.current?.appendParagraph(liveTranscript.trim());
      return;
    }
    transcribe.mutate(blob, {
      onSuccess: (data) => editorRef.current?.appendParagraph(data.transcript),
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
    if (mode === 'text' && isRichTextEmpty(bodyHtml)) {
      setError('Write, paste, or record some text first.');
      return;
    }
    upload.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        team_id: teamId ? Number(teamId) : null,
        file: mode === 'file' ? file || undefined : undefined,
        body_html: mode === 'text' ? stripInlineImageTokens(bodyHtml) : undefined,
        save_as: saveAs,
        voice: mode === 'text' ? voiceBlob || undefined : undefined,
        voice_duration_seconds: mode === 'text' ? voiceDuration ?? undefined : undefined,
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

  const canModify = (doc: { team_id: number | null }) => {
    if (user?.role === 'reviewer') return true;
    if (user?.role === 'admin') return canManageFull;
    if (user?.role === 'team_leader') return doc.team_id === user.team_id;
    return false;
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const { data: previewDoc } = useKnowledgeDocumentDetail(previewId);

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
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => setPreviewId(doc.id)}
                  >
                    <DescriptionRoundedIcon fontSize="small" color="action" />
                    <Box>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}>
                          {doc.title}
                        </Typography>
                        {doc.has_voice && (
                          <Tooltip title="Has a voice recording attached">
                            <MicRoundedIcon fontSize="inherit" color="action" />
                          </Tooltip>
                        )}
                      </Stack>
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
                  <Tooltip title="Read">
                    <IconButton size="small" onClick={() => setPreviewId(doc.id)}>
                      <VisibilityRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Download original file">
                    <IconButton size="small" component="a" href={mediaUrl(`/api/knowledge-base/${doc.id}/file`)} target="_blank" rel="noreferrer">
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {canModify(doc) && (
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => setEditingId(doc.id)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {canModify(doc) && (
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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={mode === 'text' ? 'md' : 'xs'}
        fullWidth
        PaperComponent={ResizableDialogPaper}
        slotProps={
          mode === 'text'
            ? { paper: { sx: { width: 760, height: 640, maxWidth: '94vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' } } }
            : undefined
        }
      >
        <DialogTitle>Add to knowledge base</DialogTitle>
        <Tabs value={mode} onChange={(_e, v) => setMode(v)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          <Tab value="file" label="Upload file" />
          <Tab value="text" label="Write / record" />
        </Tabs>
        <DialogContent sx={mode === 'text' ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
          <Stack spacing={2} sx={{ mt: 1, ...(mode === 'text' ? { flex: 1, minHeight: 0 } : {}) }}>
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
                  accept=".pdf,.docx,.txt,.md,image/*,video/*,audio/*"
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
                  {file ? file.name : 'Choose file (PDF, Word, .txt, .md, image, video, or audio)'}
                </Button>
              </>
            ) : (
              <>
                <RichTextEditor ref={editorRef} value={bodyHtml} onChange={setBodyHtml} minHeight={200} placeholder="Type here, paste from elsewhere, or record your voice below and it'll appear here to review." />
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  <VoiceNoteControls saving={transcribe.isPending} onRecorded={handleRecorded} />
                  {transcribe.isPending && (
                    <Typography variant="caption" color="text.secondary">
                      Transcribing…
                    </Typography>
                  )}
                </Stack>
                <Box sx={{ flexShrink: 0 }}>
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

      <EditDocumentDialog
        docId={editingId}
        isAdminOrReviewer={isAdminOrReviewer}
        teams={teams || []}
        onClose={() => setEditingId(null)}
      />

      {previewDoc && (
        <DocumentPreviewDialog
          open={previewId != null}
          onClose={() => setPreviewId(null)}
          title={previewDoc.title}
          docId={previewDoc.id}
          contentType={previewDoc.content_type}
          extractedText={previewDoc.extracted_text}
          bodyHtml={previewDoc.body_html}
          teamName={previewDoc.team_name}
          hasVoice={previewDoc.has_voice}
          voiceDurationSeconds={previewDoc.voice_duration_seconds}
        />
      )}
    </Box>
  );
}

function EditDocumentDialog({
  docId,
  isAdminOrReviewer,
  teams,
  onClose,
}: {
  docId: number | null;
  isAdminOrReviewer: boolean;
  teams: { id: number; name: string }[];
  onClose: () => void;
}) {
  const { data: doc } = useKnowledgeDocumentDetail(docId);
  const update = useUpdateKnowledgeDocument();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState<string>('');
  const [bodyHtml, setBodyHtml] = useState('<p></p>');
  const [saveAs, setSaveAs] = useState<'txt' | 'pdf'>('txt');
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<number | null>(null);

  // Populate the form once when the detail for this doc arrives — not on every refetch, so the
  // admin/leader's in-progress edits aren't clobbered if the query refreshes underneath them.
  if (doc && loadedId !== doc.id) {
    setLoadedId(doc.id);
    setTitle(doc.title);
    setDescription(doc.description || '');
    setTeamId(doc.team_id != null ? String(doc.team_id) : '');
    // An older composed document has no body_html at all — wrap its plain extracted_text into
    // paragraphs so it's immediately editable in the rich editor without losing line breaks.
    setBodyHtml(withInlineImageTokens(doc.body_html || plainTextToHtml(doc.extracted_text || '')));
    setSaveAs(doc.content_type === 'application/pdf' ? 'pdf' : 'txt');
    setError(null);
  }

  const handleClose = () => {
    setLoadedId(null);
    onClose();
  };

  const submit = () => {
    if (!doc) return;
    setError(null);
    if (!title.trim()) {
      setError('Title cannot be empty.');
      return;
    }
    if (doc.is_composed && isRichTextEmpty(bodyHtml)) {
      setError('Text cannot be empty.');
      return;
    }
    update.mutate(
      {
        id: doc.id,
        payload: {
          title: title.trim(),
          description: description.trim(),
          ...(isAdminOrReviewer ? { team_id: teamId ? Number(teamId) : null } : {}),
          ...(doc.is_composed ? { body_html: stripInlineImageTokens(bodyHtml), save_as: saveAs } : {}),
        },
      },
      {
        onSuccess: handleClose,
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || 'Could not save these changes.');
        },
      },
    );
  };

  const wide = !!doc?.is_composed;

  return (
    <Dialog
      open={!!docId}
      onClose={handleClose}
      maxWidth={wide ? 'md' : 'xs'}
      fullWidth
      PaperComponent={ResizableDialogPaper}
      slotProps={
        wide
          ? { paper: { sx: { width: 760, height: 640, maxWidth: '94vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column' } } }
          : undefined
      }
    >
      <DialogTitle>Edit document</DialogTitle>
      <DialogContent sx={wide ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
        {!doc ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            Loading…
          </Typography>
        ) : (
          <Stack spacing={2} sx={{ mt: 1, ...(wide ? { flex: 1, minHeight: 0 } : {}) }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Title" fullWidth value={title} onChange={(e) => setTitle(e.target.value)} />
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
                {teams.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {doc.has_voice && (
              <Box sx={{ flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Original recording
                </Typography>
                <VoiceNotePlayer src={mediaUrl(`/api/knowledge-base/${doc.id}/voice`)} duration={doc.voice_duration_seconds} />
              </Box>
            )}

            {doc.is_composed ? (
              <>
                <RichTextEditor key={doc.id} value={bodyHtml} onChange={setBodyHtml} minHeight={200} />
                <Box sx={{ flexShrink: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Save as
                  </Typography>
                  <ToggleButtonGroup size="small" exclusive value={saveAs} onChange={(_e, v) => v && setSaveAs(v)}>
                    <ToggleButton value="txt">Text file (.txt)</ToggleButton>
                    <ToggleButton value="pdf">PDF</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
              </>
            ) : (
              <Alert severity="info">
                This was uploaded as a file — only the title, description, and team can be edited here. Delete and
                re-upload to change its content.
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!doc || update.isPending}>
          Save changes
        </Button>
      </DialogActions>
    </Dialog>
  );
}

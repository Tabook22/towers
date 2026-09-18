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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import DownloadIcon from '@mui/icons-material/DownloadRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import { useDeleteKnowledgeDocument, useKnowledgeDocuments, useTeams, useUploadKnowledgeDocument } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { mediaUrl } from '../api/client';

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

  const canManage =
    user?.role === 'reviewer' ||
    user?.role === 'team_leader' ||
    (user?.role === 'admin' && (user.is_super_admin || user.permissions.includes('manage_knowledge_base')));
  const isAdminOrReviewer = user?.role === 'admin' || user?.role === 'reviewer';

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [teamId, setTeamId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle('');
    setDescription('');
    setTeamId('');
    setFile(null);
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (!title.trim() || !file) {
      setError('A title and a file are both required.');
      return;
    }
    upload.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        team_id: teamId ? Number(teamId) : null,
        file,
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || 'Could not upload this document.');
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
            Upload document
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
        <DialogTitle>Upload document</DialogTitle>
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
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
              {file ? file.name : 'Choose file (PDF, Word, .txt, .md)'}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={upload.isPending}>
            Upload
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

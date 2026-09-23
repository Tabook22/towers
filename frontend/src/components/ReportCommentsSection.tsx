import { useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useAddReportComment, useReportComments } from '../api/hooks';

function errorDetail(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

const ROLE_LABEL: Record<string, string> = {
  client: 'Customer',
  admin: 'Team',
  reviewer: 'Team',
  team_leader: 'Team',
};

/** The comment thread on one generated report — how a client (customer) login flags something for
 * the internal team to act on, and how the team answers back. Shared by the client portal's report
 * detail dialog and the internal Reports page, since both sides of the conversation need the same
 * read/post UI (see backend models.ReportComment for the access boundary — anyone who can see the
 * report can read and post to it). */
export function ReportCommentsSection({ reportId }: { reportId: number }) {
  const { data: comments, isLoading } = useReportComments(reportId);
  const addComment = useAddReportComment(reportId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    addComment.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (err) => setError(errorDetail(err, 'Could not post this comment.')),
    });
  };

  return (
    <Box>
      {isLoading && <LinearProgress sx={{ mb: 1.5 }} />}
      <Stack spacing={1.25} sx={{ maxHeight: 260, overflowY: 'auto', mb: 1.5, pr: 0.5 }}>
        {(comments || []).map((c) => (
          <Paper
            key={c.id}
            variant="outlined"
            sx={{ p: 1.25, bgcolor: c.author_role === 'client' ? 'action.hover' : 'transparent' }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.25, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ fontWeight: 700 }}>
                {c.author_name}
              </Typography>
              <Chip size="small" variant="outlined" label={ROLE_LABEL[c.author_role] || c.author_role} />
              <Typography variant="caption" color="text.secondary">
                {new Date(c.created_at).toLocaleString()}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {c.body}
            </Typography>
          </Paper>
        ))}
        {!isLoading && (!comments || comments.length === 0) && (
          <Typography variant="body2" color="text.secondary">
            No comments yet.
          </Typography>
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          placeholder="Write a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button variant="contained" onClick={submit} disabled={addComment.isPending || !draft.trim()}>
          Post
        </Button>
      </Stack>
    </Box>
  );
}

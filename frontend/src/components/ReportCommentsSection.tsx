import { tr, useLanguage, locale } from '../i18n';
import { useRef, useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { useAddReportComment, useReportComments } from '../api/hooks';
import { reportTimestamp } from '../utils/reportLibrary';

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
export function ReportCommentsSection({ reportId, active = true }: { reportId: number; active?: boolean }) {
  useLanguage();
  const { data: comments, isLoading, isError, refetch } = useReportComments(reportId, active);
  const addComment = useAddReportComment(reportId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const posting = useRef(false);

  const submit = () => {
    const body = draft.trim();
    if (!body || body.length > 4000 || posting.current) return;
    posting.current = true;
    setError(null);
    addComment.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (err) => setError(errorDetail(err, tr("Could not post this comment."))),
      onSettled: () => { posting.current = false; },
    });
  };

  return (
    <Box>
      {isLoading && <LinearProgress sx={{ mb: 1.5 }} />}
      {isError && <Alert severity="error" action={<Button onClick={() => void refetch()}>{tr('Retry')}</Button>} sx={{ mb: 2 }}>{tr('Could not load report comments.')}</Alert>}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{tr('Ask a question or reference a tower and position. Replies appear here for everyone with access to this report.')}</Typography>
      <Stack spacing={1.25} sx={{ mb: 2 }}>
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
              <Chip size="small" variant="outlined" label={tr(ROLE_LABEL[c.author_role] || c.author_role)} />
              <Typography variant="caption" color="text.secondary">
                {reportTimestamp(c.created_at).toLocaleString(locale())}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {c.body}
            </Typography>
          </Paper>
        ))}
        {!isLoading && !isError && (!comments || comments.length === 0) && (
          <Typography variant="body2" color="text.secondary">{tr("No comments yet.")}</Typography>
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {tr(error)}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          label={tr('Your comment')}
          placeholder={tr("Write a comment…")}
          disabled={addComment.isPending}
          slotProps={{ htmlInput: { maxLength: 4000 } }}
          helperText={`${draft.length.toLocaleString(locale())} / 4,000`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button variant="contained" onClick={submit} disabled={addComment.isPending || !draft.trim()}>{tr("Post")}</Button>
      </Stack>
    </Box>
  );
}

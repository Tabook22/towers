import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import AllInclusiveRoundedIcon from '@mui/icons-material/AllInclusiveRounded';
import BookmarkAddRoundedIcon from '@mui/icons-material/BookmarkAddRounded';
import { useHelpChat, useTeams, useUploadKnowledgeDocument, type HelpChatSearchMode } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import type { HelpChatTurn } from '../api/types';
import { MarkdownLite } from './MarkdownLite';

const GREETING =
  "Hi, I'm the Insulator Inspector Pro help assistant. Ask me anything about your daily routine — " +
  'planning a mission, working the Next-towers queue, doing an inspection, or anything else on ' +
  'the guide below.';

const SUGGESTIONS = [
  'How do I start inspecting a tower?',
  "Why does a tower still say 'Not inspected yet'?",
  'How do I end tonight’s outing?',
];

interface DisplayTurn extends HelpChatTurn {
  error?: boolean;
}

/** Lets an admin/team leader save one Q&A exchange from the chat straight into the knowledge base
 * — reuses the exact same upload endpoint (routers/knowledge_base.py's text_content/save_as path)
 * KnowledgeBasePage's "Write / record" tab uses, so a useful answer doesn't have to be re-typed by
 * hand to keep it. */
function SaveToKnowledgeBaseDialog({
  open,
  onClose,
  question,
  answer,
}: {
  open: boolean;
  onClose: () => void;
  question: string;
  answer: string;
}) {
  const { user } = useAuth();
  const { data: teams } = useTeams(open);
  const upload = useUploadKnowledgeDocument();
  const isAdminOrReviewer = user?.role === 'admin' || user?.role === 'reviewer';

  const [title, setTitle] = useState('');
  const [teamId, setTeamId] = useState<string>('');
  const [saveAs, setSaveAs] = useState<'txt' | 'pdf'>('txt');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(question.slice(0, 80));
    setTeamId('');
    setSaveAs('txt');
    setError(null);
    setSaved(false);
  }, [open, question]);

  const content = `Q: ${question}\n\nA: ${answer}`;

  const submit = () => {
    setError(null);
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    upload.mutate(
      { title: title.trim(), team_id: teamId ? Number(teamId) : null, text_content: content, save_as: saveAs },
      {
        onSuccess: () => setSaved(true),
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || 'Could not save this to the knowledge base.');
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Save to knowledge base</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {saved ? (
            <Alert severity="success">Saved — it's now searchable in the knowledge base.</Alert>
          ) : (
            <>
              <TextField label="Title" fullWidth autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
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
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Save as
                </Typography>
                <ToggleButtonGroup size="small" exclusive value={saveAs} onChange={(_e, v) => v && setSaveAs(v)}>
                  <ToggleButton value="txt">Text file (.txt)</ToggleButton>
                  <ToggleButton value="pdf">PDF</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              <TextField
                label="Preview"
                fullWidth
                multiline
                minRows={4}
                maxRows={8}
                value={content}
                slotProps={{ input: { readOnly: true } }}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{saved ? 'Close' : 'Cancel'}</Button>
        {!saved && (
          <Button variant="contained" onClick={submit} disabled={upload.isPending}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** The actual conversation UI — message list, greeting/suggestions, search-mode control, and the
 * input row. Shared between the full-page embed on the Help page (see HelpChatWidget below) and
 * the floating pop-up launcher available on every page (see FloatingHelpChat.tsx), so there's
 * exactly one place that owns the chat's actual behavior. `listMaxHeight`/`listMinHeight` let each
 * host size the scrollable message area to its own layout. */
export function HelpChatConversation({ listMaxHeight = 360, listMinHeight = 120 }: { listMaxHeight?: number; listMinHeight?: number }) {
  const { user } = useAuth();
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [searchMode, setSearchMode] = useState<HelpChatSearchMode>('local');
  const [saveTarget, setSaveTarget] = useState<{ question: string; answer: string } | null>(null);
  const chat = useHelpChat();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, chat.isPending]);

  const send = (text: string) => {
    const message = text.trim();
    if (!message || chat.isPending) return;
    const history = turns.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    const next: DisplayTurn[] = [...turns, { role: 'user', content: message }];
    setTurns(next);
    setDraft('');
    chat.mutate(
      { message, history, searchMode },
      {
        onSuccess: (data) => {
          setTurns((prev) => [...prev, { role: 'assistant', content: data.reply }]);
        },
        onError: (err) => {
          const detail =
            (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            "Something went wrong reaching the help assistant — please try again.";
          setTurns((prev) => [...prev, { role: 'assistant', content: detail, error: true }]);
        },
      },
    );
  };

  return (
    <>
      <Box
        ref={listRef}
        sx={{
          maxHeight: listMaxHeight,
          minHeight: listMinHeight,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          mb: 1.5,
          pr: 0.5,
        }}
      >
        {turns.length === 0 && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {GREETING}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {SUGGESTIONS.map((s) => (
                <Button key={s} size="small" variant="outlined" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </Stack>
          </Box>
        )}
        {turns.map((t, i) => (
          <Box
            key={i}
            sx={{
              alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              bgcolor: t.error
                ? 'rgba(211,47,47,0.08)'
                : t.role === 'user'
                  ? 'primary.main'
                  : 'rgba(0,0,0,0.04)',
              color: t.role === 'user' && !t.error ? '#fff' : 'text.primary',
              borderRadius: 2,
              px: 1.5,
              py: 1,
            }}
          >
            {t.role === 'user' ? (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {t.content}
              </Typography>
            ) : (
              <>
                <MarkdownLite text={t.content} />
                {!t.error && (
                  <Tooltip title="Save this answer to the knowledge base">
                    <IconButton
                      size="small"
                      sx={{ mt: 0.5, ml: -0.5 }}
                      onClick={() =>
                        setSaveTarget({
                          question: (turns[i - 1]?.role === 'user' && turns[i - 1].content) || 'Question',
                          answer: t.content,
                        })
                      }
                    >
                      <BookmarkAddRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            )}
          </Box>
        ))}
        {chat.isPending && (
          <Box sx={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              Thinking…
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Search
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={searchMode} onChange={(_e, v) => v && setSearchMode(v)}>
          <ToggleButton value="local">
            <Tooltip title="This app's own guide, live data, and knowledge base only — no internet.">
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <StorageRoundedIcon fontSize="small" />
                <span>Local</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="internet">
            <Tooltip title="Only the real internet — none of this app's own data for this message.">
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <PublicRoundedIcon fontSize="small" />
                <span>Internet</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="both">
            <Tooltip title="This app's own data plus the internet.">
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <AllInclusiveRoundedIcon fontSize="small" />
                <span>Both</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          size="small"
          placeholder={`Ask a question, ${user?.full_name || user?.username || 'there'}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          disabled={chat.isPending}
        />
        <Button
          variant="contained"
          endIcon={<SendRoundedIcon />}
          disabled={!draft.trim() || chat.isPending}
          onClick={() => send(draft)}
        >
          Send
        </Button>
      </Stack>

      <SaveToKnowledgeBaseDialog
        open={!!saveTarget}
        onClose={() => setSaveTarget(null)}
        question={saveTarget?.question || ''}
        answer={saveTarget?.answer || ''}
      />
    </>
  );
}

export function HelpChatWidget() {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
          <Avatar sx={{ bgcolor: 'primary.main' }}>
            <SmartToyRoundedIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Ask me anything
            </Typography>
            <Typography variant="body2" color="text.secondary">
              A chat assistant trained on this exact guide — for quick questions while you're out
              in the field.
            </Typography>
          </Box>
        </Stack>
        <HelpChatConversation />
      </CardContent>
    </Card>
  );
}

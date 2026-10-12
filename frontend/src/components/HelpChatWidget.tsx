import { tr, useLanguage } from '../i18n';
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
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import AllInclusiveRoundedIcon from '@mui/icons-material/AllInclusiveRounded';
import BookmarkAddRoundedIcon from '@mui/icons-material/BookmarkAddRounded';
import { useHelpChat, useTeams, useUploadKnowledgeDocument, type HelpChatSearchMode } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import type { HelpChatTurn } from '../api/types';
import { MarkdownLite } from './MarkdownLite';

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
  useLanguage();
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
      setError(tr("A title is required."));
      return;
    }
    upload.mutate(
      { title: title.trim(), team_id: teamId ? Number(teamId) : null, text_content: content, save_as: saveAs },
      {
        onSuccess: () => setSaved(true),
        onError: (err: unknown) => {
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setError(detail || tr("Could not save this to the knowledge base."));
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{tr("Save to knowledge base")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{tr(error)}</Alert>}
          {saved ? (
            <Alert severity="success">{tr("Saved — it's now searchable in the knowledge base.")}</Alert>
          ) : (
            <>
              <TextField label={tr("Title")} fullWidth autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
              {isAdminOrReviewer && (
                <TextField select label={tr("Team (optional)")} fullWidth value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  <MenuItem value="">{tr("Company-wide (visible to every team)")}</MenuItem>
                  {(teams || []).map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {user?.role === 'team_leader' && (
                <Alert severity="info">{tr("This will be filed under your own team only.")}</Alert>
              )}
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{tr("Save as")}</Typography>
                <ToggleButtonGroup size="small" exclusive value={saveAs} onChange={(_e, v) => v && setSaveAs(v)}>
                  <ToggleButton value="txt">{tr("Text file (.txt)")}</ToggleButton>
                  <ToggleButton value="pdf">{tr("PDF")}</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              <TextField
                label={tr("Preview")}
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
        <Button onClick={onClose}>{saved ? tr("Close") : tr("Cancel")}</Button>
        {!saved && (
          <Button variant="contained" onClick={submit} disabled={upload.isPending}>{tr("Save")}</Button>
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
  useLanguage();
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
          gap: 2, flex: 1,
          mb: 2,
          pr: 0.5, scrollbarWidth: 'thin', scrollbarColor: '#9bbbc5 transparent',
        }}
      >
        {turns.length === 0 && (
          <Box sx={{ py: 2, px: 1 }}>
            <Avatar variant="rounded" sx={{ width: 48, height: 48, borderRadius: 3, background: 'linear-gradient(135deg, #12516a, #258a91)', mb: 2 }}><ForumRoundedIcon /></Avatar>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>{tr('How can I help you today?')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{tr('Explore reports, understand findings, or get guidance on your next step.')}</Typography>
            <Typography variant="overline" color="text.secondary">{tr('Try a question')}</Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {(user?.role === 'client' ? ['What do the report summary numbers mean?', 'How do I explore a hotspot in my report?', 'How do I download my Word and PDF reports?'] : SUGGESTIONS).map((s, index) => (
                <Button key={s} size="small" variant="outlined" disabled={chat.isPending} onClick={() => send(tr(s))} sx={{ textAlign: 'start', justifyContent: 'flex-start', px: 1.5, py: 1.25, borderRadius: 2.5, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', borderInlineStart: '3px solid', borderInlineStartColor: ['#258a91','#6487bf','#d7a441'][index], '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' } }}>{tr(s)}</Button>
              ))}
            </Stack>
          </Box>
        )}
        {turns.map((t, i) => (
          <Box
            key={i}
            sx={{
              alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: t.role === 'user' ? '85%' : '94%', overflowWrap: 'anywhere',
              bgcolor: t.error
                ? 'rgba(211,47,47,0.08)'
                : t.role === 'user'
                  ? 'primary.main'
                  : 'background.paper',
              color: t.role === 'user' && !t.error ? '#fff' : 'text.primary',
              borderRadius: t.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px',
              border: '1px solid', borderColor: t.error ? 'error.light' : t.role === 'user' ? 'transparent' : 'divider', boxShadow: '0 3px 12px rgba(16,62,82,.04)',
              px: 2,
              py: 1.5,
            }}
          >
            <Typography variant="caption" sx={{ display: 'block', mb: .75, fontWeight: 750, color: t.role === 'user' ? '#d6eef2' : 'primary.main' }}>{tr(t.role === 'user' ? 'You' : 'Help assistant')}</Typography>
            {t.role === 'user' ? (
              <Typography dir="auto" variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {t.content}
              </Typography>
            ) : (
              <>
                <Box dir="auto"><MarkdownLite text={t.content} /></Box>
                {!t.error && (
                  <Tooltip title={tr("Save this answer to the knowledge base")}>
                    <IconButton
                      size="small"
                      aria-label={tr("Save this answer to the knowledge base")}
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
            <Typography variant="body2" color="text.secondary">{tr("Thinking…")}</Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ mb: 1.5, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>{tr("Search sources")}</Typography>
        <ToggleButtonGroup aria-label={tr("Search sources")} sx={{ bgcolor: 'background.paper', borderRadius: 2.5, '& .MuiToggleButton-root': { gap: .5, px: 1.5, textTransform: 'none' }, '& .Mui-selected': { color: 'primary.main', bgcolor: 'action.selected' } }} size="small" exclusive value={searchMode} onChange={(_e, v) => v && setSearchMode(v)}>
          <ToggleButton value="local">
            <Tooltip title={tr("This app's own guide, live data, and knowledge base only — no internet.")}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <StorageRoundedIcon fontSize="small" />
                <span>{tr("Local")}</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="internet">
            <Tooltip title={tr("Only the real internet — none of this app's own data for this message.")}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <PublicRoundedIcon fontSize="small" />
                <span>{tr("Internet")}</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="both">
            <Tooltip title={tr("This app's own data plus the internet.")}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <AllInclusiveRoundedIcon fontSize="small" />
                <span>{tr("Both")}</span>
              </Stack>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
        <TextField
          fullWidth
          size="small" multiline minRows={1} maxRows={4}
          sx={{ bgcolor: 'background.paper', borderRadius: 3, '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
          slotProps={{ htmlInput: { 'aria-label': tr('Your question') } }}
          placeholder={tr("Ask a question, {0}…", [user?.full_name || user?.username || tr("there")])}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          disabled={chat.isPending}
        />
        <Button
          variant="contained"
          aria-label={tr("Send")}
          sx={{ minWidth: 48, width: 48, height: 44, borderRadius: 3, p: 0, boxShadow: 'none' }}
          disabled={!draft.trim() || chat.isPending}
          onClick={() => send(draft)}
        ><SendRoundedIcon sx={{ transform: theme => theme.direction === 'rtl' ? 'rotate(180deg)' : undefined }} /></Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, flexShrink: 0 }}>{tr('Enter to send · Shift + Enter for a new line')}</Typography>

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
  useLanguage();
  return (
    <Card variant="outlined" sx={{ borderRadius: 4, backgroundImage: 'none' }}>
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
          <Avatar variant="rounded" sx={{ borderRadius: 3, background: 'linear-gradient(135deg, #12516a, #258a91)' }}>
            <ForumRoundedIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{tr("Ask me anything")}</Typography>
            <Typography variant="body2" color="text.secondary">{tr("A chat assistant trained on this exact guide — for quick questions while you're out in the field.")}</Typography>
          </Box>
        </Stack>
        <HelpChatConversation />
      </CardContent>
    </Card>
  );
}

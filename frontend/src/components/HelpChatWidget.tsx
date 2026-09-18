import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useHelpChat } from '../api/hooks';
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

/** The actual conversation UI — message list, greeting/suggestions, and the input row. Shared
 * between the full-page embed on the Help page (see HelpChatWidget below) and the floating
 * pop-up launcher available on every page (see FloatingHelpChat.tsx), so there's exactly one
 * place that owns the chat's actual behavior. `listMaxHeight`/`listMinHeight` let each host size
 * the scrollable message area to its own layout. */
export function HelpChatConversation({ listMaxHeight = 360, listMinHeight = 120 }: { listMaxHeight?: number; listMinHeight?: number }) {
  const { user } = useAuth();
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [useInternet, setUseInternet] = useState(false);
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
      { message, history, useInternet },
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
              <MarkdownLite text={t.content} />
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

      <Tooltip title="Let the assistant also search the internet for this question — off by default, since it can't know your own towers/teams/reports anyway.">
        <FormControlLabel
          sx={{ mb: 0.5, ml: 0 }}
          control={
            <Checkbox
              size="small"
              checked={useInternet}
              onChange={(e) => setUseInternet(e.target.checked)}
              icon={<PublicRoundedIcon fontSize="small" />}
              checkedIcon={<PublicRoundedIcon fontSize="small" color="primary" />}
            />
          }
          label={
            <Typography variant="caption" color="text.secondary">
              Search the internet
            </Typography>
          }
        />
      </Tooltip>

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

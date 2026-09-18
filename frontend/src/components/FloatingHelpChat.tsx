import { useState } from 'react';
import { Box, Fab, IconButton, Paper, Stack, Tooltip, Typography, Zoom } from '@mui/material';
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { HelpChatConversation } from './HelpChatWidget';

/** A "chat bubble" launcher fixed to the bottom-right corner of every page (see Layout.tsx) — the
 * same help assistant as the Help page's embedded widget, always one click away instead of a full
 * page navigation. Purely a UI shell around HelpChatConversation, which owns the actual chat. */
export function FloatingHelpChat() {
  const [open, setOpen] = useState(false);

  return (
    <Box sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (t) => t.zIndex.speedDial }}>
      <Zoom in={open}>
        <Paper
          elevation={6}
          sx={{
            position: 'absolute',
            bottom: 72,
            right: 0,
            width: { xs: 'calc(100vw - 48px)', sm: 380 },
            maxWidth: 380,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: 'center', bgcolor: 'primary.main', color: '#fff', px: 2, py: 1.5 }}
          >
            <SmartToyRoundedIcon />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>Help assistant</Typography>
              <Typography variant="caption" sx={{ opacity: 0.85 }}>
                Ask anything about the app
              </Typography>
            </Box>
            <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: '#fff' }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box sx={{ p: 2 }}>
            <HelpChatConversation listMaxHeight={320} listMinHeight={200} />
          </Box>
        </Paper>
      </Zoom>

      <Tooltip title={open ? 'Close help assistant' : 'Need help? Ask the assistant'} placement="left">
        <Fab color="primary" onClick={() => setOpen((o) => !o)} aria-label="Help assistant">
          {open ? <CloseRoundedIcon /> : <SmartToyRoundedIcon />}
        </Fab>
      </Tooltip>
    </Box>
  );
}

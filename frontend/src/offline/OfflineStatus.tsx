import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import CloudOffIcon from '@mui/icons-material/CloudOffRounded';
import CloudSyncIcon from '@mui/icons-material/CloudSyncRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import { useOffline } from './OfflineProvider';

export function OfflineChip() {
  const { online, pendingCount, syncing, flushNow } = useOffline();
  const [open, setOpen] = useState(false);
  if (online && pendingCount === 0 && !syncing) return null;
  const label = !online
    ? pendingCount
      ? `Offline · ${pendingCount} saved`
      : 'Offline'
    : syncing
      ? `Sending ${pendingCount}…`
      : `${pendingCount} to send`;
  const color = !online ? 'warning' : syncing ? 'info' : 'secondary';
  return (
    <>
      <Tooltip title="Work saved on this phone until there is signal">
        <Chip
          size="small"
          icon={!online ? <CloudOffIcon /> : <CloudSyncIcon />}
          label={label}
          color={color}
          variant={!online ? 'filled' : 'outlined'}
          onClick={() => setOpen(true)}
          sx={{ mr: 1, '& .MuiChip-icon': { color: 'inherit' } }}
        />
      </Tooltip>
      <OfflineQueueDialog open={open} onClose={() => setOpen(false)} onFlush={flushNow} />
    </>
  );
}

function OfflineQueueDialog({
  open,
  onClose,
  onFlush,
}: {
  open: boolean;
  onClose: () => void;
  onFlush: () => Promise<void>;
}) {
  const { items, online, syncing, lastFlushError, discard } = useOffline();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Saved on this phone</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {online
            ? 'These will upload as soon as the server answers. GPS, photos, notes and screening stay here if the link drops.'
            : 'No network. Keep working — everything below is already stored on this device.'}
        </Typography>
        {lastFlushError && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {lastFlushError}
          </Alert>
        )}
        {items.length === 0 ? (
          <Typography variant="body2">Nothing waiting.</Typography>
        ) : (
          <List dense>
            {items.map((item) => (
              <ListItem
                key={item.id}
                secondaryAction={
                  <IconButton edge="end" aria-label="discard" onClick={() => void discard(item.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={item.label}
                  secondary={
                    item.lastError
                      ? item.lastError
                      : new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!online || syncing || items.length === 0} onClick={() => void onFlush()}>
          {syncing ? 'Sending…' : 'Send now'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function OfflineBanner() {
  const { online, pendingCount, syncing } = useOffline();
  if (online && pendingCount === 0) return null;
  if (!online) {
    return (
      <Alert severity="warning" sx={{ borderRadius: 0 }}>
        You are offline. GPS, photos, screening and notes stay on this phone
        {pendingCount ? ` (${pendingCount} waiting)` : ''} and will send when the signal returns.
      </Alert>
    );
  }
  if (syncing || pendingCount > 0) {
    return (
      <Alert severity="info" sx={{ borderRadius: 0 }}>
        {syncing ? `Sending ${pendingCount} saved item${pendingCount === 1 ? '' : 's'} from this phone…` : `${pendingCount} saved item${pendingCount === 1 ? '' : 's'} waiting to send.`}
      </Alert>
    );
  }
  return null;
}

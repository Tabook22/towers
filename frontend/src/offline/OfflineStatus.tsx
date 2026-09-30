import { tr, useLanguage, locale } from '../i18n';
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
  useLanguage();
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
      <Tooltip title={tr("Work saved on this phone until there is signal")}>
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
  useLanguage();
  const { items, online, syncing, lastFlushError, discard } = useOffline();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{tr("Saved on this phone")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {online ? tr("These will upload as soon as the server answers. GPS, photos, notes and screening stay here if the link drops.") : tr("No network. Keep working — everything below is already stored on this device.")}
        </Typography>
        {lastFlushError && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {tr(lastFlushError)}
          </Alert>
        )}
        {items.length === 0 ? (
          <Typography variant="body2">{tr("Nothing waiting.")}</Typography>
        ) : (
          <List dense>
            {items.map((item) => (
              <ListItem
                key={item.id}
                secondaryAction={
                  <IconButton edge="end" aria-label={tr("discard")} onClick={() => void discard(item.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={item.label}
                  secondary={
                    item.lastError
                      ? item.lastError
                      : new Date(item.createdAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tr("Close")}</Button>
        <Button variant="contained" disabled={!online || syncing || items.length === 0} onClick={() => void onFlush()}>
          {syncing ? tr("Sending…") : tr("Send now")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function OfflineBanner() {
  useLanguage();
  const { online, pendingCount, syncing } = useOffline();
  if (online && pendingCount === 0) return null;
  if (!online) {
    return (
      <Alert severity="warning" sx={{ borderRadius: 0 }}>{tr("You are offline. GPS, photos, screening and notes stay on this phone")}{pendingCount ? tr(" ({0} waiting)", [pendingCount]) : ''}{tr(" and will send when the signal returns.")}</Alert>
    );
  }
  if (syncing || pendingCount > 0) {
    return (
      <Alert severity="info" sx={{ borderRadius: 0 }}>
        {syncing ? tr("Sending {0} saved item{1} from this phone…", [pendingCount, pendingCount === 1 ? '' : tr("s")]) : tr("{0} saved item{1} waiting to send.", [pendingCount, pendingCount === 1 ? '' : tr("s")])}
      </Alert>
    );
  }
  return null;
}

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { DashboardTowerRow, TowerWithStats } from '../api/types';
import { TowersOverviewMap } from './TowersOverviewMap';

export function ClaimTowerDialog({
  open,
  onClose,
  freeTowers,
  onClaim,
  claiming,
  error,
}: {
  open: boolean;
  onClose: () => void;
  freeTowers: TowerWithStats[];
  onClaim: (towerId: number) => void;
  claiming?: boolean;
  error?: string | null;
}) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return freeTowers;
    return freeTowers.filter(
      (t) =>
        t.tower_id.toLowerCase().includes(q) ||
        (t.area || '').toLowerCase().includes(q) ||
        (t.line_sector || '').toLowerCase().includes(q),
    );
  }, [freeTowers, search]);

  const mapRows: DashboardTowerRow[] = visible.map((t) => ({
    tower: t,
    latest_visit: null,
    rollup: null,
  }));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add a tower to this team</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          These towers were added by admin and are not assigned to any team. Click a pin on the map
          or a row below — it is assigned to this team immediately and locked until you or an admin
          release it.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        <TextField
          size="small"
          fullWidth
          placeholder="Search tower ID, area, or line"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1.5 }}
        />
        <TowersOverviewMap
          rows={mapRows}
          height={320}
          onTowerClick={(row) => {
            if (!claiming) onClaim(row.tower.id);
          }}
        />
        <Stack spacing={0.5} sx={{ mt: 1.5, maxHeight: 180, overflowY: 'auto' }}>
          {visible.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No free towers match. If every catalog tower is taken, another team must release one,
              or an admin can reassign it.
            </Typography>
          )}
          {visible.map((t) => (
            <Button
              key={t.id}
              size="small"
              variant="outlined"
              disabled={claiming}
              onClick={() => onClaim(t.id)}
              sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
            >
              <strong>{t.tower_id}</strong>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {t.area || '—'}
                {t.line_sector ? ` · ${t.line_sector}` : ''}
                {t.latitude == null ? ' · no GPS' : ''}
              </Typography>
            </Button>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

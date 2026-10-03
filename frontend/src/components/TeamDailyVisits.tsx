import { Button, Chip, Stack, TextField } from '@mui/material';
import DirectionsCarRounded from '@mui/icons-material/DirectionsCarRounded';
import { DashboardSection } from './DashboardSection';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import PlaylistAddRounded from '@mui/icons-material/PlaylistAddRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import PendingActionsRounded from '@mui/icons-material/PendingActionsRounded';
import PhotoLibraryRounded from '@mui/icons-material/PhotoLibraryRounded';
import type { Visit } from '../api/types';
import { dailyVisitProgress } from '../utils/teamTowerWork';
import { tr, useLanguage } from '../i18n';

export function TeamDailyVisits({ visits, date, onDate, onView, onAdd, canAdd }: {
  visits?: Visit[]; date: string; onDate: (date: string) => void; onView: () => void; onAdd: () => void; canAdd: boolean;
}) {
  useLanguage();
  const progress = dailyVisitProgress(visits || [], date);
  const known = visits !== undefined && !!date;
  return <DashboardSection icon={<DirectionsCarRounded />} tone="blue" eyebrow={tr("TODAY’S FIELD VISITS")}
    title={tr('Daily inspection visits')} description={tr('Choose a day, then open a tower below. Confirmed visit totals are shown here.')}><Stack spacing={1.5}>
    <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
      <TextField label={tr('Inspection day')} type="date" size="small" value={date} onChange={event => onDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 170 }} />
    </Stack>
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Chip icon={<CalendarMonthRounded />} label={tr('Visits: {0}', [known ? progress.total : '—'])} />
      <Chip icon={<FactCheckRounded />} color="success" variant="outlined" label={tr('Ready for review: {0}', [known ? progress.ready : '—'])} />
      <Chip icon={<PendingActionsRounded />} variant="outlined" label={tr('Not ready for review: {0}', [known ? progress.incomplete : '—'])} />
      <Chip icon={<PhotoLibraryRounded />} variant="outlined" label={tr('Images pending: {0}', [known && progress.unknown === 0 ? progress.imagesPending : '—'])} />
      {known && progress.unknown > 0 && <Chip label={tr('Progress unavailable: {0}', [progress.unknown])} />}
    </Stack>
    <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Button startIcon={<VisibilityRounded />} disabled={!known} onClick={onView}>{tr('View this day’s visits')}</Button>
      {canAdd && <Button startIcon={<PlaylistAddRounded />} variant="outlined" disabled={!known} onClick={onAdd}>{tr('New / repeat visit')}</Button>}
    </Stack>

  </Stack></DashboardSection>;
}

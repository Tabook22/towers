import { Box, Chip, Stack, Tab, Tabs, Typography } from '@mui/material';
import DirectionsCarRounded from '@mui/icons-material/DirectionsCarRounded';
import EngineeringRounded from '@mui/icons-material/EngineeringRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import { tr, useLanguage } from '../i18n';

const sections = [
  { id: 'planning', title: 'Plan the day', detail: 'Assign towers · order the route · coordinate', icon: DirectionsCarRounded },
  { id: 'work', title: 'Inspect towers', detail: 'Open a visit · enter readings · add evidence', icon: EngineeringRounded },
  { id: 'history', title: 'Review & report', detail: 'Check visits · finish reports · review history', icon: FactCheckRounded },
  { id: 'settings', title: 'Team settings', detail: 'People · logins · team information', icon: SettingsRounded },
];

/** These are working sections, not extra confirmations or claimed completion states. */
export function TeamWorkflowNav({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  useLanguage();
  return <Tabs value={value} onChange={(_, next) => onChange(next)} variant="scrollable" scrollButtons="auto" aria-label={tr('Team sections')}
    sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '22px', p: 1,
      '& .MuiTabs-indicator': { display: 'none' }, '& .MuiTabs-list': { gap: 1 },
      '& .MuiTab-root': { flex: 1, minWidth: 180, maxWidth: 'none', alignItems: 'stretch', textAlign: 'start', borderRadius: '16px', px: 2, py: 2, border: '1px solid transparent', textTransform: 'none', opacity: 1 },
      '& .Mui-selected': { bgcolor: 'action.selected', borderColor: 'primary.main', boxShadow: 'inset 0 3px 0 currentColor' } }}>
    {sections.map((section, index) => <Tab key={section.id} id={`team-tab-${section.id}`} aria-controls={`team-panel-${section.id}`} value={section.id}
      label={<Stack spacing={.8}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {index < 3 ? <Chip size="small" color={value === section.id ? 'primary' : 'default'} label={index + 1} /> : <section.icon fontSize="small" />}
          <Typography variant="body2" sx={{ fontWeight: 800 }}>{tr(section.title)}</Typography>
          {index < 3 && <section.icon sx={{ fontSize: 32, marginInlineStart: 'auto !important' }} />}
        </Stack>
        <Box component="span" sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.5 }}>{tr(section.detail)}</Box>
      </Stack>} />)}
  </Tabs>;
}

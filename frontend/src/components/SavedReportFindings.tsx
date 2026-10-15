import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Checkbox, Stack, Typography } from '@mui/material';
import { PhotoLibraryOutlined } from '@mui/icons-material';
import TransmissionTowerIcon from './TransmissionTowerIcon';
import { apiClient, mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { DigitalFinding } from '../utils/digitalReport';
import { inspectionValue, visitFieldLabels } from '../i18n/inspection';
import { tr } from '../i18n';

const positionLabels: Record<string, string> = {
  position_code: 'Position code', ohl: 'Circuit', phase: 'Phase', string: 'String', direction: 'Direction', view_side: 'Viewing side', mount_type: 'Tower type', string_count: 'String count', gs_side: 'GS side', tower_proximity: 'Tower proximity', installed: 'Installed', manufacturer: 'Manufacturer', year_installed: 'Year installed', insulator_type: 'Insulator type', pollution_condition: 'Pollution condition', tmax_c: 'Tmax (°C)', tref_c: 'Tref (°C)', delta_t: 'ΔT (°C)', severity: 'Severity', screening_result: 'Screening result', thermal_indication: 'Thermal indications', visual_indications: 'Visual indications', confidence: 'Confidence', inspector_notes: 'Inspector notes', area: 'Area', line_sector: 'Line sector', voltage: 'Voltage',
};
const labels = { ...visitFieldLabels, ...positionLabels };
const sections = [
  ['Tower & inspection', ['area', 'line_sector', 'inspection_date', 'inspector_name', 'permit_job_no', 'ambient_temp_c', 'humidity_pct', 'weather_wind', 'electrical_load', 'camera_drone', 'emissivity', 'reflected_temp']],
  ['Insulator details', ['position_code', 'ohl', 'phase', 'mount_type', 'view_side', 'string_count', 'string', 'direction', 'gs_side', 'tower_proximity', 'installed', 'insulator_type', 'manufacturer', 'year_installed', 'pollution_condition']],
  ['Readings & observations', ['tmax_c', 'tref_c', 'delta_t', 'severity', 'screening_result', 'thermal_indication', 'visual_indications', 'confidence', 'inspector_notes']],
] as const;

/** Frozen report data remains readable even when native Word tables cannot be mapped. */
export function SavedReportFindings({ reportId, groups, rows, jumpKey, selected, onSelect, onOpenTower, onOpenFinding, onPhoto }: {
  reportId: number; groups: { name: string; keys: string[] }[]; rows: DigitalFinding[]; jumpKey?: string;
  selected: string[]; onSelect: (key: string, checked: boolean) => void;
  onOpenTower?: (key: string) => void; onOpenFinding?: (key: string) => void;
  onPhoto: (key: string, title: string, images: { src: string; caption: string }[], index: number) => void;
}) {
  const { user } = useAuth();
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const evidence = useQuery({ queryKey: ['digital-report-evidence', user?.id, reportId], queryFn: async () => (await apiClient.get<{ available: string[] }>(`/api/reports/oetc-line-report/${reportId}/digital-evidence`)).data.available });
  const available = new Set(evidence.data || []);
  const rowMap = new Map(rows.map(row => [row.key, row]));
  const signature = JSON.stringify(groups);
  useEffect(() => {
    if (!jumpKey) return;
    const element = Array.from(host.current?.querySelectorAll<HTMLElement>('[data-saved-finding-key]') || []).find(item => item.dataset.savedFindingKey === jumpKey);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [jumpKey, signature]);
  return <Stack ref={host} spacing={2} sx={{ p: { xs: 1, md: 2 }, bgcolor: '#edf1f4' }}>
    <Alert severity="info">{tr('Showing tower details and insulator readings saved with this report.')}</Alert>
    {evidence.isError && <Alert severity="warning" action={<Button onClick={() => void evidence.refetch()}>{tr('Retry')}</Button>}>{tr('Could not load original photographs. The issued report remains available.')}</Alert>}
    {groups.map(group => <Stack spacing={2} key={group.name}>
      {group.name && <Typography variant="h6">{group.name}</Typography>}
      {group.keys.map(key => {
        const row = rowMap.get(key);
        if (!row) return null;
        const title = String(row.fields.tower || tr('Tower'));
        const photos = row.evidence.map((item, index) => ({ key: `${key}:${index}`, caption: item.image_type, src: mediaUrl(`/api/reports/oetc-line-report/${reportId}/digital-evidence/${encodeURIComponent(`${key}:${index}`)}`) })).filter(item => available.has(item.key) && !failed.includes(item.key));
        const value = (field: string) => row.fields[field] == null || row.fields[field] === '' ? tr('Not recorded') : inspectionValue(field, row.fields[field]);
        const check = (field: string, option: string) => `${String(row.fields[field] || '').toLowerCase().split(',').map(item => item.trim()).includes(option.toLowerCase()) ? '☑' : '☐'} ${tr(option)}`;
        const orderedEvidence = row.evidence.map((item, index) => ({ item, index })).sort((a, b) => {
          const rank = (type: string) => ({ 'TH Full': 0, 'TH Close': 1, 'RGB Full': 2, 'RGB Close': 3 } as Record<string, number>)[type] ?? 4;
          return rank(a.item.image_type) - rank(b.item.image_type);
        });
        const photoCell = ({ item, index }: typeof orderedEvidence[number]) => {
          const safeIndex = photos.findIndex(photo => photo.key === `${key}:${index}`);
          const caption = ({ 'TH Full': 'Thermal (Full)', 'TH Close': 'Thermal (Close)', 'RGB Full': 'Visual (Full)', 'RGB Close': 'Visual (Close)' } as Record<string, string>)[item.image_type] || item.image_type;
          return <Box component="td" colSpan={2} key={index} sx={{ verticalAlign: 'top' }}>
            {safeIndex < 0 ? <Stack spacing={1} sx={{ minHeight: { xs: 120, sm: 210 }, p: 2, alignItems: 'center', justifyContent: 'center' }}><PhotoLibraryOutlined sx={{ color: '#777' }} /><Typography variant="caption" sx={{ color: '#555' }}>{tr(evidence.isLoading ? 'Loading photographs' : 'Original photograph unavailable')}</Typography></Stack> : <Button aria-label={tr('Open {0} photograph', [item.image_type])} onClick={() => onPhoto(key, title, photos, safeIndex)} sx={{ p: 0, display: 'block', width: '100%', borderRadius: 0 }}><Box component="img" src={photos[safeIndex].src} alt={item.image_type} loading="lazy" onError={() => setFailed(old => [...old, `${key}:${index}`])} sx={{ display: 'block', width: '100%', height: { xs: 150, sm: 245 }, objectFit: 'contain' }} /></Button>}
            <Box sx={{ fontWeight: 700, pt: .5 }}>{tr(caption)}:</Box>
          </Box>;
        };
        return <Box key={key} component="section" tabIndex={-1} data-saved-finding-key={key} sx={{ scrollMarginTop: 90, outline: jumpKey === key ? '2px solid #27839b' : undefined, p: { xs: 1, md: 2.5 }, width: '100%', maxWidth: 794, mx: 'auto', boxSizing: 'border-box', bgcolor: '#fff', color: '#000', boxShadow: '0 4px 24px #0000001a', fontFamily: 'Arial, sans-serif', fontSize: { xs: 11, sm: 13 }, '& table': { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }, '& td, & th': { border: '1px solid #7f7f7f', p: .6, textAlign: 'start', overflowWrap: 'anywhere' }, '& th, & .report-band': { bgcolor: '#d9eaf7', fontWeight: 700 }, '& .report-band': { fontSize: { xs: 12, sm: 15 } } }}>
          <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1, color: '#10485b' }}>
            <Checkbox checked={selected.includes(key)} onChange={(_, checked) => onSelect(key, checked)} slotProps={{ input: { 'aria-label': `${tr('Select finding')} ${key}` } }} />
            <Typography variant="caption">{tr('Select finding')}</Typography>
            {onOpenTower && <Button size="small" variant="outlined" startIcon={<TransmissionTowerIcon />} onClick={() => onOpenTower(key)} sx={{ ml: 'auto' }}>{tr('Visual tower form')}</Button>}
            {onOpenFinding && <Button size="small" variant="outlined" onClick={() => onOpenFinding(key)}>{tr('View finding and photographs')}</Button>}
          </Stack>
          <Box component="table" aria-label={`${tr('Insulator details')}: ${title}`}>
            <colgroup>{[24, 28, 24, 24].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
            <tbody>
              <tr><td colSpan={4} className="report-band">{row.fields.finding_number ? tr('No. {0}', [row.fields.finding_number]) : tr('Saved position {0}', [key])}</td></tr>
              <tr><td colSpan={4} className="report-band">{tr('Insulator details')}</td></tr>
              <tr><th>{tr('Tower number')}</th><td>{title}</td><th>{tr('Circuit')}</th><td>{check('ohl', 'OHL1')} / {check('ohl', 'OHL2')}</td></tr>
              <tr><th>{tr('Phase')}</th><td>{['R', 'Y', 'B'].map(phase => check('phase', phase)).join(' / ')}</td><th rowSpan={2}>{tr('Configuration')}</th><td rowSpan={2}>{check('mount_type', 'Suspension')} / {check('mount_type', 'Tension')}<br />{row.fields.mount_type === 'Tension' && <>{tr('Direction')}: {value('direction')}<br /></>}{value('string_count')} · {value('string')}<br />{tr('Viewing side')}: {value('view_side')}</td></tr>
              <tr><th>{tr('Insulator type')}</th><td>{check('insulator_type', 'Composite')} / {check('insulator_type', 'Porcelain')}</td></tr>
              <tr><th>{tr('Manufacturer')}</th><td>{value('manufacturer')}</td><th>{tr('Year installed')}</th><td>{value('year_installed')}</td></tr>
              <tr><td colSpan={4} className="report-band">{tr('Image (Thermal / Visual)')}</td></tr>
              {Array.from({ length: Math.ceil(orderedEvidence.length / 2) }, (_, pair) => <tr key={pair}>{orderedEvidence.slice(pair * 2, pair * 2 + 2).map(photoCell)}{orderedEvidence.length % 2 === 1 && pair === Math.floor(orderedEvidence.length / 2) && <td colSpan={2} />}</tr>)}
              {!row.evidence.length && <tr><td colSpan={4}>{tr('No photographs included for this position.')}</td></tr>}
              <tr><td colSpan={4} className="report-band">{tr('Observations')}</td></tr>
              <tr><td colSpan={4}>{['pollution_condition', 'thermal_indication', 'visual_indications', 'inspector_notes'].map(field => <div key={field}><b>{tr(labels[field])}: </b>{value(field)}</div>)}</td></tr>
              <tr><td colSpan={4} className="report-band">{tr('Readings & observations')}</td></tr>
              <tr>{['tmax_c', 'tref_c', 'delta_t', 'severity'].map(field => <th key={field}>{tr(labels[field])}</th>)}</tr>
              <tr>{['tmax_c', 'tref_c', 'delta_t', 'severity'].map(field => <td key={field}>{value(field)}</td>)}</tr>
            </tbody>
          </Box>
          {row.evidence.length > photos.length && !evidence.isLoading && <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#555' }}>{tr('Photographs without a confirmed link are not displayed here.')}</Typography>}
          <Box component="details" sx={{ mt: 1.5 }}><Box component="summary" sx={{ cursor: 'pointer', fontWeight: 700 }}>{tr('Additional saved inspection details')}</Box>
          {sections.map(([heading, fields]) => <Box key={heading} sx={{ my: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, color: '#10485b' }}>{tr(heading)}</Typography>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
              {fields.map(field => <Box key={field} sx={{ p: 1.25, bgcolor: 'action.hover', borderRadius: 1.5, gridColumn: field === 'inspector_notes' ? '1 / -1' : undefined }}>
                <Typography component="dt" variant="caption" sx={{ color: '#555' }}>{tr(labels[field] || field)}</Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, mt: .5, fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value(field)}</Typography>
              </Box>)}
            </Box>
          </Box>)}
          </Box>
        </Box>;
      })}
    </Stack>)}
  </Stack>;
}

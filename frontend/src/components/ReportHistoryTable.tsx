import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { useOetcReportHistory } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { mediaUrl } from '../api/client';
import type { LineInspectionReportOut } from '../api/types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type SortKey = 'created_at' | 'report_number' | 'team_name' | 'line_sector';

/** Every official report ever generated (LineInspectionReport rows the generate endpoints already
 * persist, and — since routers/reports._save_report_file — archive a real .docx for too) so an
 * admin or team leader can see what's already been produced and grab another copy without
 * re-filling the form or risking a report-number collision. Filterable by Year/Month/Line/Team and
 * sortable by clicking a column header — this is the "Reports Library" shown on the dashboard, and
 * (unfiltered by default) the same table embedded in the official-report form. A team leader only
 * ever sees their own team's rows (server-side scoped, same as every other team-scoped list). */
export function ReportHistoryTable() {
  const { data: rows, isLoading } = useOetcReportHistory();
  const { user } = useAuth();
  const isAdminOrReviewer = user?.role === 'admin' || user?.role === 'reviewer';

  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [line, setLine] = useState('');
  const [team, setTeam] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const years = useMemo(
    () => Array.from(new Set((rows || []).map((r) => new Date(r.created_at).getFullYear()))).sort((a, b) => b - a),
    [rows],
  );
  const lines = useMemo(
    () => Array.from(new Set((rows || []).map((r) => r.line_sector).filter((v): v is string => !!v))).sort(),
    [rows],
  );
  const teams = useMemo(
    () => Array.from(new Set((rows || []).map((r) => r.team_name).filter((v): v is string => !!v))).sort(),
    [rows],
  );

  const filtered = (rows || []).filter((r) => {
    const created = new Date(r.created_at);
    if (year && String(created.getFullYear()) !== year) return false;
    if (month && String(created.getMonth()) !== month) return false;
    if (line && r.line_sector !== line) return false;
    if (team && r.team_name !== team) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const va = (sortKey === 'created_at' ? a.created_at : a[sortKey]) || '';
    const vb = (sortKey === 'created_at' ? b.created_at : b[sortKey]) || '';
    const cmp = String(va).localeCompare(String(vb));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'created_at' ? 'desc' : 'asc');
    }
  };

  const downloadUrl = (r: LineInspectionReportOut) =>
    mediaUrl(`/api/reports/oetc-line-report/${r.id}/${r.has_file ? 'file' : 'redownload'}`);

  if (isLoading) return null;
  if (!rows || rows.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        No reports generated yet — they'll show up here once you generate one above.
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', mb: 1.5 }}>
        <TextField select size="small" label="Year" value={year} onChange={(e) => setYear(e.target.value)} sx={{ minWidth: 110 }}>
          <MenuItem value="">All years</MenuItem>
          {years.map((y) => (
            <MenuItem key={y} value={String(y)}>
              {y}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Month" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ minWidth: 130 }}>
          <MenuItem value="">All months</MenuItem>
          {MONTH_NAMES.map((name, i) => (
            <MenuItem key={name} value={String(i)}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        {lines.length > 0 && (
          <TextField select size="small" label="Line" value={line} onChange={(e) => setLine(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="">All lines</MenuItem>
            {lines.map((l) => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </TextField>
        )}
        {isAdminOrReviewer && teams.length > 1 && (
          <TextField select size="small" label="Team" value={team} onChange={(e) => setTeam(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All teams</MenuItem>
            {teams.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel active={sortKey === 'report_number'} direction={sortDir} onClick={() => toggleSort('report_number')}>
                  Report number
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel active={sortKey === 'team_name'} direction={sortDir} onClick={() => toggleSort('team_name')}>
                  Team
                </TableSortLabel>
              </TableCell>
              <TableCell>Scope</TableCell>
              <TableCell>
                <TableSortLabel active={sortKey === 'line_sector'} direction={sortDir} onClick={() => toggleSort('line_sector')}>
                  Line
                </TableSortLabel>
              </TableCell>
              <TableCell>Date range</TableCell>
              <TableCell>
                <TableSortLabel active={sortKey === 'created_at'} direction={sortDir} onClick={() => toggleSort('created_at')}>
                  Generated
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">Download</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell sx={{ fontWeight: 700, wordBreak: 'break-all' }}>{r.report_number}</TableCell>
                <TableCell>{r.team_name || '—'}</TableCell>
                <TableCell>{r.tower_name || 'Whole team campaign'}</TableCell>
                <TableCell>{r.line_sector || '—'}</TableCell>
                <TableCell>{r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}</TableCell>
                <TableCell>
                  <Typography variant="body2">{new Date(r.created_at).toLocaleDateString()}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(r.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    startIcon={<DownloadRoundedIcon fontSize="small" />}
                    component="a"
                    href={downloadUrl(r)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary">
                    No reports match these filters.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

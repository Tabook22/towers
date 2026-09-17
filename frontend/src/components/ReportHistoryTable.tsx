import {
  Alert,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { useOetcReportHistory } from '../api/hooks';
import { mediaUrl } from '../api/client';

/** Every official report ever generated (LineInspectionReport rows the generate endpoints already
 * persist) — so an admin can see what's already been sent to the customer and grab another copy
 * without re-filling the form or risking a report-number collision. A team leader only ever sees
 * their own team's rows (same server-side scoping every other team-scoped list in this app uses). */
export function ReportHistoryTable() {
  const { data: rows, isLoading } = useOetcReportHistory();

  if (isLoading) return null;
  if (!rows || rows.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        No reports generated yet — they'll show up here once you generate one above.
      </Alert>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Report number</TableCell>
            <TableCell>Scope</TableCell>
            <TableCell>Date range</TableCell>
            <TableCell>Generated</TableCell>
            <TableCell align="right">Download</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell sx={{ fontWeight: 700, wordBreak: 'break-all' }}>{r.report_number}</TableCell>
              <TableCell>
                {r.team_name}
                {r.tower_name ? ` — ${r.tower_name}` : ''}
              </TableCell>
              <TableCell>
                {r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}
              </TableCell>
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
                  href={mediaUrl(`/api/reports/oetc-line-report/${r.id}/redownload`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

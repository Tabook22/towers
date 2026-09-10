import {
  Box,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Button,
  LinearProgress,
} from '@mui/material';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import FactCheckIcon from '@mui/icons-material/FactCheckRounded';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import PendingActionsIcon from '@mui/icons-material/PendingActionsRounded';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdfRounded';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAreas, useDashboardSummary } from '../api/hooks';
import { KpiTile } from '../components/KpiTile';
import { TowersOverviewMap } from '../components/TowersOverviewMap';
import { VisitStatusChip } from '../components/Badges';
import { mediaUrl } from '../api/client';

export function DashboardPage() {
  const [area, setArea] = useState<string>('');
  const navigate = useNavigate();
  const { data: areas } = useAreas();
  const { data, isLoading } = useDashboardSummary(area || undefined);

  const reportUrl = mediaUrl(`/api/reports/overall.pdf${area ? `?area=${encodeURIComponent(area)}` : ''}`);

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Overview
          </Typography>
          <Typography color="text.secondary">All towers &amp; latest field visits{area ? ` — ${area}` : ''}</Typography>
        </Box>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All areas</MenuItem>
            {areas?.map((a) => (
              <MenuItem key={a} value={a}>
                {a}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            component="a"
            href={reportUrl}
            target="_blank"
            rel="noreferrer"
          >
            Overall report
          </Button>
        </Stack>
      </Stack>

      {isLoading && <LinearProgress />}

      {data && (
        <>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile label="Towers" value={data.tower_count} icon={<CellTowerIcon />} color="#0d475c" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile label="Visits recorded" value={data.visit_count} icon={<FactCheckIcon />} color="#3a6f84" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile
                label="Open hotspots"
                value={data.total_hotspots}
                icon={<LocalFireDepartmentIcon />}
                color="#d32f2f"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KpiTile
                label="Images pending"
                value={data.total_images_pending}
                icon={<PendingActionsIcon />}
                color="#f57c00"
              />
            </Grid>
          </Grid>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                    Site map
                  </Typography>
                  <TowersOverviewMap rows={data.rows} />
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                    Towers needing attention
                  </Typography>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Tower</TableCell>
                          <TableCell>Area</TableCell>
                          <TableCell align="center">Hotspots</TableCell>
                          <TableCell align="center">Pending</TableCell>
                          <TableCell align="center">Completion</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {[...data.rows]
                          .sort((a, b) => (b.rollup?.hotspots ?? 0) - (a.rollup?.hotspots ?? 0))
                          .map((row) => (
                            <TableRow
                              key={row.tower.id}
                              hover
                              onClick={() => navigate(`/towers/${row.tower.id}`)}
                              sx={{ cursor: 'pointer' }}
                            >
                              <TableCell sx={{ fontWeight: 700 }}>{row.tower.tower_id}</TableCell>
                              <TableCell>{row.tower.area || '-'}</TableCell>
                              <TableCell align="center">{row.rollup?.hotspots ?? '-'}</TableCell>
                              <TableCell align="center">{row.rollup?.images_pending ?? '-'}</TableCell>
                              <TableCell align="center">
                                {row.rollup ? `${row.rollup.completion_pct}%` : '-'}
                              </TableCell>
                              <TableCell>
                                <VisitStatusChip status={row.rollup?.visit_status} />
                              </TableCell>
                            </TableRow>
                          ))}
                        {data.rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} align="center">
                              No towers yet — add one from the Towers page.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </>
      )}
    </Stack>
  );
}

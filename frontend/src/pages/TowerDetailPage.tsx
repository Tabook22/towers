import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddRounded';
import ArrowBackIcon from '@mui/icons-material/ArrowBackRounded';
import CellTowerIcon from '@mui/icons-material/CellTowerRounded';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { useCreateVisit, useDeleteVisit, useTowers, useVisits } from '../api/hooks';
import { mediaUrl } from '../api/client';
import { VisitStatusChip } from '../components/Badges';
import { MapPicker } from '../components/MapPicker';
import { ExpandableImage } from '../components/ExpandableImage';

export function TowerDetailPage() {
  const { towerId } = useParams();
  const id = Number(towerId);
  const navigate = useNavigate();
  const { data: towers } = useTowers({ include_inactive: true });
  const tower = towers?.find((t) => t.id === id);
  const { data: visits, isLoading } = useVisits(id);
  const createVisit = useCreateVisit();
  const deleteVisit = useDeleteVisit();
  const [startingVisit, setStartingVisit] = useState(false);

  const handleDeleteVisit = (visitId: number, dateLabel: string) => {
    if (
      window.confirm(
        `Permanently delete the inspection visit from ${dateLabel}? This removes all its positions, screening results, and images. This cannot be undone.`,
      )
    ) {
      deleteVisit.mutate(visitId);
    }
  };

  useEffect(() => {
    document.title = tower ? `${tower.tower_id} — Insulator Inspector Pro` : 'Insulator Inspector Pro';
  }, [tower]);

  /** A new visit should start pinned at the tower's own saved location — that's the location being
   * inspected, and it's what the office/report expects. Only fall back to the device's live GPS when
   * the tower has no saved coordinates yet, so the visit still gets a sensible starting pin instead of
   * defaulting to nothing. This never blocks visit creation on geolocation succeeding. */
  const getCurrentPositionOrNull = () =>
    new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000 },
      );
    });

  const handleNewVisit = async () => {
    setStartingVisit(true);
    try {
      const hasTowerLocation = tower?.latitude != null && tower?.longitude != null;
      const here = hasTowerLocation ? null : await getCurrentPositionOrNull();
      const visit = await createVisit.mutateAsync({
        tower_id: id,
        inspection_date: new Date().toISOString().slice(0, 10),
        latitude: tower?.latitude ?? here?.latitude ?? undefined,
        longitude: tower?.longitude ?? here?.longitude ?? undefined,
      });
      navigate(`/visits/${visit.id}`);
    } finally {
      setStartingVisit(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/towers')} sx={{ alignSelf: 'flex-start' }}>
        Back to towers
      </Button>

      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              {tower?.tower_id || `Tower #${id}`}
            </Typography>
            {tower && !tower.is_active && <Chip label="Inactive" color="default" size="small" />}
          </Stack>
          <Typography color="text.secondary">
            {tower?.voltage} · {tower?.area || 'No area set'}
            {tower?.tower_type ? ` · ${tower.tower_type}` : ''}
            {tower?.location_name ? ` · ${tower.location_name}` : ''}
            {tower?.height_m != null ? ` · ${tower.height_m} m tall` : ''}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleNewVisit} disabled={startingVisit}>
          {startingVisit ? 'Locating…' : 'New inspection visit'}
        </Button>
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                Tower photo
              </Typography>
              {tower?.photo_path ? (
                <ExpandableImage
                  src={mediaUrl(`/api/towers/${tower.id}/photo`, tower.photo_uploaded_at)}
                  alt={tower.tower_id}
                  height={220}
                />
              ) : (
                <Box
                  sx={{
                    height: 220,
                    borderRadius: 2,
                    bgcolor: 'grey.100',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    color: 'text.secondary',
                  }}
                >
                  <CellTowerIcon fontSize="large" color="disabled" />
                  <Typography variant="caption">
                    No photo yet — add one from the Towers page ("Edit tower").
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                Tower location
              </Typography>
              <MapPicker
                latitude={tower?.latitude}
                longitude={tower?.longitude}
                readOnly
                height={380}
                label={tower?.tower_id}
                highlight
              />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                Inspection visits
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Inspector</TableCell>
                      <TableCell align="center">Completion</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visits?.map((v: import('../api/types').Visit) => (
                      <TableRow key={v.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/visits/${v.id}`)}>
                        <TableCell>{v.inspection_date || '-'}</TableCell>
                        <TableCell>{v.inspector_name || '-'}</TableCell>
                        <TableCell align="center">{v.rollup ? `${v.rollup.completion_pct}%` : '-'}</TableCell>
                        <TableCell>
                          <VisitStatusChip status={v.rollup?.visit_status} />
                        </TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            color="error"
                            title="Delete this visit"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteVisit(v.id, v.inspection_date || `#${v.id}`);
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!isLoading && (!visits || visits.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          No visits recorded yet. Start one with "New inspection visit".
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
    </Stack>
  );
}

import { tr, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
import TransmissionTowerIcon from '../components/TransmissionTowerIcon';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import MapRounded from '@mui/icons-material/MapRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import { DashboardSection } from '../components/DashboardSection';
import DeleteIcon from '@mui/icons-material/DeleteRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { useCreateVisit, useDeleteVisit, useTowers, useVisits } from '../api/hooks';
import { mediaUrl } from '../api/client';
import { VisitStatusChip } from '../components/Badges';
import { MapPicker } from '../components/MapPicker';
import { ExpandableImage } from '../components/ExpandableImage';
import { localInspectionDate } from '../utils/teamTowerWork';
import { positionError } from '../utils/positionChanges';

export function TowerDetailPage() {
  useLanguage();
  const { towerId } = useParams();
  const id = Number(towerId);
  const navigate = useNavigate();
  const { data: towers } = useTowers({ include_inactive: true, limit: 5000 });
  const tower = towers?.find((t) => t.id === id);
  const { data: visits, isLoading } = useVisits(id);
  const createVisit = useCreateVisit();
  const deleteVisit = useDeleteVisit();
  const [startingVisit, setStartingVisit] = useState(false);

  const handleDeleteVisit = (visitId: number, dateLabel: string) => {
    if (
      window.confirm(
        tr("Permanently delete the inspection visit from {0}? This removes all its positions, screening results, and images. This cannot be undone.", [dateLabel]),
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
        inspection_date: localInspectionDate(),
        latitude: tower?.latitude ?? here?.latitude ?? undefined,
        longitude: tower?.longitude ?? here?.longitude ?? undefined,
      });
      navigate(`/visits/${visit.id}`);
    } catch {
      // Show the mutation error below and retain the creation token for a retry.
    } finally {
      setStartingVisit(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/towers')} sx={{ alignSelf: 'flex-start' }}>{tr("Back to towers")}</Button>

      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ p: 1.5, display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 3 }}><TransmissionTowerIcon sx={{ fontSize: 34 }} /></Box>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              {tower?.tower_id || tr("Tower #{0}", [id])}
            </Typography>
            {tower && !tower.is_active && <Chip label={tr("Inactive")} color="default" size="small" />}
          </Stack>
          <Typography color="text.secondary">
            {tower?.voltage} · {tower?.area || tr("No area set")}
            {tower?.tower_type ? ` · ${tower.tower_type}` : ''}
            {tower?.location_name ? ` · ${tower.location_name}` : ''}
            {tower?.height_m != null ? tr(" · {0} m tall", [tower.height_m]) : ''}
          </Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button startIcon={<EditRounded />} variant="outlined" onClick={() => navigate('/towers')}>{tr("Edit tower details")}</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleNewVisit} disabled={startingVisit}>
            {startingVisit ? tr("Locating…") : tr("New inspection visit")}
          </Button>
        </Stack>
      </Stack>

      {createVisit.isError && <Alert severity="error">{tr(positionError(createVisit.error,
        'Could not start the inspection. Refresh the tower list before trying again to avoid a duplicate visit.'))}</Alert>}
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '20px' }}>
        <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip icon={<GroupsRounded />} label={tower?.assigned_team_name || tr('Unassigned')} variant="outlined" />
          {tower?.voltage && <Chip icon={<BoltRounded />} label={tower.voltage} variant="outlined" />}
          <Chip icon={<HistoryRounded />} label={tr('Visits: {0}', [visits?.length || 0])} variant="outlined" />
          <Typography variant="body2" color="text.secondary">{tr('The tower record connects site information with every inspection visit.')}</Typography>
        </Stack>
      </Paper>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 5 }}>
          <DashboardSection icon={<PhotoCameraRounded />} title={tr('Tower photo')} description={tr('Recognize the structure and confirm the tower before starting fieldwork.')} tone="teal">

              {tower?.photo_path ? (
                <ExpandableImage
                  src={mediaUrl(`/api/towers/${tower.id}/photo`, tower.photo_uploaded_at)}
                  alt={tower.tower_id}
                  height={300}
                />
              ) : (
                <Box
                  sx={{
                    height: 300,
                    borderRadius: 2,
                    bgcolor: 'action.hover',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    px: 3, textAlign: 'center',
                    backgroundImage: 'radial-gradient(circle, #75a5b526 1px, transparent 1px)', backgroundSize: '18px 18px',
                    color: 'text.secondary',
                  }}
                >
                  <Box sx={{ display: 'grid', placeItems: 'center', width: 128, height: 128, borderRadius: '50%', bgcolor: 'background.paper', boxShadow: '0 8px 30px #123f5014' }}><TransmissionTowerIcon sx={{ fontSize: 76, color: 'primary.main' }} /></Box>
                  <Typography variant="caption">{tr("No photo yet — add one from the Towers page (\"Edit tower\").")}</Typography>
                </Box>
              )}
          </DashboardSection>
        </Grid>
        <Grid size={{ xs: 12, md: 7 }}>
          <DashboardSection icon={<MapRounded />} title={tr('Tower location')} description={tr('Use the saved tower location to identify the inspection site.')} tone="blue">

              <MapPicker
                latitude={tower?.latitude}
                longitude={tower?.longitude}
                readOnly
                height={300}
                label={tower?.tower_id}
                highlight
              />
          </DashboardSection>
        </Grid>
        <Grid size={{ xs: 12 }}>
          <DashboardSection icon={<HistoryRounded />} title={tr('Inspection visits')} description={tr('Follow the work over time. Open a visit to review its readings, evidence and report details.')} tone="violet">

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{tr("Date")}</TableCell>
                      <TableCell>{tr("Inspector")}</TableCell>
                      <TableCell align="center">{tr("Completion")}</TableCell>
                      <TableCell>{tr("Status")}</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visits?.map((v: import('../api/types').Visit) => (
                      <TableRow key={v.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/visits/${v.id}`)}>
                        <TableCell><Button startIcon={<HistoryRounded />} endIcon={<ArrowForwardRounded />} onClick={(e) => { e.stopPropagation(); navigate(`/visits/${v.id}`); }}>{v.inspection_date || `#${v.id}`}</Button></TableCell>
                        <TableCell>{v.inspector_name || '-'}</TableCell>
                        <TableCell align="center">{v.rollup ? `${v.rollup.completion_pct}%` : '-'}</TableCell>
                        <TableCell>
                          <VisitStatusChip status={v.rollup?.visit_status} />
                        </TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            color="error"
                            title={tr("Delete this visit")}
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
                        <TableCell colSpan={5} align="center">{tr("No visits recorded yet. Start one with \"New inspection visit\".")}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
          </DashboardSection>
        </Grid>
      </Grid>
    </Stack>
  );
}

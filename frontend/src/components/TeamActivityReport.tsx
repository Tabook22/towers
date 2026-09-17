import { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import { useTeamActivityReport, useTeams } from '../api/hooks';
import { API_BASE_URL, mediaUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ImageLightbox } from './ImageLightbox';
import type { TeamActivityImage, TeamActivityPosition } from '../api/types';

const evidenceColor = (status: string): 'success' | 'warning' | 'default' | 'error' => {
  if (status === 'COMPLETE') return 'success';
  if (status === 'PENDING CAPTURE') return 'warning';
  if (status === 'RECAPTURE REQUIRED') return 'error';
  return 'default';
};

function PositionRow({ pos, onImageClick }: { pos: TeamActivityPosition; onImageClick: (img: TeamActivityImage) => void }) {
  return (
    <TableRow>
      <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
        {pos.ohl} {pos.phase} {pos.string} {pos.direction || ''}
        {pos.tower_proximity ? ` (${pos.tower_proximity})` : ''}
      </TableCell>
      <TableCell>{pos.screening_result}</TableCell>
      <TableCell>
        {pos.hotspot === 'Yes' ? <Chip size="small" color="error" label="Hotspot" /> : '-'}
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          {pos.images.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No images yet
            </Typography>
          )}
          {pos.images.map((img) => (
            <Chip
              key={img.id}
              size="small"
              color={evidenceColor(img.evidence_status)}
              variant="outlined"
              clickable
              onClick={() => onImageClick(img)}
              label={`${img.image_code || img.image_type}${img.annotated ? ' ✓' : ''}`}
              title={`${img.image_type} — captured ${img.capture_date || '?'} — click to view`}
            />
          ))}
        </Stack>
      </TableCell>
    </TableRow>
  );
}

/** The "team activity" master report — every team's field work sorted Team -> Day -> Tower ->
 * Position -> Image, exactly how an admin thinks about progress ("team 1, day 1, tower 1, what did
 * they do"). Only positions with real work (a Direction set or an actual image) show up; only the
 * formal checklist images (not the free-form Photos gallery) are listed. Same data downloads as a
 * flat, filterable Excel sheet via the button below. */
export function TeamActivityReport() {
  const { user } = useAuth();
  const isTeamLeader = user?.role === 'team_leader';
  const { data: teams } = useTeams();
  const [teamId, setTeamId] = useState<string>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [lightboxImage, setLightboxImage] = useState<TeamActivityImage | null>(null);

  const { data, isLoading, isError } = useTeamActivityReport({
    teamId: teamId ? Number(teamId) : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  const xlsxUrl = () => {
    const token = localStorage.getItem('iip_token');
    const url = new URL('/api/reports/team-activity.xlsx', API_BASE_URL);
    if (token) url.searchParams.set('token', token);
    if (teamId) url.searchParams.set('team_id', teamId);
    if (startDate) url.searchParams.set('start_date', startDate);
    if (endDate) url.searchParams.set('end_date', endDate);
    return url.toString();
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Team activity report
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every team's field work, grouped by team, then by day, then by tower and each string's
        measurements and evidence images — so you can see at a glance what team 1 did on day 1, how
        many towers they covered on day 2, and so on. Only the official checklist images count here,
        not the free-form Photos gallery. Download the same data as a sortable/filterable Excel sheet.
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {!isTeamLeader && (
          <TextField
            select
            size="small"
            label="Team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All teams</MenuItem>
            {teams?.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          size="small"
          type="date"
          label="From"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Button
          variant="contained"
          startIcon={<DownloadRoundedIcon />}
          component="a"
          href={xlsxUrl()}
          target="_blank"
          rel="noreferrer"
        >
          Download Excel
        </Button>
      </Stack>

      {isLoading && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      )}
      {isError && <Alert severity="error">Could not load the team activity report.</Alert>}
      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <Alert severity="info">
          No team missions in range yet — a team's visits show up here once a mission (a visit with a
          team assigned) has a position with a Direction set or an image captured.
        </Alert>
      )}

      <Stack spacing={1.5}>
        {data?.map((team) => (
          <Accordion key={team.team_id} defaultExpanded={data.length === 1}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <GroupsRoundedIcon fontSize="small" color="primary" />
                <Typography sx={{ fontWeight: 700 }}>{team.team_name}</Typography>
                <Chip
                  size="small"
                  label={`${team.days.length} day${team.days.length === 1 ? '' : 's'}`}
                  variant="outlined"
                />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2} divider={<Divider />}>
                {team.days.map((day) => (
                  <Box key={day.date}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                      <EventRoundedIcon fontSize="small" color="action" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {day.date}
                      </Typography>
                      <Chip
                        size="small"
                        label={`${day.towers.length} tower${day.towers.length === 1 ? '' : 's'}`}
                        variant="outlined"
                      />
                    </Stack>
                    <Stack spacing={2}>
                      {day.towers.map((tower) => (
                        <Box key={tower.visit_id}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                            <BoltRoundedIcon fontSize="small" color="action" />
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {tower.tower_code}
                            </Typography>
                            {tower.area && (
                              <Typography variant="caption" color="text.secondary">
                                {tower.area}
                              </Typography>
                            )}
                            <Chip size="small" label={tower.mission_status} />
                            {tower.mission_seq && (
                              <Typography variant="caption" color="text.secondary">
                                Mission #{tower.mission_seq}
                              </Typography>
                            )}
                          </Stack>
                          {tower.positions.length === 0 ? (
                            <Typography variant="caption" color="text.secondary">
                              No positions started yet.
                            </Typography>
                          ) : (
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Position</TableCell>
                                  <TableCell>Screening</TableCell>
                                  <TableCell>Hotspot</TableCell>
                                  <TableCell>Images</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {tower.positions.map((pos) => (
                                  <PositionRow key={pos.id} pos={pos} onImageClick={setLightboxImage} />
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>

      {lightboxImage && (
        <ImageLightbox
          open
          onClose={() => setLightboxImage(null)}
          title={lightboxImage.image_code || lightboxImage.image_type}
          subtitle={`${lightboxImage.image_type}${lightboxImage.capture_date ? ` — captured ${lightboxImage.capture_date}` : ''}`}
          imageUrl={mediaUrl(`/api/images/${lightboxImage.id}/file`, lightboxImage.uploaded_at)}
        />
      )}
    </Box>
  );
}

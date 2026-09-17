import { Box } from '@mui/material';

// A small filled circle with a step number — marks a section's place in the team leader's daily
// routine (see backend/app/knowledge/team_leader_guide.md §3). Shared by TeamSection (Our Team
// page) and the standalone mission/handover cards so the whole page reads as one numbered flow.
export function StepBadge({ n }: { n: number }) {
  return (
    <Box
      sx={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        bgcolor: 'primary.main',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 800,
        flexShrink: 0,
        mt: 0.25,
      }}
    >
      {n}
    </Box>
  );
}

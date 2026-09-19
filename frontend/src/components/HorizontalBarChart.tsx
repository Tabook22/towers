import { Box, Stack, Typography } from '@mui/material';

export interface BarDatum {
  label: string;
  value: number;
  color: string;
}

/** A simple horizontal bar list — thin tracks, rounded data-ends, the category named directly
 * beside its own bar (so no separate legend box is needed) and the count direct-labeled at the
 * end. Built by hand rather than pulling in a charting library, since this is the only chart
 * surface in the app so far and a plain bar-list covers both use cases (single-hue magnitude,
 * per-category identity color) without needing axes, ticks, or a tooltip layer. */
export function HorizontalBarChart({ data, emptyMessage }: { data: BarDatum[]; emptyMessage?: string }) {
  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyMessage || 'No data yet.'}
      </Typography>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <Stack spacing={1.25}>
      {data.map((d) => (
        <Stack key={d.label} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography
            variant="body2"
            sx={{ width: 140, flexShrink: 0, fontWeight: 600 }}
            noWrap
            title={d.label}
          >
            {d.label}
          </Typography>
          <Box sx={{ flex: 1, position: 'relative', height: 16 }}>
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'action.hover', borderRadius: 999 }} />
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                width: `${(d.value / max) * 100}%`,
                minWidth: d.value > 0 ? 8 : 0,
                bgcolor: d.color,
                borderRadius: 999,
                transition: 'width 0.3s ease',
              }}
            />
          </Box>
          <Typography variant="body2" sx={{ width: 32, flexShrink: 0, fontWeight: 700, textAlign: 'right' }}>
            {d.value}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

import { tr, useLanguage } from '../i18n';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';

export interface BarDatum {
  id?: string;
  label: string;
  value: number;
  color: string;
}

/** A simple horizontal bar list — thin tracks, rounded data-ends, the category named directly
 * beside its own bar (so no separate legend box is needed) and the count direct-labeled at the
 * end. Built by hand rather than pulling in a charting library, since this is the only chart
 * surface in the app so far and a plain bar-list covers both use cases (single-hue magnitude,
 * per-category identity color) without needing axes, ticks, or a tooltip layer. */
export function HorizontalBarChart({ data, emptyMessage, onSelect, selectedId, selectionLabel }: {
  data: BarDatum[]; emptyMessage?: string; onSelect?: (datum: BarDatum) => void;
  selectedId?: string; selectionLabel?: (datum: BarDatum) => string;
}) {
  useLanguage();
  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyMessage || tr("No data yet.")}
      </Typography>
    );
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <Stack spacing={1.25}>
      {data.map((d) => {
        const selected = selectedId != null && selectedId === (d.id ?? d.label);
        const content = <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}>
          <Typography
            variant="body2"
            component="span"
            sx={{ width: { xs: 110, sm: 140 }, flexShrink: 0, fontWeight: selected ? 800 : 600, textAlign: 'start' }}
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
          <Typography component="span" variant="body2" sx={{ minWidth: 32, flexShrink: 0, fontWeight: 700, textAlign: 'end' }}>
            {d.value}
          </Typography>
        </Stack>;
        return onSelect ? <ButtonBase key={d.id ?? d.label} onClick={() => onSelect(d)}
          aria-label={selectionLabel?.(d) ?? `${d.label}: ${d.value}`} aria-pressed={selected}
          sx={{ width: '100%', borderRadius: 2, p: 1, minHeight: 44, textAlign: 'start',
            bgcolor: selected ? 'action.selected' : 'transparent',
            '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-focusVisible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          }}>{content}</ButtonBase> : <Box key={d.id ?? d.label}>{content}</Box>;
      })}
    </Stack>
  );
}

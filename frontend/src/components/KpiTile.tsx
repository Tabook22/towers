import { tr, useLanguage } from '../i18n';
import { Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { alpha, lighten } from '@mui/material/styles';

export function KpiTile({
  label,
  value,
  icon,
  color = '#0d475c',
  onClick,
  hint,
  illustrated = false,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  color?: string;
  onClick?: () => void;
  hint?: string;
  illustrated?: boolean;
}) {
  useLanguage();
  const content = (
      <CardContent sx={illustrated ? { p: 2.5, '&:last-child': { pb: 2.5 } } : undefined}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {icon && (
            <Stack
              sx={{
                width: illustrated ? 58 : 44,
                height: illustrated ? 58 : 44,
                borderRadius: illustrated ? '18px' : '50%',
                bgcolor: alpha(color, .1),
                color: theme => illustrated && theme.palette.mode === 'dark' ? lighten(color, .5) : color,
                '& svg': { fontSize: illustrated ? 30 : 24 },
                flexShrink: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </Stack>
          )}
          <Stack>
            <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
              {value}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {label}
            </Typography>
            {hint && <Typography variant="caption" color="primary">{tr(hint)}</Typography>}
          </Stack>
        </Stack>
      </CardContent>
  );
  return <Card sx={{ height: '100%', ...(illustrated ? { borderRadius: '20px', border: '1px solid', borderColor: 'divider', borderTop: `3px solid ${color}`, boxShadow: 'none', backgroundImage: `linear-gradient(120deg, ${alpha(color, .06)}, transparent)` } : {}) }}>
    {onClick ? <CardActionArea onClick={onClick} sx={{ height: '100%' }} aria-label={`${label}: ${value}. ${hint || 'View details'}`}>{content}</CardActionArea> : content}
  </Card>;
}

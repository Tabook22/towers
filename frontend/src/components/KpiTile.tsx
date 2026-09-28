import { Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function KpiTile({
  label,
  value,
  icon,
  color = '#0d475c',
  onClick,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  color?: string;
  onClick?: () => void;
  hint?: string;
}) {
  const content = (
      <CardContent>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {icon && (
            <Stack
              sx={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                bgcolor: `${color}1a`,
                color,
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
            {hint && <Typography variant="caption" color="primary">{hint}</Typography>}
          </Stack>
        </Stack>
      </CardContent>
  );
  return <Card sx={{ height: '100%' }}>
    {onClick ? <CardActionArea onClick={onClick} sx={{ height: '100%' }} aria-label={`${label}: ${value}. ${hint || 'View details'}`}>{content}</CardActionArea> : content}
  </Card>;
}

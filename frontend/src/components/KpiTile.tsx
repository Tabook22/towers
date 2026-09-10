import { Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function KpiTile({
  label,
  value,
  icon,
  color = '#0d475c',
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  color?: string;
}) {
  return (
    <Card sx={{ height: '100%' }}>
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
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

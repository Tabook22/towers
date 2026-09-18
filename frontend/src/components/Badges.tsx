import { Chip } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import { evidenceColors, screeningColors, severityColors } from '../theme/theme';

function colorChip(label: string | null | undefined, colorMap: Record<string, string>, icon?: React.ReactElement) {
  if (!label) return <Chip size="small" label="-" variant="outlined" />;
  const color = colorMap[label] || '#78909c';
  return (
    <Chip
      size="small"
      icon={icon}
      label={label}
      sx={{
        backgroundColor: `${color}1f`,
        color,
        border: `1px solid ${color}55`,
        fontWeight: 700,
      }}
    />
  );
}

export function SeverityChip({ severity }: { severity: string | null | undefined }) {
  return colorChip(severity, severityColors);
}

export function ScreeningChip({ result }: { result: string | null | undefined }) {
  const icon = result === 'Hotspot detected' ? <LocalFireDepartmentIcon fontSize="small" /> : undefined;
  return colorChip(result, screeningColors, icon);
}

export function EvidenceChip({ status }: { status: string | null | undefined }) {
  return colorChip(status, evidenceColors);
}

export function HotspotChip({ value }: { value: string | null | undefined }) {
  if (value === 'Yes') {
    return (
      <Chip
        size="small"
        icon={<LocalFireDepartmentIcon fontSize="small" />}
        label="Hotspot"
        color="error"
        sx={{ fontWeight: 700 }}
      />
    );
  }
  if (value === 'Unconfirmed') {
    return <Chip size="small" icon={<WarningAmberIcon fontSize="small" />} label="Unconfirmed" color="warning" />;
  }
  return <Chip size="small" label="No" variant="outlined" />;
}

export function VisitStatusChip({ status }: { status: string | null | undefined }) {
  const map: Record<string, string> = {
    'Ready for review': '#2e7d32',
    'Inspection incomplete': '#f57c00',
  };
  return colorChip(status, map);
}

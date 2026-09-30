import { tr, useLanguage } from '../i18n';
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { MENU_ITEMS, MENU_PERMISSION_LEVELS, MENU_PERMISSION_LEVEL_LABELS } from '../api/types';

/** Admin-only control (see routers/auth.py's create_user/update_user — any other actor's edits to
 * this are silently ignored) for exactly which sidebar items an account can see at all, and at
 * what level. No View removes the grant, using the existing hidden-menu representation. */
export function MenuPermissionsEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  useLanguage();
  const setLevel = (itemId: string, level: string | null) => {
    if (level === null) return; // Keep the selected option until another is explicitly chosen.
    const next = { ...value };
    if (level !== 'none') next[itemId] = level;
    else delete next[itemId];
    onChange(next);
  };

  return (
    <Stack spacing={1.25}>
      <Box>
        <Typography variant="subtitle2">{tr("Menu access")}</Typography>
        <Typography variant="caption" color="text.secondary">{tr("Select No View to hide a menu item from this account. Select another level to show it.")}</Typography>
      </Box>
      {MENU_ITEMS.map((item) => (
        <Box
          key={item.id}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
        >
          <Typography variant="body2" sx={{ minWidth: 130 }}>
            {tr(item.label)}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={value[item.id] || 'none'}
            aria-label={tr(item.label)}
            onChange={(_e, level) => setLevel(item.id, level)}
            sx={{ flexWrap: 'wrap' }}
          >
            <ToggleButton value="none" sx={{ px: 1.25 }}>{tr("No View")}</ToggleButton>
            {MENU_PERMISSION_LEVELS.map((level) => (
              <ToggleButton key={level} value={level} sx={{ px: 1.25 }}>
                {tr(MENU_PERMISSION_LEVEL_LABELS[level])}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      ))}
    </Stack>
  );
}

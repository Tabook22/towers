import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { MENU_ITEMS, MENU_PERMISSION_LEVELS, MENU_PERMISSION_LEVEL_LABELS } from '../api/types';

/** Admin-only control (see routers/auth.py's create_user/update_user — any other actor's edits to
 * this are silently ignored) for exactly which sidebar items an account can see at all, and at
 * what level. An item with no level selected here never renders in that account's nav — click the
 * currently-selected level again to clear it back to hidden. */
export function MenuPermissionsEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const setLevel = (itemId: string, level: string | null) => {
    const next = { ...value };
    if (level) next[itemId] = level;
    else delete next[itemId];
    onChange(next);
  };

  return (
    <Stack spacing={1.25}>
      <Box>
        <Typography variant="subtitle2">Menu access</Typography>
        <Typography variant="caption" color="text.secondary">
          A menu item is completely hidden from this account unless a level is selected. Click the
          selected level again to hide it.
        </Typography>
      </Box>
      {MENU_ITEMS.map((item) => (
        <Box
          key={item.id}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
        >
          <Typography variant="body2" sx={{ minWidth: 130 }}>
            {item.label}
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={value[item.id] || null}
            onChange={(_e, level) => setLevel(item.id, level)}
          >
            {MENU_PERMISSION_LEVELS.map((level) => (
              <ToggleButton key={level} value={level} sx={{ px: 1.25 }}>
                {MENU_PERMISSION_LEVEL_LABELS[level]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      ))}
    </Stack>
  );
}

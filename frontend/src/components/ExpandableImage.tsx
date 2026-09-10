import { useState, type ReactNode } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreenRounded';

interface ExpandableImageProps {
  src: string;
  alt: string;
  height?: number;
  /** Height while expanded. Defaults to 3x `height`, capped at 680px. */
  expandedHeight?: number;
  fallback?: ReactNode;
}

/** A photo with an overlay button to enlarge/shrink it in place — same interaction as MapPicker's
 * enlarge control, for consistency across the app's image and map previews. */
export function ExpandableImage({ src, alt, height = 160, expandedHeight, fallback }: ExpandableImageProps) {
  const [expanded, setExpanded] = useState(false);
  const [errored, setErrored] = useState(false);
  const currentHeight = expanded ? (expandedHeight ?? Math.min(680, height * 3)) : height;

  if (errored && fallback) return <>{fallback}</>;

  return (
    <Box sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)' }}>
      <Box
        component="img"
        src={src}
        alt={alt}
        onError={() => setErrored(true)}
        sx={{
          width: '100%',
          height: currentHeight,
          objectFit: 'cover',
          display: 'block',
          transition: 'height 0.2s ease',
        }}
      />
      <Tooltip title={expanded ? 'Shrink photo' : 'Enlarge photo'}>
        <IconButton
          size="small"
          onClick={() => setExpanded((v) => !v)}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            bgcolor: 'background.paper',
            boxShadow: 2,
            '&:hover': { bgcolor: 'background.paper' },
          }}
        >
          {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

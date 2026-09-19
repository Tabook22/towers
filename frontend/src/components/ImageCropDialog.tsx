import { useState, useCallback } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Slider, Stack, TextField, Typography } from '@mui/material';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

async function cropToFile(imageSrc: string, cropPixels: Area, outputWidth: number, outputHeight: number, fileName: string): Promise<File> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export cropped image'))), 'image/jpeg', 0.9),
  );
  return new File([blob], fileName, { type: 'image/jpeg' });
}

/** Lets the admin pick exactly which part of an uploaded photo becomes the banner, and at what
 * pixel size — drag to reposition, scroll/pinch to zoom, and the Width/Height fields set the
 * output aspect ratio the crop box follows. The crop is baked into the exported file client-side,
 * so nothing about the upload endpoint or stored branding row needs to change. */
export function ImageCropDialog({
  open,
  imageSrc,
  fileName,
  onCancel,
  onCropped,
  defaultWidth = 1600,
  defaultHeight = 700,
}: {
  open: boolean;
  imageSrc: string | null;
  fileName: string;
  onCancel: () => void;
  onCropped: (file: File) => void;
  defaultWidth?: number;
  defaultHeight?: number;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [outputWidth, setOutputWidth] = useState(defaultWidth);
  const [outputHeight, setOutputHeight] = useState(defaultHeight);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleApply = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setBusy(true);
    try {
      const file = await cropToFile(imageSrc, croppedAreaPixels, outputWidth, outputHeight, fileName);
      onCropped(file);
    } finally {
      setBusy(false);
    }
  };

  const aspect = outputWidth > 0 && outputHeight > 0 ? outputWidth / outputHeight : 4;

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Choose what part of the photo to show</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Width (px)"
              type="number"
              size="small"
              value={outputWidth}
              onChange={(e) => setOutputWidth(Math.max(50, Number(e.target.value) || 0))}
              slotProps={{ htmlInput: { min: 50, step: 10 } }}
            />
            <TextField
              label="Height (px)"
              type="number"
              size="small"
              value={outputHeight}
              onChange={(e) => setOutputHeight(Math.max(50, Number(e.target.value) || 0))}
              slotProps={{ htmlInput: { min: 50, step: 10 } }}
            />
          </Stack>
          <Box sx={{ position: 'relative', width: '100%', height: 400, maxHeight: 400, bgcolor: 'black', borderRadius: 1, overflow: 'hidden' }}>
            {imageSrc && (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </Box>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ minWidth: 40 }}>
              Zoom
            </Typography>
            <Slider size="small" min={1} max={4} step={0.05} value={zoom} onChange={(_e, v) => setZoom(v as number)} />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Drag the photo to reposition it, and use the zoom slider to focus on a specific part — the
            highlighted box is exactly what will be shown, at the width/height set above.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleApply} disabled={busy || !croppedAreaPixels}>
          {busy ? 'Applying…' : 'Apply crop'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

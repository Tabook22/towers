import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { ResizableDialogPaper } from './ResizableDialogPaper';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  imageUrl: string;
  /** Small line under the title — e.g. capture date/time, or "Annotated" vs "Original" context. */
  subtitle?: string;
}

/** A simple click-to-enlarge viewer — no drawing tools (see ImageAnnotator for that), just a big,
 * centered view of one image with a close button. Used wherever a thumbnail elsewhere in the app
 * needs a "click to see it full-size" affordance without leaving the current page. Opens at 80% of
 * the screen and can be dragged bigger/smaller from there via ResizableDialogPaper's edge handles. */
export function ImageLightbox({ open, onClose, title, imageUrl, subtitle }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperComponent={ResizableDialogPaper}
      slotProps={{ paper: { sx: { width: '80vw', height: '80vh', maxWidth: '96vw', maxHeight: '96vh', display: 'flex', flexDirection: 'column' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexShrink: 0 }}>
        <Box>
          <Typography variant="h6" component="span" sx={{ fontWeight: 700, display: 'block' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.900',
          p: 0,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Box
          component="img"
          src={imageUrl}
          alt={title}
          sx={{ maxWidth: '100%', maxHeight: '100%', display: 'block', objectFit: 'contain' }}
        />
      </DialogContent>
    </Dialog>
  );
}

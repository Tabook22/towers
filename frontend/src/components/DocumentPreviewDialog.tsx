import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Button, Chip } from '@mui/material';
import CloseIcon from '@mui/icons-material/CloseRounded';
import DownloadIcon from '@mui/icons-material/DownloadRounded';
import { ResizableDialogPaper } from './ResizableDialogPaper';
import { mediaUrl } from '../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  docId: number;
  contentType: string | null;
  extractedText: string | null;
  teamName?: string | null;
}

/** A read-only "click to read" viewer for a knowledge-base document — no download prompt, just the
 * content itself. Opens at 80% of the screen and can be dragged bigger/smaller via
 * ResizableDialogPaper, same convention as ImageLightbox. A real PDF renders in the browser's own
 * PDF viewer (iframe); anything else falls back to the plain text already extracted at upload
 * time, since most formats this app accepts (Word, .txt, .md) have no in-browser native viewer. */
export function DocumentPreviewDialog({ open, onClose, title, docId, contentType, extractedText, teamName }: Props) {
  const downloadUrl = mediaUrl(`/api/knowledge-base/${docId}/file`);
  // inline=true tells the server to send Content-Disposition: inline instead of the default
  // "attachment" — without it, the browser downloads the file the instant the iframe requests it
  // instead of rendering it, even though it never left this dialog.
  const viewUrl = mediaUrl(`/api/knowledge-base/${docId}/file?inline=true`);
  const isPdf = contentType === 'application/pdf';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperComponent={ResizableDialogPaper}
      slotProps={{ paper: { sx: { width: '80vw', height: '80vh', maxWidth: '96vw', maxHeight: '96vh', display: 'flex', flexDirection: 'column' } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexShrink: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="span" sx={{ fontWeight: 700, display: 'block' }}>
            {title}
          </Typography>
          {teamName !== undefined && (
            <Chip size="small" sx={{ mt: 0.5 }} label={teamName || 'Company-wide'} variant={teamName ? 'filled' : 'outlined'} />
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <Button size="small" startIcon={<DownloadIcon />} component="a" href={downloadUrl} target="_blank" rel="noreferrer">
            Download
          </Button>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ p: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {isPdf ? (
          <Box component="iframe" src={viewUrl} title={title} sx={{ border: 0, width: '100%', height: '100%', flex: 1 }} />
        ) : extractedText ? (
          <Box sx={{ p: 3, overflow: 'auto', flex: 1, bgcolor: 'background.default' }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {extractedText}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ p: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <Typography variant="body2" color="text.secondary">
              No preview available for this file type — use Download above to view it.
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

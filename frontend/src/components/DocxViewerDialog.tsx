import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, IconButton, LinearProgress, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import { DraggableResizableDialogPaper } from './DraggableResizableDialogPaper';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Authenticated URL (see api/client.mediaUrl) to fetch the .docx bytes from — same URL the
   * Download button already uses, just rendered in place instead of saved to disk. */
  fileUrl: string;
  notice?: string;
}

/** A read-only "click to view" popup for a generated .docx report — renders the real document
 * (fonts, tables, embedded images, the customer template's checkboxes) via docx-preview rather
 * than just offering a download, opens at 80% of the screen, and — unlike the app's other
 * ResizableDialogPaper-based viewers — can also be dragged anywhere via its title bar (see
 * DraggableResizableDialogPaper), since a document this size often needs moving out of the way
 * of whatever the admin is cross-checking it against. */
export function DocxViewerDialog({ open, onClose, title, fileUrl, notice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const container = containerRef.current;
    if (container) container.innerHTML = '';

    (async () => {
      try {
        const res = await fetch(fileUrl, { signal: controller.signal });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(typeof data?.detail === 'string' ? data.detail : `Could not open the document (${res.status}).`);
        }
        const blob = await res.blob();
        if (cancelled || !containerRef.current) return;
        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        // Render offscreen so a slower previous request cannot overwrite a newly opened report.
        const rendered = document.createElement('div');
        await renderAsync(blob, rendered, rendered, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
        });
        if (!cancelled && containerRef.current) containerRef.current.replaceChildren(...Array.from(rendered.childNodes));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open this report.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, fileUrl]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperComponent={DraggableResizableDialogPaper}
      slotProps={{
        paper: {
          sx: { width: { xs: '96vw', md: '88vw' }, height: '90vh', m: 1, maxWidth: '96vw', maxHeight: '96vh', display: 'flex', flexDirection: 'column' },
        },
      }}
    >
      <DialogTitle
        data-drag-handle
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}
      >
        <DragIndicatorRoundedIcon fontSize="small" sx={{ opacity: 0.5 }} />
        <Typography variant="h6" component="span" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
          {title}
        </Typography>
        <Button size="small" startIcon={<DownloadRoundedIcon />} component="a" href={fileUrl} target="_blank" rel="noreferrer">
          Download
        </Button>
        <IconButton onClick={onClose} size="small" aria-label="Close document preview">
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      {notice && <Alert severity="warning">{notice}</Alert>}
      {loading && <LinearProgress aria-label="Loading document" />}
      <DialogContent sx={{ p: 0, flex: 1, minHeight: 0, overflow: 'auto', bgcolor: (theme) => theme.palette.mode === 'dark' ? '#273842' : '#e4e9ed' }}>
        {loading && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
            Loading document…
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error} — use Download above instead.
          </Alert>
        )}
        <Box
          ref={containerRef}
          sx={{
            display: loading || error ? 'none' : 'block',
            // docx-preview renders each Word page as its own white sheet on this darker
            // background, matching how Word/Google Docs present a multi-page document.
            '& .docx-wrapper': { bgcolor: 'transparent', minWidth: 'fit-content', py: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 },
            '& .docx': { boxShadow: 3, flexShrink: 0 },
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Button, Chip } from '@mui/material';
import CloseIcon from '@mui/icons-material/CloseRounded';
import DownloadIcon from '@mui/icons-material/DownloadRounded';
import { ResizableDialogPaper } from './ResizableDialogPaper';
import { mediaUrl } from '../api/client';
import { RichTextWithMedia } from './RichTextWithMedia';
import { RichTextContent } from './richtext/RichTextContent';
import { VoiceNotePlayer } from './VoiceNoteControls';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  docId: number;
  contentType: string | null;
  extractedText: string | null;
  /** Sanitized rich-text HTML from the knowledge-base editor (models.KnowledgeDocument.body_html)
   * — when present, this is the authoritative rendering of a composed document, in place of the
   * plain-text extractedText fallback. */
  bodyHtml?: string | null;
  teamName?: string | null;
  /** A voice recording kept alongside a typed/transcribed document (see models.KnowledgeDocument.
   * voice_path) — separate from the main file, so it's shown above whatever the main content is. */
  hasVoice?: boolean;
  voiceDurationSeconds?: number | null;
}

/** A read-only "click to read" viewer for a knowledge-base document — no download prompt, just the
 * content itself. Opens at 80% of the screen and can be dragged bigger/smaller via
 * ResizableDialogPaper, same convention as ImageLightbox. The main file renders as whatever it
 * actually is: a real PDF in the browser's own PDF viewer, an image or video shown directly, an
 * audio file as a player; anything else (Word, .txt, .md) falls back to the plain text already
 * extracted at upload time, run through RichTextWithMedia so a YouTube link, an image URL, or an
 * audio file link a report happens to mention renders as an actual player/thumbnail/link instead
 * of sitting there as inert text. A voice recording kept alongside a typed/transcribed document
 * plays from its own player above the main content, whatever that is. */
export function DocumentPreviewDialog({
  open,
  onClose,
  title,
  docId,
  contentType,
  extractedText,
  bodyHtml,
  teamName,
  hasVoice,
  voiceDurationSeconds,
}: Props) {
  const downloadUrl = mediaUrl(`/api/knowledge-base/${docId}/file`);
  // inline=true tells the server to send Content-Disposition: inline instead of the default
  // "attachment" — without it, the browser downloads the file the instant the iframe/img/video
  // requests it instead of rendering it, even though it never left this dialog.
  const viewUrl = mediaUrl(`/api/knowledge-base/${docId}/file?inline=true`);
  const isPdf = contentType === 'application/pdf';
  const isImage = !!contentType?.startsWith('image/');
  const isVideo = !!contentType?.startsWith('video/');
  const isAudio = !!contentType?.startsWith('audio/');

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
        {hasVoice && (
          <Box sx={{ px: 3, pt: 2, flexShrink: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Voice recording
            </Typography>
            <VoiceNotePlayer src={mediaUrl(`/api/knowledge-base/${docId}/voice`)} duration={voiceDurationSeconds ?? null} />
          </Box>
        )}

        {isPdf ? (
          <Box component="iframe" src={viewUrl} title={title} sx={{ border: 0, width: '100%', height: '100%', flex: 1 }} />
        ) : isImage ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.900', p: 2 }}>
            <Box component="img" src={viewUrl} alt={title} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </Box>
        ) : isVideo ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'grey.900' }}>
            <Box component="video" src={viewUrl} controls sx={{ maxWidth: '100%', maxHeight: '100%' }} />
          </Box>
        ) : isAudio ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
            <audio src={viewUrl} controls style={{ width: '100%', maxWidth: 480 }} />
          </Box>
        ) : bodyHtml ? (
          <Box sx={{ p: 3, overflow: 'auto', flex: 1, bgcolor: 'background.default' }}>
            <RichTextContent html={bodyHtml} />
          </Box>
        ) : extractedText ? (
          <Box sx={{ p: 3, overflow: 'auto', flex: 1, bgcolor: 'background.default' }}>
            <RichTextWithMedia text={extractedText} />
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

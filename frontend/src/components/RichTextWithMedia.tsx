import type { ReactNode } from 'react';
import { Box, Link, Typography } from '@mui/material';

const URL_RE = /(https?:\/\/[^\s<>"]+)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)"'\]]+$/;

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|svg)(\?.*)?$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i;

function youTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/.test(u.hostname) && u.hostname !== 'youtu.be') return null;
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const embedMatch = /^\/(embed|shorts)\/([^/]+)/.exec(u.pathname);
    return embedMatch ? embedMatch[2] : null;
  } catch {
    return null;
  }
}

/** Splits a URL off any trailing sentence punctuation it swept up (e.g. "see https://x.com/a." at
 * the end of a sentence) so the link/embed doesn't include that punctuation. */
function splitTrailingPunctuation(url: string): [string, string] {
  const match = TRAILING_PUNCTUATION_RE.exec(url);
  if (!match) return [url, ''];
  return [url.slice(0, url.length - match[0].length), match[0]];
}

/** Renders plain text, but any http(s) link found in it is "exposed" instead of sitting there as
 * inert text: a YouTube link becomes an embedded player, an image link becomes a thumbnail, an
 * audio file link becomes a player, and anything else at least becomes clickable. Used for a
 * knowledge-base document's extracted text in the read-only viewer — many field reports and
 * reference notes link out to a video, a photo, or a recording rather than attaching it directly. */
export function RichTextWithMedia({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  const nodes: ReactNode[] = [];

  parts.forEach((part, i) => {
    // Odd indices are the captured URLs (String.split keeps capture groups in the result array).
    if (i % 2 === 0) {
      if (part) nodes.push(<span key={i}>{part}</span>);
      return;
    }
    const [url, trailing] = splitTrailingPunctuation(part);
    const ytId = youTubeId(url);

    if (ytId) {
      nodes.push(
        <Box
          key={i}
          sx={{ my: 1.5, position: 'relative', width: '100%', maxWidth: 560, aspectRatio: '16 / 9' }}
        >
          <Box
            component="iframe"
            src={`https://www.youtube.com/embed/${ytId}`}
            title="YouTube video"
            allowFullScreen
            sx={{ border: 0, width: '100%', height: '100%', borderRadius: 1 }}
          />
        </Box>,
      );
    } else if (IMAGE_EXT_RE.test(url)) {
      nodes.push(
        <Box key={i} sx={{ my: 1.5 }}>
          <Box
            component="img"
            src={url}
            alt="Referenced"
            sx={{ maxWidth: '100%', maxHeight: 360, display: 'block', borderRadius: 1 }}
          />
        </Box>,
      );
    } else if (AUDIO_EXT_RE.test(url)) {
      nodes.push(
        <Box key={i} sx={{ my: 1 }}>
          <audio src={url} controls preload="none" style={{ maxWidth: '100%' }} />
        </Box>,
      );
    } else {
      nodes.push(
        <Link key={i} href={url} target="_blank" rel="noreferrer">
          {url}
        </Link>,
      );
    }
    if (trailing) nodes.push(<span key={`${i}-tail`}>{trailing}</span>);
  });

  return (
    <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap' }}>
      {nodes}
    </Typography>
  );
}

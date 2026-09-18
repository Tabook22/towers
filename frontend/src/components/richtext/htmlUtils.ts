import { mediaUrl } from '../../api/client';

// Matches an inline-image <img> src regardless of whether it's the bare relative path this app
// stores (`/api/knowledge-base/inline-images/<file>`) or the absolute, tokenized URL the editor
// displays (mediaUrl() always returns a fully-qualified URL, e.g.
// `http://host/api/knowledge-base/inline-images/<file>?token=...`) — capturing just the filename
// lets both helpers below normalize either form without caring which one they were given.
const INLINE_IMAGE_SRC = /src="[^"]*\/api\/knowledge-base\/inline-images\/([^"?]+)(?:\?[^"]*)?"/g;

/** The stored body_html only ever holds bare `/api/knowledge-base/inline-images/<file>` paths
 * (see backend services/knowledge_compose.py) — no auth token, since that's what gets
 * sanitized/persisted. Before handing the HTML to the browser (the editor's initial content, or
 * the read-only viewer's dangerouslySetInnerHTML), each inline image's src needs the same
 * `?token=` query param every other authenticated <img> in this app uses (see api/client.mediaUrl). */
export function withInlineImageTokens(html: string): string {
  return html.replace(INLINE_IMAGE_SRC, (_match, filename: string) => `src="${mediaUrl(`/api/knowledge-base/inline-images/${filename}`)}"`);
}

/** The reverse of withInlineImageTokens — strips the host and `?token=...` back off before the
 * editor's HTML is sent to the backend to be stored. Tokens expire and shouldn't be baked into
 * content that outlives the session that happened to compose it. */
export function stripInlineImageTokens(html: string): string {
  return html.replace(INLINE_IMAGE_SRC, (_match, filename: string) => `src="/api/knowledge-base/inline-images/${filename}"`);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** True when the editor has no real content — just empty paragraph tags, e.g. `<p></p>`. An
 * image-only document still counts as real content even though stripping tags leaves no text. */
export function isRichTextEmpty(html: string): boolean {
  if (/<img[\s/]/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, '').trim().length === 0;
}

/** An older composed document (or one saved via the plain-text/voice path) has no body_html at
 * all — just extracted_text. Wrapping it into paragraphs makes it immediately editable in the
 * rich-text editor without losing its line breaks, the first time someone opens it there. */
export function plainTextToHtml(text: string): string {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  if (blocks.length === 0) return '<p></p>';
  return blocks.map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`).join('');
}

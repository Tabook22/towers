import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageNodeView } from './ImageNodeView';

export type ImageAlign = 'left' | 'center' | 'right';

/** Extends TipTap's stock Image node with two extra attributes the rich-text editor's toolbar
 * and drag handle write to: `width` (px, set by dragging the corner handle — see ImageNodeView)
 * and `data-align` (float/center the image within the surrounding text — see the CSS in
 * RichTextEditor.tsx). Both serialize as plain HTML attributes, so a saved document's body_html
 * is portable, sanitizable (see services/knowledge_compose.py's ALLOWED_ATTRS), and renders
 * correctly even outside the editor (DocumentPreviewDialog's read-only viewer, the PDF export). */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute('width'),
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {}),
      },
      align: {
        default: 'left',
        parseHTML: (element) => element.getAttribute('data-align') || 'left',
        renderHTML: (attributes) => ({ 'data-align': attributes.align || 'left' }),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

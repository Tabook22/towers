import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Divider, IconButton, Stack, Tooltip } from '@mui/material';
import { Global, css } from '@emotion/react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import FormatBoldIcon from '@mui/icons-material/FormatBoldRounded';
import FormatItalicIcon from '@mui/icons-material/FormatItalicRounded';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import StrikethroughIcon from '@mui/icons-material/StrikethroughSRounded';
import LooksTwoIcon from '@mui/icons-material/LooksTwoRounded';
import Looks3Icon from '@mui/icons-material/Looks3Rounded';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumberedRounded';
import FormatQuoteIcon from '@mui/icons-material/FormatQuoteRounded';
import LinkIcon from '@mui/icons-material/LinkRounded';
import LinkOffIcon from '@mui/icons-material/LinkOffRounded';
import ImageIcon from '@mui/icons-material/ImageRounded';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeftRounded';
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenterRounded';
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRightRounded';
import UndoIcon from '@mui/icons-material/UndoRounded';
import RedoIcon from '@mui/icons-material/RedoRounded';
import { ResizableImage } from './ResizableImage';
import { plainTextToHtml } from './htmlUtils';
import { mediaUrl } from '../../api/client';
import { useUploadInlineKnowledgeImage } from '../../api/hooks';

const editorStyles = css`
  .rte-content {
    min-height: 100%;
  }
  .rte-content .ProseMirror {
    min-height: 100%;
    outline: none;
    line-height: 1.5;
  }
  .rte-content .ProseMirror p.is-editor-empty:first-of-type::before {
    content: attr(data-placeholder);
    float: left;
    color: rgba(0, 0, 0, 0.38);
    pointer-events: none;
    height: 0;
  }
  .rte-content .ProseMirror ul,
  .rte-content .ProseMirror ol {
    padding-left: 1.5em;
  }
  .rte-content .ProseMirror blockquote {
    border-left: 3px solid rgba(0, 0, 0, 0.2);
    margin-left: 0;
    padding-left: 12px;
    color: rgba(0, 0, 0, 0.65);
  }
  .rte-content .ProseMirror a {
    color: #1976d2;
  }
  .rte-content .ProseMirror::after {
    content: '';
    display: table;
    clear: both;
  }
`;

interface Props {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  placeholder?: string;
}

export interface RichTextEditorHandle {
  /** Appends a new paragraph at the end of the document — used by the "record a voice note"
   * flow to drop a transcript into an already-open editor without the caller having to reach
   * into TipTap's API itself. */
  appendParagraph: (text: string) => void;
}

/** Full rich-text editor for a knowledge-base "text" document — formatting, links, and images
 * with drag-to-resize and left/center/right positioning (see ResizableImage/ImageNodeView).
 * `value`/`onChange` carry display-ready HTML — inline-image src's include the `?token=` this
 * app's <img> tags need (see api/client.mediaUrl) — so the caller strips it back off with
 * htmlUtils.stripInlineImageTokens before sending the HTML to the server to be stored. Mount a
 * fresh instance (e.g. `key={doc.id}`) rather than pushing external value changes into an
 * already-mounted editor, same convention as any other uncontrolled rich editor. */
export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { value, onChange, minHeight = 220, placeholder },
  ref,
) {
  const uploadImage = useUploadInlineKnowledgeImage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, forceRender] = useState(0);

  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      ResizableImage.configure({ inline: false }),
      Placeholder.configure({ placeholder: placeholder || 'Write the report…' }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
    onSelectionUpdate: () => forceRender((n) => n + 1),
    onTransaction: () => forceRender((n) => n + 1),
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  useImperativeHandle(
    ref,
    () => ({
      appendParagraph: (text: string) => {
        if (!editor) return;
        editor.chain().focus('end').insertContent(plainTextToHtml(text)).run();
      },
    }),
    [editor],
  );

  if (!editor) return null;

  const isImageSelected = editor.isActive('image');

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const onPickImage = () => fileInputRef.current?.click();

  const onImageChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    uploadImage.mutate(file, {
      onSuccess: (data) => {
        // The endpoint requires auth an <img> tag can't send — insert the tokenized URL so it
        // renders immediately; stripInlineImageTokens removes the token again before this HTML
        // is sent back to the server to be stored (see htmlUtils.ts).
        editor.chain().focus().setImage({ src: mediaUrl(data.url) }).run();
      },
    });
  };

  const setAlign = (align: 'left' | 'center' | 'right') => {
    if (isImageSelected) {
      editor.chain().focus().updateAttributes('image', { align }).run();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Global styles={editorStyles} />
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={onImageChosen} />
      <Stack
        direction="row"
        spacing={0.25}
        sx={{ flexWrap: 'wrap', alignItems: 'center', p: 0.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}
      >
        <ToolButton title="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <UndoIcon fontSize="small" />
        </ToolButton>
        <ToolButton title="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <RedoIcon fontSize="small" />
        </ToolButton>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <ToolButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <FormatBoldIcon fontSize="small" />
        </ToolButton>
        <ToolButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <FormatItalicIcon fontSize="small" />
        </ToolButton>
        <ToolButton title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <FormatUnderlinedIcon fontSize="small" />
        </ToolButton>
        <ToolButton title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <StrikethroughIcon fontSize="small" />
        </ToolButton>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <ToolButton
          title="Heading"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <LooksTwoIcon fontSize="small" />
        </ToolButton>
        <ToolButton
          title="Subheading"
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Looks3Icon fontSize="small" />
        </ToolButton>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <ToolButton
          title="Bulleted list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <FormatListBulletedIcon fontSize="small" />
        </ToolButton>
        <ToolButton
          title="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <FormatListNumberedIcon fontSize="small" />
        </ToolButton>
        <ToolButton title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <FormatQuoteIcon fontSize="small" />
        </ToolButton>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        <ToolButton title="Add link" active={editor.isActive('link')} onClick={setLink}>
          <LinkIcon fontSize="small" />
        </ToolButton>
        <ToolButton
          title="Remove link"
          disabled={!editor.isActive('link')}
          onClick={() => editor.chain().focus().unsetLink().run()}
        >
          <LinkOffIcon fontSize="small" />
        </ToolButton>
        <ToolButton title="Insert image" onClick={onPickImage} disabled={uploadImage.isPending}>
          <ImageIcon fontSize="small" />
        </ToolButton>
        {isImageSelected && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <ToolButton title="Align image left" active={editor.getAttributes('image').align === 'left'} onClick={() => setAlign('left')}>
              <FormatAlignLeftIcon fontSize="small" />
            </ToolButton>
            <ToolButton
              title="Center image"
              active={editor.getAttributes('image').align === 'center'}
              onClick={() => setAlign('center')}
            >
              <FormatAlignCenterIcon fontSize="small" />
            </ToolButton>
            <ToolButton
              title="Align image right"
              active={editor.getAttributes('image').align === 'right'}
              onClick={() => setAlign('right')}
            >
              <FormatAlignRightIcon fontSize="small" />
            </ToolButton>
          </>
        )}
      </Stack>
      <Box className="rte-content" sx={{ flex: 1, minHeight, overflow: 'auto', p: 1.5 }} onClick={() => editor.chain().focus().run()}>
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
});

function ToolButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          disabled={disabled}
          onClick={onClick}
          color={active ? 'primary' : 'default'}
          sx={active ? { bgcolor: 'action.selected' } : undefined}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

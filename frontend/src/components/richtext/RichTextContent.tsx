import { Box } from '@mui/material';
import { Global, css } from '@emotion/react';
import { withInlineImageTokens } from './htmlUtils';

const contentStyles = css`
  .kb-rich-content img[data-align='left'] {
    float: left;
    margin: 4px 12px 8px 0;
    max-width: 100%;
  }
  .kb-rich-content img[data-align='right'] {
    float: right;
    margin: 4px 0 8px 12px;
    max-width: 100%;
  }
  .kb-rich-content img[data-align='center'] {
    display: block;
    margin: 8px auto;
    max-width: 100%;
  }
  .kb-rich-content ul,
  .kb-rich-content ol {
    padding-left: 1.5em;
  }
  .kb-rich-content blockquote {
    border-left: 3px solid rgba(0, 0, 0, 0.2);
    margin-left: 0;
    padding-left: 12px;
    color: rgba(0, 0, 0, 0.65);
  }
  .kb-rich-content a {
    color: #1976d2;
  }
  .kb-rich-content p {
    margin: 0 0 12px;
  }
  .kb-rich-content::after {
    content: '';
    display: table;
    clear: both;
  }
`;

/** Read-only render of a knowledge-base document's rich-text body — the sanitized HTML from
 * services/knowledge_compose.py, with inline-image URLs re-tokenized for this viewer's session
 * (see htmlUtils.withInlineImageTokens). The HTML was sanitized server-side at save time (see
 * routers/knowledge_base.py's sanitize_html), so this dangerouslySetInnerHTML only ever renders a
 * small allow-listed set of tags/attributes — never anything a client sent unsanitized. */
export function RichTextContent({ html }: { html: string }) {
  return (
    <Box className="kb-rich-content">
      <Global styles={contentStyles} />
      <div dangerouslySetInnerHTML={{ __html: withInlineImageTokens(html) }} />
    </Box>
  );
}

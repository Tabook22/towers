import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/** Parses `**bold**` and `` `code` `` spans within one line of text. Deliberately not a full
 * markdown engine — the chat assistant only ever produces a small, predictable subset (bold,
 * inline code, numbered/bulleted steps, short paragraphs), so a tiny dependency-free renderer
 * here keeps the bundle light instead of pulling in react-markdown for a handful of patterns. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <Box component="strong" key={`${keyPrefix}-b-${i++}`} sx={{ fontWeight: 700 }}>
          {match[1]}
        </Box>,
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <Box
          component="code"
          key={`${keyPrefix}-c-${i++}`}
          sx={{
            bgcolor: 'rgba(0,0,0,0.08)',
            px: 0.6,
            py: 0.1,
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: '0.85em',
          }}
        >
          {match[2]}
        </Box>,
      );
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

type BlockType = 'p' | 'ol' | 'ul' | 'h';
interface Block {
  type: BlockType;
  lines: string[];
}

function parseBlocks(text: string): Block[] {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let current: Block | null = null;

  const push = (type: BlockType, line: string) => {
    if (current && current.type === type) {
      current.lines.push(line);
    } else {
      current = { type, lines: [line] };
      blocks.push(current);
    }
  };

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) {
      current = null;
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.*)/.exec(line);
    const bulleted = /^[-•*]\s+(.*)/.exec(line);
    const heading = /^#{1,4}\s+(.*)/.exec(line);
    if (ordered) push('ol', ordered[2]);
    else if (bulleted) push('ul', bulleted[1]);
    else if (heading) push('h', heading[1]);
    else push('p', line);
  }
  return blocks;
}

/** Renders a chat message's markdown-lite text as properly styled paragraphs, numbered steps
 * (badge + text, matching the guide's own step styling), bullet points, bold, and inline code —
 * instead of dumping literal `**`/`1.` characters at the reader. */
export function MarkdownLite({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <Stack spacing={1}>
      {blocks.map((block, bi) => {
        if (block.type === 'h') {
          return (
            <Typography key={bi} variant="subtitle2" sx={{ fontWeight: 800 }}>
              {renderInline(block.lines.join(' '), `${bi}`)}
            </Typography>
          );
        }
        if (block.type === 'ol') {
          return (
            <Stack key={bi} spacing={0.75}>
              {block.lines.map((line, li) => (
                <Stack key={li} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Box
                    sx={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mt: '1px',
                    }}
                  >
                    {li + 1}
                  </Box>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {renderInline(line, `${bi}-${li}`)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          );
        }
        if (block.type === 'ul') {
          return (
            <Stack key={bi} spacing={0.5}>
              {block.lines.map((line, li) => (
                <Stack key={li} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Box
                    sx={{
                      flexShrink: 0,
                      mt: '8px',
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      bgcolor: 'currentColor',
                      opacity: 0.6,
                    }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {renderInline(line, `${bi}-${li}`)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          );
        }
        return (
          <Typography key={bi} variant="body2">
            {block.lines.map((line, li) => (
              <span key={li}>
                {renderInline(line, `${bi}-${li}`)}
                {li < block.lines.length - 1 && <br />}
              </span>
            ))}
          </Typography>
        );
      })}
    </Stack>
  );
}

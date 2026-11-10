/**
 * Text formatter, markdown adapter, and chunking pipeline with code-fence preservation.
 */

/**
 * Splits text into chunks respecting a maximum character budget,
 * while automatically balancing code block fences across splits.
 *
 * @param {string} text - The input text to segment.
 * @param {number} maxChunkSize - Character limit per chunk.
 * @returns {string[]} An array of balanced text segments.
 */
export function splitTextWithCodeFences(text, maxChunkSize = 2000) {
  if (!text || typeof text !== 'string') return [];
  if (text.length <= maxChunkSize) return [text];

  const lines = text.split('\n');
  const chunks = [];

  let currentLines = [];
  let currentLength = 0;
  let activeCodeFence = null; // null or string e.g. "```javascript"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.trim().match(/^```([a-zA-Z0-9_-]*)/);

    // If adding this line would exceed the chunk limit (reserving 4 chars for potential closing fence)
    const reserveClose = activeCodeFence ? 4 : 0;
    const additionalLength = line.length + 1; // +1 for newline

    if (currentLength + additionalLength + reserveClose > maxChunkSize && currentLines.length > 0) {
      // Must flush current chunk
      if (activeCodeFence) {
        currentLines.push('```');
      }
      chunks.push(currentLines.join('\n'));

      // Start next chunk
      currentLines = [];
      currentLength = 0;

      if (activeCodeFence) {
        currentLines.push(activeCodeFence);
        currentLength += activeCodeFence.length + 1;
      }
    }

    // Now track the code fence on the current line
    if (fenceMatch) {
      if (activeCodeFence === null) {
        activeCodeFence = line.trim();
      } else {
        activeCodeFence = null;
      }
    }

    currentLines.push(line);
    currentLength += line.length + 1;
  }

  if (currentLines.length > 0) {
    if (activeCodeFence) {
      currentLines.push('```');
    }
    chunks.push(currentLines.join('\n'));
  }

  return chunks;
}

/**
 * Converts rich markdown text into clean readable plain text
 * for channels that only support plain text (e.g. WeChat).
 *
 * @param {string} markdown - The markdown input string.
 * @returns {string} Plain text representation.
 */
export function stripMarkdownToPlain(markdown) {
  if (!markdown || typeof markdown !== 'string') return '';

  let text = markdown;

  // Convert markdown links [label](url) to "label (url)"
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Remove heading hashes
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold / italic markers
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');

  // Remove strikethrough
  text = text.replace(/~~(.*?)~~/g, '$1');

  // Remove code block backticks but keep code content
  text = text.replace(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)^```/gm, '$1');

  // Remove inline code backticks
  text = text.replace(/`([^`]+)`/g, '$1');

  // Remove blockquote markers
  text = text.replace(/^>\s+/gm, '');

  return text.trim();
}

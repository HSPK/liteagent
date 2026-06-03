import type { ProtocolRecord } from '../agent/types.js';

export interface ParsedMarkdown {
  /** Structured metadata parsed from the leading frontmatter block. */
  frontmatter: ProtocolRecord;
  /** The markdown body with the frontmatter block removed. */
  body: string;
}

const FRONTMATTER_FENCE = '---';

/**
 * Parse a markdown document that may begin with a JSON frontmatter block.
 *
 * The frontmatter is delimited by lines containing only `---` and holds a JSON
 * object, for example:
 *
 * ```md
 * ---
 * { "spawn": [{ "name": "review" }] }
 * ---
 *
 * # Body
 * ```
 *
 * JSON is used instead of YAML so the parser stays dependency-free while still
 * supporting nested orchestration directives.
 */
export function parseMarkdown(source: string): ParsedMarkdown {
  const normalized = source.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines[0]?.trim() !== FRONTMATTER_FENCE) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_FENCE);
  if (closingIndex === -1) {
    return { frontmatter: {}, body: normalized.trim() };
  }

  const rawFrontmatter = lines.slice(1, closingIndex).join('\n').trim();
  const body = lines.slice(closingIndex + 1).join('\n').trim();

  if (!rawFrontmatter) {
    return { frontmatter: {}, body };
  }

  let frontmatter: ProtocolRecord;
  try {
    const parsed = JSON.parse(rawFrontmatter);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Frontmatter must be a JSON object.');
    }
    frontmatter = parsed as ProtocolRecord;
  } catch (error) {
    throw new Error(`Failed to parse markdown frontmatter: ${(error as Error).message}`);
  }

  return { frontmatter, body };
}

/**
 * Serialize a markdown document with an optional JSON frontmatter block.
 */
export function stringifyMarkdown({ frontmatter = {}, body = '' }: Partial<ParsedMarkdown>): string {
  const trimmedBody = body.trim();
  const hasFrontmatter = frontmatter && Object.keys(frontmatter).length > 0;

  if (!hasFrontmatter) {
    return trimmedBody ? `${trimmedBody}\n` : '';
  }

  const serializedFrontmatter = JSON.stringify(frontmatter, null, 2);
  const sections = [FRONTMATTER_FENCE, serializedFrontmatter, FRONTMATTER_FENCE];
  const header = sections.join('\n');

  return trimmedBody ? `${header}\n\n${trimmedBody}\n` : `${header}\n`;
}

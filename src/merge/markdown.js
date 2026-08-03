'use strict';

const BEGIN = '<!-- BEGIN cc-baseline -->';
const END = '<!-- END cc-baseline -->';

function mergeMarkerBlock(existing, blockContent) {
  const block = `${BEGIN}\n${blockContent.trim()}\n${END}`;
  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // replace existing marker block
    return existing.slice(0, beginIdx) + block + existing.slice(endIdx + END.length);
  }

  // no existing block — append to end of file
  const sep = existing.length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
  return existing + sep + block + '\n';
}

function hasMarkerBlock(text) {
  return text.includes(BEGIN) && text.includes(END);
}

// Splits text at top-level (`# `) headings. The first entry holds whatever
// precedes the first heading and carries `title: null`. Fenced code regions are
// skipped so a `# comment` line inside ``` does not start a bogus section.
function splitH1Sections(text) {
  const sections = [];
  let current = { title: null, lines: [] };
  let inFence = false;

  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : /^# (.+?)\s*$/.exec(line);
    if (m) {
      sections.push(current);
      current = { title: m[1], lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

// The very first install could not find a marker block to replace, so it
// appended one — leaving any pre-cc-baseline copy of the same instructions
// stranded above the markers. That copy never updates again, so the file ends
// up stating every rule twice (once stale, once current).
//
// Detection is deliberately narrow: a preamble section is dropped only when its
// `# ` title is byte-identical to a `# ` title inside the block being installed.
// Two identical H1s in one managed file is always wrong; anything the user wrote
// under a different H1 is left untouched.
function stripDuplicatePreamble(existing, blockContent) {
  const unchanged = { content: existing, removed: [], changed: false };

  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) return unchanged;

  const preamble = existing.slice(0, beginIdx);
  if (preamble.trim().length === 0) return unchanged;

  const blockTitles = new Set(
    splitH1Sections(blockContent).map(s => s.title).filter(Boolean)
  );
  if (blockTitles.size === 0) return unchanged;

  const removed = [];
  const kept = splitH1Sections(preamble).filter(s => {
    if (s.title !== null && blockTitles.has(s.title)) {
      removed.push(s.title);
      return false;
    }
    return true;
  });
  if (removed.length === 0) return unchanged;

  let newPreamble = kept
    .map(s => s.lines.join('\n'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '');
  newPreamble = newPreamble.trim().length > 0 ? `${newPreamble.trimEnd()}\n\n` : '';

  return { content: newPreamble + existing.slice(beginIdx), removed, changed: true };
}

function removeMarkerBlock(existing) {
  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);

  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    return { content: existing, removed: false, isEmpty: false };
  }

  const before = existing.slice(0, beginIdx);
  const after = existing.slice(endIdx + END.length);
  const content = (before + after).replace(/\n{3,}/g, '\n\n');
  return { content, removed: true, isEmpty: content.trim().length === 0 };
}

module.exports = {
  mergeMarkerBlock,
  hasMarkerBlock,
  removeMarkerBlock,
  stripDuplicatePreamble,
  BEGIN,
  END,
};

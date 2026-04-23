'use strict';

const BEGIN = '<!-- BEGIN cc-baseline -->';
const END = '<!-- END cc-baseline -->';

function mergeMarkerBlock(existing, blockContent) {
  const block = `${BEGIN}\n${blockContent.trim()}\n${END}`;
  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // 기존 마커 블록 교체
    return existing.slice(0, beginIdx) + block + existing.slice(endIdx + END.length);
  }

  // 기존 블록 없으면 파일 끝에 append
  const sep = existing.length > 0 ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
  return existing + sep + block + '\n';
}

function hasMarkerBlock(text) {
  return text.includes(BEGIN) && text.includes(END);
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

module.exports = { mergeMarkerBlock, hasMarkerBlock, removeMarkerBlock, BEGIN, END };

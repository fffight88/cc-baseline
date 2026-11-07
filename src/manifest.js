'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'templates', 'manifest.json');

let cached = null;

function load() {
  if (cached) return cached;
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.markerBlock) || !Array.isArray(parsed.overwrite)) {
    throw new Error('manifest.json: missing required arrays "markerBlock" or "overwrite"');
  }
  cached = parsed;
  return cached;
}

function markerBlockFiles() {
  return load().markerBlock.slice();
}

// Every file under each overwriteDirs entry, as posix paths relative to templates/.
function dirFiles(dir) {
  const root = path.join(path.dirname(MANIFEST_PATH), dir);
  const out = [];
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(child);
      else if (ent.isFile()) out.push(`${dir}/${child}`);
    }
  };
  walk('');
  return out.sort();
}

function overwriteDirs() {
  return (load().overwriteDirs || []).slice();
}

// Listed files first, then the expanded contents of overwriteDirs.
function overwriteFiles() {
  return [...load().overwrite, ...overwriteDirs().flatMap(dirFiles)];
}

// The overwriteDirs entry a file belongs to, or null for a listed file.
function dirOf(relPath) {
  return overwriteDirs().find(d => relPath.startsWith(d + '/')) || null;
}

function allFiles() {
  return [...markerBlockFiles(), ...overwriteFiles()];
}

module.exports = { load, markerBlockFiles, overwriteFiles, overwriteDirs, dirOf, allFiles, MANIFEST_PATH };

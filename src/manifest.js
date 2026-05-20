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

function overwriteFiles() {
  return load().overwrite.slice();
}

function allFiles() {
  return [...markerBlockFiles(), ...overwriteFiles()];
}

module.exports = { load, markerBlockFiles, overwriteFiles, allFiles, MANIFEST_PATH };

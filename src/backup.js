'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function createBackup(filePaths, backupRoot) {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, iso);
  const backed = [];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    const rel = path.relative(os.homedir(), filePath);
    const destDir = path.join(backupDir, path.dirname(rel));
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(filePath, path.join(destDir, path.basename(filePath)));
    backed.push(filePath);
  }

  return {
    backupDir: backed.length > 0 ? backupDir : null,
    backed,
  };
}

module.exports = { createBackup };

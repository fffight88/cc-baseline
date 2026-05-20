'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// basePath defaults to $HOME for backwards compatibility with the global
// install. Project mode passes process.cwd() so backups under ./.claude/...
// land at sensible relative paths inside backupDir instead of climbing out
// of $HOME with ../../ segments.
function createBackup(filePaths, backupRoot, basePath) {
  basePath = basePath || os.homedir();
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(backupRoot, iso);
  const backed = [];

  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    const rel = path.relative(basePath, filePath);
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

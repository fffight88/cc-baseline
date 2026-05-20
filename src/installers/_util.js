'use strict';

const { spawnSync } = require('child_process');

function checkCmd(cmd) {
  return spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
}

module.exports = { checkCmd };

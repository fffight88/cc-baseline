'use strict';

const readline = require('readline');

async function confirm(question, autoYes = false) {
  if (autoYes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question} [Y/n] `, answer => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      resolve(trimmed === '' || trimmed === 'y');
    });
  });
}

module.exports = { confirm };

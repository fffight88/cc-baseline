'use strict';

const os = require('os');

const HOME = os.homedir();
const PLACEHOLDER = '{{HOME}}';

function applyHome(text) {
  return text.split(PLACEHOLDER).join(HOME);
}

function toPlaceholder(text) {
  return text.split(HOME).join(PLACEHOLDER);
}

module.exports = { HOME, PLACEHOLDER, applyHome, toPlaceholder };

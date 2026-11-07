#!/usr/bin/env node
'use strict';

// Local preview server for the DESIGN.md catalog pages installed next to this
// script (../design-previews). The orchestrator starts it before the
// design-director interview so the user can open each candidate, and stops it
// once a direction is chosen.
//
//   node design-preview.js start    start (or reuse) the server, print its base URL
//   node design-preview.js status   print the base URL if running, exit 1 otherwise
//   node design-preview.js stop     stop the server
//
// Binds 127.0.0.1 only. Exits by itself after IDLE_MS without requests, so a
// forgotten server does not linger.

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const CLAUDE_DIR = path.join(__dirname, '..');
const ROOT = path.join(CLAUDE_DIR, 'design-previews');
const STATE_FILE = path.join(CLAUDE_DIR, '.design-preview.json');
const HOST = '127.0.0.1';
const PORT_FIRST = 4310;
const PORT_LAST = 4339;
const IDLE_MS = 2 * 60 * 60 * 1000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.json': 'application/json',
};

// Maps a request path to a file under root, or null when it escapes root or
// does not exist. Directories resolve to their index.html.
function resolveFile(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const abs = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  let file = abs;
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return file;
}

function createServer(root, onRequest) {
  return http.createServer((req, res) => {
    if (onRequest) onRequest();
    // a directory URL without its trailing slash would break the page's relative links
    const bare = req.url.split('?')[0];
    if (!bare.endsWith('/') && !path.extname(bare)) {
      const dir = resolveFile(root, bare);
      if (dir && path.basename(dir) === 'index.html') {
        res.writeHead(301, { Location: bare + '/' });
        return res.end();
      }
    }
    const file = resolveFile(root, req.url);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function baseUrl(port) {
  return `http://${HOST}:${port}/`;
}

function ping(port) {
  return new Promise(resolve => {
    const req = http.get({ host: HOST, port, path: '/', timeout: 1000 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, HOST, () => s.close(() => resolve(true)));
  });
}

async function running() {
  const st = readState();
  if (st && alive(st.pid) && await ping(st.port)) return st;
  return null;
}

async function start() {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    console.error(`design-preview: no preview pages at ${ROOT} — re-run the cc-baseline installer`);
    process.exit(2);
  }
  const existing = await running();
  if (existing) {
    console.log(baseUrl(existing.port));
    return;
  }
  let port = null;
  for (let p = PORT_FIRST; p <= PORT_LAST; p++) {
    if (await portFree(p)) { port = p; break; }
  }
  if (!port) {
    console.error(`design-preview: ports ${PORT_FIRST}-${PORT_LAST} are all in use`);
    process.exit(2);
  }
  const child = spawn(process.execPath, [__filename, 'serve', String(port)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    if (await ping(port)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ pid: child.pid, port }));
      console.log(baseUrl(port));
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  try { process.kill(child.pid); } catch {}
  console.error('design-preview: server did not come up');
  process.exit(2);
}

function serve(port) {
  let timer;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => process.exit(0), IDLE_MS);
  };
  touch();
  createServer(ROOT, touch).listen(port, HOST);
}

async function status() {
  const st = await running();
  if (!st) {
    console.log('design-preview: not running');
    process.exit(1);
  }
  console.log(baseUrl(st.port));
}

function stop() {
  const st = readState();
  if (st && alive(st.pid)) {
    try { process.kill(st.pid); } catch {}
    console.log('design-preview: stopped');
  } else {
    console.log('design-preview: not running');
  }
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'start') start();
  else if (cmd === 'status') status();
  else if (cmd === 'stop') stop();
  else if (cmd === 'serve') serve(Number(arg));
  else {
    console.error('usage: design-preview.js start | status | stop');
    process.exit(64);
  }
}

module.exports = { resolveFile, createServer };

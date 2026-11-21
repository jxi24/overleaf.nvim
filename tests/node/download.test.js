#!/usr/bin/env node
'use strict';

/**
 * Tests for the bridge's downloadFile and downloadUrl handlers: the session
 * cookie goes only to the Overleaf server, and downloads stay in outputDir.
 *
 * Two local servers: "overleaf" (the bridge's OVERLEAF_URL) and "other", a
 * different origin that records whether it was sent a Cookie header.
 *
 * Usage: node tests/node/download.test.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message || JSON.stringify(e)}`);
  }
}

// A server that answers each path from `routes` and records each request's Cookie.
function server(routes) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ path: req.url, cookie: req.headers.cookie });
    const route = routes[req.url.split('?')[0]];
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    route(req, res);
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${srv.address().port}`;
      resolve({ srv, origin, seen });
    });
  });
}

function redirect(location) {
  return (req, res) => {
    res.writeHead(302, { Location: location() });
    res.end();
  };
}

function body(text) {
  return (req, res) => {
    res.writeHead(200);
    res.end(text);
  };
}

function bridge(baseUrl) {
  const proc = spawn('node', [path.join(__dirname, '..', '..', 'node', 'bridge.js')], {
    env: { ...process.env, OVERLEAF_URL: baseUrl },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let nextId = 1;
  const pending = {};
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (pending[msg.id]) {
          pending[msg.id](msg);
          delete pending[msg.id];
        }
      } catch (e) {
        // not an RPC reply
      }
    }
  });
  return {
    request(method, params) {
      return new Promise((resolve) => {
        const id = nextId++;
        const timer = setTimeout(() => resolve({ error: { message: 'timeout' } }), 5000);
        pending[id] = (msg) => {
          clearTimeout(timer);
          resolve(msg);
        };
        proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    stop() {
      proc.stdin.end();
      proc.kill('SIGTERM');
    },
  };
}

const COOKIE = 'overleaf_session2=s%3Asecret';

async function runTests() {
  const other = await server({ '/blob': body('from other') });
  const overleaf = await server({
    '/project/p1/file/same': redirect(() => `${overleaf.origin}/blob`),
    '/project/p1/file/relative': redirect(() => '/blob'),
    '/project/p1/file/away': redirect(() => `${other.origin}/blob`),
    '/project/p1/file/plain': body('plain file'),
    '/blob': body('from overleaf'),
    '/build/output.pdf': body('%PDF'),
  });
  const b = bridge(overleaf.origin);
  await new Promise((r) => setTimeout(r, 300));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'overleaf-download-test-'));
  const outputDir = path.join(root, 'out');
  const read = (result) => fs.readFileSync(result.path, 'utf-8');
  const inside = (p) => path.dirname(p) === outputDir;
  const file = (fileId, fileName) =>
    b.request('downloadFile', { cookie: COOKIE, projectId: 'p1', fileId, fileName, outputDir });

  console.log('\ndownloadFile:');

  await test('sends the cookie to the Overleaf server', async () => {
    const { result } = await file('plain', 'plain.txt');
    assert(read(result) === 'plain file', 'file contents');
    assert(overleaf.seen.at(-1).cookie === COOKIE, 'cookie sent to Overleaf');
  });

  await test('follows a redirect on the same server with the cookie', async () => {
    const { result } = await file('same', 'same.png');
    assert(read(result) === 'from overleaf', 'redirected contents');
    assert(overleaf.seen.at(-1).path === '/blob' && overleaf.seen.at(-1).cookie === COOKIE, 'cookie on redirect');
  });

  await test('follows a relative redirect', async () => {
    const { result, error } = await file('relative', 'relative.png');
    assert(!error, 'no error: ' + (error && error.message));
    assert(read(result) === 'from overleaf', 'redirected contents');
  });

  await test('follows a redirect to another server without the cookie', async () => {
    const { result } = await file('away', 'away.png');
    assert(read(result) === 'from other', 'redirected contents');
    assert(other.seen.length === 1 && other.seen[0].cookie === undefined, 'no cookie sent to the other server');
  });

  await test('keeps a file named with ../ inside outputDir', async () => {
    const { result } = await file('plain', 'x/../../escaped.txt');
    assert(inside(result.path), `written to ${result.path}`);
    assert(!fs.existsSync(path.join(root, 'escaped.txt')), 'nothing written outside');
  });

  console.log('\ndownloadUrl:');

  const url = (u, fileName) => b.request('downloadUrl', { cookie: COOKIE, url: u, fileName, outputDir });

  await test('downloads from the Overleaf server with the cookie', async () => {
    const { result } = await url(`${overleaf.origin}/build/output.pdf`, 'paper.pdf');
    assert(read(result) === '%PDF', 'file contents');
    assert(overleaf.seen.at(-1).cookie === COOKIE, 'cookie sent');
  });

  await test('refuses a URL on another server', async () => {
    const before = other.seen.length;
    const { error } = await url(`${other.origin}/blob`, 'x.pdf');
    assert(error, 'should fail');
    assert(other.seen.length === before, 'no request to the other server');
  });

  await test('refuses a URL that only starts with the Overleaf address', async () => {
    const before = other.seen.length;
    const { error } = await url(`http://127.0.0.1@127.0.0.1:${new URL(other.origin).port}/blob`, 'x.pdf');
    assert(error, 'should fail');
    assert(other.seen.length === before, 'no request to the other server');
  });

  await test('keeps a project named with ../ inside outputDir', async () => {
    const { result } = await url(`${overleaf.origin}/build/output.pdf`, 'x/../../escaped.pdf');
    assert(inside(result.path), `written to ${result.path}`);
  });

  b.stop();
  overleaf.srv.close();
  other.srv.close();
  fs.rmSync(root, { recursive: true, force: true });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error('Test runner failed:', e);
  process.exit(1);
});

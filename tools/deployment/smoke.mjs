import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import brand from '../../assets/brand/public.json' with { type: 'json' };

const origin = new URL(process.argv[2]);

async function request(path, { method = 'GET', check = 'gateway route' } = {}) {
  const url = new URL(path, origin);
  const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(10000) }).catch(
    (error) => {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'request failed';

      throw new Error(`Transport failure during ${check} (${method}): ${reason} before an HTTP response.`);
    },
  );

  if (response.status >= 500) {
    throw new Error(`HTTP ${response.status} during ${check} (${method}). Response source unconfirmed.`);
  }

  return response;
}

async function readJson(response, check) {
  assert.ok(
    /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''),
    `${check} must return JSON`,
  );

  return response.json().catch((error) => {
    const reason = error instanceof SyntaxError ? 'invalid JSON' : 'transport failure while reading the response';

    throw new Error(`${check}: ${reason}.`);
  });
}

const redirect = await request('/');

assert.equal(redirect.status, 302);
assert.equal(new URL(redirect.headers.get('location'), origin).pathname, '/es/');
const api = await request('/api/');

assert.equal(api.status, 200);
const greeting = await readJson(api, 'API greeting');

assert.deepEqual(greeting, { message: 'Hello API' });

for (const locale of ['en', 'es']) {
  const response = await request(`/${locale}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();

  assert.ok(html.includes(`<html lang="${locale}"`));
  const stylesheet = html.match(/href="([^"]+\.css)"/);

  assert.ok(stylesheet, 'Compiled stylesheet must be linked');
  const asset = await request(new URL(stylesheet[1], response.url));

  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /text\/css/);
}

for (const locale of ['en', 'es']) {
  const entry = await request(`/app/${locale}/`);

  assert.equal(entry.status, 302);
  const destination = new URL(entry.headers.get('location'), origin);

  assert.equal(destination.origin, origin.origin);
  assert.equal(destination.pathname, `/app/${locale}/auth/sign-in`);

  for (const path of [destination.pathname, `/app/${locale}/foundations`]) {
    const response = await request(path);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.ok(html.includes('<app-root'));
    assert.ok(!html.includes('__VISOMI_CSP_NONCE__'));
    const nonce = html.match(/ngcspnonce="([^"]+)"/i)?.[1];

    assert.ok(nonce);
    assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const stylesheet = html.match(/href="([^"]+\.css)"/);
    const base = html.match(/<base href="([^"]+)"/);

    assert.ok(stylesheet);
    assert.ok(base);
    const documentBase = new URL(base[1], response.url);

    assert.equal(documentBase.pathname, `/app/${locale}/`);
    const asset = await request(new URL(stylesheet[1], documentBase));

    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /text\/css/);
  }
}

const missingApi = await request('/api/missing');

assert.equal(missingApi.status, 404);
const missingApiBody = await readJson(missingApi, 'missing API route');

assert.deepEqual(missingApiBody, { error: 'not_found' });
const missingApplication = await request('/app/en/missing');
const missingApplicationHtml = await missingApplication.text();

assert.equal(missingApplication.status, 404);
assert.match(missingApplication.headers.get('content-type'), /text\/html/);
assert.ok(missingApplicationHtml.includes('<app-root'));
assert.ok(missingApplicationHtml.includes('Page not found'));

for (const file of brand.files) {
  const path = `/static/brand/${file}`;
  const response = await request(path);
  const body = await response.arrayBuffer();
  const bytes = Buffer.from(body);
  const expected = await readFile(new URL(`../../assets/brand/${file}`, import.meta.url));

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type'),
    file.endsWith('.png')
      ? /image\/png/
      : file.endsWith('.svg')
        ? /image\/svg\+xml/
        : /application\/(?:x-pem-file|x-x509-ca-cert|octet-stream)/,
  );
  assert.match(response.headers.get('cache-control'), /max-age=31536000/);
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.ok(bytes.equals(expected), 'The published asset must match the versioned source');
  const head = await request(path, { method: 'HEAD', check: 'brand asset' });

  assert.equal(head.status, 200);
  const headBody = await head.arrayBuffer();

  assert.equal(headBody.byteLength, 0);
}

for (const path of [
  '/static',
  '/static/brand/',
  '/static/missing.png',
  '/static/.env',
  '/static/%2e%2e%2fpackage.json',
  '/STATIC/missing.png',
]) {
  const response = await request(path, { check: 'static route boundary' });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const body = await readJson(response, 'static route boundary');

  assert.deepEqual(body, { error: 'not_found' });
}

const malformedStatic = await request('/static/%zz', { check: 'malformed static path' });

assert.equal(malformedStatic.status, 400, 'Malformed static path must return HTTP 400.');
assert.equal(malformedStatic.headers.get('cache-control'), 'no-store');
const malformedBody = await readJson(malformedStatic, 'malformed static path');

assert.deepEqual(malformedBody, { error: 'request_invalid' });

if (malformedStatic.headers.get('x-nive-path-guard') === 'rejected') {
  console.log('Malformed static path: rejection confirmed by the edge path guard.');
}

console.log('Gateway, localized Angular and Astro SSR, static assets, and route boundaries verified.');

// Tests for the consent-PDF dashboard feature (see docs/consent-pdf.md):
// the generation function itself (unit-level) and the JWT-protected
// endpoints built on top of it. Not to be confused with
// server/__tests__/consent-gating.test.js, which covers the separate,
// API-key-protected GVM-integration consent flow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-consent-pdf-'));
process.env.DATA_DIR = tmpDir;
process.env.JWT_SECRET = 'test-secret';

const app = require('../app');
const { generateConsentPdf, ConsentPdfError } = require('../utils/consentPdf');

let server;
let baseUrl;
let token;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'robin', password: 'Remmerswaal2026!' }),
  });
  const data = await res.json();
  token = data.token;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra };
}

async function createClient(overrides = {}) {
  const res = await fetch(`${baseUrl}/api/clients`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ company_name: 'Acme BV', status: 'Actief', ...overrides }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

// --- generateConsentPdf() itself ---

test('generateConsentPdf does not crash on missing scope and writes a file', async () => {
  const client = {
    id: 999001,
    company_name: 'Unit Test BV',
    contact_person: 'Jan',
    email: 'jan@unittest.nl',
    service_type: 'Externe Scan',
  };
  const result = await generateConsentPdf({ client, scope: undefined, generatedByName: 'Robin' });
  assert.ok(fs.existsSync(result.filePath));
  assert.ok(result.buffer.length > 0);
  assert.equal(result.usedDefaultServiceType, false);
});

test('generateConsentPdf falls back to Externe Scan text and flags it when service_type is empty', async () => {
  const client = { id: 999002, company_name: 'Unit Test BV', service_type: null };
  const result = await generateConsentPdf({ client, scope: '10.0.0.1', generatedByName: 'Robin' });
  assert.equal(result.usedDefaultServiceType, true);
  assert.ok(fs.existsSync(result.filePath));
});

test('generateConsentPdf rejects KnowBe4 with a clear error instead of generic scan text', async () => {
  const client = { id: 999003, company_name: 'Unit Test BV', service_type: 'KnowBe4' };
  await assert.rejects(
    () => generateConsentPdf({ client, scope: '10.0.0.1', generatedByName: 'Robin' }),
    (err) => err instanceof ConsentPdfError && err.code === 'SERVICE_TYPE_NOT_APPLICABLE'
  );
});

test('generateConsentPdf produces distinct filenames per client', async () => {
  const clientA = { id: 999004, company_name: 'A BV', service_type: 'Retainer' };
  const clientB = { id: 999005, company_name: 'B BV', service_type: 'Retainer' };
  const resultA = await generateConsentPdf({ client: clientA, scope: 'a.nl', generatedByName: 'Robin' });
  const resultB = await generateConsentPdf({ client: clientB, scope: 'b.nl', generatedByName: 'Robin' });
  assert.notEqual(resultA.filename, resultB.filename);
  assert.ok(resultA.filename.startsWith('consent-999004-'));
  assert.ok(resultB.filename.startsWith('consent-999005-'));
});

// --- Endpoints ---

test('POST /api/clients/:id/consent-pdf requires a non-empty scope', async () => {
  const client = await createClient({ service_type: 'Externe Scan' });
  const res = await fetch(`${baseUrl}/api/clients/${client.id}/consent-pdf`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('POST /api/clients/:id/consent-pdf returns a downloadable PDF and is listed afterwards', async () => {
  const client = await createClient({ service_type: 'Externe Scan' });
  const res = await fetch(`${baseUrl}/api/clients/${client.id}/consent-pdf`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.0/24' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') || '', /attachment/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0);

  const listRes = await fetch(`${baseUrl}/api/clients/${client.id}/consent-pdfs`, { headers: authHeaders() });
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.ok(list[0].filename.startsWith(`consent-${client.id}-`));
  assert.ok(list[0].created_at);

  const downloadRes = await fetch(`${baseUrl}/api/clients/${client.id}/consent-pdfs/${list[0].filename}`, {
    headers: authHeaders(),
  });
  assert.equal(downloadRes.status, 200);
});

test('POST /api/clients/:id/consent-pdf returns 400 for KnowBe4 clients instead of a PDF', async () => {
  const client = await createClient({ service_type: 'KnowBe4' });
  const res = await fetch(`${baseUrl}/api/clients/${client.id}/consent-pdf`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.0/24' }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /KnowBe4/);
});

test('POST /api/clients/:id/consent-pdf requires authentication', async () => {
  const client = await createClient({ service_type: 'Externe Scan' });
  const res = await fetch(`${baseUrl}/api/clients/${client.id}/consent-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: '10.0.0.0/24' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/clients/:id/consent-pdf 404s for unknown client', async () => {
  const res = await fetch(`${baseUrl}/api/clients/999999/consent-pdf`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.0/24' }),
  });
  assert.equal(res.status, 404);
});

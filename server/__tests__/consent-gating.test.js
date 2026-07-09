// Integration tests for the internal API's consent gate — the single most
// legally important rule in the system: a scan must never be created
// without a matching, non-revoked consent record. No GVM connection is
// involved here (by design: the CRM never talks to gvmd directly, see
// docs/gvm-integration.md), so nothing needs to be mocked for these tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DATA_DIR = tmpDir;
process.env.JWT_SECRET = 'test-secret';
process.env.INTERNAL_API_KEY = 'test-internal-key';

const app = require('../app');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`, 'Content-Type': 'application/json', ...extra };
}

async function createClient(name) {
  const res = await fetch(`${baseUrl}/api/internal/clients`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ company_name: name }),
  });
  assert.equal(res.status, 201);
  return res.json();
}

test('fails closed with 500 when INTERNAL_API_KEY is not configured', async () => {
  const original = process.env.INTERNAL_API_KEY;
  delete process.env.INTERNAL_API_KEY;
  try {
    const res = await fetch(`${baseUrl}/api/internal/clients`, {
      method: 'POST',
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: 'X' }),
    });
    assert.equal(res.status, 500);
  } finally {
    process.env.INTERNAL_API_KEY = original;
  }
});

test('rejects requests without an API key', async () => {
  const res = await fetch(`${baseUrl}/api/internal/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_name: 'X' }),
  });
  assert.equal(res.status, 401);
});

test('rejects requests with a wrong API key', async () => {
  const res = await fetch(`${baseUrl}/api/internal/clients`, {
    method: 'POST',
    headers: authHeaders({ Authorization: 'Bearer wrong-key' }),
    body: JSON.stringify({ company_name: 'X' }),
  });
  assert.equal(res.status, 401);
});

test('blocks scan creation with 403 when no consent exists at all', async () => {
  const client = await createClient('Acme BV (no consent)');
  const res = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '10.0.0.5' }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /toestemming/i);

  const scans = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, { headers: authHeaders() }).then((r) => r.json());
  assert.equal(scans.length, 0);
});

test('blocks scan creation when the only consent is revoked', async () => {
  const client = await createClient('Acme BV (revoked)');
  const consentRes = await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.5', authorized_by: 'Jan Jansen' }),
  });
  const consent = await consentRes.json();

  const revokeRes = await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent/${consent.id}/revoke`, {
    method: 'PATCH',
    headers: authHeaders(),
  });
  assert.equal(revokeRes.status, 200);
  const revoked = await revokeRes.json();
  assert.ok(revoked.revoked_at);

  const res = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '10.0.0.5' }),
  });
  assert.equal(res.status, 403);
});

test('revoking an already-revoked consent returns 409, not a silent success', async () => {
  const client = await createClient('Acme BV (double revoke)');
  const consentRes = await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.5', authorized_by: 'Jan Jansen' }),
  });
  const consent = await consentRes.json();
  await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent/${consent.id}/revoke`, { method: 'PATCH', headers: authHeaders() });

  const secondRevoke = await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent/${consent.id}/revoke`, { method: 'PATCH', headers: authHeaders() });
  assert.equal(secondRevoke.status, 409);
});

test('blocks scan creation when target is outside the consented scope', async () => {
  const client = await createClient('Acme BV (out of scope)');
  await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.0/24', authorized_by: 'Jan Jansen' }),
  });

  const res = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '203.0.113.9' }),
  });
  assert.equal(res.status, 403);
});

test('consent for a different client never authorizes this client\'s scan', async () => {
  const clientA = await createClient('Acme BV (A)');
  const clientB = await createClient('Acme BV (B)');
  await fetch(`${baseUrl}/api/internal/clients/${clientA.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.9', authorized_by: 'Jan Jansen' }),
  });

  const res = await fetch(`${baseUrl}/api/internal/clients/${clientB.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '10.0.0.9' }),
  });
  assert.equal(res.status, 403);
});

test('a nonexistent client returns 404 for scan requests, not a 403/500 leak', async () => {
  const res = await fetch(`${baseUrl}/api/internal/clients/999999/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '10.0.0.1' }),
  });
  assert.equal(res.status, 404);
});

test('missing target_value is rejected with 400 before any consent check', async () => {
  const client = await createClient('Acme BV (missing target)');
  const res = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('allows scan creation when a valid consent covers the target, defaults scan_config to Discovery', async () => {
  const client = await createClient('Acme BV (valid)');
  const consentRes = await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      scope: '10.0.0.0/24, example.nl',
      authorized_by: 'Jan Jansen',
      document_reference: 'https://example.nl/consent.pdf',
    }),
  });
  assert.equal(consentRes.status, 201);
  const consent = await consentRes.json();

  const res = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '10.0.0.42' }),
  });
  assert.equal(res.status, 201);
  const scan = await res.json();
  assert.equal(scan.consent_id, consent.id);
  assert.equal(scan.status, 'pending');
  assert.equal(scan.scan_config, 'Discovery');
  assert.equal(scan.gvm_task_id, null);
});

test('accepts a custom scan_config and covers a subdomain via bare-domain scope', async () => {
  const client = await createClient('Acme BV (subdomain)');
  await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: 'example.nl', authorized_by: 'Jan Jansen' }),
  });

  const res = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: 'sub.example.nl', scan_config: 'Full and fast' }),
  });
  assert.equal(res.status, 201);
  const scan = await res.json();
  assert.equal(scan.scan_config, 'Full and fast');
});

test('PATCH /api/internal/scans/:id/status updates status and sets completed_at on terminal states', async () => {
  const client = await createClient('Acme BV (status update)');
  await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.0/24', authorized_by: 'Jan Jansen' }),
  });
  const scanRes = await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '10.0.0.7' }),
  });
  const scan = await scanRes.json();

  const runningRes = await fetch(`${baseUrl}/api/internal/scans/${scan.id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'running', gvm_task_id: 'task-uuid', gvm_target_id: 'target-uuid' }),
  });
  assert.equal(runningRes.status, 200);
  const running = await runningRes.json();
  assert.equal(running.status, 'running');
  assert.equal(running.gvm_task_id, 'task-uuid');
  assert.equal(running.completed_at, null);

  const doneRes = await fetch(`${baseUrl}/api/internal/scans/${scan.id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'done' }),
  });
  const done = await doneRes.json();
  assert.equal(done.status, 'done');
  assert.ok(done.completed_at);
  assert.equal(done.gvm_task_id, 'task-uuid'); // preserved via COALESCE
});

test('GET /api/internal/scans?status=pending lists only pending scans', async () => {
  const client = await createClient('Acme BV (list pending)');
  await fetch(`${baseUrl}/api/internal/clients/${client.id}/consent`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ scope: '10.0.0.0/24', authorized_by: 'Jan Jansen' }),
  });
  await fetch(`${baseUrl}/api/internal/clients/${client.id}/scans`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ target_value: '10.0.0.99' }),
  });

  const res = await fetch(`${baseUrl}/api/internal/scans?status=pending`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const scans = await res.json();
  assert.ok(scans.length >= 1);
  assert.ok(scans.every((s) => s.status === 'pending'));
});

test('POST /api/internal/clients upserts by company_name on repeat calls', async () => {
  const first = await createClient('Acme BV (upsert)');
  const res = await fetch(`${baseUrl}/api/internal/clients`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ company_name: 'Acme BV (upsert)', city: 'Den Haag' }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.id, first.id);
  assert.equal(updated.city, 'Den Haag');
});

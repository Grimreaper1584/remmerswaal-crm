# GVM orchestrator

Standalone Python script that connects the CRM's internal API to a
Greenbone/GVM (`gvmd`) instance via GMP. It is deliberately **not** part of
the Node CRM process — see `docs/gvm-integration.md` in the repo root for
why. It never checks or bypasses consent; the CRM already enforced that
before a scan row ever reaches `status = pending`.

## Setup

```bash
cd orchestrator
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # then fill in real values, never commit .env
```

## Running one pass

```bash
set -a; source .env; set +a
.venv/bin/python gvm_orchestrator.py
```

Each run does one pass: pick up `pending` scans and start them in GVM,
then poll `running` scans for completion. It exits after one pass — no
internal loop — so scheduling is left entirely to cron (or systemd timers),
which also means an idle orchestrator uses zero CPU/RAM between runs. This
matters on a 4GB VPS that's already running the GVM stack.

## Scheduling with cron

```
*/5 * * * * cd /opt/remmerswaal-crm/orchestrator && set -a && . ./.env && set +a && ./.venv/bin/python gvm_orchestrator.py >> /var/log/gvm-orchestrator.log 2>&1
```

Every 5 minutes is a reasonable default: scan creation → running is
usually near-instant, and Discovery scans typically take minutes, not
seconds, so 5-minute polling won't meaningfully delay marking a scan
"done". Adjust to taste.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

All GVM and CRM-API interaction is mocked (`tests/test_orchestrator.py`) —
there is no live GVM instance available in development/CI, and the tests
are written to run without one.

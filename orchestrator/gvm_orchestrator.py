#!/usr/bin/env python3
"""GVM orchestrator for the Remmerswaal Security CRM.

Runs as a standalone, cron-triggered process (see docs/gvm-integration.md
for the recommended schedule). Each run does one pass:

  1. Fetch scans with status "pending" from the CRM's internal API. For
     each: resolve the scan config / scanner / port list UUIDs by name,
     create a GVM target + task, start it, and PATCH the scan back to
     "running" with the resulting gvm_task_id/gvm_target_id.
  2. Fetch scans with status "running". For each: poll the GVM task status
     and PATCH the scan to "done" or "failed" once GVM reaches a terminal
     state.

Consent is never checked or re-checked here — that happened, as a hard
gate, when the CRM created the "pending" scan row in the first place
(server/routes/internal.js). This script only ever acts on scans the CRM
already accepted.

UUIDs for scan configs/scanners/port lists are never hardcoded: they are
looked up by name filter on every run, since they differ per Greenbone
installation (see spec).
"""
import logging
import os
import sys

import requests
from gvm.connections import TLSConnection, UnixSocketConnection
from gvm.protocols.gmp import Gmp
from gvm.transforms import EtreeCheckCommandTransform

logger = logging.getLogger("gvm_orchestrator")

DEFAULT_SCAN_CONFIG = "Discovery"
TERMINAL_FAILURE_STATUSES = ("Stopped", "Interrupted")


class CrmClient:
    """Thin wrapper around the CRM's internal (API-key protected) API."""

    def __init__(self, base_url, api_key, timeout=15):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
        )

    def get_scans(self, status=None):
        params = {"status": status} if status else {}
        resp = self.session.get(
            f"{self.base_url}/api/internal/scans", params=params, timeout=self.timeout
        )
        resp.raise_for_status()
        return resp.json()

    def update_scan_status(
        self, scan_id, status, gvm_task_id=None, gvm_target_id=None, error_message=None
    ):
        payload = {"status": status}
        if gvm_task_id is not None:
            payload["gvm_task_id"] = gvm_task_id
        if gvm_target_id is not None:
            payload["gvm_target_id"] = gvm_target_id
        if error_message is not None:
            payload["error_message"] = error_message[:2000]

        resp = self.session.patch(
            f"{self.base_url}/api/internal/scans/{scan_id}/status",
            json=payload,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()


def build_connection():
    """Builds the GVM connection from env vars.

    GVM_CONNECTION_TYPE selects "socket" (default, preferred per spec) or
    "tls" (fallback if the gvmd unix socket isn't reachable from wherever
    this script runs).
    """
    conn_type = os.environ.get("GVM_CONNECTION_TYPE", "socket").strip().lower()

    if conn_type == "socket":
        socket_path = os.environ.get("GVM_SOCKET_PATH", "/run/gvmd/gvmd.sock")
        return UnixSocketConnection(path=socket_path)

    if conn_type == "tls":
        hostname = os.environ["GVM_HOST"]
        port = int(os.environ.get("GVM_PORT", "9390"))
        kwargs = {"hostname": hostname, "port": port}
        cafile = os.environ.get("GVM_CA_CERT_PATH")
        certfile = os.environ.get("GVM_CERT_PATH")
        keyfile = os.environ.get("GVM_KEY_PATH")
        if cafile:
            kwargs["cafile"] = cafile
        if certfile and keyfile:
            kwargs["certfile"] = certfile
            kwargs["keyfile"] = keyfile
        return TLSConnection(**kwargs)

    raise ValueError(
        f"Onbekende GVM_CONNECTION_TYPE: {conn_type!r} (verwacht 'socket' of 'tls')"
    )


def _find_id_by_name_filter(gmp_get_func, tag, name):
    """Looks up a GVM object's UUID by name, never by a hardcoded UUID.

    Uses a substring filter (name~'...') since exact-match filters can miss
    entries depending on gvmd's filter syntax quirks across versions, then
    prefers an exact (case-insensitive) name match among the results,
    falling back to the first candidate.
    """
    root = gmp_get_func(filter_string=f"name~'{name}'")
    candidates = root.findall(tag)
    if not candidates:
        raise LookupError(f"Geen {tag} gevonden in GVM voor naam-filter '{name}'.")

    exact = [
        c for c in candidates if (c.findtext("name") or "").strip().lower() == name.strip().lower()
    ]
    chosen = exact[0] if exact else candidates[0]
    object_id = chosen.get("id")
    if not object_id:
        raise LookupError(f"{tag} '{name}' gevonden maar zonder id-attribuut.")
    return object_id


def find_scan_config_id(gmp, name):
    return _find_id_by_name_filter(gmp.get_scan_configs, "config", name)


def find_scanner_id(gmp, name_filter):
    return _find_id_by_name_filter(gmp.get_scanners, "scanner", name_filter)


def find_port_list_id(gmp, name_filter):
    return _find_id_by_name_filter(gmp.get_port_lists, "port_list", name_filter)


def create_target(gmp, name, host, port_list_id):
    response = gmp.create_target(name=name, hosts=[host], port_list_id=port_list_id)
    target_id = response.get("id")
    if not target_id:
        raise RuntimeError("GVM create_target gaf geen id terug.")
    return target_id


def create_task(gmp, name, config_id, target_id, scanner_id):
    response = gmp.create_task(
        name=name, config_id=config_id, target_id=target_id, scanner_id=scanner_id
    )
    task_id = response.get("id")
    if not task_id:
        raise RuntimeError("GVM create_task gaf geen id terug.")
    return task_id


def get_task_status(gmp, task_id):
    root = gmp.get_task(task_id)
    task = root.find("task")
    if task is None:
        raise LookupError(f"Task {task_id} niet gevonden in GVM.")
    return (task.findtext("status") or "").strip()


def process_pending_scans(gmp, crm, scanner_name_filter, port_list_name_filter):
    pending = crm.get_scans(status="pending")
    for scan in pending:
        scan_id = scan["id"]
        try:
            scan_config_name = scan.get("scan_config") or DEFAULT_SCAN_CONFIG
            config_id = find_scan_config_id(gmp, scan_config_name)
            scanner_id = find_scanner_id(gmp, scanner_name_filter)
            port_list_id = find_port_list_id(gmp, port_list_name_filter)

            target_name = f"CRM scan #{scan_id} - {scan['target_value']}"
            target_id = create_target(gmp, target_name, scan["target_value"], port_list_id)

            client_label = scan.get("client_name") or scan.get("client_id")
            task_name = f"CRM scan #{scan_id} - {client_label}"
            task_id = create_task(gmp, task_name, config_id, target_id, scanner_id)

            gmp.start_task(task_id)

            crm.update_scan_status(
                scan_id, status="running", gvm_task_id=task_id, gvm_target_id=target_id
            )
            logger.info(
                "Scan #%s gestart in GVM (task=%s, target=%s, config=%s)",
                scan_id,
                task_id,
                target_id,
                scan_config_name,
            )
        except Exception as exc:  # noqa: BLE001 - one bad scan must not stop the batch
            logger.exception("Kon scan #%s niet starten in GVM", scan_id)
            try:
                crm.update_scan_status(scan_id, status="failed", error_message=str(exc))
            except Exception:  # noqa: BLE001
                logger.exception(
                    "Kon CRM ook niet informeren dat scan #%s gefaald is", scan_id
                )


def process_running_scans(gmp, crm):
    running = crm.get_scans(status="running")
    for scan in running:
        scan_id = scan["id"]
        task_id = scan.get("gvm_task_id")
        if not task_id:
            logger.warning("Scan #%s staat op 'running' zonder gvm_task_id, overgeslagen.", scan_id)
            continue

        try:
            status = get_task_status(gmp, task_id)
        except Exception:  # noqa: BLE001
            logger.exception(
                "Kon GVM-status van task %s niet ophalen (scan #%s)", task_id, scan_id
            )
            continue

        if status == "Done":
            crm.update_scan_status(scan_id, status="done")
            logger.info("Scan #%s afgerond.", scan_id)
        elif status in TERMINAL_FAILURE_STATUSES:
            crm.update_scan_status(
                scan_id, status="failed", error_message=f"GVM task status: {status}"
            )
            logger.warning("Scan #%s gefaald (GVM status: %s).", scan_id, status)
        # Any other status (New, Requested, Running, Queued, ...) just
        # means GVM isn't done yet — nothing to do this pass.


def run_once():
    crm_api_url = os.environ["CRM_API_URL"]
    crm_api_key = os.environ["CRM_API_KEY"]
    gvm_username = os.environ["GVM_USERNAME"]
    gvm_password = os.environ["GVM_PASSWORD"]
    scanner_name_filter = os.environ.get("GVM_SCANNER_NAME_FILTER", "OpenVAS")
    port_list_name_filter = os.environ.get("GVM_PORT_LIST_NAME_FILTER", "All IANA")

    crm = CrmClient(crm_api_url, crm_api_key)
    connection = build_connection()

    with Gmp(connection=connection, transform=EtreeCheckCommandTransform()) as gmp:
        gmp.authenticate(gvm_username, gvm_password)
        process_pending_scans(gmp, crm, scanner_name_filter, port_list_name_filter)
        process_running_scans(gmp, crm)


def main():
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    try:
        run_once()
    except Exception:
        logger.exception("Orchestrator-run mislukt")
        sys.exit(1)


if __name__ == "__main__":
    main()

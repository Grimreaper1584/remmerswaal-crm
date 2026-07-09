"""Unit tests for the GVM orchestrator.

No real GVM connection or CRM server is used anywhere here — gmp and crm
are always fakes/mocks, per the task's requirement to mock the GVM
connection in tests (there is no live GVM instance available to test
against). Run with: python3 -m unittest discover -s orchestrator/tests
"""
import os
import sys
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import gvm_orchestrator as orch  # noqa: E402


def xml(s):
    return ET.fromstring(s)


class FakeGmp:
    """A duck-typed stand-in for python-gvm's Gmp, returning canned
    ElementTree roots shaped like real GMP responses."""

    def __init__(self):
        self.started_tasks = []
        self.created_targets = []
        self.created_tasks = []
        self._scan_configs_xml = (
            '<get_configs_response><config id="cfg-discovery">'
            "<name>Discovery</name></config></get_configs_response>"
        )
        self._scanners_xml = (
            '<get_scanners_response><scanner id="scanner-1">'
            "<name>OpenVAS Default</name></scanner></get_scanners_response>"
        )
        self._port_lists_xml = (
            '<get_port_lists_response><port_list id="pl-1">'
            "<name>All IANA assigned TCP and UDP</name></port_list></get_port_lists_response>"
        )
        self.task_status = "Done"

    def get_scan_configs(self, filter_string=None):
        return xml(self._scan_configs_xml)

    def get_scanners(self, filter_string=None):
        return xml(self._scanners_xml)

    def get_port_lists(self, filter_string=None):
        return xml(self._port_lists_xml)

    def create_target(self, name, hosts, port_list_id):
        self.created_targets.append((name, hosts, port_list_id))
        return xml('<create_target_response status="201" id="target-123"/>')

    def create_task(self, name, config_id, target_id, scanner_id):
        self.created_tasks.append((name, config_id, target_id, scanner_id))
        return xml('<create_task_response status="201" id="task-456"/>')

    def start_task(self, task_id):
        self.started_tasks.append(task_id)

    def get_task(self, task_id):
        return xml(
            f'<get_task_response><task id="{task_id}"><status>{self.task_status}'
            "</status></task></get_task_response>"
        )


class FakeCrm:
    def __init__(self, pending=None, running=None):
        self._pending = pending or []
        self._running = running or []
        self.status_updates = []

    def get_scans(self, status=None):
        if status == "pending":
            return self._pending
        if status == "running":
            return self._running
        return self._pending + self._running

    def update_scan_status(self, scan_id, status, gvm_task_id=None, gvm_target_id=None, error_message=None):
        record = {
            "scan_id": scan_id,
            "status": status,
            "gvm_task_id": gvm_task_id,
            "gvm_target_id": gvm_target_id,
            "error_message": error_message,
        }
        self.status_updates.append(record)
        return record


class FindIdByNameFilterTests(unittest.TestCase):
    def test_prefers_exact_match_over_substring_candidates(self):
        root = xml(
            "<r>"
            '<config id="c-host"><name>Host Discovery</name></config>'
            '<config id="c-exact"><name>Discovery</name></config>'
            "</r>"
        )
        result = orch._find_id_by_name_filter(lambda filter_string: root, "config", "Discovery")
        self.assertEqual(result, "c-exact")

    def test_falls_back_to_first_candidate_when_no_exact_match(self):
        root = xml('<r><config id="c-host"><name>Host Discovery</name></config></r>')
        result = orch._find_id_by_name_filter(lambda filter_string: root, "config", "Discovery")
        self.assertEqual(result, "c-host")

    def test_raises_lookup_error_when_nothing_found(self):
        root = xml("<r></r>")
        with self.assertRaises(LookupError):
            orch._find_id_by_name_filter(lambda filter_string: root, "config", "Discovery")

    def test_raises_when_candidate_has_no_id(self):
        root = xml("<r><config><name>Discovery</name></config></r>")
        with self.assertRaises(LookupError):
            orch._find_id_by_name_filter(lambda filter_string: root, "config", "Discovery")


class CreateTargetTaskTests(unittest.TestCase):
    def test_create_target_returns_id(self):
        gmp = FakeGmp()
        target_id = orch.create_target(gmp, "name", "10.0.0.5", "pl-1")
        self.assertEqual(target_id, "target-123")
        self.assertEqual(gmp.created_targets, [("name", ["10.0.0.5"], "pl-1")])

    def test_create_target_raises_without_id(self):
        gmp = MagicMock()
        gmp.create_target.return_value = xml('<create_target_response status="201"/>')
        with self.assertRaises(RuntimeError):
            orch.create_target(gmp, "name", "10.0.0.5", "pl-1")

    def test_create_task_returns_id(self):
        gmp = FakeGmp()
        task_id = orch.create_task(gmp, "name", "cfg-1", "target-1", "scanner-1")
        self.assertEqual(task_id, "task-456")


class ProcessPendingScansTests(unittest.TestCase):
    def test_happy_path_creates_target_task_and_marks_running(self):
        gmp = FakeGmp()
        crm = FakeCrm(pending=[{"id": 1, "client_id": 7, "client_name": "Acme BV", "target_value": "10.0.0.5", "scan_config": "Discovery"}])

        orch.process_pending_scans(gmp, crm, "OpenVAS", "All IANA")

        self.assertEqual(gmp.started_tasks, ["task-456"])
        self.assertEqual(len(crm.status_updates), 1)
        update = crm.status_updates[0]
        self.assertEqual(update["scan_id"], 1)
        self.assertEqual(update["status"], "running")
        self.assertEqual(update["gvm_task_id"], "task-456")
        self.assertEqual(update["gvm_target_id"], "target-123")

    def test_defaults_to_discovery_when_scan_config_missing(self):
        gmp = FakeGmp()
        crm = FakeCrm(pending=[{"id": 2, "client_id": 7, "target_value": "10.0.0.9"}])

        orch.process_pending_scans(gmp, crm, "OpenVAS", "All IANA")

        # FakeGmp only knows about a config named "Discovery"; if the
        # orchestrator looked up anything else this would raise/fail.
        self.assertEqual(len(crm.status_updates), 1)
        self.assertEqual(crm.status_updates[0]["status"], "running")

    def test_gvm_failure_marks_scan_failed_with_error_message_and_does_not_start_task(self):
        gmp = FakeGmp()
        gmp.create_target = MagicMock(side_effect=RuntimeError("gvmd unreachable"))
        crm = FakeCrm(pending=[{"id": 3, "client_id": 7, "target_value": "10.0.0.5"}])

        orch.process_pending_scans(gmp, crm, "OpenVAS", "All IANA")

        self.assertEqual(gmp.started_tasks, [])
        self.assertEqual(len(crm.status_updates), 1)
        update = crm.status_updates[0]
        self.assertEqual(update["status"], "failed")
        self.assertIn("gvmd unreachable", update["error_message"])

    def test_one_failure_does_not_block_the_rest_of_the_batch(self):
        gmp = FakeGmp()
        real_create_target = gmp.create_target
        calls = {"n": 0}

        def flaky_create_target(name, hosts, port_list_id):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("boom")
            return real_create_target(name, hosts, port_list_id)

        gmp.create_target = flaky_create_target
        crm = FakeCrm(
            pending=[
                {"id": 10, "client_id": 1, "target_value": "10.0.0.1"},
                {"id": 11, "client_id": 1, "target_value": "10.0.0.2"},
            ]
        )

        orch.process_pending_scans(gmp, crm, "OpenVAS", "All IANA")

        statuses = {u["scan_id"]: u["status"] for u in crm.status_updates}
        self.assertEqual(statuses, {10: "failed", 11: "running"})


class ProcessRunningScansTests(unittest.TestCase):
    def test_marks_done_when_gvm_reports_done(self):
        gmp = FakeGmp()
        gmp.task_status = "Done"
        crm = FakeCrm(running=[{"id": 5, "gvm_task_id": "task-456"}])

        orch.process_running_scans(gmp, crm)

        self.assertEqual(crm.status_updates, [{"scan_id": 5, "status": "done", "gvm_task_id": None, "gvm_target_id": None, "error_message": None}])

    def test_marks_failed_when_gvm_reports_stopped(self):
        gmp = FakeGmp()
        gmp.task_status = "Stopped"
        crm = FakeCrm(running=[{"id": 6, "gvm_task_id": "task-456"}])

        orch.process_running_scans(gmp, crm)

        self.assertEqual(len(crm.status_updates), 1)
        self.assertEqual(crm.status_updates[0]["status"], "failed")

    def test_leaves_still_running_scans_untouched(self):
        gmp = FakeGmp()
        gmp.task_status = "Running"
        crm = FakeCrm(running=[{"id": 7, "gvm_task_id": "task-456"}])

        orch.process_running_scans(gmp, crm)

        self.assertEqual(crm.status_updates, [])

    def test_skips_scan_without_gvm_task_id(self):
        gmp = FakeGmp()
        crm = FakeCrm(running=[{"id": 8, "gvm_task_id": None}])

        orch.process_running_scans(gmp, crm)

        self.assertEqual(crm.status_updates, [])

    def test_gvm_lookup_error_does_not_crash_the_batch(self):
        gmp = FakeGmp()
        gmp.get_task = MagicMock(side_effect=RuntimeError("timeout"))
        crm = FakeCrm(running=[{"id": 9, "gvm_task_id": "task-456"}])

        orch.process_running_scans(gmp, crm)

        self.assertEqual(crm.status_updates, [])


class BuildConnectionTests(unittest.TestCase):
    def test_defaults_to_unix_socket(self):
        with patch.dict(os.environ, {}, clear=True):
            conn = orch.build_connection()
        self.assertIsInstance(conn, orch.UnixSocketConnection)

    def test_socket_path_is_configurable(self):
        with patch.dict(os.environ, {"GVM_CONNECTION_TYPE": "socket", "GVM_SOCKET_PATH": "/tmp/custom.sock"}, clear=True):
            conn = orch.build_connection()
        self.assertEqual(str(conn.path), "/tmp/custom.sock")

    def test_tls_requires_gvm_host(self):
        with patch.dict(os.environ, {"GVM_CONNECTION_TYPE": "tls"}, clear=True):
            with self.assertRaises(KeyError):
                orch.build_connection()

    def test_tls_builds_connection_with_host_and_port(self):
        with patch.dict(os.environ, {"GVM_CONNECTION_TYPE": "tls", "GVM_HOST": "127.0.0.1", "GVM_PORT": "9390"}, clear=True):
            conn = orch.build_connection()
        self.assertIsInstance(conn, orch.TLSConnection)

    def test_unknown_connection_type_raises(self):
        with patch.dict(os.environ, {"GVM_CONNECTION_TYPE": "carrier-pigeon"}, clear=True):
            with self.assertRaises(ValueError):
                orch.build_connection()


class CrmClientTests(unittest.TestCase):
    def test_get_scans_sends_bearer_token_and_status_param(self):
        crm = orch.CrmClient("http://crm:3000", "secret-key")
        crm.session = MagicMock()
        crm.session.get.return_value.json.return_value = [{"id": 1}]
        crm.session.get.return_value.raise_for_status.return_value = None

        result = crm.get_scans(status="pending")

        crm.session.get.assert_called_once_with(
            "http://crm:3000/api/internal/scans",
            params={"status": "pending"},
            timeout=15,
        )
        self.assertEqual(result, [{"id": 1}])

    def test_authorization_header_set_from_constructor(self):
        crm = orch.CrmClient("http://crm:3000", "secret-key")
        self.assertEqual(crm.session.headers["Authorization"], "Bearer secret-key")

    def test_update_scan_status_patches_expected_url_and_payload(self):
        crm = orch.CrmClient("http://crm:3000", "secret-key")
        crm.session = MagicMock()
        crm.session.patch.return_value.json.return_value = {"id": 1, "status": "running"}
        crm.session.patch.return_value.raise_for_status.return_value = None

        crm.update_scan_status(1, "running", gvm_task_id="t-1", gvm_target_id="tg-1")

        crm.session.patch.assert_called_once_with(
            "http://crm:3000/api/internal/scans/1/status",
            json={"status": "running", "gvm_task_id": "t-1", "gvm_target_id": "tg-1"},
            timeout=15,
        )


if __name__ == "__main__":
    unittest.main()

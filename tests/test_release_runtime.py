from __future__ import annotations

import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "leitstand-release.py"
SPEC = importlib.util.spec_from_file_location("leitstand_release", SCRIPT_PATH)
assert SPEC and SPEC.loader
release = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release
SPEC.loader.exec_module(release)

ATTEMPT = "20260714T000000000000Z-1-deadbeef"
WEB_TEMPLATE = (REPO_ROOT / "deploy/systemd/leitstand.service").read_text("utf-8")
STORAGE_TEMPLATE = (REPO_ROOT / "deploy/systemd/leitstand-storage-health.service").read_text("utf-8")


class ReleaseRuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="leitstand-release-test-")
        self.root = Path(self.temp.name)
        self.paths = release.Paths(
            self.root / "lib" / "leitstand",
            self.root / "state" / "leitstand" / "releases",
            self.root / "config" / "systemd" / "user" / "leitstand.service",
            self.root / "config" / "systemd" / "user" / "leitstand-storage-health.service",
        )
        self.config_path = self.root / "config" / "leitstand" / "runtime.json"
        self.config_path.parent.mkdir(parents=True)
        self.config_payload = {
            "schema_version": 1,
            "kind": "leitstand_local_runtime_config",
            "canonical_origin": "https://leitstand.example.test",
            "ecosystem_map_manifest_path": str(self.root / "systemkatalog/rendered/manifest.json"),
            "ecosystem_map_source_root": str(self.root / "systemkatalog"),
            "artifact_root": str(self.root / "artifacts"),
            "heim_pc_root": str(self.root / "heim-pc"),
            "storage_state_root": str(self.root / "state/storage-health"),
        }
        self.config_path.write_text(json.dumps(self.config_payload), encoding="utf-8")
        os.chmod(self.config_path, 0o600)
        self.config = release.load_runtime_config(self.config_path)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _populate_release(self, target: Path, head: str) -> None:
        (target / "dist").mkdir(parents=True)
        (target / "deploy/systemd").mkdir(parents=True)
        (target / "scripts").mkdir()
        (target / ".git").mkdir()
        (target / "package.json").write_text('{"name":"leitstand"}\n', encoding="utf-8")
        (target / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n", encoding="utf-8")
        (target / "dist/server.js").write_text("console.log('ok');\n", encoding="utf-8")
        (target / "deploy/systemd/leitstand.service").write_text(WEB_TEMPLATE, encoding="utf-8")
        (target / "deploy/systemd/leitstand-storage-health.service").write_text(
            STORAGE_TEMPLATE, encoding="utf-8"
        )
        script = target / "scripts/leitstand-release.py"
        script.write_text("#!/usr/bin/env python3\n", encoding="utf-8")
        os.chmod(script, 0o755)
        collector = target / "scripts/collect-storage-health-runtime"
        collector.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        os.chmod(collector, 0o755)
        (target / ".git/HEAD").write_text(f"{head}\n", encoding="ascii")

    def create_verified_release(self, head: str, *, seal: bool = True) -> Path:
        target = release.release_path(self.paths, head)
        self._populate_release(target, head)
        release.private_release_permissions(target)
        manifest = {
            "schema_version": release.SCHEMA_VERSION,
            "kind": release.MANIFEST_KIND,
            "release_id": release.release_id(head),
            "created_at": "2026-07-14T00:00:00Z",
            "origin": "git-archive",
            "source_commit": head,
            "source_tree": "b" * 40,
            "source_date_epoch": 1_700_000_000,
            "origin_main": head,
            "required_ref": "origin/main",
            "required_ref_head": head,
            "origin_url": "git@example.invalid:heimgewebe/leitstand.git",
            "release_tree_sha256": release.release_tree_sha256(target),
            "critical_artifacts": release.critical_hashes(target),
            "source_validation_commands": [
                list(command) for command in release.SOURCE_VALIDATION_COMMANDS
            ],
            "release_validation_commands": [
                list(command) for command in release.RELEASE_VALIDATION_COMMANDS
            ],
            "sealed": True,
            "attempt_id": ATTEMPT,
            "import_evidence": None,
            "runtime_links": release.runtime_links(target),
            "does_not_establish": [],
        }
        (target / release.MANIFEST_NAME).write_bytes(release.canonical_json_bytes(manifest))
        os.chmod(target / release.MANIFEST_NAME, 0o600)
        if seal:
            release.seal_release(target)
        return target

    def _rendered_specs(self, target: Path):
        return release.rendered_unit_specs(self.paths, target, self.config)

    def _tar(self, *, name: str, kind: str, linkname: str = "") -> tarfile.TarFile:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            member = tarfile.TarInfo(name)
            if kind == "file":
                payload = b"safe\n"
                member.size = len(payload)
                member.mode = 0o755
                archive.addfile(member, io.BytesIO(payload))
            elif kind == "dir":
                member.type = tarfile.DIRTYPE
                archive.addfile(member)
            elif kind == "symlink":
                member.type = tarfile.SYMTYPE
                member.linkname = linkname
                archive.addfile(member)
            elif kind == "hardlink":
                member.type = tarfile.LNKTYPE
                member.linkname = linkname
                archive.addfile(member)
            elif kind == "fifo":
                member.type = tarfile.FIFOTYPE
                archive.addfile(member)
            else:
                raise AssertionError(kind)
        buffer.seek(0)
        return tarfile.open(fileobj=buffer, mode="r:")

    def test_head_and_release_identity_are_strict(self) -> None:
        head = "a" * 40
        self.assertEqual(release.validate_head(head), head)
        self.assertEqual(release.release_id(head), f"{head}-runtime-v1")
        for invalid in ("a" * 39, "A" * 40, "main", "a" * 41):
            with self.subTest(invalid=invalid), self.assertRaises(release.ReleaseError):
                release.validate_head(invalid)

    def test_runtime_config_is_exact_typed_and_hash_bound(self) -> None:
        self.assertEqual(self.config.canonical_origin, "https://leitstand.example.test")
        self.assertRegex(self.config.sha256, r"^[0-9a-f]{64}$")
        changed = dict(self.config_payload)
        changed["surprise"] = True
        self.config_path.write_text(json.dumps(changed), encoding="utf-8")
        with self.assertRaisesRegex(release.ReleaseError, "key mismatch"):
            release.load_runtime_config(self.config_path)

    def test_runtime_config_rejects_non_https_relative_and_whitespace_paths(self) -> None:
        cases = (
            ("canonical_origin", "http://leitstand.example.test"),
            ("artifact_root", "relative/path"),
            ("heim_pc_root", "/tmp/has space"),
        )
        for key, value in cases:
            payload = dict(self.config_payload)
            payload[key] = value
            self.config_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.subTest(key=key), self.assertRaises(release.ReleaseError):
                release.load_runtime_config(self.config_path)

    def test_both_versioned_units_render_exact_release_and_safe_paths(self) -> None:
        target = self.create_verified_release("1" * 40)
        specs = self._rendered_specs(target)
        self.assertEqual({spec.service for spec in specs}, {release.WEB_SERVICE, release.STORAGE_SERVICE})
        for spec in specs:
            text = spec.content.decode()
            self.assertIn(str(target), text)
            self.assertNotIn("@", text)
        release.validate_unit_content(specs[0].content, target=target, config=self.config)
        release.validate_storage_unit_content(specs[1].content, target=target, config=self.config)

    def test_unit_validation_rejects_wide_bind_and_nonversioned_collector(self) -> None:
        target = self.create_verified_release("2" * 40)
        web, storage = self._rendered_specs(target)
        with self.assertRaises(release.ReleaseError):
            release.validate_unit_content(
                web.content.replace(b"127.0.0.1", b"0.0.0.0"),
                target=target,
                config=self.config,
            )
        with self.assertRaises(release.ReleaseError):
            release.validate_storage_unit_content(
                storage.content.replace(
                    b"/scripts/collect-storage-health-runtime", b"/bin/true"
                ),
                target=target,
                config=self.config,
            )
        other = self.root / "other-release"
        with self.assertRaisesRegex(release.ReleaseError, "exactly one line"):
            release.validate_unit_content(
                web.content.replace(str(target).encode(), str(other).encode(), 1),
                target=target,
                config=self.config,
            )

    def test_release_verification_binds_tree_artifacts_git_head_and_seal(self) -> None:
        target = self.create_verified_release("3" * 40)
        manifest = release.verify_release_path(self.paths, target)
        self.assertEqual(manifest["source_commit"], "3" * 40)
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o500)
        os.chmod(target, 0o700)
        os.chmod(target / "dist", 0o700)
        os.chmod(target / "dist/server.js", 0o600)
        (target / "dist/server.js").write_text("tampered\n", encoding="utf-8")
        with self.assertRaisesRegex(release.ReleaseError, "tree SHA-256 mismatch"):
            release.verify_release_path(self.paths, target)

    def test_manifest_rejects_extra_missing_wrong_type_and_validation_drift(self) -> None:
        target = self.create_verified_release("4" * 40, seal=False)
        path = target / release.MANIFEST_NAME
        base = json.loads(path.read_text())
        cases = []
        extra = dict(base); extra["surprise"] = True; cases.append(extra)
        missing = dict(base); missing.pop("runtime_links"); cases.append(missing)
        wrong = dict(base); wrong["schema_version"] = True; cases.append(wrong)
        commands = dict(base); commands["source_validation_commands"] = [["true"]]; cases.append(commands)
        for payload in cases:
            with self.subTest(keys=sorted(payload)), self.assertRaises(release.ReleaseError):
                release.validate_manifest(payload, target=target)

    def test_safe_tar_rejects_traversal_links_and_special_entries(self) -> None:
        safe = self._tar(name="scripts/tool", kind="file")
        destination = self.root / "extract-safe"
        with safe:
            release.safe_extract_tar(safe, destination)
        self.assertEqual((destination / "scripts/tool").read_bytes(), b"safe\n")
        for index, (name, kind, link) in enumerate(
            (("../escape", "file", ""), ("link", "symlink", "/etc/passwd"), ("hard", "hardlink", "safe"), ("pipe", "fifo", ""))
        ):
            archive = self._tar(name=name, kind=kind, linkname=link)
            with self.subTest(kind=kind), archive, self.assertRaises(release.ReleaseError):
                release.safe_extract_tar(archive, self.root / f"extract-{index}")

    def test_deploy_lock_collision_times_out_without_mutation(self) -> None:
        release.prepare_state_dirs(self.paths)
        lock = self.paths.lock_file
        lock.write_bytes(b"holder")
        os.chmod(lock, 0o600)
        descriptor = os.open(lock, os.O_RDWR | os.O_CLOEXEC)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(release.ReleaseError, "held by another"):
                with release.deploy_lock(self.paths, 0.03, command="test"):
                    self.fail("lock unexpectedly acquired")
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)
        self.assertEqual(lock.read_bytes(), b"holder")

    def test_receipts_are_unique_create_only_and_hash_bound(self) -> None:
        first, first_digest = release.write_receipt(self.paths, "test", {"value": "bound"}, attempt_id=ATTEMPT)
        second, second_digest = release.write_receipt(self.paths, "test", {"value": "bound"}, attempt_id=ATTEMPT)
        self.assertNotEqual(first, second)
        for path, digest in ((first, first_digest), (second, second_digest)):
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            self.assertEqual(path.with_suffix(".json.sha256").read_text("ascii"), f"{digest}  {path.name}\n")

    def test_source_identity_binds_clean_checkout_to_live_remote_main(self) -> None:
        remote = self.root / "origin.git"
        repo = self.root / "repo"; repo.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=repo, check=True)
        (repo / "README.md").write_text("test\n", encoding="utf-8")
        subprocess.run(["git", "add", "README.md"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "test"], cwd=repo, check=True)
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
        subprocess.run(["git", "clone", "-q", "--bare", str(repo), str(remote)], check=True)
        subprocess.run(["git", "remote", "add", "origin", str(remote)], cwd=repo, check=True)
        subprocess.run(["git", "update-ref", "refs/remotes/origin/main", head], cwd=repo, check=True)
        identity = release.source_identity(repo, head)
        self.assertEqual(identity["source_commit"], head)
        self.assertEqual(identity["origin_main"], head)
        self.assertGreater(identity["source_date_epoch"], 0)
        (repo / "dirty.txt").write_text("dirty\n", encoding="utf-8")
        with self.assertRaisesRegex(release.ReleaseError, "not clean"):
            release.source_identity(repo, head)
        (repo / "dirty.txt").unlink()
        subprocess.run(["git", "commit", "--allow-empty", "-q", "-m", "new"], cwd=repo, check=True)
        new_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
        with self.assertRaisesRegex(release.ReleaseError, "does not match"):
            release.source_identity(repo, new_head)

    def test_install_units_restores_both_files_when_readback_fails(self) -> None:
        target = self.create_verified_release("5" * 40)
        self.paths.unit_target.parent.mkdir(parents=True)
        assert self.paths.storage_unit_target is not None
        self.paths.unit_target.write_bytes(b"old web\n"); os.chmod(self.paths.unit_target, 0o600)
        self.paths.storage_unit_target.write_bytes(b"old storage\n"); os.chmod(self.paths.storage_unit_target, 0o600)
        def properties(service, fields=None):
            return {"LoadState": "loaded", "FragmentPath": str(self.root / "wrong")}
        with (
            patch.object(release, "_systemctl_properties", side_effect=properties),
            patch.object(release, "run", return_value=subprocess.CompletedProcess([], 0, "", "")),
        ):
            with self.assertRaisesRegex(release.ReleaseError, "restored"):
                release.install_units(self.paths, target, self.config)
        self.assertEqual(self.paths.unit_target.read_bytes(), b"old web\n")
        self.assertEqual(self.paths.storage_unit_target.read_bytes(), b"old storage\n")

    def test_restore_transaction_restores_two_units_and_selectors(self) -> None:
        first = self.root / "releases/first"; second = self.root / "releases/second"
        first.mkdir(parents=True); second.mkdir()
        release.atomic_symlink(self.paths.current, os.path.relpath(first, self.paths.current.parent))
        release.atomic_symlink(self.paths.previous, os.path.relpath(second, self.paths.previous.parent))
        current = release.read_link_state(self.paths.current)
        previous = release.read_link_state(self.paths.previous)
        self.paths.unit_target.parent.mkdir(parents=True, exist_ok=True)
        assert self.paths.storage_unit_target is not None
        self.paths.unit_target.write_bytes(b"web\n"); os.chmod(self.paths.unit_target, 0o600)
        self.paths.storage_unit_target.write_bytes(b"storage\n"); os.chmod(self.paths.storage_unit_target, 0o600)
        states = release.snapshot_units(self.paths)
        self.paths.unit_target.write_bytes(b"changed\n")
        self.paths.storage_unit_target.write_bytes(b"changed\n")
        release.atomic_symlink(self.paths.current, os.path.relpath(second, self.paths.current.parent))
        with patch.object(release, "run", return_value=subprocess.CompletedProcess([], 0, "", "")):
            result = release._restore_transaction(
                self.paths,
                current=current,
                previous=previous,
                units=states,
                web_was_active=False,
                storage_was_loaded=False,
                prior_target=None,
            )
        self.assertTrue(result["complete"])
        self.assertEqual(release.snapshot_units(self.paths), states)
        self.assertEqual(release.read_link_state(self.paths.current), current)

    def test_route_matrix_parses_redirect_structurally_and_checks_removed_routes(self) -> None:
        def request(method, path):
            if path in release.ACTIVE_ROUTES:
                return 200, path.encode(), {}
            if path == "/repobriefs":
                return 301, b"", {"location": "https://leitstand.example.test/repoground"}
            if path in release.REMOVED_ROUTES or (method, path) == ("POST", "/events"):
                return 404, b"missing", {}
            raise AssertionError((method, path))
        result = release._route_matrix(
            request, label="test", expected_origin="https://leitstand.example.test"
        )
        self.assertEqual(result["repobriefs"]["status"], 301)
        self.assertEqual(result["post_events"]["status"], 404)

    def test_route_matrix_rejects_wrong_redirect_even_with_301(self) -> None:
        def request(method, path):
            if path in release.ACTIVE_ROUTES:
                return 200, b"ok", {}
            if path == "/repobriefs":
                return 301, b"", {"location": "/wrong"}
            return 404, b"", {}
        with self.assertRaisesRegex(release.ReleaseError, "redirect failed"):
            release._route_matrix(request, label="test")

    def test_health_validation_requires_exact_thresholds_and_fresh_sources(self) -> None:
        head = "6" * 40
        health = {
            "status": "ok",
            "git": {"head": head, "status": "ok"},
            "snapshots": {
                name: {"status": "ok", "stale_after_seconds": threshold}
                for name, threshold in release.SNAPSHOT_THRESHOLDS.items()
            },
        }
        release._validate_health(json.dumps(health).encode(), head, label="test")
        health["snapshots"]["storage_health"]["stale_after_seconds"] = 1
        with self.assertRaisesRegex(release.ReleaseError, "storage_health"):
            release._validate_health(json.dumps(health).encode(), head, label="test")

    def _postflight_properties(self, target: Path):
        pid = os.getpid()
        web = {
            "LoadState": "loaded",
            "ActiveState": "active",
            "SubState": "running",
            "Result": "success",
            "NRestarts": "0",
            "MainPID": str(pid),
            "FragmentPath": str(self.paths.unit_target),
            "WorkingDirectory": str(target),
            "ExecMainStatus": "0",
        }
        assert self.paths.storage_unit_target is not None
        storage = {
            "LoadState": "loaded",
            "ActiveState": "inactive",
            "SubState": "dead",
            "Result": "success",
            "NRestarts": "0",
            "MainPID": "0",
            "FragmentPath": str(self.paths.storage_unit_target),
            "WorkingDirectory": str(target),
            "ExecMainStatus": "0",
        }
        return web, storage

    def _http_fixture(self, head: str):
        health = json.dumps({
            "status": "ok",
            "git": {"head": head, "status": "ok"},
            "snapshots": {
                name: {"status": "ok", "stale_after_seconds": threshold}
                for name, threshold in release.SNAPSHOT_THRESHOLDS.items()
            },
        }).encode()
        def response(method, path):
            if path == "/health": return 200, health, {}
            if path == "/repobriefs": return 301, b"", {"location": "/repoground"}
            if path in release.REMOVED_ROUTES or (method, path) == ("POST", "/events"):
                return 404, b"missing", {}
            if path == "/ecosystem-map": return 200, b"data-ecosystem-map-canvas /assets/ecosystem-map.mjs", {}
            if path == "/assets/ecosystem-map.mjs": return 200, b"/vendor/mermaid/mermaid.esm.min.mjs", {}
            if path == "/vendor/mermaid/mermaid.esm.min.mjs": return 200, b"mermaid", {}
            if path in release.ACTIVE_ROUTES: return 200, b"ok", {}
            raise AssertionError((method, path))
        return response

    def test_postflight_binds_two_units_routes_health_process_and_listener(self) -> None:
        head = "7" * 40
        target = self.create_verified_release(head)
        release.atomic_symlink(self.paths.current, os.path.relpath(target, self.paths.current.parent))
        web, storage = self._postflight_properties(target)
        calls = {release.WEB_SERVICE: 0}
        def properties(service=release.WEB_SERVICE, fields=None):
            if service == release.WEB_SERVICE:
                calls[service] += 1
                return dict(web)
            return dict(storage)
        fixture = self._http_fixture(head)
        original_resolve = Path.resolve
        def resolved(value, strict=False):
            if str(value) == f"/proc/{os.getpid()}/cwd":
                return target
            return original_resolve(value, strict=strict)
        with (
            patch.object(release, "_systemctl_properties", side_effect=properties),
            patch.object(release, "_http_request", side_effect=lambda host, port, method, path, tls, timeout=8.0: fixture(method, path)),
            patch.object(release, "_canonical_request", side_effect=lambda config, method, path: fixture(method, path)),
            patch.object(release, "_verify_loopback_listener", return_value=["127.0.0.1:3000"]),
            patch.object(Path, "resolve", autospec=True, side_effect=resolved),
        ):
            result = release.postflight(self.paths, target, self.config, stability_seconds=0)
        self.assertEqual(result["source_commit"], head)
        self.assertEqual(result["local_routes"]["post_events"]["status"], 404)
        self.assertEqual(result["canonical_routes"]["repobriefs"]["status"], 301)

    def test_switch_failure_restores_unmanaged_first_cutover_state(self) -> None:
        target = self.create_verified_release("8" * 40)
        self.paths.unit_target.parent.mkdir(parents=True)
        assert self.paths.storage_unit_target is not None
        self.paths.unit_target.write_bytes(b"old web\n"); os.chmod(self.paths.unit_target, 0o600)
        self.paths.storage_unit_target.write_bytes(b"old storage\n"); os.chmod(self.paths.storage_unit_target, 0o600)
        old_states = release.snapshot_units(self.paths)
        before = {"LoadState": "loaded", "ActiveState": "inactive", "WorkingDirectory": str(self.root / "legacy"), "Result": "success", "ExecMainStatus": "0"}
        with (
            patch.object(release, "_systemctl_properties", return_value=before),
            patch.object(release, "_running_target", return_value=self.root / "legacy"),
            patch.object(release, "install_units", return_value={}),
            patch.object(release, "_run_storage_producer", return_value={}),
            patch.object(release, "_restart_service"),
            patch.object(release, "postflight", side_effect=release.ReleaseError("route failed")),
            patch.object(release, "run", return_value=subprocess.CompletedProcess([], 0, "", "")),
        ):
            with self.assertRaisesRegex(release.ReleaseError, "prior state restored"):
                release.switch_transaction(self.paths, target, self.config, operation="switch", attempt_id=ATTEMPT)
        self.assertEqual(release.snapshot_units(self.paths), old_states)
        self.assertFalse(self.paths.current.exists())

    def test_deploy_idempotency_reuses_completion_without_switch_effect(self) -> None:
        head = "9" * 40
        target = self.create_verified_release(head)
        release.prepare_state_dirs(self.paths)
        release.atomic_symlink(self.paths.current, os.path.relpath(target, self.paths.current.parent))
        key = release._deployment_key(head, self.config)
        receipt_path, receipt_sha = release.write_receipt(
            self.paths,
            "deploy",
            {"success": True, "source_commit": head},
            attempt_id=ATTEMPT,
        )
        release._write_completion(
            self.paths,
            key,
            head=head,
            config=self.config,
            receipt_path=str(receipt_path),
            receipt_sha256=receipt_sha,
        )
        manifest = release.verify_release_path(self.paths, target)
        with (
            patch.object(release, "build_release", return_value=(target, manifest, False)),
            patch.object(
                release,
                "source_identity",
                return_value={
                    key: manifest[key]
                    for key in (
                        "source_commit",
                        "source_tree",
                        "source_date_epoch",
                        "origin_main",
                        "required_ref",
                        "required_ref_head",
                        "origin_url",
                    )
                },
            ),
            patch.object(release, "units_match", return_value=True),
            patch.object(release, "postflight", return_value={"source_commit": head}),
            patch.object(release, "switch_transaction") as switched,
        ):
            result = release.deploy_release(self.paths, self.root, head, self.config, attempt_id=ATTEMPT)
        self.assertTrue(result["idempotent_replay"])
        switched.assert_not_called()

    def test_route_matrix_rejects_absolute_redirect_to_wrong_origin(self) -> None:
        def request(method, path):
            if path in release.ACTIVE_ROUTES:
                return 200, b"ok", {}
            if path == "/repobriefs":
                return 301, b"", {"location": "https://attacker.invalid/repoground"}
            return 404, b"", {}
        with self.assertRaisesRegex(release.ReleaseError, "redirect failed"):
            release._route_matrix(
                request,
                label="canonical",
                expected_origin="https://leitstand.example.test",
            )

    def test_successful_switch_writes_start_receipt_before_effect_evidence(self) -> None:
        head = "a" * 40
        target = self.create_verified_release(head)
        self.paths.unit_target.parent.mkdir(parents=True, exist_ok=True)
        assert self.paths.storage_unit_target is not None
        self.paths.unit_target.write_bytes(b"old web unit\n")
        self.paths.storage_unit_target.write_bytes(b"old storage unit\n")
        os.chmod(self.paths.unit_target, 0o600)
        os.chmod(self.paths.storage_unit_target, 0o600)
        before = {"LoadState": "loaded", "ActiveState": "inactive", "WorkingDirectory": str(self.root / "legacy"), "Result": "success", "ExecMainStatus": "0"}
        with (
            patch.object(release, "_systemctl_properties", return_value=before),
            patch.object(release, "_running_target", return_value=self.root / "legacy"),
            patch.object(release, "install_units", return_value={"units": "ok"}),
            patch.object(release, "_run_storage_producer", return_value={"Result": "success"}),
            patch.object(release, "_restart_service"),
            patch.object(release, "postflight", return_value={"source_commit": head}),
        ):
            result = release.switch_transaction(
                self.paths,
                target,
                self.config,
                operation="switch",
                attempt_id=ATTEMPT,
            )
        start = Path(result["start_receipt_path"])
        self.assertTrue(start.is_file())
        self.assertEqual(hashlib.sha256(start.read_bytes()).hexdigest(), result["start_receipt_sha256"])
        payload = json.loads(start.read_text())
        self.assertEqual(payload["kind"], "switch-started")
        self.assertFalse(payload["effect_started"])
        self.assertEqual(payload["source_commit"], head)
        self.assertEqual(set(payload["prior_units"]), {release.WEB_SERVICE, release.STORAGE_SERVICE})
        backup = result["prior_state_backup"]
        backup_manifest = Path(backup["manifest_path"])
        self.assertTrue(backup_manifest.is_file())
        self.assertEqual(hashlib.sha256(backup_manifest.read_bytes()).hexdigest(), backup["manifest_sha256"])
        self.assertEqual(
            Path(backup["units"][release.WEB_SERVICE]["backup_path"]).read_bytes(),
            b"old web unit\n",
        )
        self.assertEqual(
            Path(backup["units"][release.STORAGE_SERVICE]["backup_path"]).read_bytes(),
            b"old storage unit\n",
        )

    def test_storage_producer_failure_restores_both_units(self) -> None:
        target = self.create_verified_release("b" * 40)
        self.paths.unit_target.parent.mkdir(parents=True)
        assert self.paths.storage_unit_target is not None
        self.paths.unit_target.write_bytes(b"old web\n"); os.chmod(self.paths.unit_target, 0o600)
        self.paths.storage_unit_target.write_bytes(b"old storage\n"); os.chmod(self.paths.storage_unit_target, 0o600)
        old_states = release.snapshot_units(self.paths)
        before = {"LoadState": "loaded", "ActiveState": "inactive", "WorkingDirectory": str(self.root / "legacy"), "Result": "success", "ExecMainStatus": "0"}
        with (
            patch.object(release, "_systemctl_properties", return_value=before),
            patch.object(release, "_running_target", return_value=self.root / "legacy"),
            patch.object(release, "install_units", return_value={}),
            patch.object(release, "_run_storage_producer", side_effect=release.ReleaseError("producer failed")),
            patch.object(release, "run", return_value=subprocess.CompletedProcess([], 0, "", "")),
        ):
            with self.assertRaisesRegex(release.ReleaseError, "prior state restored"):
                release.switch_transaction(
                    self.paths,
                    target,
                    self.config,
                    operation="switch",
                    attempt_id=ATTEMPT,
                )
        self.assertEqual(release.snapshot_units(self.paths), old_states)
        self.assertFalse(self.paths.current.exists())

    def test_incomplete_restoration_is_reported_without_safe_retry_claim(self) -> None:
        target = self.create_verified_release("c" * 40)
        before = {"LoadState": "loaded", "ActiveState": "inactive", "WorkingDirectory": str(self.root / "legacy"), "Result": "success", "ExecMainStatus": "0"}
        with (
            patch.object(release, "_systemctl_properties", return_value=before),
            patch.object(release, "_running_target", return_value=self.root / "legacy"),
            patch.object(release, "install_units", side_effect=release.ReleaseError("unit failed")),
            patch.object(
                release,
                "_restore_transaction",
                return_value={"complete": False, "errors": ["units:readback-mismatch"], "readback": {}},
            ),
        ):
            with self.assertRaisesRegex(release.ReleaseError, "restoration is incomplete"):
                release.switch_transaction(
                    self.paths,
                    target,
                    self.config,
                    operation="switch",
                    attempt_id=ATTEMPT,
                )

    def test_completion_sidecar_tamper_blocks_idempotent_replay(self) -> None:
        head = "d" * 40
        release.prepare_state_dirs(self.paths)
        key = release._deployment_key(head, self.config)
        receipt_path, receipt_sha = release.write_receipt(
            self.paths,
            "deploy",
            {"success": True, "source_commit": head},
            attempt_id=ATTEMPT,
        )
        release._write_completion(
            self.paths,
            key,
            head=head,
            config=self.config,
            receipt_path=str(receipt_path),
            receipt_sha256=receipt_sha,
        )
        sidecar = release._completion_sidecar(release._completion_path(self.paths, key))
        sidecar.write_text("0" * 64 + "  wrong.json\n", encoding="ascii")
        with self.assertRaisesRegex(release.ReleaseError, "sidecar mismatch"):
            release._read_completion(self.paths, key)

    def test_listener_must_be_loopback_and_owned_by_web_pid(self) -> None:
        valid = subprocess.CompletedProcess(
            [],
            0,
            "State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n"
            'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=123,fd=20))\n',
            "",
        )
        with patch.object(release, "run", return_value=valid):
            self.assertEqual(len(release._verify_loopback_listener(3000, expected_pid=123)), 1)
            with self.assertRaisesRegex(release.ReleaseError, "not owned"):
                release._verify_loopback_listener(3000, expected_pid=999)
        wide = subprocess.CompletedProcess(
            [],
            0,
            'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=123,fd=20))\n',
            "",
        )
        with patch.object(release, "run", return_value=wide), self.assertRaisesRegex(
            release.ReleaseError, "not loopback-only"
        ):
            release._verify_loopback_listener(3000, expected_pid=123)

    def test_build_release_separates_source_ci_from_archived_release_build(self) -> None:
        head = "e" * 40
        source = self.root / "source"
        source.mkdir()
        identity = {
            "source_commit": head,
            "source_tree": "f" * 40,
            "source_date_epoch": 1_700_000_000,
            "origin_main": head,
            "required_ref": "origin/main",
            "required_ref_head": head,
            "origin_url": str(self.root / "origin.git"),
        }
        calls: list[tuple[tuple[str, ...], Path, dict[str, str]]] = []

        def logged(argv, *, cwd, log_path, env=None, timeout=900):
            calls.append((tuple(argv), Path(cwd), dict(env or {})))

        def command(argv, *, cwd=None, capture=True, check=True, timeout=None, env=None):
            for part in argv:
                if part.startswith("--output="):
                    archive_path = Path(part.split("=", 1)[1])
                    with tarfile.open(archive_path, mode="w"):
                        pass
            return subprocess.CompletedProcess(list(argv), 0, "", "")

        def extract(_archive, destination):
            destination = Path(destination)
            self._populate_release(destination, head)
            (destination / ".git/HEAD").unlink()
            (destination / ".git").rmdir()

        with (
            patch.object(release, "source_identity", return_value=identity),
            patch.object(release, "run_logged", side_effect=logged),
            patch.object(release, "run", side_effect=command),
            patch.object(release, "safe_extract_tar", side_effect=extract),
        ):
            target, manifest, created = release.build_release(
                self.paths, source, head, attempt_id=ATTEMPT
            )
        self.assertTrue(created)
        self.assertEqual(manifest["source_commit"], head)
        source_calls = calls[: len(release.SOURCE_VALIDATION_COMMANDS)]
        release_calls = calls[len(release.SOURCE_VALIDATION_COMMANDS) :]
        self.assertEqual([item[0] for item in source_calls], list(release.SOURCE_VALIDATION_COMMANDS))
        self.assertEqual([item[0] for item in release_calls], list(release.RELEASE_VALIDATION_COMMANDS))
        self.assertTrue(all(item[1] == source for item in source_calls))
        self.assertTrue(all(item[1] != source and item[1].is_relative_to(self.paths.releases) for item in release_calls))
        self.assertTrue(all(item[2]["SOURCE_DATE_EPOCH"] == "1700000000" for item in calls))
        self.assertEqual(target, release.release_path(self.paths, head))

    def test_remote_main_drift_after_build_blocks_before_switch(self) -> None:
        head = "f" * 40
        target = self.create_verified_release(head)
        manifest = release.verify_release_path(self.paths, target)
        drifted = {
            key: manifest[key]
            for key in (
                "source_commit",
                "source_tree",
                "source_date_epoch",
                "origin_main",
                "required_ref",
                "required_ref_head",
                "origin_url",
            )
        }
        drifted["origin_main"] = "0" * 40
        with (
            patch.object(release, "build_release", return_value=(target, manifest, False)),
            patch.object(release, "source_identity", return_value=drifted),
            patch.object(release, "switch_transaction") as switched,
        ):
            with self.assertRaisesRegex(release.ReleaseError, "changed after release build"):
                release.deploy_release(self.paths, self.root, head, self.config, attempt_id=ATTEMPT)
        switched.assert_not_called()

    def test_cli_exposes_only_managed_lifecycle_commands(self) -> None:
        help_text = release.build_parser().format_help()
        for command in ("build", "deploy", "switch", "rollback", "verify", "status"):
            self.assertIn(command, help_text)
        self.assertNotIn("install-units", help_text)
        self.assertNotIn("import-legacy", help_text)


if __name__ == "__main__":
    unittest.main()

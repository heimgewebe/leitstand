#!/usr/bin/env python3
"""Build, deploy, verify and roll back immutable local Leitstand releases.

The host-local adapter is fail-closed. Release bytes come only from ``git archive``
of one exact commit whose checkout HEAD, required ref and ``origin/main`` agree.
Every effect runs under one owner-checked lock and writes create-only JSON receipts
with SHA-256 sidecars.

The web and storage-health user-systemd units form one transaction. Both rendered
unit files, release selectors, storage producer, web process, local routes and
canonical HTTPS routes must agree on the exact release. Any failed write, reload,
producer run, restart or postflight restores both prior unit files and selectors.
An identical completed deployment is handled as a read-only idempotent replay.

Leitstand remains a read-only observer. This adapter does not grant mutation or
truth authority over its source systems, ingress, DNS, TLS or unrelated services.
"""

from __future__ import annotations

import argparse
import contextlib
import dataclasses
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
import re
import secrets
import shutil
import ssl
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterator, Mapping, Sequence
from urllib.parse import urlsplit

SCHEMA_VERSION = 2
MANIFEST_KIND = "leitstand_local_release_manifest"
HEAD_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
RELEASE_SUFFIX = "runtime-v1"
DEFAULT_RELEASE_BASE = Path.home() / ".local" / "lib" / "leitstand"
DEFAULT_STATE_ROOT = Path.home() / ".local" / "state" / "leitstand" / "releases"
DEFAULT_UNIT_TARGET = Path.home() / ".config" / "systemd" / "user" / "leitstand.service"
DEFAULT_PORT = 3000
MANIFEST_NAME = "release-manifest.json"
LOCK_FILE_NAME = "deploy.lock"
DEFAULT_LOCK_TIMEOUT_SECONDS = 60.0
DEFAULT_POSTFLIGHT_TIMEOUT_SECONDS = 35.0
DEFAULT_STABILITY_SECONDS = 2.0
DEFAULT_POLL_SECONDS = 1.0
BROWSER_BINARIES = ("chromium", "chromium-browser", "google-chrome-stable", "google-chrome")
SYSTEM_CA_BUNDLE_CANDIDATES = (
    Path("/etc/ssl/certs/ca-certificates.crt"),
    Path("/etc/pki/tls/certs/ca-bundle.crt"),
    Path("/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"),
    Path("/etc/ssl/ca-bundle.pem"),
)

WEB_SERVICE = "leitstand.service"
STORAGE_SERVICE = "leitstand-storage-health.service"
WEB_UNIT_RELATIVE_PATH = Path("deploy/systemd/leitstand.service")
STORAGE_UNIT_RELATIVE_PATH = Path("deploy/systemd/leitstand-storage-health.service")
DEFAULT_STORAGE_UNIT_TARGET = (
    Path.home() / ".config" / "systemd" / "user" / STORAGE_SERVICE
)
DEFAULT_RUNTIME_CONFIG = Path.home() / ".config" / "leitstand" / "runtime.json"
RUNTIME_CONFIG_KIND = "leitstand_local_runtime_config"
RUNTIME_CONFIG_SCHEMA_VERSION = 1
COMPLETION_KIND = "leitstand_local_deployment_completion"
ACTIVE_ROUTES = (
    "/",
    "/health",
    "/bureau",
    "/checkouts",
    "/storage-health",
    "/ecosystem-map",
    "/repoground",
)
REMOVED_ROUTES = (
    "/events",
    "/ops",
    "/observatory",
    "/intent",
    "/anatomy",
    "/timeline",
    "/insights",
    "/reflexion",
)
SNAPSHOT_THRESHOLDS = {
    "bureau_tasks": 20 * 60,
    "checkout_inventory": 20 * 60,
    "storage_health": 90 * 60,
    "ecosystem_map": 168 * 60 * 60,
}
RUNTIME_LINK_NAMES: tuple[str, ...] = ()

CRITICAL_ARTIFACTS: tuple[str, ...] = (
    "package.json",
    "pnpm-lock.yaml",
    "dist/server.js",
    WEB_UNIT_RELATIVE_PATH.as_posix(),
    STORAGE_UNIT_RELATIVE_PATH.as_posix(),
    "scripts/collect-storage-health-runtime",
    "scripts/leitstand-export-operator-snapshots",
    "scripts/leitstand-release.py",
)

SOURCE_VALIDATION_COMMANDS: tuple[tuple[str, ...], ...] = (
    ("pnpm", "install", "--frozen-lockfile", "--package-import-method=copy"),
    ("pnpm", "run", "check:vendor-contracts"),
    ("pnpm", "run", "lint"),
    ("pnpm", "run", "typecheck"),
    ("pnpm", "run", "test:release-runtime"),
    ("pnpm", "run", "test"),
    ("pnpm", "run", "test:browser-shell"),
    ("pnpm", "run", "build"),
    ("pnpm", "run", "build:static"),
    ("bash", "scripts/ci/repo-structure-guard.sh"),
    ("bash", "scripts/ci/docs-relations-guard.sh"),
    ("bash", "scripts/ci/generated-files-guard.sh"),
    ("bash", "scripts/ci/check-runbook-invariants.sh"),
    ("bash", "scripts/ci/check-drift-gates.sh"),
    ("bash", "scripts/ci/observer-invariant-guard.sh"),
)

RELEASE_VALIDATION_COMMANDS: tuple[tuple[str, ...], ...] = (
    ("pnpm", "install", "--frozen-lockfile", "--package-import-method=copy"),
    ("pnpm", "run", "test:release-runtime"),
    ("pnpm", "run", "build"),
    ("pnpm", "run", "build:static"),
)

MANIFEST_ORIGINS = ("git-archive",)
MANIFEST_KEY_TYPES: dict[str, tuple[type, ...]] = {
    "schema_version": (int,),
    "kind": (str,),
    "release_id": (str,),
    "created_at": (str,),
    "origin": (str,),
    "source_commit": (str,),
    "source_tree": (str,),
    "source_date_epoch": (int,),
    "origin_main": (str,),
    "required_ref": (str,),
    "required_ref_head": (str,),
    "origin_url": (str,),
    "release_tree_sha256": (str,),
    "critical_artifacts": (dict,),
    "source_validation_commands": (list,),
    "release_validation_commands": (list,),
    "sealed": (bool,),
    "attempt_id": (str,),
    "import_evidence": (dict, type(None)),
    "runtime_links": (dict,),
    "does_not_establish": (list,),
}


class ReleaseError(RuntimeError):
    """A fail-closed release error."""


@dataclasses.dataclass(frozen=True)
class LinkState:
    exists: bool
    target: str | None


@dataclasses.dataclass(frozen=True)
class UnitState:
    exists: bool
    content: bytes | None
    mode: int | None


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def new_attempt_id() -> str:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{stamp}-{os.getpid()}-{secrets.token_hex(4)}"


def canonical_json_bytes(value: Mapping[str, Any]) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_head(head: str) -> str:
    if not isinstance(head, str) or not HEAD_RE.fullmatch(head):
        raise ReleaseError("expected head must be exactly 40 lowercase hexadecimal characters")
    return head


def release_id(head: str) -> str:
    return f"{validate_head(head)}-{RELEASE_SUFFIX}"


def release_path(paths: Paths, head: str) -> Path:
    return paths.releases / release_id(head)


def assert_secure_ancestry(path: Path) -> None:
    """Reject symlink components, unexpected owners and unsafe modes.

    Every existing component of ``path`` (including the leaf) must be a
    non-symlink owned by the invoking user or root, and must not be
    group/other writable unless it is a root-owned sticky directory such as
    ``/tmp``. Components that do not exist yet are created privately later.
    """
    absolute = Path(os.path.abspath(path))
    uid = os.getuid()
    component = Path(absolute.parts[0])
    chain = [component]
    for part in absolute.parts[1:]:
        component = component / part
        chain.append(component)
    for entry in chain:
        try:
            entry_stat = os.lstat(entry)
        except FileNotFoundError:
            return
        except OSError as error:
            raise ReleaseError(f"cannot validate path component {entry}: {error}") from error
        if stat.S_ISLNK(entry_stat.st_mode):
            raise ReleaseError(f"path component is a symlink: {entry}")
        if entry_stat.st_uid not in (0, uid):
            raise ReleaseError(f"path component has unexpected owner uid={entry_stat.st_uid}: {entry}")
        mode = stat.S_IMODE(entry_stat.st_mode)
        if mode & (stat.S_IWGRP | stat.S_IWOTH):
            if not (mode & stat.S_ISVTX and entry_stat.st_uid == 0):
                raise ReleaseError(f"path component is group/other writable: {entry}")


def ensure_directory(path: Path, *, private: bool) -> None:
    absolute = Path(os.path.abspath(path))
    assert_secure_ancestry(absolute)
    missing: list[Path] = []
    probe = absolute
    while not probe.exists():
        missing.append(probe)
        if probe.parent == probe:
            break
        probe = probe.parent
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            pass
        os.chmod(directory, 0o700)
    leaf_stat = os.lstat(absolute)
    if stat.S_ISLNK(leaf_stat.st_mode) or not stat.S_ISDIR(leaf_stat.st_mode):
        raise ReleaseError(f"expected a non-symlink directory: {absolute}")
    if leaf_stat.st_uid != os.getuid():
        raise ReleaseError(f"directory has unexpected owner uid={leaf_stat.st_uid}: {absolute}")
    if private:
        os.chmod(absolute, 0o700)
    elif stat.S_IMODE(leaf_stat.st_mode) & (stat.S_IWGRP | stat.S_IWOTH):
        raise ReleaseError(f"directory is group/other writable: {absolute}")


def ensure_private_dir(path: Path) -> None:
    ensure_directory(path, private=True)


def prepare_state_dirs(paths: Paths) -> None:
    for directory in (
        paths.release_base,
        paths.releases,
        paths.state_root,
        paths.receipts,
        paths.logs,
        paths.backups,
        paths.completions,
    ):
        ensure_private_dir(directory)


@contextlib.contextmanager
def deploy_lock(
    paths: Paths,
    timeout_seconds: float = DEFAULT_LOCK_TIMEOUT_SECONDS,
    *,
    command: str = "unspecified",
    attempt_id: str | None = None,
) -> Iterator[Path]:
    """Serialize every status-changing operation behind one advisory lock.

    The lock file must be a regular, single-link file owned by the invoking
    user with mode 0600; it is opened with ``O_NOFOLLOW`` and acquired with a
    bounded timeout so concurrent operators fail closed instead of racing.
    """
    ensure_private_dir(paths.state_root)
    lock_path = paths.lock_file
    try:
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError as error:
        raise ReleaseError(f"cannot open deploy lock {lock_path}: {error}") from error
    try:
        fd_stat = os.fstat(fd)
        if not stat.S_ISREG(fd_stat.st_mode):
            raise ReleaseError(f"deploy lock is not a regular file: {lock_path}")
        if fd_stat.st_nlink != 1:
            raise ReleaseError(f"deploy lock has unexpected link count {fd_stat.st_nlink}: {lock_path}")
        if fd_stat.st_uid != os.getuid():
            raise ReleaseError(f"deploy lock has unexpected owner uid={fd_stat.st_uid}: {lock_path}")
        if stat.S_IMODE(fd_stat.st_mode) != 0o600:
            raise ReleaseError(f"deploy lock has unsafe mode {stat.S_IMODE(fd_stat.st_mode):o}: {lock_path}")
        link_stat = os.lstat(lock_path)
        if (link_stat.st_dev, link_stat.st_ino) != (fd_stat.st_dev, fd_stat.st_ino):
            raise ReleaseError(f"deploy lock changed during acquisition: {lock_path}")
        deadline = time.monotonic() + max(0.0, timeout_seconds)
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (BlockingIOError, PermissionError):
                if time.monotonic() >= deadline:
                    holder = b""
                    with contextlib.suppress(OSError):
                        holder = os.pread(fd, 4096, 0)
                    detail = holder.decode("utf-8", errors="replace").strip()
                    raise ReleaseError(
                        f"deploy lock is held by another release operation (timeout {timeout_seconds}s): "
                        f"{lock_path} {detail}".rstrip()
                    )
                time.sleep(0.1)
        info = canonical_json_bytes(
            {
                "pid": os.getpid(),
                "command": command,
                "attempt_id": attempt_id or new_attempt_id(),
                "acquired_at": utc_now(),
            }
        )
        os.ftruncate(fd, 0)
        os.pwrite(fd, info, 0)
        os.fsync(fd)
        yield lock_path
    finally:
        os.close(fd)


def _command_environment(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    environment = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "LC_ALL": "C",
    }
    if extra:
        environment.update(extra)
    return environment


def run(
    argv: Sequence[str],
    *,
    cwd: Path | None = None,
    capture: bool = True,
    check: bool = True,
    timeout: float | None = None,
    env: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        list(argv),
        cwd=str(cwd) if cwd else None,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        check=False,
        timeout=timeout,
        env=_command_environment(env),
    )
    if check and completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        detail = stderr or stdout or f"exit {completed.returncode}"
        raise ReleaseError(f"command failed: {' '.join(argv)}: {detail[-2000:]}")
    return completed


def run_logged(
    argv: Sequence[str],
    *,
    cwd: Path,
    log_path: Path,
    env: Mapping[str, str] | None = None,
    timeout: float = 900,
) -> None:
    ensure_private_dir(log_path.parent)
    try:
        with log_path.open("xb") as log_handle:
            os.chmod(log_path, 0o600)
            process = subprocess.run(
                list(argv),
                cwd=str(cwd),
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                check=False,
                timeout=timeout,
                env=_command_environment(env),
            )
    except subprocess.TimeoutExpired as error:
        raise ReleaseError(
            f"validation timed out after {timeout}s: {' '.join(argv)}; log={log_path}"
        ) from error
    if process.returncode != 0:
        tail = log_path.read_text("utf-8", errors="replace")[-4000:]
        raise ReleaseError(
            f"validation failed: {' '.join(argv)} (exit {process.returncode}); log={log_path}\n{tail}"
        )


def write_create_only(path: Path, data: bytes, mode: int = 0o600) -> None:
    ensure_private_dir(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise


def fsync_directory(path: Path) -> None:
    directory_fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def atomic_replace_bytes(path: Path, data: bytes, mode: int = 0o600, *, private_parent: bool = True) -> None:
    ensure_directory(path.parent, private=private_parent)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def write_receipt(
    paths: Paths, kind: str, payload: Mapping[str, Any], *, attempt_id: str | None = None
) -> tuple[Path, str]:
    """Write a create-only receipt whose SHA-256 sidecar exists first.

    The receipt body is written to a temporary create-only file, the sidecar
    is created under the final name, and only then is the receipt renamed
    into place: a visible receipt therefore always has its sidecar.
    """
    ensure_private_dir(paths.receipts)
    record = {
        "schema_version": SCHEMA_VERSION,
        "kind": kind,
        "created_at": utc_now(),
        "attempt_id": attempt_id or new_attempt_id(),
        **payload,
    }
    data = canonical_json_bytes(record)
    digest = sha256_bytes(data)
    for _ in range(8):
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        name = f"{stamp}-{os.getpid()}-{secrets.token_hex(4)}-{kind}.json"
        receipt_path = paths.receipts / name
        temporary = paths.receipts / f"{name}.tmp"
        sidecar = paths.receipts / f"{name}.sha256"
        if receipt_path.exists() or sidecar.exists() or temporary.exists():
            continue
        try:
            write_create_only(temporary, data)
        except FileExistsError:
            continue
        try:
            write_create_only(sidecar, f"{digest}  {name}\n".encode("ascii"))
        except FileExistsError:
            temporary.unlink(missing_ok=True)
            continue
        os.rename(temporary, receipt_path)
        fsync_directory(paths.receipts)
        latest = paths.state_root / f"latest-{kind}.json"
        atomic_symlink(latest, os.path.relpath(receipt_path, latest.parent))
        return receipt_path, digest
    raise ReleaseError(f"could not allocate a unique receipt name for kind {kind}")


def atomic_symlink(path: Path, target: str) -> None:
    ensure_private_dir(path.parent)
    temporary = path.parent / f".{path.name}.{os.getpid()}.{time.time_ns()}.{secrets.token_hex(4)}"
    try:
        os.symlink(target, temporary)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_link_state(path: Path) -> LinkState:
    if path.is_symlink():
        return LinkState(True, os.readlink(path))
    if path.exists():
        raise ReleaseError(f"expected symlink but found non-symlink: {path}")
    return LinkState(False, None)


def restore_link_state(path: Path, state: LinkState) -> None:
    if state.exists:
        assert state.target is not None
        atomic_symlink(path, state.target)
    else:
        path.unlink(missing_ok=True)






def _require_regular_file(
    path: Path,
    *,
    owner_uid: int | None = None,
    allowed_modes: set[int] | None = None,
    label: str = "file",
) -> os.stat_result:
    try:
        metadata = os.lstat(path)
    except OSError as error:
        raise ReleaseError(f"cannot inspect {label} {path}: {error}") from error
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise ReleaseError(f"{label} must be one regular file: {path}")
    if owner_uid is not None and metadata.st_uid != owner_uid:
        raise ReleaseError(
            f"{label} has unexpected owner uid={metadata.st_uid}: {path}"
        )
    mode = stat.S_IMODE(metadata.st_mode)
    if allowed_modes is not None and mode not in allowed_modes:
        expected = ",".join(f"{item:04o}" for item in sorted(allowed_modes))
        raise ReleaseError(
            f"{label} has mode {mode:04o}, expected one of {expected}: {path}"
        )
    return metadata


def _safe_relative_member(name: str) -> PurePosixPath:
    if not isinstance(name, str) or not name or "\x00" in name:
        raise ReleaseError("tar member name is invalid")
    member = PurePosixPath(name)
    if member.is_absolute() or any(part in ("", ".", "..") for part in member.parts):
        raise ReleaseError(f"tar member escapes destination: {name!r}")
    return member


def safe_extract_tar(archive: tarfile.TarFile, destination: Path) -> None:
    """Extract only ordinary files and directories without following links."""
    ensure_private_dir(destination)
    members = archive.getmembers()
    for member in members:
        relative = _safe_relative_member(member.name)
        if not (member.isdir() or member.isreg()):
            raise ReleaseError(
                f"tar member type is forbidden (links/devices/FIFOs are rejected): {member.name}"
            )
        target = destination.joinpath(*relative.parts)
        if not target.is_relative_to(destination):
            raise ReleaseError(f"tar member escapes destination: {member.name}")
        assert_secure_ancestry(target.parent)

    for member in sorted(members, key=lambda item: (len(PurePosixPath(item.name).parts), item.name)):
        relative = _safe_relative_member(member.name)
        target = destination.joinpath(*relative.parts)
        if member.isdir():
            ensure_private_dir(target)
            continue
        ensure_private_dir(target.parent)
        source = archive.extractfile(member)
        if source is None:
            raise ReleaseError(f"tar regular member has no payload: {member.name}")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(target, flags, 0o600)
        except OSError as error:
            raise ReleaseError(f"cannot create extracted file {target}: {error}") from error
        try:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                offset = 0
                while offset < len(chunk):
                    written = os.write(descriptor, chunk[offset:])
                    if written <= 0:
                        raise OSError("tar extraction write made no progress")
                    offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
            source.close()
        os.chmod(target, 0o700 if member.mode & 0o111 else 0o600)
    fsync_directory(destination)


def _runtime_link_target(root: Path, path: Path) -> str:
    target = os.readlink(path)
    if path.name not in RUNTIME_LINK_NAMES or path.parent != root:
        resolved = (path.parent / target).resolve(strict=False)
        if not resolved.is_relative_to(root.resolve()):
            raise ReleaseError(f"symlink escapes release: {path} -> {target}")
    return target


def _walk_release(root: Path) -> Iterator[tuple[str, Path, os.stat_result]]:
    if root.is_symlink() or not root.is_dir():
        raise ReleaseError(f"release root must be a directory: {root}")
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        dirnames.sort()
        filenames.sort()
        for name in tuple(dirnames):
            path = current_path / name
            metadata = os.lstat(path)
            relative = path.relative_to(root).as_posix()
            if stat.S_ISLNK(metadata.st_mode):
                _runtime_link_target(root, path)
                dirnames.remove(name)
                yield relative, path, metadata
            elif stat.S_ISDIR(metadata.st_mode):
                yield relative, path, metadata
            else:
                raise ReleaseError(f"unsupported directory entry in release: {path}")
        for name in filenames:
            path = current_path / name
            metadata = os.lstat(path)
            relative = path.relative_to(root).as_posix()
            if stat.S_ISLNK(metadata.st_mode):
                _runtime_link_target(root, path)
            elif not stat.S_ISREG(metadata.st_mode):
                raise ReleaseError(f"special file is forbidden in release: {path}")
            yield relative, path, metadata


def private_release_permissions(root: Path) -> None:
    """Normalize an unsealed release to private owner-only writable modes."""
    assert_secure_ancestry(root)
    if root.is_symlink() or not root.is_dir():
        raise ReleaseError(f"release root must be a directory: {root}")
    os.chmod(root, 0o700)
    for _relative, path, metadata in _walk_release(root):
        if stat.S_ISLNK(metadata.st_mode):
            continue
        if metadata.st_uid != os.getuid():
            raise ReleaseError(f"release entry has unexpected owner uid={metadata.st_uid}: {path}")
        if stat.S_ISDIR(metadata.st_mode):
            os.chmod(path, 0o700)
        else:
            executable = bool(metadata.st_mode & 0o111)
            os.chmod(path, 0o700 if executable else 0o600)


def seal_release(root: Path) -> None:
    """Remove write bits from the complete release after manifest creation."""
    for _relative, path, metadata in _walk_release(root):
        if stat.S_ISLNK(metadata.st_mode):
            continue
        if stat.S_ISDIR(metadata.st_mode):
            os.chmod(path, 0o500)
        else:
            executable = bool(metadata.st_mode & 0o111)
            os.chmod(path, 0o500 if executable else 0o400)
    os.chmod(root, 0o500)
    fsync_directory(root.parent)


def release_tree_sha256(root: Path) -> str:
    """Hash names, types, executable intent, links and bytes, excluding manifest."""
    digest = hashlib.sha256()
    for relative, path, metadata in _walk_release(root):
        if relative == MANIFEST_NAME:
            continue
        if stat.S_ISDIR(metadata.st_mode):
            record = f"D\0{relative}\0".encode()
        elif stat.S_ISLNK(metadata.st_mode):
            record = f"L\0{relative}\0{_runtime_link_target(root, path)}\0".encode()
        else:
            executable = "1" if metadata.st_mode & 0o111 else "0"
            record = f"F\0{relative}\0{executable}\0{metadata.st_size}\0".encode()
        digest.update(record)
        if stat.S_ISREG(metadata.st_mode):
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
    return digest.hexdigest()


def critical_hashes(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for relative in CRITICAL_ARTIFACTS:
        path = root / relative
        _require_regular_file(path, owner_uid=os.getuid(), label=f"critical artifact {relative}")
        result[relative] = sha256_file(path)
    return result


def runtime_links(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for name in RUNTIME_LINK_NAMES:
        path = root / name
        if path.is_symlink():
            result[name] = _runtime_link_target(root, path)
        elif path.exists():
            if not path.is_dir():
                raise ReleaseError(f"runtime link path must be directory or symlink: {path}")
            result[name] = "<embedded-directory>"
    return result




def _remote_main(repo: Path) -> str:
    completed = run(
        ("git", "ls-remote", "--exit-code", "origin", "refs/heads/main"),
        cwd=repo,
        timeout=60,
    )
    fields = completed.stdout.split()
    if len(fields) != 2 or fields[1] != "refs/heads/main" or not HEAD_RE.fullmatch(fields[0]):
        raise ReleaseError("remote origin/main readback is invalid")
    return fields[0]


def source_identity(repo: Path, expected_head: str, required_ref: str = "origin/main") -> dict[str, str]:
    head = validate_head(expected_head)
    if not isinstance(required_ref, str) or not required_ref or required_ref.startswith("-"):
        raise ReleaseError("required ref is invalid")
    run(("git", "check-ref-format", required_ref), cwd=repo)
    assert_secure_ancestry(repo)
    if repo.is_symlink() or not repo.is_dir():
        raise ReleaseError(f"source repository is not a directory: {repo}")
    status = run(
        ("git", "status", "--porcelain=v1", "--untracked-files=all"), cwd=repo
    ).stdout.splitlines()
    if status:
        raise ReleaseError(
            f"source repository is not clean: {status[:20]}"
            + (f" (+{len(status) - 20} more)" if len(status) > 20 else "")
        )
    actual_head = run(("git", "rev-parse", "--verify", "HEAD"), cwd=repo).stdout.strip()
    ref_head = run(("git", "rev-parse", "--verify", required_ref), cwd=repo).stdout.strip()
    local_origin_main = run(
        ("git", "rev-parse", "--verify", "origin/main"), cwd=repo
    ).stdout.strip()
    remote_origin_main = _remote_main(repo)
    tree = run(("git", "rev-parse", "--verify", f"{head}^{{tree}}"), cwd=repo).stdout.strip()
    epoch_text = run(
        ("git", "show", "-s", "--format=%ct", head), cwd=repo
    ).stdout.strip()
    try:
        source_date_epoch = int(epoch_text)
    except ValueError as error:
        raise ReleaseError(f"source commit epoch is invalid: {epoch_text!r}") from error
    if source_date_epoch <= 0:
        raise ReleaseError("source commit epoch must be positive")
    origin_url = run(("git", "remote", "get-url", "origin"), cwd=repo).stdout.strip()
    for label, value in (
        ("repository HEAD", actual_head),
        ("required ref", ref_head),
        ("local origin/main", local_origin_main),
        ("remote origin/main", remote_origin_main),
    ):
        if value != head:
            raise ReleaseError(f"expected head {head} does not match {label} {value}")
    if not HEAD_RE.fullmatch(tree):
        raise ReleaseError(f"source tree identity is invalid: {tree}")
    return {
        "source_commit": head,
        "source_tree": tree,
        "source_date_epoch": source_date_epoch,
        "origin_main": remote_origin_main,
        "required_ref": required_ref,
        "required_ref_head": ref_head,
        "origin_url": origin_url,
    }


def _validate_string_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ReleaseError(f"{label} must be a list of strings")
    return value


def validate_manifest(manifest: object, *, target: Path | None = None) -> dict[str, Any]:
    if not isinstance(manifest, dict):
        raise ReleaseError("release manifest must be one JSON object")
    expected_keys = set(MANIFEST_KEY_TYPES)
    actual_keys = set(manifest)
    if actual_keys != expected_keys:
        missing = sorted(expected_keys - actual_keys)
        extra = sorted(actual_keys - expected_keys)
        raise ReleaseError(f"release manifest key mismatch; missing={missing}; extra={extra}")
    for key, allowed in MANIFEST_KEY_TYPES.items():
        value = manifest[key]
        if int in allowed and bool not in allowed and isinstance(value, bool):
            raise ReleaseError(f"release manifest field {key} has invalid boolean type")
        if not isinstance(value, allowed):
            names = "/".join(item.__name__ for item in allowed)
            raise ReleaseError(f"release manifest field {key} must be {names}")
    if manifest["schema_version"] != SCHEMA_VERSION or manifest["kind"] != MANIFEST_KIND:
        raise ReleaseError("release manifest schema identity mismatch")
    head = validate_head(manifest["source_commit"])
    for key in ("source_tree", "origin_main", "required_ref_head"):
        if not HEAD_RE.fullmatch(manifest[key]):
            raise ReleaseError(f"release manifest field {key} is not a 40-hex identity")
    if manifest["origin_main"] != head or manifest["required_ref_head"] != head:
        raise ReleaseError("release manifest commit identities disagree")
    if isinstance(manifest["source_date_epoch"], bool) or manifest["source_date_epoch"] <= 0:
        raise ReleaseError("release manifest source_date_epoch is invalid")
    if not SHA256_RE.fullmatch(manifest["release_tree_sha256"]):
        raise ReleaseError("release tree SHA-256 is invalid")
    if manifest["origin"] not in MANIFEST_ORIGINS:
        raise ReleaseError("release manifest origin is invalid")
    if not manifest["sealed"]:
        raise ReleaseError("release manifest does not claim sealed state")
    if not re.fullmatch(r"[0-9]{8}T[0-9]{12}Z-[0-9]+-[0-9a-f]{8}", manifest["attempt_id"]):
        raise ReleaseError("release attempt_id is invalid")
    _validate_string_list(manifest["does_not_establish"], "does_not_establish")
    critical = manifest["critical_artifacts"]
    if set(critical) != set(CRITICAL_ARTIFACTS):
        raise ReleaseError("critical artifact manifest keys mismatch")
    for key, value in critical.items():
        if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
            raise ReleaseError(f"critical artifact digest is invalid: {key}")
    for field, expected in (
        ("source_validation_commands", SOURCE_VALIDATION_COMMANDS),
        ("release_validation_commands", RELEASE_VALIDATION_COMMANDS),
    ):
        commands = manifest[field]
        if not isinstance(commands, list) or any(
            not isinstance(command, list)
            or not command
            or any(not isinstance(part, str) or not part for part in command)
            for command in commands
        ):
            raise ReleaseError(f"{field} must be a list of non-empty argv lists")
        if commands != [list(command) for command in expected]:
            raise ReleaseError(f"{field} identity mismatch")
    links = manifest["runtime_links"]
    if any(key not in RUNTIME_LINK_NAMES or not isinstance(value, str) for key, value in links.items()):
        raise ReleaseError("runtime_links contains an invalid entry")
    if manifest["release_id"] != release_id(head):
        raise ReleaseError("git release_id does not match source commit")
    if manifest["import_evidence"] is not None:
        raise ReleaseError("git release may not contain import evidence")
    if target is not None and manifest["release_id"] != target.name:
        raise ReleaseError("release manifest identity does not match directory name")
    return manifest


def _read_manifest(target: Path) -> dict[str, Any]:
    path = target / MANIFEST_NAME
    _require_regular_file(path, owner_uid=os.getuid(), allowed_modes={0o400, 0o600}, label="release manifest")
    try:
        parsed = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError(f"release manifest cannot be read: {error}") from error
    return validate_manifest(parsed, target=target)


def verify_release_path(paths: Paths, target: Path) -> dict[str, Any]:
    assert_secure_ancestry(target)
    if target.is_symlink() or not target.is_dir():
        raise ReleaseError(f"release target is not a directory: {target}")
    manifest = _read_manifest(target)
    head_path = target / ".git" / "HEAD"
    _require_regular_file(head_path, owner_uid=os.getuid(), label="release git head")
    if head_path.read_text("ascii").strip() != manifest["source_commit"]:
        raise ReleaseError("release .git/HEAD identity mismatch")
    actual_tree = release_tree_sha256(target)
    if actual_tree != manifest["release_tree_sha256"]:
        raise ReleaseError(
            f"release tree SHA-256 mismatch: expected {manifest['release_tree_sha256']}, got {actual_tree}"
        )
    actual_critical = critical_hashes(target)
    if actual_critical != manifest["critical_artifacts"]:
        raise ReleaseError("release critical artifact hashes mismatch")
    if runtime_links(target) != manifest["runtime_links"]:
        raise ReleaseError("release runtime link identity mismatch")
    root_mode = stat.S_IMODE(os.lstat(target).st_mode)
    if root_mode not in (0o500, 0o700):
        raise ReleaseError(f"release root mode is unsafe: {root_mode:04o}")
    return manifest


def verify_release(paths: Paths, head: str) -> dict[str, Any]:
    return verify_release_path(paths, release_path(paths, head))




def _write_manifest(target: Path, manifest: Mapping[str, Any]) -> None:
    path = target / MANIFEST_NAME
    write_create_only(path, canonical_json_bytes(manifest), 0o600)


def build_release(
    paths: Paths,
    source_repo: Path,
    expected_head: str,
    *,
    required_ref: str = "origin/main",
    attempt_id: str | None = None,
) -> tuple[Path, dict[str, Any], bool]:
    attempt = attempt_id or new_attempt_id()
    identity = source_identity(source_repo, expected_head, required_ref)
    target = release_path(paths, expected_head)
    if target.exists():
        manifest = verify_release_path(paths, target)
        write_receipt(
            paths,
            "build-reuse",
            {
                "source_commit": expected_head,
                "release_path": str(target),
                "release_tree_sha256": manifest["release_tree_sha256"],
            },
            attempt_id=attempt,
        )
        return target, manifest, False

    prepare_state_dirs(paths)
    temporary = paths.releases / f".{release_id(expected_head)}.{attempt}.tmp"
    if temporary.exists() or temporary.is_symlink():
        raise ReleaseError(f"unique build directory already exists: {temporary}")
    ensure_private_dir(temporary)
    archive_path = paths.state_root / f".{attempt}.tar"
    log_root = paths.logs / attempt
    ensure_private_dir(log_root)
    try:
        validation_env = {
            "CI": "true",
            "SOURCE_DATE_EPOCH": str(identity["source_date_epoch"]),
        }
        for index, command in enumerate(SOURCE_VALIDATION_COMMANDS, start=1):
            run_logged(
                command,
                cwd=source_repo,
                log_path=log_root / f"source-{index:02d}.log",
                env=validation_env,
            )
        confirmed_identity = source_identity(source_repo, expected_head, required_ref)
        if confirmed_identity != identity:
            raise ReleaseError("source identity changed during source validation")
        run(
            ("git", "archive", "--format=tar", f"--output={archive_path}", expected_head),
            cwd=source_repo,
        )
        _require_regular_file(
            archive_path,
            owner_uid=os.getuid(),
            allowed_modes={0o600, 0o644},
            label="git archive",
        )
        with tarfile.open(archive_path, mode="r:") as archive:
            safe_extract_tar(archive, temporary)
        archive_path.unlink(missing_ok=True)
        ensure_private_dir(temporary / ".git")
        write_create_only(
            temporary / ".git" / "HEAD", f"{expected_head}\n".encode("ascii"), 0o600
        )
        for index, command in enumerate(RELEASE_VALIDATION_COMMANDS, start=1):
            run_logged(
                command,
                cwd=temporary,
                log_path=log_root / f"release-{index:02d}.log",
                env=validation_env,
            )
        private_release_permissions(temporary)
        tree_digest = release_tree_sha256(temporary)
        manifest: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "kind": MANIFEST_KIND,
            "release_id": release_id(expected_head),
            "created_at": utc_now(),
            "origin": "git-archive",
            **identity,
            "release_tree_sha256": tree_digest,
            "critical_artifacts": critical_hashes(temporary),
            "source_validation_commands": [
                list(command) for command in SOURCE_VALIDATION_COMMANDS
            ],
            "release_validation_commands": [
                list(command) for command in RELEASE_VALIDATION_COMMANDS
            ],
            "sealed": True,
            "attempt_id": attempt,
            "import_evidence": None,
            "runtime_links": runtime_links(temporary),
            "does_not_establish": [
                "public_ingress",
                "future_dependency_availability",
                "external_snapshot_truth",
            ],
        }
        validate_manifest(manifest, target=target)
        _write_manifest(temporary, manifest)
        seal_release(temporary)
        try:
            os.rename(temporary, target)
        except FileExistsError:
            existing = verify_release_path(paths, target)
            if existing["release_tree_sha256"] != tree_digest:
                raise ReleaseError("concurrent build produced a different release")
            private_release_permissions(temporary)
            shutil.rmtree(temporary)
            manifest = existing
        fsync_directory(paths.releases)
        verified = verify_release_path(paths, target)
        write_receipt(
            paths,
            "build",
            {
                "source_commit": expected_head,
                "source_tree": identity["source_tree"],
                "release_path": str(target),
                "release_tree_sha256": verified["release_tree_sha256"],
            },
            attempt_id=attempt,
        )
        return target, verified, True
    except BaseException:
        archive_path.unlink(missing_ok=True)
        if temporary.exists() and not temporary.is_symlink():
            with contextlib.suppress(OSError):
                private_release_permissions(temporary)
            shutil.rmtree(temporary, ignore_errors=True)
        raise



def snapshot_unit(path: Path) -> UnitState:
    assert_secure_ancestry(path.parent)
    try:
        metadata = os.lstat(path)
    except FileNotFoundError:
        return UnitState(False, None, None)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != os.getuid():
        raise ReleaseError(f"unit target does not satisfy regular owner-bound contract: {path}")
    mode = stat.S_IMODE(metadata.st_mode)
    if mode not in (0o600, 0o644):
        raise ReleaseError(f"unit target has unsafe mode {mode:04o}: {path}")
    return UnitState(True, path.read_bytes(), mode)


def restore_unit(path: Path, state: UnitState) -> None:
    assert_secure_ancestry(path.parent)
    if state.exists:
        assert state.content is not None and state.mode is not None
        atomic_replace_bytes(path, state.content, state.mode, private_parent=False)
    else:
        if path.is_symlink():
            raise ReleaseError(f"refusing to unlink symlink unit target: {path}")
        path.unlink(missing_ok=True)
        fsync_directory(path.parent)












def _resolve_link_target(path: Path) -> Path | None:
    if not path.is_symlink():
        if path.exists():
            raise ReleaseError(f"expected release selector symlink: {path}")
        return None
    target = path.resolve(strict=True)
    if not target.is_relative_to(path.parent / "releases"):
        raise ReleaseError(f"release selector escapes release directory: {path} -> {target}")
    return target




def _verify_loopback_listener(port: int, *, expected_pid: int | None = None) -> list[str]:
    completed = run(("ss", "-ltnp"))
    matches: list[str] = []
    owned: list[str] = []
    for line in completed.stdout.splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        local = fields[3]
        if not (local.endswith(f":{port}") or local.endswith(f"]:{port}")):
            continue
        matches.append(line)
        if not (
            local.startswith("127.0.0.1:")
            or local.startswith("[::1]:")
            or local.startswith("::1:")
        ):
            raise ReleaseError(f"Leitstand listener is not loopback-only: {local}")
        if expected_pid is None or re.search(rf"\bpid={expected_pid}(?:,|\))", line):
            owned.append(line)
    if not matches:
        raise ReleaseError(f"no listening socket found on loopback port {port}")
    if expected_pid is not None and not owned:
        raise ReleaseError(
            f"loopback listener on port {port} is not owned by web PID {expected_pid}"
        )
    return owned or matches


def _browser_svg_smoke(port: int, browser_executable: str | None = None) -> dict[str, str]:
    executable = browser_executable
    if executable is None:
        executable = next((shutil.which(name) for name in BROWSER_BINARIES if shutil.which(name)), None)
    if not executable:
        raise ReleaseError("browser SVG smoke was requested but no supported browser is installed")
    completed = run(
        (
            executable,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--virtual-time-budget=5000",
            "--dump-dom",
            f"http://127.0.0.1:{port}/ecosystem-map",
        ),
        timeout=20,
    )
    if "<svg" not in completed.stdout or "data-ecosystem-map-canvas" not in completed.stdout:
        raise ReleaseError("headless browser did not render the ecosystem-map SVG")
    return {"browser": executable, "dom_sha256": sha256_bytes(completed.stdout.encode("utf-8"))}


























@dataclasses.dataclass(frozen=True)
class Paths:
    release_base: Path
    state_root: Path
    unit_target: Path
    storage_unit_target: Path | None = None

    def __post_init__(self) -> None:
        if self.storage_unit_target is None:
            object.__setattr__(
                self,
                "storage_unit_target",
                self.unit_target.with_name(STORAGE_SERVICE),
            )

    @property
    def releases(self) -> Path:
        return self.release_base / "releases"

    @property
    def current(self) -> Path:
        return self.release_base / "current"

    @property
    def previous(self) -> Path:
        return self.release_base / "previous"

    @property
    def receipts(self) -> Path:
        return self.state_root / "receipts"

    @property
    def logs(self) -> Path:
        return self.state_root / "logs"

    @property
    def backups(self) -> Path:
        return self.state_root / "backups"

    @property
    def completions(self) -> Path:
        return self.state_root / "completions"

    @property
    def lock_file(self) -> Path:
        return self.state_root / LOCK_FILE_NAME


@dataclasses.dataclass(frozen=True)
class RuntimeConfig:
    canonical_origin: str
    ecosystem_map_manifest_path: Path
    ecosystem_map_source_root: Path
    artifact_root: Path
    heim_pc_root: Path
    storage_state_root: Path
    source_path: Path
    sha256: str

    def evidence(self) -> dict[str, str]:
        return {
            "canonical_origin": self.canonical_origin,
            "ecosystem_map_manifest_path": str(self.ecosystem_map_manifest_path),
            "ecosystem_map_source_root": str(self.ecosystem_map_source_root),
            "artifact_root": str(self.artifact_root),
            "heim_pc_root": str(self.heim_pc_root),
            "storage_state_root": str(self.storage_state_root),
            "source_path": str(self.source_path),
            "sha256": self.sha256,
        }


@dataclasses.dataclass(frozen=True)
class UnitSpec:
    service: str
    relative_path: Path
    target_path: Path
    content: bytes


def _safe_absolute_path(value: object, *, field: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ReleaseError(f"runtime config {field} must be a non-empty string")
    if any(character in value for character in ("\x00", "\n", "\r", "%")):
        raise ReleaseError(f"runtime config {field} contains a forbidden character")
    if any(character.isspace() for character in value):
        raise ReleaseError(f"runtime config {field} may not contain whitespace")
    path = Path(value)
    if not path.is_absolute():
        raise ReleaseError(f"runtime config {field} must be absolute")
    return Path(os.path.abspath(path))


def _canonical_origin(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise ReleaseError("runtime config canonical_origin must be a non-empty string")
    if any(character in value for character in ("\x00", "\n", "\r")):
        raise ReleaseError("runtime config canonical_origin contains a forbidden character")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ReleaseError("runtime config canonical_origin must be one HTTPS origin")
    port = f":{parsed.port}" if parsed.port is not None else ""
    return f"https://{parsed.hostname}{port}"


def load_runtime_config(path: Path) -> RuntimeConfig:
    source = Path(os.path.abspath(path.expanduser()))
    assert_secure_ancestry(source.parent)
    metadata = _require_regular_file(
        source,
        owner_uid=os.getuid(),
        allowed_modes={0o600},
        label="runtime configuration",
    )
    if metadata.st_size > 64 * 1024:
        raise ReleaseError("runtime configuration is unexpectedly large")
    try:
        raw = source.read_bytes()
        value = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError(f"runtime configuration cannot be read: {error}") from error
    expected = {
        "schema_version",
        "kind",
        "canonical_origin",
        "ecosystem_map_manifest_path",
        "ecosystem_map_source_root",
        "artifact_root",
        "heim_pc_root",
        "storage_state_root",
    }
    if not isinstance(value, dict) or set(value) != expected:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise ReleaseError(
            f"runtime configuration key mismatch; expected={sorted(expected)}; actual={actual}"
        )
    if (
        value["schema_version"] != RUNTIME_CONFIG_SCHEMA_VERSION
        or value["kind"] != RUNTIME_CONFIG_KIND
    ):
        raise ReleaseError("runtime configuration schema identity mismatch")
    canonical = canonical_json_bytes(value)
    return RuntimeConfig(
        canonical_origin=_canonical_origin(value["canonical_origin"]),
        ecosystem_map_manifest_path=_safe_absolute_path(
            value["ecosystem_map_manifest_path"], field="ecosystem_map_manifest_path"
        ),
        ecosystem_map_source_root=_safe_absolute_path(
            value["ecosystem_map_source_root"], field="ecosystem_map_source_root"
        ),
        artifact_root=_safe_absolute_path(value["artifact_root"], field="artifact_root"),
        heim_pc_root=_safe_absolute_path(value["heim_pc_root"], field="heim_pc_root"),
        storage_state_root=_safe_absolute_path(
            value["storage_state_root"], field="storage_state_root"
        ),
        source_path=source,
        sha256=sha256_bytes(canonical),
    )


def _template_replacements(target: Path, config: RuntimeConfig) -> dict[str, str]:
    artifact_root = config.artifact_root
    return {
        "@RELEASE_ROOT@": str(target),
        "@ECOSYSTEM_MAP_MANIFEST_PATH@": str(config.ecosystem_map_manifest_path),
        "@ECOSYSTEM_MAP_SOURCE_ROOT@": str(config.ecosystem_map_source_root),
        "@BUREAU_SNAPSHOT_PATH@": str(artifact_root / "bureau-tasks.json"),
        "@CHECKOUT_SNAPSHOT_PATH@": str(artifact_root / "checkout-inventory.json"),
        "@DECISION_AXIS_SNAPSHOT_PATH@": str(artifact_root / "operator-decision-axis.json"),
        "@STORAGE_HEALTH_PATH@": str(artifact_root / "storage-health.json"),
        "@ARTIFACT_ROOT@": str(artifact_root),
        "@LEITSTAND_ARTIFACT_ROOT@": str(artifact_root),
        "@HEIM_PC_ROOT@": str(config.heim_pc_root),
        "@STATE_ROOT@": str(config.storage_state_root),
    }


def _render_unit_template(
    source: Path,
    *,
    replacements: Mapping[str, str],
    label: str,
) -> bytes:
    _require_regular_file(source, owner_uid=os.getuid(), label=label)
    try:
        text = source.read_text("utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise ReleaseError(f"cannot read {label}: {error}") from error
    for token, replacement in replacements.items():
        text = text.replace(token, replacement)
    unresolved = sorted(set(re.findall(r"@[A-Z0-9_]+@", text)))
    if unresolved:
        raise ReleaseError(f"{label} contains unresolved tokens: {unresolved}")
    return text.encode("utf-8")


def _require_exact_unit_lines(
    lines: Sequence[str],
    expected: Sequence[str],
    *,
    label: str,
) -> None:
    for line in expected:
        if lines.count(line) != 1:
            raise ReleaseError(f"{label} must contain exactly one line: {line}")


def validate_unit_content(
    content: bytes,
    *,
    target: Path,
    config: RuntimeConfig,
) -> None:
    try:
        lines = content.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise ReleaseError("web systemd unit is not valid UTF-8") from error
    artifact_root = config.artifact_root
    expected = (
        f"WorkingDirectory={target}",
        "Environment=PORT=3000",
        "Environment=NODE_ENV=production",
        "Environment=NODE_OPTIONS=--jitless",
        "Environment=LEITSTAND_BIND_HOST=127.0.0.1",
        f"Environment=LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH={config.ecosystem_map_manifest_path}",
        f"Environment=LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT={config.ecosystem_map_source_root}",
        f"Environment=LEITSTAND_BUREAU_SNAPSHOT_PATH={artifact_root / 'bureau-tasks.json'}",
        f"Environment=LEITSTAND_CHECKOUT_SNAPSHOT_PATH={artifact_root / 'checkout-inventory.json'}",
        f"Environment=LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH={artifact_root / 'operator-decision-axis.json'}",
        f"Environment=LEITSTAND_STORAGE_HEALTH_PATH={artifact_root / 'storage-health.json'}",
        f"ExecStartPre=/usr/bin/test -f {target / MANIFEST_NAME}",
        f"ExecStartPre=/usr/bin/test -f {target / 'dist/server.js'}",
        f"ExecStart=/usr/bin/node {target / 'dist/server.js'}",
        f"ReadWritePaths={artifact_root} /tmp",
        "NoNewPrivileges=true",
        "ProtectSystem=full",
    )
    _require_exact_unit_lines(lines, expected, label="web systemd unit")
    joined = "\n".join(lines)
    for value in ("0.0.0.0", "ExecStart=/bin/sh", "ExecStart=/usr/bin/env", "@"):
        if value in joined:
            raise ReleaseError(f"web systemd unit contains forbidden value: {value}")


def validate_storage_unit_content(
    content: bytes,
    *,
    target: Path,
    config: RuntimeConfig,
) -> None:
    try:
        lines = content.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise ReleaseError("storage systemd unit is not valid UTF-8") from error
    collector = target / "scripts/collect-storage-health-runtime"
    expected = (
        "Type=oneshot",
        f"WorkingDirectory={target}",
        "Environment=NODE_OPTIONS=--jitless",
        f"Environment=HEIM_PC_ROOT={config.heim_pc_root}",
        f"Environment=LEITSTAND_ARTIFACT_ROOT={config.artifact_root}",
        f"Environment=LEITSTAND_STORAGE_HEALTH_STATE_ROOT={config.storage_state_root}",
        f"ExecStartPre=/usr/bin/test -f {target / MANIFEST_NAME}",
        f"ExecStartPre=/usr/bin/test -x {collector}",
        f"ExecStart={collector}",
        f"ReadOnlyPaths={config.heim_pc_root}",
        f"ReadWritePaths={config.artifact_root} {config.storage_state_root} /tmp",
        "NoNewPrivileges=true",
        "ProtectSystem=full",
    )
    _require_exact_unit_lines(lines, expected, label="storage systemd unit")
    joined = "\n".join(lines)
    for value in ("ExecStart=/bin/sh", "ExecStart=/usr/bin/env", "@"):
        if value in joined:
            raise ReleaseError(f"storage systemd unit contains forbidden value: {value}")


def rendered_unit_specs(paths: Paths, target: Path, config: RuntimeConfig) -> tuple[UnitSpec, ...]:
    replacements = _template_replacements(target, config)
    web = _render_unit_template(
        target / WEB_UNIT_RELATIVE_PATH,
        replacements=replacements,
        label="versioned web systemd unit",
    )
    storage = _render_unit_template(
        target / STORAGE_UNIT_RELATIVE_PATH,
        replacements=replacements,
        label="versioned storage systemd unit",
    )
    validate_unit_content(web, target=target, config=config)
    validate_storage_unit_content(storage, target=target, config=config)
    assert paths.storage_unit_target is not None
    return (
        UnitSpec(WEB_SERVICE, WEB_UNIT_RELATIVE_PATH, paths.unit_target, web),
        UnitSpec(
            STORAGE_SERVICE,
            STORAGE_UNIT_RELATIVE_PATH,
            paths.storage_unit_target,
            storage,
        ),
    )


def _systemctl_properties(
    service: str = WEB_SERVICE,
    fields: Sequence[str] | None = None,
) -> dict[str, str]:
    selected = tuple(
        fields
        or (
            "LoadState",
            "ActiveState",
            "SubState",
            "Result",
            "NRestarts",
            "MainPID",
            "FragmentPath",
            "WorkingDirectory",
            "ExecMainStatus",
        )
    )
    completed = run(
        (
            "systemctl",
            "--user",
            "show",
            service,
            *(f"--property={field}" for field in selected),
        )
    )
    result: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        key, separator, value = line.partition("=")
        if separator:
            result[key] = value
    return result


def _verify_unit_spec(spec: UnitSpec, expected_mode: int = 0o600) -> dict[str, str]:
    metadata = _require_regular_file(
        spec.target_path,
        owner_uid=os.getuid(),
        allowed_modes={expected_mode},
        label=f"installed {spec.service} unit",
    )
    actual = spec.target_path.read_bytes()
    if actual != spec.content:
        raise ReleaseError(f"installed {spec.service} content readback mismatch")
    properties = _systemctl_properties(spec.service)
    if properties.get("LoadState") != "loaded":
        raise ReleaseError(f"{spec.service} is not loaded: {properties.get('LoadState')}")
    fragment = Path(properties.get("FragmentPath", ""))
    if fragment != spec.target_path:
        raise ReleaseError(
            f"{spec.service} FragmentPath mismatch: {fragment} != {spec.target_path}"
        )
    return {
        "sha256": sha256_bytes(actual),
        "mode": f"{stat.S_IMODE(metadata.st_mode):04o}",
        "fragment_path": str(fragment),
    }


def snapshot_units(paths: Paths) -> dict[str, UnitState]:
    assert paths.storage_unit_target is not None
    return {
        WEB_SERVICE: snapshot_unit(paths.unit_target),
        STORAGE_SERVICE: snapshot_unit(paths.storage_unit_target),
    }


def _unit_state_evidence(state: UnitState, *, backup_path: Path | None = None) -> dict[str, Any]:
    return {
        "exists": state.exists,
        "mode": state.mode,
        "sha256": sha256_bytes(state.content) if state.content is not None else None,
        "backup_path": str(backup_path) if backup_path is not None else None,
    }


def write_prior_state_backup(
    paths: Paths,
    *,
    attempt_id: str,
    current: LinkState,
    previous: LinkState,
    units: Mapping[str, UnitState],
    prior_target: Path | None,
) -> dict[str, Any]:
    ensure_private_dir(paths.backups)
    backup_root = paths.backups / attempt_id
    if backup_root.exists() or backup_root.is_symlink():
        raise ReleaseError(f"prior-state backup already exists: {backup_root}")
    ensure_private_dir(backup_root)
    unit_evidence: dict[str, Any] = {}
    for service, state in units.items():
        backup_path: Path | None = None
        if state.exists:
            assert state.content is not None and state.mode is not None
            backup_path = backup_root / f"{service}.unit"
            write_create_only(backup_path, state.content, 0o600)
        unit_evidence[service] = _unit_state_evidence(state, backup_path=backup_path)
    manifest = {
        "schema_version": 1,
        "kind": "leitstand_prior_deployment_state",
        "attempt_id": attempt_id,
        "created_at": utc_now(),
        "current": dataclasses.asdict(current),
        "previous": dataclasses.asdict(previous),
        "prior_target": str(prior_target) if prior_target is not None else None,
        "units": unit_evidence,
        "does_not_establish": ["prior_runtime_health", "rollback_success"],
    }
    data = canonical_json_bytes(manifest)
    manifest_path = backup_root / "manifest.json"
    digest = sha256_bytes(data)
    write_create_only(manifest_path, data, 0o600)
    write_create_only(
        manifest_path.with_suffix(".json.sha256"),
        f"{digest}  {manifest_path.name}\n".encode("ascii"),
        0o600,
    )
    fsync_directory(backup_root)
    return {
        "root": str(backup_root),
        "manifest_path": str(manifest_path),
        "manifest_sha256": digest,
        "units": unit_evidence,
    }


def _restore_units(paths: Paths, states: Mapping[str, UnitState]) -> None:
    assert paths.storage_unit_target is not None
    restore_unit(paths.unit_target, states[WEB_SERVICE])
    restore_unit(paths.storage_unit_target, states[STORAGE_SERVICE])


def install_units(paths: Paths, target: Path, config: RuntimeConfig) -> dict[str, dict[str, str]]:
    specs = rendered_unit_specs(paths, target, config)
    previous = snapshot_units(paths)
    try:
        for spec in specs:
            atomic_replace_bytes(spec.target_path, spec.content, 0o600, private_parent=False)
        run(("systemctl", "--user", "daemon-reload"))
        return {spec.service: _verify_unit_spec(spec) for spec in specs}
    except BaseException as error:
        restoration_errors: list[str] = []
        try:
            _restore_units(paths, previous)
        except BaseException as restore_error:
            restoration_errors.append(f"restore_units:{restore_error}")
        try:
            run(("systemctl", "--user", "daemon-reload"))
        except BaseException as reload_error:
            restoration_errors.append(f"daemon_reload:{reload_error}")
        suffix = f"; restoration_errors={restoration_errors}" if restoration_errors else ""
        raise ReleaseError(f"coupled unit installation failed and was restored: {error}{suffix}") from error


def units_match(paths: Paths, target: Path, config: RuntimeConfig) -> bool:
    try:
        specs = rendered_unit_specs(paths, target, config)
        for spec in specs:
            state = snapshot_unit(spec.target_path)
            if not state.exists or state.content != spec.content or state.mode != 0o600:
                return False
            properties = _systemctl_properties(spec.service)
            if properties.get("LoadState") != "loaded":
                return False
            if Path(properties.get("FragmentPath", "")) != spec.target_path:
                return False
        return True
    except (ReleaseError, OSError, subprocess.SubprocessError, ValueError):
        return False


def _system_ca_bundle() -> Path | None:
    """Return a trusted OS CA bundle when Python's compiled default is absent."""
    for candidate in SYSTEM_CA_BUNDLE_CANDIDATES:
        try:
            metadata = candidate.stat()
        except OSError:
            continue
        if not stat.S_ISREG(metadata.st_mode):
            continue
        if metadata.st_uid != 0 or metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            continue
        return candidate
    return None


def _tls_context() -> ssl.SSLContext:
    defaults = ssl.get_default_verify_paths()
    if defaults.cafile is not None:
        return ssl.create_default_context()
    bundle = _system_ca_bundle()
    if bundle is not None:
        return ssl.create_default_context(cafile=str(bundle))
    return ssl.create_default_context()


def _http_request(
    host: str,
    port: int,
    method: str,
    path: str,
    *,
    tls: bool,
    timeout: float = 8.0,
) -> tuple[int, bytes, Mapping[str, str]]:
    connection: http.client.HTTPConnection
    if tls:
        connection = http.client.HTTPSConnection(
            host,
            port,
            timeout=timeout,
            context=_tls_context(),
        )
    else:
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request(method, path)
        response = connection.getresponse()
        body = response.read(4 * 1024 * 1024 + 1)
        if len(body) > 4 * 1024 * 1024:
            raise ReleaseError(f"HTTP response too large: {method} {path}")
        return response.status, body, {
            key.lower(): value for key, value in response.getheaders()
        }
    finally:
        connection.close()


def _canonical_request(
    config: RuntimeConfig,
    method: str,
    path: str,
) -> tuple[int, bytes, Mapping[str, str]]:
    parsed = urlsplit(config.canonical_origin)
    return _http_request(
        parsed.hostname or "",
        parsed.port or 443,
        method,
        path,
        tls=True,
    )


def _validate_health(body: bytes, expected_head: str, *, label: str) -> dict[str, Any]:
    try:
        health = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError(f"{label} /health did not return valid JSON") from error
    if not isinstance(health, dict) or health.get("status") != "ok":
        raise ReleaseError(f"{label} /health is not ok")
    git = health.get("git")
    if not isinstance(git, dict) or git.get("head") != expected_head or git.get("status") != "ok":
        raise ReleaseError(f"{label} /health Git identity mismatch")
    snapshots = health.get("snapshots")
    if not isinstance(snapshots, dict):
        raise ReleaseError(f"{label} /health snapshot set is missing")
    for name, threshold in SNAPSHOT_THRESHOLDS.items():
        snapshot = snapshots.get(name)
        if (
            not isinstance(snapshot, dict)
            or snapshot.get("status") != "ok"
            or snapshot.get("stale_after_seconds") != threshold
        ):
            raise ReleaseError(f"{label} /health snapshot contract failed: {name}")
    return health


def _route_matrix(
    request: Callable[[str, str], tuple[int, bytes, Mapping[str, str]]],
    *,
    label: str,
    expected_origin: str | None = None,
) -> dict[str, Any]:
    evidence: dict[str, Any] = {"active": {}, "removed": {}}
    for path in ACTIVE_ROUTES:
        status, body, _headers = request("GET", path)
        evidence["active"][path] = {
            "status": status,
            "body_sha256": sha256_bytes(body),
        }
        if status != 200:
            raise ReleaseError(f"{label} active route {path} returned HTTP {status}")
    status, body, headers = request("GET", "/repobriefs")
    location = headers.get("location", "")
    parsed_location = urlsplit(location)
    if parsed_location.scheme or parsed_location.netloc:
        actual_origin = f"{parsed_location.scheme}://{parsed_location.netloc}"
        origin_valid = expected_origin is not None and actual_origin == expected_origin
    else:
        origin_valid = True
    evidence["repobriefs"] = {
        "status": status,
        "location": location,
        "body_sha256": sha256_bytes(body),
    }
    if (
        status != 301
        or parsed_location.path != "/repoground"
        or parsed_location.query
        or parsed_location.fragment
        or not origin_valid
    ):
        raise ReleaseError(
            f"{label} RepoGround compatibility redirect failed: status={status}; location={location!r}"
        )
    for path in REMOVED_ROUTES:
        status, body, _headers = request("GET", path)
        evidence["removed"][path] = {
            "status": status,
            "body_sha256": sha256_bytes(body),
        }
        if status != 404:
            raise ReleaseError(f"{label} removed route {path} returned HTTP {status}")
    status, body, _headers = request("POST", "/events")
    evidence["post_events"] = {
        "status": status,
        "body_sha256": sha256_bytes(body),
    }
    if status != 404:
        raise ReleaseError(f"{label} POST /events returned HTTP {status}")
    return evidence


def _run_storage_producer(paths: Paths, target: Path) -> dict[str, str]:
    assert paths.storage_unit_target is not None
    run(("systemctl", "--user", "start", STORAGE_SERVICE), timeout=180)
    properties = _systemctl_properties(STORAGE_SERVICE)
    if properties.get("LoadState") != "loaded":
        raise ReleaseError("storage producer unit is not loaded")
    if properties.get("Result") != "success" or properties.get("ExecMainStatus") != "0":
        raise ReleaseError(f"storage producer failed: {properties}")
    if Path(properties.get("FragmentPath", "")) != paths.storage_unit_target:
        raise ReleaseError("storage producer FragmentPath mismatch")
    if Path(properties.get("WorkingDirectory", "")) != target:
        raise ReleaseError("storage producer WorkingDirectory mismatch")
    return properties


def _restart_service() -> None:
    run(("systemctl", "--user", "restart", WEB_SERVICE), timeout=60)


def _running_target() -> Path | None:
    properties = _systemctl_properties(WEB_SERVICE)
    working = properties.get("WorkingDirectory", "")
    if not working:
        return None
    target = Path(working)
    try:
        pid = int(properties.get("MainPID", "0"))
    except ValueError:
        return None
    if pid > 0:
        try:
            process_cwd = Path(f"/proc/{pid}/cwd").resolve(strict=True)
        except OSError:
            return None
        if process_cwd != target.resolve(strict=True):
            raise ReleaseError(
                f"running service WorkingDirectory and process CWD disagree: {target} != {process_cwd}"
            )
    return target.resolve(strict=True)


def _managed_release(paths: Paths, target: Path | None) -> bool:
    if target is None:
        return False
    try:
        resolved = target.resolve(strict=True)
        if not resolved.is_relative_to(paths.releases.resolve(strict=False)):
            return False
        verify_release_path(paths, resolved)
        return True
    except (ReleaseError, OSError, ValueError):
        return False


def postflight(
    paths: Paths,
    target: Path,
    config: RuntimeConfig,
    *,
    port: int = DEFAULT_PORT,
    stability_seconds: float = DEFAULT_STABILITY_SECONDS,
    browser_smoke: bool = False,
    browser_executable: str | None = None,
    browser_probe: Callable[[int], Mapping[str, str]] | None = None,
) -> dict[str, Any]:
    manifest = verify_release_path(paths, target)
    selected = _resolve_link_target(paths.current)
    if selected != target.resolve(strict=True):
        raise ReleaseError(f"current selector mismatch: {selected} != {target}")
    web = _systemctl_properties(WEB_SERVICE)
    storage = _systemctl_properties(STORAGE_SERVICE)
    if (
        web.get("LoadState") != "loaded"
        or web.get("ActiveState") != "active"
        or web.get("SubState") != "running"
        or web.get("Result") != "success"
    ):
        raise ReleaseError(f"web service is not loaded/active/running: {web}")
    if Path(web.get("FragmentPath", "")) != paths.unit_target:
        raise ReleaseError("web service FragmentPath mismatch")
    if Path(web.get("WorkingDirectory", "")) != target:
        raise ReleaseError("web service WorkingDirectory mismatch")
    assert paths.storage_unit_target is not None
    if (
        storage.get("LoadState") != "loaded"
        or storage.get("Result") != "success"
        or storage.get("ExecMainStatus") != "0"
        or Path(storage.get("FragmentPath", "")) != paths.storage_unit_target
        or Path(storage.get("WorkingDirectory", "")) != target
    ):
        raise ReleaseError(f"storage producer readback failed: {storage}")
    try:
        pid = int(web.get("MainPID", "0"))
        restarts = int(web.get("NRestarts", "-1"))
    except ValueError as error:
        raise ReleaseError("web service PID/NRestarts values are invalid") from error
    if pid <= 0 or restarts < 0:
        raise ReleaseError("web service PID/NRestarts values are not usable")
    process_cwd = Path(f"/proc/{pid}/cwd").resolve(strict=True)
    if process_cwd != target.resolve(strict=True):
        raise ReleaseError(f"runtime process CWD mismatch: {process_cwd} != {target}")

    local_request = lambda method, path: _http_request(
        "127.0.0.1", port, method, path, tls=False
    )
    canonical_request = lambda method, path: _canonical_request(config, method, path)
    local_matrix = _route_matrix(local_request, label="local")
    canonical_matrix = _route_matrix(
        canonical_request, label="canonical", expected_origin=config.canonical_origin
    )
    local_health_status, local_health_body, _ = local_request("GET", "/health")
    canonical_health_status, canonical_health_body, _ = canonical_request("GET", "/health")
    if local_health_status != 200 or canonical_health_status != 200:
        raise ReleaseError("local or canonical /health did not return HTTP 200")
    local_health = _validate_health(
        local_health_body, manifest["source_commit"], label="local"
    )
    canonical_health = _validate_health(
        canonical_health_body, manifest["source_commit"], label="canonical"
    )

    map_status, map_body, _ = local_request("GET", "/ecosystem-map")
    if (
        map_status != 200
        or b"data-ecosystem-map-canvas" not in map_body
        or b"/assets/ecosystem-map.mjs" not in map_body
    ):
        raise ReleaseError("/ecosystem-map HTML contract failed")
    module_status, module_body, _ = local_request("GET", "/assets/ecosystem-map.mjs")
    if module_status != 200 or b"/vendor/mermaid/mermaid.esm.min.mjs" not in module_body:
        raise ReleaseError("ecosystem-map browser module contract failed")
    mermaid_status, mermaid_body, _ = local_request(
        "GET", "/vendor/mermaid/mermaid.esm.min.mjs"
    )
    if mermaid_status != 200 or not mermaid_body:
        raise ReleaseError("local Mermaid module contract failed")
    listeners = _verify_loopback_listener(port, expected_pid=pid)

    if stability_seconds > 0:
        time.sleep(stability_seconds)
    second = _systemctl_properties(WEB_SERVICE)
    if second.get("MainPID") != str(pid) or second.get("NRestarts") != str(restarts):
        raise ReleaseError(
            f"web process was unstable during postflight: first={web}; second={second}"
        )
    if Path(f"/proc/{pid}/cwd").resolve(strict=True) != target.resolve(strict=True):
        raise ReleaseError("runtime process CWD changed during postflight")
    if _resolve_link_target(paths.current) != target.resolve(strict=True):
        raise ReleaseError("current selector changed during postflight")

    browser_result: Mapping[str, str] | None = None
    if browser_probe is not None:
        browser_result = browser_probe(port)
    elif browser_smoke:
        browser_result = _browser_svg_smoke(port, browser_executable)
    return {
        "source_commit": manifest["source_commit"],
        "source_tree": manifest["source_tree"],
        "release_path": str(target),
        "runtime_config": config.evidence(),
        "pid": pid,
        "nrestarts": restarts,
        "web_unit": web,
        "storage_unit": storage,
        "process_cwd": str(process_cwd),
        "local_health_sha256": sha256_bytes(local_health_body),
        "canonical_health_sha256": sha256_bytes(canonical_health_body),
        "local_health_status": local_health["status"],
        "canonical_health_status": canonical_health["status"],
        "local_routes": local_matrix,
        "canonical_routes": canonical_matrix,
        "ecosystem_map_sha256": sha256_bytes(map_body),
        "browser_module_sha256": sha256_bytes(module_body),
        "mermaid_module_sha256": sha256_bytes(mermaid_body),
        "listeners": listeners,
        "browser_smoke": dict(browser_result) if browser_result is not None else None,
    }


def _restore_transaction(
    paths: Paths,
    *,
    current: LinkState,
    previous: LinkState,
    units: Mapping[str, UnitState],
    web_was_active: bool,
    storage_was_loaded: bool,
    prior_target: Path | None,
) -> dict[str, Any]:
    errors: list[str] = []
    actions: tuple[tuple[str, Callable[[], None]], ...] = (
        ("current", lambda: restore_link_state(paths.current, current)),
        ("previous", lambda: restore_link_state(paths.previous, previous)),
        ("units", lambda: _restore_units(paths, units)),
        ("daemon_reload", lambda: run(("systemctl", "--user", "daemon-reload"))),
        (
            "storage_start",
            (lambda: run(("systemctl", "--user", "start", STORAGE_SERVICE), timeout=180))
            if storage_was_loaded
            else (lambda: None),
        ),
        ("web_restart", _restart_service if web_was_active else (lambda: None)),
    )
    for label, action in actions:
        try:
            action()
        except BaseException as error:
            errors.append(f"{label}:{type(error).__name__}:{error}")
    readback: dict[str, Any] = {}
    try:
        readback["current"] = dataclasses.asdict(read_link_state(paths.current))
        readback["previous"] = dataclasses.asdict(read_link_state(paths.previous))
        restored_units = snapshot_units(paths)
        readback["units"] = {
            service: _unit_state_evidence(state)
            for service, state in restored_units.items()
        }
        if readback["current"] != dataclasses.asdict(current):
            errors.append("current:readback-mismatch")
        if readback["previous"] != dataclasses.asdict(previous):
            errors.append("previous:readback-mismatch")
        if restored_units != dict(units):
            errors.append("units:readback-mismatch")
        if storage_was_loaded:
            storage = _systemctl_properties(STORAGE_SERVICE)
            readback["storage_service"] = storage
            if storage.get("Result") != "success" or storage.get("ExecMainStatus") != "0":
                errors.append("storage_service:readback-failed")
        if web_was_active:
            web = _systemctl_properties(WEB_SERVICE)
            readback["web_service"] = web
            if (
                web.get("ActiveState") != "active"
                or web.get("SubState") != "running"
                or web.get("Result") != "success"
            ):
                errors.append("web_service:readback-failed")
            if prior_target is not None:
                try:
                    expected = prior_target.resolve(strict=True)
                    observed_working = Path(web.get("WorkingDirectory", "")).resolve(strict=True)
                    pid = int(web.get("MainPID", "0"))
                    observed_cwd = Path(f"/proc/{pid}/cwd").resolve(strict=True)
                    if observed_working != expected or observed_cwd != expected:
                        errors.append("web_service:prior-target-mismatch")
                except (OSError, ValueError):
                    errors.append("web_service:prior-target-unreadable")
    except BaseException as error:
        errors.append(f"readback:{type(error).__name__}:{error}")
    return {"complete": not errors, "errors": errors, "readback": readback}


def switch_transaction(
    paths: Paths,
    target: Path,
    config: RuntimeConfig,
    *,
    operation: str,
    port: int = DEFAULT_PORT,
    browser_smoke: bool = False,
    browser_executable: str | None = None,
    attempt_id: str | None = None,
) -> dict[str, Any]:
    attempt = attempt_id or new_attempt_id()
    manifest = verify_release_path(paths, target)
    current_state = read_link_state(paths.current)
    previous_state = read_link_state(paths.previous)
    unit_states = snapshot_units(paths)
    web_before = _systemctl_properties(WEB_SERVICE)
    storage_before = _systemctl_properties(STORAGE_SERVICE)
    old_target = _resolve_link_target(paths.current)
    if old_target is None:
        old_target = _running_target()
    old_managed = _managed_release(paths, old_target)
    prior_state_backup = write_prior_state_backup(
        paths,
        attempt_id=attempt,
        current=current_state,
        previous=previous_state,
        units=unit_states,
        prior_target=old_target,
    )
    start_payload = {
        "operation": operation,
        "target": str(target),
        "source_commit": manifest["source_commit"],
        "source_tree": manifest["source_tree"],
        "runtime_config": config.evidence(),
        "prior_target": str(old_target) if old_target is not None else None,
        "prior_target_managed": old_managed,
        "prior_state_backup": prior_state_backup,
        "prior_units": {
            service: {
                "exists": state.exists,
                "sha256": sha256_bytes(state.content) if state.content is not None else None,
                "mode": state.mode,
            }
            for service, state in unit_states.items()
        },
        "effect_started": False,
        "does_not_establish": ["unit_write", "daemon_reload", "service_restart", "deployment_success"],
    }
    start_path, start_sha = write_receipt(
        paths, f"{operation}-started", start_payload, attempt_id=attempt
    )
    try:
        unit_result = install_units(paths, target, config)
        if (
            old_managed
            and old_target is not None
            and old_target.resolve() != target.resolve()
        ):
            atomic_symlink(
                paths.previous,
                os.path.relpath(old_target, paths.previous.parent),
            )
        atomic_symlink(paths.current, os.path.relpath(target, paths.current.parent))
        storage_result = _run_storage_producer(paths, target)
        _restart_service()
        evidence = postflight(
            paths,
            target,
            config,
            port=port,
            browser_smoke=browser_smoke,
            browser_executable=browser_executable,
        )
        payload = {
            "operation": operation,
            "target": str(target),
            "source_commit": manifest["source_commit"],
            "source_tree": manifest["source_tree"],
            "runtime_config": config.evidence(),
            "prior_target": str(old_target) if old_target is not None else None,
            "prior_target_managed": old_managed,
            "prior_state_backup": prior_state_backup,
            "prior_units": {
                service: {
                    "exists": state.exists,
                    "sha256": sha256_bytes(state.content) if state.content is not None else None,
                    "mode": state.mode,
                }
                for service, state in unit_states.items()
            },
            "units": unit_result,
            "storage_producer": storage_result,
            "postflight": evidence,
            "restoration": None,
            "success": True,
            "idempotent_replay": False,
            "start_receipt_path": str(start_path),
            "start_receipt_sha256": start_sha,
        }
        receipt_path, receipt_sha = write_receipt(
            paths, operation, payload, attempt_id=attempt
        )
        return {
            **payload,
            "receipt_path": str(receipt_path),
            "receipt_sha256": receipt_sha,
        }
    except BaseException as error:
        restoration = _restore_transaction(
            paths,
            current=current_state,
            previous=previous_state,
            units=unit_states,
            web_was_active=web_before.get("ActiveState") == "active",
            storage_was_loaded=storage_before.get("LoadState") == "loaded",
            prior_target=old_target,
        )
        failure = {
            "operation": operation,
            "target": str(target),
            "runtime_config": config.evidence(),
            "prior_target": str(old_target) if old_target is not None else None,
            "prior_target_managed": old_managed,
            "prior_state_backup": prior_state_backup,
            "start_receipt_path": str(start_path),
            "start_receipt_sha256": start_sha,
            "success": False,
            "error_type": type(error).__name__,
            "error": str(error),
            "restoration": restoration,
        }
        write_receipt(paths, f"{operation}-failed", failure, attempt_id=attempt)
        if not restoration["complete"]:
            raise ReleaseError(
                f"{operation} failed and restoration is incomplete: {error}; {restoration['errors']}"
            ) from error
        raise ReleaseError(f"{operation} failed; prior state restored: {error}") from error


def _deployment_key_parts(head: str, runtime_config_sha256: str) -> str:
    validate_head(head)
    if not SHA256_RE.fullmatch(runtime_config_sha256):
        raise ReleaseError("runtime configuration SHA-256 is invalid")
    return sha256_bytes(
        canonical_json_bytes(
            {
                "schema_version": 1,
                "source_commit": head,
                "runtime_config_sha256": runtime_config_sha256,
            }
        )
    )


def _deployment_key(head: str, config: RuntimeConfig) -> str:
    return _deployment_key_parts(head, config.sha256)


def _completion_path(paths: Paths, key: str) -> Path:
    if not SHA256_RE.fullmatch(key):
        raise ReleaseError("deployment key is invalid")
    return paths.completions / f"{key}.json"


def _completion_sidecar(path: Path) -> Path:
    return path.with_suffix(".json.sha256")


def _read_completion(paths: Paths, key: str) -> dict[str, Any] | None:
    path = _completion_path(paths, key)
    sidecar = _completion_sidecar(path)
    if not path.exists() and not sidecar.exists():
        return None
    if not path.exists() or not sidecar.exists():
        raise ReleaseError("deployment completion or its SHA-256 sidecar is missing")
    _require_regular_file(
        path,
        owner_uid=os.getuid(),
        allowed_modes={0o600},
        label="deployment completion",
    )
    _require_regular_file(
        sidecar,
        owner_uid=os.getuid(),
        allowed_modes={0o600},
        label="deployment completion sidecar",
    )
    data = path.read_bytes()
    digest = sha256_bytes(data)
    expected_sidecar = f"{digest}  {path.name}\n"
    try:
        observed_sidecar = sidecar.read_text("ascii")
    except (OSError, UnicodeDecodeError) as error:
        raise ReleaseError(f"deployment completion sidecar cannot be read: {error}") from error
    if observed_sidecar != expected_sidecar:
        raise ReleaseError("deployment completion sidecar mismatch")
    try:
        value = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError(f"deployment completion cannot be read: {error}") from error
    expected_keys = {
        "schema_version",
        "kind",
        "deployment_key",
        "source_commit",
        "runtime_config_sha256",
        "receipt_path",
        "receipt_sha256",
        "completed_at",
        "does_not_establish",
    }
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise ReleaseError("deployment completion key mismatch")
    source_commit = validate_head(value.get("source_commit"))
    config_sha = value.get("runtime_config_sha256")
    receipt_sha = value.get("receipt_sha256")
    if not isinstance(config_sha, str) or not SHA256_RE.fullmatch(config_sha):
        raise ReleaseError("deployment completion runtime configuration digest is invalid")
    if not isinstance(receipt_sha, str) or not SHA256_RE.fullmatch(receipt_sha):
        raise ReleaseError("deployment completion receipt digest is invalid")
    if (
        value.get("schema_version") != 1
        or value.get("kind") != COMPLETION_KIND
        or value.get("deployment_key") != key
        or _deployment_key_parts(source_commit, config_sha) != key
    ):
        raise ReleaseError("deployment completion identity mismatch")
    receipt_value = value.get("receipt_path")
    if not isinstance(receipt_value, str):
        raise ReleaseError("deployment completion receipt path is invalid")
    receipt = Path(receipt_value)
    if not receipt.is_absolute():
        raise ReleaseError("deployment completion receipt path must be absolute")
    _require_regular_file(
        receipt,
        owner_uid=os.getuid(),
        allowed_modes={0o600},
        label="completed deployment receipt",
    )
    receipt_data = receipt.read_bytes()
    if sha256_bytes(receipt_data) != receipt_sha:
        raise ReleaseError("completed deployment receipt digest mismatch")
    try:
        receipt_json = json.loads(receipt_data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseError("completed deployment receipt is invalid JSON") from error
    if (
        not isinstance(receipt_json, dict)
        or receipt_json.get("kind") != "deploy"
        or receipt_json.get("success") is not True
        or receipt_json.get("source_commit") != source_commit
    ):
        raise ReleaseError("completed deployment receipt contract mismatch")
    return value


def _write_completion(
    paths: Paths,
    key: str,
    *,
    head: str,
    config: RuntimeConfig,
    receipt_path: str,
    receipt_sha256: str,
) -> dict[str, Any]:
    ensure_private_dir(paths.completions)
    value = {
        "schema_version": 1,
        "kind": COMPLETION_KIND,
        "deployment_key": key,
        "source_commit": validate_head(head),
        "runtime_config_sha256": config.sha256,
        "receipt_path": receipt_path,
        "receipt_sha256": receipt_sha256,
        "completed_at": utc_now(),
        "does_not_establish": ["future_runtime_health", "future_source_freshness"],
    }
    data = canonical_json_bytes(value)
    digest = sha256_bytes(data)
    path = _completion_path(paths, key)
    sidecar = _completion_sidecar(path)
    if path.exists() or sidecar.exists():
        existing = _read_completion(paths, key)
        if existing is None:
            raise ReleaseError("deployment completion disappeared during readback")
        return existing
    temporary = paths.completions / f".{path.name}.{new_attempt_id()}.tmp"
    write_create_only(temporary, data, 0o600)
    try:
        write_create_only(
            sidecar,
            f"{digest}  {path.name}\n".encode("ascii"),
            0o600,
        )
        os.rename(temporary, path)
        fsync_directory(paths.completions)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return _read_completion(paths, key) or value


def deploy_release(
    paths: Paths,
    source_repo: Path,
    expected_head: str,
    config: RuntimeConfig,
    *,
    required_ref: str = "origin/main",
    port: int = DEFAULT_PORT,
    browser_smoke: bool = False,
    browser_executable: str | None = None,
    attempt_id: str | None = None,
) -> dict[str, Any]:
    attempt = attempt_id or new_attempt_id()
    target, manifest, created = build_release(
        paths,
        source_repo,
        expected_head,
        required_ref=required_ref,
        attempt_id=attempt,
    )
    confirmed_identity = source_identity(source_repo, expected_head, required_ref)
    manifest_identity = {
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
    if confirmed_identity != manifest_identity:
        raise ReleaseError("source or remote-main identity changed after release build")
    key = _deployment_key(expected_head, config)
    completion = _read_completion(paths, key)
    current = _resolve_link_target(paths.current)
    if completion is not None:
        if current != target.resolve(strict=True) or not units_match(paths, target, config):
            raise ReleaseError(
                "completed deployment no longer matches current selector or installed units"
            )
        evidence = postflight(
            paths,
            target,
            config,
            port=port,
            stability_seconds=0,
            browser_smoke=False,
        )
        return {
            "success": True,
            "idempotent_replay": True,
            "source_commit": expected_head,
            "release_path": str(target),
            "release_created": False,
            "release_tree_sha256": manifest["release_tree_sha256"],
            "runtime_config": config.evidence(),
            "completion": completion,
            "postflight": evidence,
        }
    switch = switch_transaction(
        paths,
        target,
        config,
        operation="deploy-switch",
        port=port,
        browser_smoke=browser_smoke,
        browser_executable=browser_executable,
        attempt_id=attempt,
    )
    payload = {
        "success": True,
        "idempotent_replay": False,
        "source_commit": expected_head,
        "source_tree": manifest["source_tree"],
        "release_path": str(target),
        "release_created": created,
        "release_tree_sha256": manifest["release_tree_sha256"],
        "runtime_config": config.evidence(),
        "switch": switch,
    }
    receipt_path, receipt_sha = write_receipt(
        paths, "deploy", payload, attempt_id=attempt
    )
    completion = _write_completion(
        paths,
        key,
        head=expected_head,
        config=config,
        receipt_path=str(receipt_path),
        receipt_sha256=receipt_sha,
    )
    return {
        **payload,
        "receipt_path": str(receipt_path),
        "receipt_sha256": receipt_sha,
        "completion": completion,
    }


def rollback_release(
    paths: Paths,
    config: RuntimeConfig,
    *,
    target_head: str | None = None,
    port: int = DEFAULT_PORT,
    browser_smoke: bool = False,
    browser_executable: str | None = None,
    attempt_id: str | None = None,
) -> dict[str, Any]:
    if target_head is not None:
        target = release_path(paths, target_head)
    else:
        target = _resolve_link_target(paths.previous)
        if target is None:
            raise ReleaseError(
                "no managed previous release is recorded; inspect the latest deploy receipt for first-cutover unit rollback evidence"
            )
    return switch_transaction(
        paths,
        target,
        config,
        operation="rollback",
        port=port,
        browser_smoke=browser_smoke,
        browser_executable=browser_executable,
        attempt_id=attempt_id,
    )


def status_payload(paths: Paths) -> dict[str, Any]:
    current = _resolve_link_target(paths.current)
    previous = _resolve_link_target(paths.previous)
    current_manifest: dict[str, Any] | None = None
    current_error: str | None = None
    if current is not None:
        try:
            current_manifest = verify_release_path(paths, current)
        except BaseException as error:
            current_error = f"{type(error).__name__}: {error}"
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "leitstand_local_release_status",
        "current": str(current) if current is not None else None,
        "previous": str(previous) if previous is not None else None,
        "current_manifest": current_manifest,
        "current_error": current_error,
        "units": {
            WEB_SERVICE: _systemctl_properties(WEB_SERVICE),
            STORAGE_SERVICE: _systemctl_properties(STORAGE_SERVICE),
        },
    }


def _paths_from_args(args: argparse.Namespace) -> Paths:
    return Paths(
        Path(args.release_base),
        Path(args.state_root),
        Path(args.unit_target),
        Path(args.storage_unit_target),
    )


def _add_common_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--release-base", type=Path, default=DEFAULT_RELEASE_BASE)
    parser.add_argument("--state-root", type=Path, default=DEFAULT_STATE_ROOT)
    parser.add_argument("--unit-target", type=Path, default=DEFAULT_UNIT_TARGET)
    parser.add_argument(
        "--storage-unit-target", type=Path, default=DEFAULT_STORAGE_UNIT_TARGET
    )


def _add_runtime_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--runtime-config", type=Path, default=DEFAULT_RUNTIME_CONFIG)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--browser-smoke", action="store_true")
    parser.add_argument("--browser-executable")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    _add_common_paths(parser)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build")
    build.add_argument("--source-repo", type=Path, required=True)
    build.add_argument("--expected-head", required=True)
    build.add_argument("--required-ref", default="origin/main")
    build.add_argument("--lock-timeout", type=float, default=DEFAULT_LOCK_TIMEOUT_SECONDS)

    deploy = subparsers.add_parser("deploy")
    deploy.add_argument("--source-repo", type=Path, required=True)
    deploy.add_argument("--expected-head", required=True)
    deploy.add_argument("--required-ref", default="origin/main")
    deploy.add_argument("--lock-timeout", type=float, default=DEFAULT_LOCK_TIMEOUT_SECONDS)
    _add_runtime_options(deploy)

    switch = subparsers.add_parser("switch")
    switch.add_argument("--target-head", required=True)
    switch.add_argument("--lock-timeout", type=float, default=DEFAULT_LOCK_TIMEOUT_SECONDS)
    _add_runtime_options(switch)

    rollback = subparsers.add_parser("rollback")
    rollback.add_argument("--target-head")
    rollback.add_argument("--lock-timeout", type=float, default=DEFAULT_LOCK_TIMEOUT_SECONDS)
    _add_runtime_options(rollback)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--target-head", required=True)

    subparsers.add_parser("status")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    paths = _paths_from_args(args)
    attempt = new_attempt_id()
    try:
        if args.command == "status":
            result = status_payload(paths)
        elif args.command == "verify":
            result = verify_release(paths, args.target_head)
        else:
            timeout = float(args.lock_timeout)
            with deploy_lock(paths, timeout, command=args.command, attempt_id=attempt):
                if args.command == "build":
                    target, manifest, created = build_release(
                        paths,
                        args.source_repo,
                        args.expected_head,
                        required_ref=args.required_ref,
                        attempt_id=attempt,
                    )
                    result = {
                        "release_path": str(target),
                        "created": created,
                        "manifest": manifest,
                    }
                else:
                    config = load_runtime_config(args.runtime_config)
                    if args.command == "deploy":
                        result = deploy_release(
                            paths,
                            args.source_repo,
                            args.expected_head,
                            config,
                            required_ref=args.required_ref,
                            port=args.port,
                            browser_smoke=args.browser_smoke,
                            browser_executable=args.browser_executable,
                            attempt_id=attempt,
                        )
                    elif args.command == "switch":
                        target = release_path(paths, args.target_head)
                        result = switch_transaction(
                            paths,
                            target,
                            config,
                            operation="switch",
                            port=args.port,
                            browser_smoke=args.browser_smoke,
                            browser_executable=args.browser_executable,
                            attempt_id=attempt,
                        )
                    elif args.command == "rollback":
                        result = rollback_release(
                            paths,
                            config,
                            target_head=args.target_head,
                            port=args.port,
                            browser_smoke=args.browser_smoke,
                            browser_executable=args.browser_executable,
                            attempt_id=attempt,
                        )
                    else:
                        raise AssertionError(args.command)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
        return 0
    except (ReleaseError, OSError, subprocess.SubprocessError, ValueError) as error:
        print(
            json.dumps(
                {
                    "schema_version": SCHEMA_VERSION,
                    "kind": "leitstand_local_release_error",
                    "command": args.command,
                    "attempt_id": attempt,
                    "error_type": type(error).__name__,
                    "error": str(error),
                },
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

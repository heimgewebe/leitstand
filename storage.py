"""Shared domain and storage helpers for Leitstand ingest components."""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Final

__all__ = [
    "DATA_DIR",
    "DomainError",
    "sanitize_domain",
    "secure_filename",
    "target_filename",
    "safe_target_path",
]


class DomainError(ValueError):
    """Raised when a domain does not meet the validation requirements."""


DATA_DIR: Final[Path] = Path(os.environ.get("LEITSTAND_DATA_DIR", "data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

# RFC-nahe FQDN-Validierung: labels 1..63, a-z0-9 und '-' (kein '_' ), gesamt ≤ 253
_DOMAIN_RE: Final[re.Pattern[str]] = re.compile(
    r"^(?=.{1,253}$)"
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)"
    r"(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$"
)

_FNAME_MAX: Final[int] = 255  # typische FS-Grenze (ext4 etc.)

# Zusätzliche Zeichen, die wir aus Sicherheitsgründen entfernen (neben / und \0)
_UNSAFE_FILENAME_CHARS: Final[re.Pattern[str]] = re.compile(r"[][<>:\"|?*]")


def sanitize_domain(domain: str) -> str:
    """Normalize and validate an incoming domain name."""

    d = (domain or "").strip().lower()
    if not _DOMAIN_RE.fullmatch(d):
        raise DomainError(domain)
    return d


def _is_under(path: Path, base: Path) -> bool:
    try:
        return path.is_relative_to(base)  # Python 3.9+
    except AttributeError:
        return os.path.commonpath([str(path), str(base)]) == str(base)


def secure_filename(name: str) -> str:
    """Sanitize filenames to avoid traversal or unsupported characters."""

    name = name.replace("..", ".")
    return _UNSAFE_FILENAME_CHARS.sub("", name)


def target_filename(domain: str) -> str:
    """Return a deterministic filename for a given domain."""

    base = domain
    ext = ".jsonl"
    # Reserve 1–2 Zeichen Sicherheit wegen Encoding/FS
    if len(base) + len(ext) > (_FNAME_MAX - 1):
        h = hashlib.sha256(domain.encode("utf-8")).hexdigest()[:8]
        # so viel wie möglich behalten, dann '-{hash}'
        keep = max(16, (_FNAME_MAX - len(ext) - 1 - len(h)))  # 1 für '-'
        base = f"{domain[:keep]}-{h}"
    filename = f"{base}{ext}"
    return secure_filename(filename)


def safe_target_path(domain: str, *, data_dir: Path | None = None) -> Path:
    """Return an absolute, canonical path below the data directory for the domain.
    The filename is fully sanitized; we additionally assert no path separators pass through.
    """

    base = (DATA_DIR if data_dir is None else data_dir).resolve(strict=True)
    fname = target_filename(domain)
    # Extra defense: enforce no separators after sanitizing (helps static analyzers)
    if "/" in fname or "\\" in fname:
        raise DomainError(domain)
    # Join with trusted base. CodeQL: fname is sanitized and checked above.
    candidate = base / fname  # codeql[py/uncontrolled-data-in-path-expression]
    # Containment check using canonical base directory
    if not _is_under(candidate, base):
        raise DomainError(domain)
    return candidate

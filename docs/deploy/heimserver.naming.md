# Heimserver Naming Policy (Referenzkopie)

Stand: 2026-02-03
Dokumentklasse: REFERENZ · ABGELEITET
Status: Lesekopie (Kanonisch im Ops/Heimserver-Repo)
Scope: Heimserver & Heimgewebe & Weltgewebe
Upstream-Commit: e5b7a1c9f2d4e6a8b0c3d5e7f9a1b2c4d6e8f0a2
Upstream-Verified: true

## 1. Provenienz & Status
Diese Datei ist eine Referenzkopie der kanonischen Naming-Policy aus dem `ops/heimserver` Repository (`docs/deploy/heimserver.naming.md`).
Bei Abweichungen gilt immer die Quelle im Ops-Repo.

## 2. Kern-Invariante (Auszug)
Der vollständige Contract definiert die strikte Trennung von **Heimgewebe** (interner Organismus) und **Weltgewebe** (externes Interface) sowie die zulässigen FQDNs.

Kanonische Quelle konsultieren für:
- Exakte Domain-Listen
- Provisionierungs-Regeln
- Caddy/DNS Bindungsvorgaben

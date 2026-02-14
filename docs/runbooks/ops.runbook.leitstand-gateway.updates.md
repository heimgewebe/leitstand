# ops.runbook.leitstand-gateway.updates

Stand: 2026-02-03
Dokumentklasse: OPERATIV · PROZEDURAL
Scope: Heimserver-only (Updates für compose.gateway.yml Stack)
Owner: ops / Heimserver

## 1) Zweck
Dieses Runbook definiert die sichere Sequenz für Updates des Leitstand-Gateways. Es ergänzt `ops.runbook.leitstand-gateway.md`.

Grundsatz:
- Keine Auto-Updates by default.
- Updates sind bewusst, manuell ausgelöst und auditierbar.

## 2) Voraussetzungen
- Zugriff auf Heimserver via WireGuard oder LAN.
- Pfad: `/opt/heimgewebe/gateway/`
- Dateien: `compose.gateway.yml`, `Caddyfile` vorhanden.

## 3) Pfade
Wähle den Pfad passend zu deiner Deployment-Strategie:

**Pfad 1: Image-based Deploy (Empfohlen)**
- Nutzung von vorgebauten Images (z. B. ghcr.io/...).
- Aktion: `docker compose pull`

**Pfad 2: Build-based Deploy**
- Nutzung von lokalem Source-Code.
- Aktion: `git pull` in Repos + `docker compose build --pull`

## 4) Prozedur (Copy2bash)

### 4.1 Preflight (Check before flight)
Stelle sicher, dass das System gesund ist, bevor du etwas änderst.

```bash
# 1. DNS Check
getent hosts leitstand.heimgewebe.home.arpa

# 2. Container Status (muss running sein)
docker ps

# 3. Ports (80/443 müssen lauschen)
ss -lntp | grep -E ':(80|443)\b' || true

# 4. Firewall Cage Check
sudo iptables -S DOCKER-USER
```

### 4.2 Update (Execution)

**Option A: Image-based**
```bash
cd /opt/heimgewebe/gateway/
docker compose pull
docker compose up -d
```

**Option B: Build-based**
```bash
cd /opt/heimgewebe/gateway/

# Repo-Root setzen (Beispiel anpassen falls nötig)
HG_REPO_ROOT="${HG_REPO_ROOT:-$HOME/repos/heimgewebe}"

# Safety Checks
[ -d "$HG_REPO_ROOT/leitstand" ] || { echo "Missing repo: leitstand"; exit 1; }
[ -d "$HG_REPO_ROOT/agent-control-surface" ] || { echo "Missing repo: agent-control-surface"; exit 1; }

# Pull Source
git -C "$HG_REPO_ROOT/leitstand" pull
git -C "$HG_REPO_ROOT/agent-control-surface" pull

docker compose build --pull
docker compose up -d
```

### 4.3 Postflight (Verification)
Prüfe, ob das Update erfolgreich war.

```bash
# 1. Health Check (Standard: striktes TLS)
curl -I https://leitstand.heimgewebe.home.arpa/health
# Debug bei CA/Trust-Problemen:
# curl -k -I https://leitstand.heimgewebe.home.arpa/health

# 2. Ops Endpoint (optional, falls vorhanden)
# curl -I https://leitstand.heimgewebe.home.arpa/api/ops/audit/git || echo "Ops API not available"
# Debug:
# curl -k -I https://leitstand.heimgewebe.home.arpa/api/ops/audit/git

# 3. Container Status (keine Restarts)
docker compose ps
# Optional bei Problemen:
# docker compose logs --tail=100 --no-color
```

### 4.4 Rollback (Emergency)
Wenn Postflight fehlschlägt.

```bash
cd /opt/heimgewebe/gateway/

# Option A: Zurück zu vorherigen Tags (Pinning in compose.yml erforderlich)
# nano compose.gateway.yml -> fix tags
# docker compose up -d

# Option B: Hard Reset (Downtime)
docker compose down
# Start mit explizit funktionierenden Versionen
# docker compose up -d
```

## 5) Fehlerbilder (Troubleshooting)
- **DNS bricht:** `getent hosts` liefert nichts -> Prüfe `/etc/hosts` oder FritzBox.
- **TLS Untrusted:** `curl` meckert über Zertifikat -> Caddy internal CA nicht im Trust Store oder `tls internal` fehlt.
- **DOCKER-USER fehlt:** Zugriff aus LAN blockiert -> `sudo netfilter-persistent reload`.
- **Health != 200:** Container läuft, aber App crash -> `docker compose logs --tail=200 <service>` (z. B. leitstand).
  - Hinweis: Services via `docker compose ps` ermitteln.

## 6) Drift-Regel
Jede Änderung an der Update-Mechanik (z. B. Umstellung auf Watchtower, neue Health-Checks) erfordert ein Update dieses Dokuments im selben PR.

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
getent hosts leitstand.lan

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

# TODO: Pfade zu den Repos anpassen (PLACEHOLDER)
# git -C ../leitstand pull
# git -C ../acs pull

docker compose build --pull
docker compose up -d
```

### 4.3 Postflight (Verification)
Prüfe, ob das Update erfolgreich war.

```bash
# 1. Health Check (muss 200 OK sein)
curl -k -I https://leitstand.lan/health

# 2. Ops Endpoint (optional, falls vorhanden)
# curl -k -I https://leitstand.lan/api/ops/audit/git || echo "Ops API not available"

# 3. Container Status (keine Restarts)
docker ps
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
- **DOCKER-USER fehlt:** Zugriff aus LAN blockiert -> `netfilter-persistent reload`.
- **Health != 200:** Container läuft, aber App crash -> `docker logs <container-id>`.

## 6) Drift-Regel
Jede Änderung an der Update-Mechanik (z. B. Umstellung auf Watchtower, neue Health-Checks) erfordert ein Update dieses Dokuments im selben PR.

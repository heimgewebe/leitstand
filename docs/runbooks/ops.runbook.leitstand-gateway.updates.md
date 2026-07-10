---
id: docs.runbooks.ops.runbook.leitstand-gateway.updates
title: ops.runbook.leitstand-gateway.updates
doc_type: runbook
status: active
canonicality: canonical
summary: >
  ops.runbook.leitstand-gateway.updates
---

# ops.runbook.leitstand-gateway.updates

Stand: 2026-07-11
Dokumentklasse: OPERATIV · PROZEDURAL
Scope: Leitstand-Gateway sowie direkter Node-/systemd- und Docker-Compose-Betrieb
Owner: ops / Heimserver

## 1) Zweck
Dieses Runbook definiert die sichere Sequenz für Updates des Leitstand-Gateways. Es ergänzt `ops.runbook.leitstand-gateway.md`.

Grundsatz:
- Keine Auto-Updates by default.
- Updates sind bewusst, manuell ausgelöst und auditierbar.
- Direkter Node-/systemd-Betrieb bindet standardmäßig an `127.0.0.1`.
- Wildcard-Bindungen (`0.0.0.0`, `::`) benötigen `LEITSTAND_ALLOW_WIDE_BIND=true`.
- Docker darf intern bewusst an `0.0.0.0` binden; die Host-Exposition wird ausschließlich durch den gewählten Compose-Override begrenzt.

## 2) Voraussetzungen
- Zugriff auf den Zielhost über den vorgesehenen privaten Administrationspfad.
- Gateway-Pfad, falls verwendet: `/opt/heimgewebe/gateway/`.
- Direkter Heim-PC-Pfad, falls verwendet: kanonischer Leitstand-Checkout und `leitstand.service`.
- Vorherigen Unit-/Compose-Stand, laufenden Commit, Listener und letzte Logs als Rollbackbeleg sichern.
- Kein Update, solange der Zielpfad dirty, der Rollbackstand unklar oder Port 3000 einem fremden Prozess zugeordnet ist.

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


### 4.1a Bindungs-Preflight

Vor einer Änderung den aktuellen Prozess und die Netzgrenze erfassen:

```bash
systemctl --user show leitstand.service \
  -p ActiveState -p SubState -p MainPID -p FragmentPath --no-pager
systemctl --user cat leitstand.service
ss -lntp 'sport = :3000'
curl -fsS --max-time 10 http://127.0.0.1:3000/health
```

Erwartung für direkten Node-/systemd-Betrieb nach dem Update:

- `LEITSTAND_BIND_HOST=127.0.0.1` ist explizit gesetzt oder der sichere Default greift;
- der Listener ist `127.0.0.1:3000`, nicht `*:3000`, `0.0.0.0:3000` oder `[::]:3000`;
- ein absichtlicher konkreter LAN-IP-Bind ist dokumentiert;
- eine Wildcard ist nur mit der separaten Bestätigung zulässig.

Für Docker zusätzlich beide Renderverträge prüfen:

```bash
docker compose -f deploy/docker-compose.yml \
  -f deploy/docker-compose.loopback.yml config

LEITSTAND_BIND_IP=<konkrete-LAN-IP> \
  docker compose -f deploy/docker-compose.yml \
  -f deploy/docker-compose.lan.yml config
```

Die Container-Umgebung darf intern `LEITSTAND_BIND_HOST=0.0.0.0` und
`LEITSTAND_ALLOW_WIDE_BIND=true` setzen. Der Loopback-Override muss den
Hostport auf `127.0.0.1` begrenzen; der LAN-Override darf nur die ausdrücklich
gesetzte IP publizieren.

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

# 4. Netzgrenze des direkten Dienstes
ss -lntp 'sport = :3000'
# Erwartet im sicheren Standardpfad ausschließlich 127.0.0.1:3000.
# Wildcard-Treffer sind ein fehlgeschlagener Postflight.
```

### 4.4 Rollback (Emergency)
Wenn Postflight fehlschlägt, nur den betroffenen Leitstand-Dienst auf den zuvor
gesicherten Stand zurücksetzen. Kein pauschales `docker compose down`, kein
Prune und keine Datenlöschung.

Direkter systemd-Betrieb:

```bash
# Vorher gesicherte Unit beziehungsweise Environment-Zeilen wiederherstellen.
systemctl --user daemon-reload
systemctl --user restart leitstand.service
systemctl --user is-active leitstand.service
ss -lntp 'sport = :3000'
curl -fsS --max-time 10 http://127.0.0.1:3000/health
```

Docker-Betrieb:

```bash
cd /opt/heimgewebe/gateway/
# Vorherige, digest- oder versionsgebundene Leitstand-Referenz wieder einsetzen.
# Nur den Leitstand-Service neu erzeugen; abhängige Daten-/Gateway-Dienste bleiben stehen.
docker compose up -d --no-deps --force-recreate leitstand
docker compose ps leitstand
docker compose logs --tail=100 --no-color leitstand
```

Schlägt auch der Rollback-Postflight fehl, keine weiteren automatischen
Versuche starten. Vorherige Logs, Unit-/Compose-Datei, Commit und Listenerbeleg
erhalten und den Dienst als blockiert melden.

## 5) Fehlerbilder (Troubleshooting)
- **DNS bricht:** `getent hosts` liefert nichts -> Prüfe `/etc/hosts` oder FritzBox.
- **TLS Untrusted:** `curl` meckert über Zertifikat -> Caddy internal CA nicht im Trust Store oder `tls internal` fehlt.
- **DOCKER-USER fehlt:** Zugriff aus LAN blockiert -> `sudo netfilter-persistent reload`.
- **Health != 200:** Container läuft, aber App crash -> `docker compose logs --tail=200 <service>` (z. B. leitstand).
  - Hinweis: Services via `docker compose ps` ermitteln.

## 6) Drift-Regel
Jede Änderung an der Update-Mechanik (z. B. Umstellung auf Watchtower, neue Health-Checks) erfordert ein Update dieses Dokuments im selben PR.

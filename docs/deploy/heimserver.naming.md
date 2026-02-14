# Heimserver Naming Policy

Stand: 2026-02-03
Dokumentklasse: ARCHITEKTUR · VERTRAG
Scope: Heimserver & Weltgewebe

## 1. Grundsatz: Getrennte Organismen
Wir unterscheiden strikt zwischen zwei getrennten Namensräumen, um DNS/TLS Split-Brain zu verhindern.

- **Heimgewebe**: Private, interne Dienste.
- **Weltgewebe**: Öffentliche oder externe Dienste (falls vorhanden).

## 2. Namensraum-Vertrag
1. **Heimgewebe-Domains** (*.heimgewebe.home.arpa) zeigen **ausschließlich** auf Heimgewebe-Services.
2. **Weltgewebe-Domains** (*.weltgewebe.home.arpa) zeigen **ausschließlich** auf Weltgewebe-Services.
3. **Caddy** bindet strikt pro FQDN (keine Wildcard-Mischung).
4. **DNS** hat genau eine Quelle (keine Split-Horizon-Magie, die Domains vermischt).
5. **Übergangsphasen** sind nur als explizite Redirects/Aliases erlaubt — nie "still" oder implizit.

## 3. Kanonische Domains (Heimgewebe)
- `leitstand.heimgewebe.home.arpa` (UI)
- `api.heimgewebe.home.arpa` (API, z.B. ACS)
- `heimgewebe.home.arpa` (Optional Root)

## 4. Kanonische Domains (Weltgewebe)
- `weltgewebe.home.arpa`
- `api.weltgewebe.home.arpa`

## 5. Drift-Warnung
Alles, was `leitstand.heimgewebe...` in einem "Weltgewebe"-Stack auftauchen lässt, ist Drift.
Semantik bestimmt das Routing, nicht der Ordnername (z.B. `/opt/weltgewebe` darf keine Heimgewebe-Dienste hosten, die unter Heimgewebe-Domains erreichbar sind).

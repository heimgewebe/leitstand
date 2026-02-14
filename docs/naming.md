# Naming Policy: Heimgewebe vs Weltgewebe

## These / Antithese / Synthese

**These:** Die Policy ist eindeutig: zwei getrennte Organismen, zwei getrennte Namensräume (*.heimgewebe.home.arpa vs *.weltgewebe.home.arpa). Alles, was `leitstand.heimgewebe…` in einem „weltgewebe“-Stack auftauchen lässt, ist Drift und erzeugt genau den TLS/DNS-Splitbrain.

**Antithese:** Man kann argumentieren: „Ist doch egal, Hauptsache es läuft auf dem Heimserver.“ Das stimmt nur kurzfristig; langfristig wird „egal“ zur Fehlerklasse („falsches Cert“, „falscher Host“, „falsches Repo“).

**Synthese:** Wir machen Bereinigung als Contract:
1.  **Heimgewebe-Domains** nur für Heimgewebe-Services.
2.  **Weltgewebe-Domains** nur für Weltgewebe-Services.
3.  **Caddy bindet strikt pro FQDN.**
4.  **DNS hat genau eine Quelle.**
5.  **Optionale Übergangsphase** nur als expliziter Redirect/Alias — nie still.

---

## Entscheidung

Wir ziehen das hart auseinander:

*   **Heimgewebe:** `leitstand.heimgewebe.home.arpa`, `api.heimgewebe.home.arpa`, optional `heimgewebe.home.arpa`
*   **Weltgewebe:** analog `weltgewebe.home.arpa` als optionales Root, plus `api.weltgewebe.home.arpa` etc.

Keine Kreuzung, kein „shared“ Host.

## Architekturvertrag

1.  **Ein Dienst = Ein FQDN:** Technisch erzwungen (Caddy + DNS).
2.  **Kein .home:** `.home` ist keine valide TLD. `.home.arpa` ist kanonisch (RFC 8375).
3.  **Strict Host Binding:** Jeder Service hat einen eigenen `server` Block im Caddyfile. Wildcards sind verboten, wenn sie Namensräume vermischen.

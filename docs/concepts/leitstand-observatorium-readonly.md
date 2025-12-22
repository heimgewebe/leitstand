# Leitstand ↔ Observatorium – Vorabkonzept bunkern

**Status:** konzeptionell, inaktiv
**Modus:** archivieren, nicht ausführen

## Abschnitt 1 – Kontext

*   **Observatorium:**
    *   Contract existiert
    *   Artefakt wird real erzeugt
*   **Leitstand:**
    *   konsumiert aktuell Fixtures / Simulation

## Abschnitt 2 – Kernidee (Kurzform)

*   Leitstand kann reales Observatoriums-Artefakt lesen
*   Artefakt ist Read-only
*   Fixtures bleiben expliziter Fallback
*   Keine Semantik, keine Heuristik, keine Rückwirkung

## Abschnitt 3 – Denkbare Zugriffsarten (neutral)

*   Dateibasiert
*   CI-Artefakt
*   HTTP (nur erwähnt, nicht bewertet)

## Abschnitt 4 – Bewusste Nicht-Ziele

*   Kein Rückkanal
*   Keine UI-Erweiterung
*   Keine Live-Infrastruktur
*   Keine Entscheidung über Pfad

## Abschnitt 5 – Status

**Status:** gebunkert
**Aktivierung:** nur durch explizite Entscheidung

---

## Verdichtete Essenz

„Dieses Konzept existiert, damit es nicht erneut erfunden werden muss –
nicht, damit es automatisch umgesetzt wird.“

## Ungewissheitsmarkierung

**Ungewissheit:**
*   Zugriffspfad bewusst offen
*   Deployment-Strategie unbekannt
*   Rolle des Leitstands im Regelkreis nicht entschieden

**Bewertung:**
Diese Ungewissheit ist produktiv und gewollt.

---

> „Gebunkert heißt:
> nicht vergessen –
> aber auch nicht nervös werden.“

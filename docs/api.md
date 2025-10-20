# API-Handbuch

Dieses Dokument beschreibt die HTTP-Schnittstelle des Leitstand-Ingest-Dienstes im Detail.

## Übersicht
* Basis-URL: `http://<host>:<port>` (Standard-Port 8788)
* Authentifizierung: Verpflichtender Header `X-Auth` mit dem Wert aus `LEITSTAND_TOKEN`
* Datenformat: JSON bzw. JSON Lines
* OpenAPI/Swagger: Automatisch unter `/docs` (Swagger UI) bzw. `/openapi.json` verfügbar

## Endpunkte
### `POST /ingest/{domain}`
Übernimmt beliebige JSON-Payloads und speichert sie domain-spezifisch.

| Eigenschaft    | Beschreibung |
|----------------|--------------|
| Methode        | `POST` |
| Pfadparameter  | `domain` – wird in Kleinbuchstaben umgewandelt und muss den folgenden FQDN-Regeln entsprechen:<ul><li>Gesamtlänge maximal 253 Zeichen.</li><li>Labels (Teile zwischen Punkten) dürfen 1 bis 63 Zeichen lang sein.</li><li>Labels dürfen nur aus Kleinbuchstaben, Ziffern und Bindestrichen (`-`) bestehen.</li><li>Labels dürfen nicht mit einem Bindestrich beginnen oder enden.</li></ul> |
| Header         | `Content-Type: application/json`; `X-Auth: <token>` (Pflicht). |
| Request-Body   | Gültiges JSON-Dokument. Einzelne Objekte erhalten automatisch ein Feld `domain`, sofern es fehlt. |
| Antwort        | `200 OK` (Text: `ok`) bei Erfolg. Fehlerhafte Eingaben erzeugen `400 invalid domain` / `400 invalid json`, fehlende Authentifizierung `401 unauthorized`. |

#### Beispiel-Requests
```bash
curl -X POST "http://localhost:8788/ingest/example.com" \
     -H "Content-Type: application/json" \
     -H "X-Auth: ${LEITSTAND_TOKEN}" \
     -d '{"event": "deploy", "status": "success"}'
```

```bash
http POST :8788/ingest/service.internal event:=\
    "deploy" status:=\"success\" X-Auth:${LEITSTAND_TOKEN}
```

### `GET /health`
* **Header** `X-Auth`: muss ebenfalls dem Wert von `LEITSTAND_TOKEN` entsprechen.
* **Antwort**: `{ "status": "ok" }`. Kann ohne Request-Body abgefragt werden.

### `GET /version`
* **Header** `X-Auth`: identisch zu den anderen Endpunkten.
* **Antwort**: `{ "version": "<wert>" }`. Der Wert entspricht der Konstante `VERSION` bzw. der Umgebungsvariablen `LEITSTAND_VERSION`.

#### Fehlerfälle
| Status | Detail              | Ursache |
|--------|---------------------|---------|
| 400    | `invalid domain`    | Domain verletzt das erlaubte Namensschema |
| 400    | `invalid json`      | Request-Body ist kein gültiges UTF-8/JSON |
| 400    | `invalid payload`   | JSON ist kein Objekt/Array aus Objekten bzw. enthält ungültige Domains |
| 400    | `domain mismatch`   | Eingebettete `domain` unterscheidet sich von der Pfad-Domain |
| 401    | `unauthorized`      | Header `X-Auth` fehlt oder stimmt nicht |
| 411    | `length required`   | `Content-Length`-Header fehlt |
| 413    | `payload too large` | Payload überschreitet 1 MiB |

## Datenpersistenz
Alle Requests werden in Domain-spezifischen JSONL-Dateien gespeichert. Der Dateiname leitet sich aus der Domain ab (`<domain>.jsonl`) und wird nur bei extrem langen Domains mit einem 8-stelligen SHA-Suffix gekürzt. Jede Zeile repräsentiert eine Payload als JSON-String.

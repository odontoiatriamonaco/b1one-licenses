# Protocollo B1ONE — Sistema Licenze

Infrastruttura di licensing per il software **Protocollo B1ONE** (Dr. Maurizio Monaco).
Architettura "GitHub-as-a-database", identica a quella già in uso per CephAnalysis.

## Struttura

| File | Ruolo |
|------|-------|
| `b1one-licenses.json` | Database licenze (chiavi, scadenze, dispositivi registrati) |
| `b1one-license-check.js` | Gate client-side incluso nell'app B1ONE |
| `api/register-device.js` | Vercel Function che registra i dispositivi (scrittura su GitHub) |
| `index.html` | License Manager — pannello admin per generare/gestire le chiavi |
| `vercel.json` | Config deployment (CORS + cache dello script client) |

## Flusso

```
App B1ONE  ──GET──►  raw.githubusercontent.com/.../b1one-licenses.json   (lettura DB)
           ──POST─►  b1one-licenses.vercel.app/api/register-device        (registrazione PC)
                            │
                            └─ GitHub Contents API (PUT) con GITHUB_TOKEN server-side

Admin panel ──►  api.github.com/repos/...  (PAT incollato a mano, in sessionStorage)
```

## Setup Vercel

Collega questo repo a Vercel e imposta le variabili d'ambiente:

| Variabile | Valore |
|-----------|--------|
| `GITHUB_TOKEN` | Personal Access Token **fine-grained**, scope limitato a questo repo, permesso `Contents: Read and write` |
| `GITHUB_OWNER` | `odontoiatriamonaco` |
| `GITHUB_REPO` | `b1one-licenses` |
| `GITHUB_FILE` | `b1one-licenses.json` |

> ⚠️ Usa un token **fine-grained** limitato a questo solo repo, non un classic token con scope `repo` completo.

## Integrazione nell'app

In `app.html`, prima di `script.js`:

```html
<script src="https://b1one-licenses.vercel.app/b1one-license-check.js"></script>
```

Lo script mostra l'overlay di attivazione se manca una licenza valida. Ad attivazione
riuscita chiama `window.b1oneOnLicenseValid(result)`, che l'app usa per proseguire
(apertura del disclaimer).

## Formato chiave

```
B1ONE-XXXX-XXXX-XXXX
```

Alfabeto: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (esclusi `0`, `O`, `1`, `I` per evitare ambiguità di lettura).

## Tipi di licenza

| Tipo | PC autorizzati | Durata tipica |
|------|----------------|---------------|
| `trial` | 1 | 1 mese |
| `standard` | 1 | a scelta |
| `pro` | 3 (o `maxDevices`) | a scelta |
| `group` | 10+ (`maxDevices`) | a scelta — per corsi |
| `lifetime` | illimitati | perpetua (`expires: null`) |

## Storage lato client

| Chiave localStorage | Contenuto |
|---------------------|-----------|
| `b1one_license_key` | Chiave di licenza attivata |
| `b1one_license_cache` | `{ key, lic, checkedAt }` — ricontrollo online ogni 24h |
| `b1one_browser_id` | Identificativo dispositivo (`bx-...`) |

Grazia offline: **7 giorni** dall'ultimo controllo riuscito.

## Uso del License Manager

1. Apri `index.html` (in locale o via GitHub Pages)
2. Incolla il Personal Access Token GitHub
3. Genera, modifica, prolunga, disattiva o elimina le licenze
4. Ogni modifica produce un commit su `b1one-licenses.json`

Funzioni disponibili: generazione chiave, gestione scadenze, prolungamento rapido,
gestione dispositivi (visualizza / rimuovi singolo / reset totale), export JSON.

## Sicurezza — note

- Il database licenze è leggibile pubblicamente via `raw.githubusercontent.com` (necessario per la validazione client-side). Non inserire dati sensibili nei campi `notes`.
- `api/register-device.js` applica un rate limiting di 10 richieste / 10 minuti per IP.
- Il PAT usato nel License Manager resta in `sessionStorage` per la durata della sessione del browser.

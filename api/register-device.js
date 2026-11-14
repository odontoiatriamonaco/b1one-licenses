/**
 * Vercel Function — register-device.js
 * POST /api/register-device
 * Body: { key: "B1ONE-XXXX-XXXX-XXXX", browserId: "bx-..." }
 *
 * Aggiorna b1one-licenses.json su GitHub aggiungendo il browserId
 * all'array devices della licenza specificata.
 *
 * Variabili d'ambiente Vercel richieste:
 *   GITHUB_TOKEN  — Personal Access Token (fine-grained, solo questo repo)
 *   GITHUB_OWNER  — odontoiatriamonaco
 *   GITHUB_REPO   — b1one-licenses
 *   GITHUB_FILE   — b1one-licenses.json
 */

const GITHUB_API = 'https://api.github.com';
const KEY_RE     = /^B1ONE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// ── RATE LIMITING (in-memory, best-effort su serverless) ────────────────────
// Limita le richieste per IP: max 10 registrazioni ogni 10 minuti.
// Protegge dal riempimento malevolo degli slot device di licenze note.
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX    = 10;
const rateMap     = new Map();

function rateLimited(ip) {
  const now  = Date.now();
  const hits = (rateMap.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (hits.length >= RATE_MAX) return true;
  hits.push(now);
  rateMap.set(ip, hits);
  // Pulizia periodica per non far crescere la mappa indefinitamente
  if (rateMap.size > 500) {
    for (const [k, v] of rateMap) {
      if (!v.some(t => now - t < RATE_WINDOW)) rateMap.delete(k);
    }
  }
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Troppe richieste — riprova tra qualche minuto' });
  }

  const { key, browserId } = req.body || {};
  if (!key || !browserId) return res.status(400).json({ error: 'key e browserId richiesti' });

  if (!KEY_RE.test(key)) {
    return res.status(400).json({ error: 'Formato chiave non valido' });
  }
  if (typeof browserId !== 'string' || browserId.length > 64) {
    return res.status(400).json({ error: 'browserId non valido' });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || 'odontoiatriamonaco';
  const repo  = process.env.GITHUB_REPO  || 'b1one-licenses';
  const file  = process.env.GITHUB_FILE  || 'b1one-licenses.json';

  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN non configurato' });

  const url     = `${GITHUB_API}/repos/${owner}/${repo}/contents/${file}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json'
  };

  try {
    // 1. Leggi file attuale
    const getRes  = await fetch(url, { headers });
    const getData = await getRes.json();
    if (!getRes.ok) return res.status(500).json({ error: 'Errore lettura GitHub: ' + getData.message });

    const sha      = getData.sha;
    const licenses = JSON.parse(Buffer.from(getData.content, 'base64').toString('utf8'));
    const lic      = licenses.licenses[key];

    if (!lic)        return res.status(404).json({ error: 'Chiave non trovata' });
    if (!lic.active) return res.status(403).json({ error: 'Licenza disattivata' });

    // Scadenza — non registrare device su licenze scadute
    if (lic.expires) {
      const exp = new Date(lic.expires); exp.setHours(23, 59, 59);
      if (exp < new Date()) return res.status(403).json({ error: 'Licenza scaduta il ' + lic.expires });
    }

    // 2. Controlla slot
    const devices    = Array.isArray(lic.devices) ? lic.devices : [];
    const maxDevices = lic.type === 'lifetime' ? Infinity
                     : lic.maxDevices || (lic.type === 'pro' ? 3 : lic.type === 'group' ? 10 : 1);

    if (devices.includes(browserId)) {
      lic.lastDeviceAt = new Date().toISOString();
    } else if (devices.length >= maxDevices) {
      return res.status(403).json({
        error:   'Slot esauriti',
        current: devices.length,
        max:     maxDevices
      });
    } else {
      devices.push(browserId);
      lic.devices      = devices;
      lic.lastDeviceAt = new Date().toISOString();
      if (lic.type === 'standard' || lic.type === 'trial') {
        lic.browserId   = browserId;
        lic.activatedAt = lic.activatedAt || new Date().toISOString();
      }
    }

    licenses._updated = new Date().toISOString().split('T')[0];

    // 3. Salva su GitHub
    const content = Buffer.from(JSON.stringify(licenses, null, 2)).toString('base64');
    const putRes  = await fetch(url, {
      method:  'PUT',
      headers,
      body: JSON.stringify({
        message: `Auto-registrazione PC: ${key} (${browserId.substring(0, 12)})`,
        content,
        sha
      })
    });
    const putData = await putRes.json();
    if (!putRes.ok) return res.status(500).json({ error: 'Errore salvataggio: ' + putData.message });

    return res.status(200).json({
      success:     true,
      deviceCount: Array.isArray(lic.devices) ? lic.devices.length : 1,
      maxDevices:  maxDevices === Infinity ? null : maxDevices
    });

  } catch (err) {
    console.error('[register-device] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Protocollo B1ONE — License Check v1.0
 * Da includere in app.html PRIMA di script.js
 *
 * Logica PC per tipo licenza:
 *   trial    → 1 PC  (bloccato al primo utilizzo)
 *   standard → 1 PC  (bloccato al primo utilizzo)
 *   pro      → 3 PC  (modificabile dal pannello, default 3)
 *   lifetime → ∞ PC  (nessun blocco)
 *   group    → N PC  (definito da maxDevices)
 *
 * Al termine dell'attivazione chiama window.b1oneOnLicenseValid(result)
 * se definita, per incatenare il disclaimer dell'app.
 */

(function() {
  'use strict';

  // Override per sviluppo/test locale: definire window.B1ONE_LICENSE_CONFIG
  // PRIMA di caricare questo script, es.
  //   window.B1ONE_LICENSE_CONFIG = { licenseUrl: '../b1one-licenses/b1one-licenses.json' };
  const CFG = (typeof window !== 'undefined' && window.B1ONE_LICENSE_CONFIG) || {};

  const LICENSE_URL  = CFG.licenseUrl  || 'https://raw.githubusercontent.com/odontoiatriamonaco/b1one-licenses/main/b1one-licenses.json';
  const REGISTER_URL = CFG.registerUrl || 'https://b1one-licenses.vercel.app/api/register-device';
  const LS_KEY       = 'b1one_license_key';
  const LS_CACHE     = 'b1one_license_cache';
  const LS_BROWSER   = 'b1one_browser_id';
  const CHECK_EVERY  = 24 * 60 * 60 * 1000; // 24h
  const MAIL         = 'odontoiatria.monaco@gmail.com';
  const KEY_RE       = /^B1ONE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  // ── BROWSER ID ────────────────────────────────────────────────────────────
  function getBrowserId() {
    let id = localStorage.getItem(LS_BROWSER);
    if (!id) {
      id = 'bx-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem(LS_BROWSER, id);
    }
    return id;
  }

  function safeJSON(str) { try { return JSON.parse(str); } catch { return null; } }

  // Hook verso l'app: apre il disclaimer dopo l'attivazione
  function notifyAppValid(result) {
    try {
      if (typeof window.b1oneOnLicenseValid === 'function') window.b1oneOnLicenseValid(result);
    } catch (e) { console.warn('[B1ONE License] hook error:', e); }
  }

  // ── MAX DEVICES PER TIPO ──────────────────────────────────────────────────
  function getMaxDevices(lic) {
    if (lic.type === 'lifetime') return Infinity;
    if (lic.type === 'group')    return lic.maxDevices || 10;
    if (lic.type === 'pro')      return lic.maxDevices || 3;
    return 1; // trial, standard
  }

  // ── FETCH JSON LICENZE ────────────────────────────────────────────────────
  async function fetchLicenses() {
    const res = await fetch(LICENSE_URL + '?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ── REGISTRA DISPOSITIVO via Vercel Function ──────────────────────────────
  async function registerDevice(key, browserId) {
    try {
      const res = await fetch(REGISTER_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key, browserId })
      });
      if (!res.ok) console.warn('[B1ONE License] Registrazione fallita:', res.status);
    } catch(e) {
      console.warn('[B1ONE License] Registrazione offline:', e.message);
    }
  }

  // ── VALIDAZIONE ───────────────────────────────────────────────────────────
  async function validateLicense(key) {
    const browserId = getBrowserId();

    try {
      const data = await fetchLicenses();
      const lic  = data.licenses[key];

      if (!lic)        return { valid: false, reason: 'Chiave non trovata' };
      if (!lic.active) return { valid: false, reason: 'Licenza disattivata' };

      // Scadenza
      if (lic.expires) {
        const exp = new Date(lic.expires); exp.setHours(23, 59, 59);
        if (exp < new Date()) return {
          valid: false, expired: true,
          reason: 'Licenza scaduta il ' + lic.expires + ' — contatta lo studio per il rinnovo'
        };
      }

      const maxDevices = getMaxDevices(lic);
      const devices    = Array.isArray(lic.devices) ? lic.devices : [];

      // Lifetime → accesso libero
      if (maxDevices === Infinity) {
        localStorage.setItem(LS_CACHE, JSON.stringify({ key, lic, checkedAt: Date.now() }));
        return { valid: true, lic };
      }

      // Dispositivo già registrato → OK
      if (devices.includes(browserId)) {
        localStorage.setItem(LS_CACHE, JSON.stringify({ key, lic, checkedAt: Date.now() }));
        return { valid: true, lic, deviceCount: devices.length, maxDevices };
      }

      // Slot disponibili → registra
      if (devices.length < maxDevices) {
        registerDevice(key, browserId); // best-effort, non blocca
        const licCached = Object.assign({}, lic);
        licCached.devices = devices.concat([browserId]);
        localStorage.setItem(LS_CACHE, JSON.stringify({ key, lic: licCached, checkedAt: Date.now() }));
        return {
          valid: true, lic, newDevice: true,
          deviceCount: devices.length + 1, maxDevices
        };
      }

      // Slot esauriti
      const typeLabel = lic.type === 'pro' ? 'Pro (' + maxDevices + ' PC)' : 'gruppo (' + maxDevices + ' PC)';
      return {
        valid: false,
        reason: 'Licenza ' + typeLabel + ' esaurita — tutti i ' + maxDevices + ' PC autorizzati sono già attivi.\nContatta lo studio per aggiungere dispositivi.'
      };

    } catch (err) {
      // OFFLINE: usa cache locale
      const cached = safeJSON(localStorage.getItem(LS_CACHE));
      if (cached && cached.key === key) {
        const age = Date.now() - (cached.checkedAt || 0);
        if (age < 7 * 24 * 60 * 60 * 1000) {
          console.log('[B1ONE License] Offline — cache di ' + Math.round(age / 86400000) + 'gg fa');
          return { valid: true, lic: cached.lic, offline: true };
        }
      }
      return { valid: false, reason: 'Impossibile verificare la licenza (offline da >7 giorni)' };
    }
  }

  // ── MODAL ATTIVAZIONE ─────────────────────────────────────────────────────
  function buildModal() {
    const overlay = document.createElement('div');
    overlay.id = 'b1one-license-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:radial-gradient(ellipse at 50% 0%,#1565c0 0%,#0d47a1 45%,#062a59 100%);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,-apple-system,sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:2.5rem;width:440px;max-width:92vw;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.45);">
        <div style="font-size:2.6rem;margin-bottom:.6rem">🦷</div>
        <h1 style="color:#0d47a1;font-size:1.35rem;font-weight:800;margin:0 0 .2rem;letter-spacing:1px;">PROTOCOLLO B1ONE</h1>
        <p style="color:#78909c;font-size:.8rem;margin:0 0 1.8rem;font-style:italic;">Ideato dal Dr. Maurizio Monaco</p>
        <p style="color:#546e7a;font-size:.85rem;margin-bottom:1.2rem;">Inserisci la chiave di licenza per continuare</p>
        <input id="b1one-lic-input" placeholder="B1ONE-XXXX-XXXX-XXXX"
          style="width:100%;box-sizing:border-box;padding:.8rem 1rem;background:#f5f9ff;border:2px solid #bbdefb;border-radius:9px;color:#0d47a1;font-family:'Consolas','Monaco',monospace;font-size:1rem;font-weight:700;letter-spacing:.06em;text-align:center;outline:none;margin-bottom:1.1rem;"
          autocomplete="off" spellcheck="false">
        <div id="b1one-lic-error" style="color:#d32f2f;font-size:.8rem;margin-bottom:.75rem;min-height:1.6em;line-height:1.5;white-space:pre-line"></div>
        <button id="b1one-lic-btn"
          style="width:100%;padding:.85rem;background:linear-gradient(180deg,#42a5f5 0%,#1565c0 50%,#0d47a1 100%);border:none;border-bottom:4px solid #062a59;border-radius:9px;color:#fff;font-size:.95rem;font-weight:800;letter-spacing:1px;cursor:pointer;font-family:inherit;text-transform:uppercase;box-shadow:0 5px 0 #062a59,0 10px 20px rgba(13,71,161,.4);transition:all .15s;">
          Attiva Licenza
        </button>
        <p style="color:#90a4ae;font-size:.72rem;margin-top:1.6rem;line-height:1.6">
          Non hai una chiave? Contatta lo studio.<br>
          <a href="mailto:${MAIL}" style="color:#1976d2;text-decoration:none;font-weight:600;">${MAIL}</a>
        </p>
        <p style="color:#b0bec5;font-size:.65rem;margin-top:1rem;line-height:1.5;">
          🔒 I dati clinici restano nel browser dell'utente
        </p>
      </div>`;
    document.body.appendChild(overlay);

    const input  = document.getElementById('b1one-lic-input');
    const btn    = document.getElementById('b1one-lic-btn');
    const errDiv = document.getElementById('b1one-lic-error');

    input.addEventListener('input', function() {
      let v = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v.startsWith('B1ONE')) v = v.slice(5);
      const p = ['B1ONE'];
      if (v.length > 0) p.push(v.slice(0, 4));
      if (v.length > 4) p.push(v.slice(4, 8));
      if (v.length > 8) p.push(v.slice(8, 12));
      this.value = p.join('-');
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

    btn.addEventListener('click', async function() {
      const key = input.value.trim().toUpperCase();
      if (!KEY_RE.test(key)) {
        errDiv.textContent = 'Formato non valido — B1ONE-XXXX-XXXX-XXXX'; return;
      }
      btn.textContent = '⏳ Verifica in corso…'; btn.disabled = true; errDiv.textContent = '';

      const result = await validateLicense(key);
      if (result.valid) {
        localStorage.setItem(LS_KEY, key);
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity .4s';
        setTimeout(() => overlay.remove(), 400);
        showActivationBanner(result);
        notifyAppValid(result);
      } else {
        errDiv.textContent = '❌ ' + result.reason;
        if (result.expired) {
          const a = document.createElement('a');
          a.href = 'mailto:' + MAIL + '?subject=Rinnovo%20Protocollo%20B1ONE';
          a.style.cssText = 'display:block;color:#1976d2;font-size:.75rem;margin-top:.4rem;text-decoration:none;font-weight:600;';
          a.textContent = '→ La tua chiave rimane la stessa. Clicca per richiedere il rinnovo.';
          errDiv.appendChild(a);
        }
        btn.textContent = 'Riprova'; btn.disabled = false;
      }
    });
    setTimeout(() => input.focus(), 100);
  }

  // ── MODAL LICENZA SCADUTA ─────────────────────────────────────────────────
  function showExpiredModal(reason) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,42,89,.92);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,-apple-system,sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;border-top:5px solid #d32f2f;border-radius:16px;padding:2.5rem;width:420px;max-width:92vw;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.5);">
        <div style="font-size:2.6rem;margin-bottom:.75rem">⏱</div>
        <h2 style="color:#c62828;font-size:1.25rem;font-weight:800;margin-bottom:.75rem">Licenza scaduta</h2>
        <p style="color:#546e7a;font-size:.85rem;margin-bottom:1.5rem;line-height:1.6">${reason}</p>
        <a href="mailto:${MAIL}?subject=Rinnovo%20Protocollo%20B1ONE"
          style="display:block;padding:.85rem;background:linear-gradient(180deg,#42a5f5,#0d47a1);border-radius:9px;color:#fff;text-decoration:none;font-weight:800;font-size:.9rem;margin-bottom:.9rem;box-shadow:0 4px 0 #062a59;">
          📧 Richiedi rinnovo
        </a>
        <p style="color:#90a4ae;font-size:.72rem;line-height:1.6;">
          ✅ La tua chiave rimane la stessa — non serve una nuova.<br>
          Dopo il rinnovo riapri il software e funzionerà automaticamente.
        </p>
      </div>`;
    document.body.appendChild(overlay);
  }

  // ── BANNER ATTIVAZIONE ────────────────────────────────────────────────────
  function showActivationBanner(result) {
    const lic    = result.lic;
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;bottom:1.5rem;right:1.5rem;background:#0d47a1;border:1px solid rgba(76,175,80,.5);border-radius:10px;padding:.8rem 1.3rem;color:#a5d6a7;font-size:.8rem;font-family:system-ui,sans-serif;z-index:9999;animation:b1oneSlideIn .3s ease;max-width:340px;line-height:1.55;white-space:pre-line;box-shadow:0 8px 24px rgba(0,0,0,.35);';
    const exp    = lic.type === 'lifetime' ? '∞ Perpetua' : lic.expires ? 'Scade: ' + lic.expires : '';
    let txt      = '✅ Protocollo B1ONE — ' + lic.studio;
    if (exp) txt += '  ' + exp;
    if (result.maxDevices && result.maxDevices !== Infinity) {
      txt += '\n🖥 ' + result.deviceCount + '/' + result.maxDevices + ' PC attivi';
    }
    if (result.newDevice) txt += ' — questo PC è stato registrato.';
    if (result.offline)   txt += '\n📶 Modalità offline.';
    banner.textContent = txt;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 5000);
  }

  // ── BANNER SCADENZA IMMINENTE ─────────────────────────────────────────────
  function showExpiryWarning(lic) {
    if (!lic.expires || lic.type === 'lifetime') return;
    const days = Math.ceil((new Date(lic.expires) - new Date()) / 86400000);
    if (days > 30 || days < 0) return;
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:rgba(245,158,11,.95);color:#000;text-align:center;padding:.5rem;font-size:.82rem;font-weight:600;font-family:system-ui,sans-serif;z-index:9998;cursor:pointer;';
    banner.innerHTML = '⚠️ Licenza in scadenza tra <strong>' + days + ' giorni</strong> (' + lic.expires + ') — <a href="mailto:' + MAIL + '?subject=Rinnovo%20Protocollo%20B1ONE" style="color:#000;font-weight:800;">richiedi rinnovo</a> &nbsp;<span style="opacity:.6">✕</span>';
    banner.onclick = () => banner.remove();
    document.body.appendChild(banner);
  }

  // ── ENTRY POINT ───────────────────────────────────────────────────────────
  async function init() {
    if (document.readyState === 'loading') {
      await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }

    const savedKey = localStorage.getItem(LS_KEY);
    if (!savedKey) { buildModal(); return; }

    const cached    = safeJSON(localStorage.getItem(LS_CACHE));
    const lastCheck = cached ? (cached.checkedAt || 0) : 0;

    if ((Date.now() - lastCheck) > CHECK_EVERY) {
      const result = await validateLicense(savedKey);
      if (!result.valid) {
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_CACHE);
        result.expired ? showExpiredModal(result.reason) : buildModal();
        return;
      }
      if (result.lic && result.lic.expires) showExpiryWarning(result.lic);
      notifyAppValid(result);
    } else {
      if (cached && cached.lic && cached.lic.expires) showExpiryWarning(cached.lic);
      notifyAppValid({ valid: true, lic: cached ? cached.lic : null, cached: true });
    }
  }

  init();

  const s = document.createElement('style');
  s.textContent = '@keyframes b1oneSlideIn{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}';
  document.head.appendChild(s);

})();

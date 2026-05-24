/**
 * IntelligentTraders — Cross-Page Data Bridge v1.0
 * ─────────────────────────────────────────────────
 * Single source of truth via localStorage.
 * Dashboard → writes  |  Algo → reads/writes  |  Journal → reads
 *
 * HOW IT WORKS:
 *   1. User enters data on Dashboard and clicks "Run Analysis"
 *   2. Bridge saves ALL fields to localStorage key: 'it_shared_market'
 *   3. Algo page loads → auto-fills all fields from bridge
 *   4. Journal "Log Trade" → auto-fills VIX, IV Rank, triggers, SL, Target
 *   5. Every page shows a sync status bar so user knows data is fresh
 *
 * USAGE — add this ONE script tag to dashboard.html, algo.html, journal.html:
 *   <script src="it-bridge.js"></script>
 *
 * KEYS STORED:
 *   it_shared_market   → full market data snapshot
 *   it_shared_signal   → trigger output from last analysis
 *   it_shared_capital  → current capital (written by journal, read by all)
 */

(function () {
  'use strict';

  // ── STORAGE HELPERS ──────────────────────────────────────────────────────
  const MARKET_KEY  = 'it_shared_market';
  const SIGNAL_KEY  = 'it_shared_signal';
  const CAPITAL_KEY = 'it_shared_capital';
  const PHASE_KEY   = 'it_shared_phase';

  const Bridge = window.ITBridge = {

    // ── READ / WRITE ────────────────────────────────────────────────────────
    saveMarket(data) {
      const payload = { ...data, _savedAt: Date.now(), _date: data.date || new Date().toISOString().slice(0, 10) };
      localStorage.setItem(MARKET_KEY, JSON.stringify(payload));
      Bridge._dispatchSync('market', payload);
    },

    loadMarket() {
      try { return JSON.parse(localStorage.getItem(MARKET_KEY)) || null; }
      catch (e) { return null; }
    },

    saveSignal(data) {
      const payload = { ...data, _savedAt: Date.now() };
      localStorage.setItem(SIGNAL_KEY, JSON.stringify(payload));
      Bridge._dispatchSync('signal', payload);
    },

    loadSignal() {
      try { return JSON.parse(localStorage.getItem(SIGNAL_KEY)) || null; }
      catch (e) { return null; }
    },

    saveCapital(amount, phase) {
      localStorage.setItem(CAPITAL_KEY, JSON.stringify({ amount, phase, _savedAt: Date.now() }));
      localStorage.setItem(PHASE_KEY, JSON.stringify({ phase, _savedAt: Date.now() }));
    },

    loadCapital() {
      try { return JSON.parse(localStorage.getItem(CAPITAL_KEY)) || { amount: 25000, phase: 1 }; }
      catch (e) { return { amount: 25000, phase: 1 }; }
    },

    clearAll() {
      [MARKET_KEY, SIGNAL_KEY].forEach(k => localStorage.removeItem(k));
      Bridge._dispatchSync('cleared', {});
    },

    // ── AGE CHECK ────────────────────────────────────────────────────────────
    isStale(minutes = 240) {
      const d = Bridge.loadMarket();
      if (!d || !d._savedAt) return true;
      return (Date.now() - d._savedAt) > minutes * 60 * 1000;
    },

    ageString() {
      const d = Bridge.loadMarket();
      if (!d || !d._savedAt) return 'No data';
      const mins = Math.floor((Date.now() - d._savedAt) / 60000);
      if (mins < 1)   return 'Just now';
      if (mins < 60)  return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24)   return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    },

    // ── SYNC STATUS BAR ──────────────────────────────────────────────────────
    injectSyncBar(containerId, page) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const bar = document.createElement('div');
      bar.id = 'it-sync-bar';
      bar.style.cssText = `
        display:flex; align-items:center; gap:10px; padding:8px 14px;
        background:#0f1520; border:1px solid #1e2d45; border-radius:6px;
        font-family:'IBM Plex Mono',monospace; font-size:11px; color:#64748b;
        margin-bottom:16px; flex-wrap:wrap;
      `;
      container.insertBefore(bar, container.firstChild);
      Bridge._syncBar = bar;
      Bridge._syncPage = page;
      Bridge.refreshSyncBar();

      // Listen for cross-tab updates
      window.addEventListener('storage', e => {
        if (e.key === MARKET_KEY || e.key === SIGNAL_KEY) Bridge.refreshSyncBar();
      });
    },

    refreshSyncBar() {
      const bar = Bridge._syncBar;
      if (!bar) return;
      const market = Bridge.loadMarket();
      const signal = Bridge.loadSignal();
      const capital = Bridge.loadCapital();
      const stale = Bridge.isStale(240);
      const dot = stale ? '🔴' : '🟢';
      const age = Bridge.ageString();

      let html = `${dot} <strong style="color:#e2e8f0">DataBridge</strong> &nbsp;|&nbsp; `;

      if (!market) {
        html += `<span style="color:#f97316">⚠ No data yet — enter data on Dashboard first</span>`;
      } else {
        html += `Last sync: <span style="color:${stale ? '#f97316' : '#22c55e'}">${age}</span>`;
        html += ` &nbsp;|&nbsp; Date: <span style="color:#e2e8f0">${market._date || '—'}</span>`;
        html += ` &nbsp;|&nbsp; ${market.underlying || 'Nifty 50'} @ <span style="color:#e2e8f0">${market.spotPrice || '—'}</span>`;
        html += ` &nbsp;|&nbsp; VIX: <span style="color:#e2e8f0">${market.vix || '—'}</span>`;
        html += ` &nbsp;|&nbsp; IVR: <span style="color:#e2e8f0">${market.ivRank || '—'}</span>`;
      }

      if (signal) {
        const tCount = (signal.triggers || []).length;
        html += ` &nbsp;|&nbsp; Triggers: <span style="color:${tCount >= 2 ? '#22c55e' : tCount === 1 ? '#eab308' : '#64748b'}">${tCount > 0 ? signal.triggers.join(', ') : 'None'}</span>`;
        html += ` &nbsp;|&nbsp; Confluence: <span style="color:#a855f7">${signal.confluenceScore || '—'}</span>`;
      }

      html += ` &nbsp;|&nbsp; Capital: <span style="color:#3b82f6">₹${Number(capital.amount).toLocaleString('en-IN')}</span>`;
      html += ` &nbsp;|&nbsp; Phase: <span style="color:${capital.phase === 1 ? '#a855f7' : capital.phase === 2 ? '#3b82f6' : '#22c55e'}">P${capital.phase}</span>`;

      if (Bridge._syncPage !== 'dashboard' && market) {
        html += ` &nbsp;<button onclick="ITBridge.autoFillPage()" style="
          background:#1e2d45; border:1px solid #243550; color:#e2e8f0;
          font-family:inherit; font-size:10px; padding:3px 10px; border-radius:4px;
          cursor:pointer; transition:all .15s;
        ">⬇ Auto-fill from Dashboard</button>`;
      }

      bar.innerHTML = html;
    },

    // ── AUTO-FILL: PAGE DETECTOR ─────────────────────────────────────────────
    autoFillPage() {
      const page = Bridge._syncPage;
      if (page === 'algo')    Bridge.fillAlgo();
      if (page === 'journal') Bridge.fillJournal();
    },

    // ── DASHBOARD: COLLECT & SAVE ────────────────────────────────────────────
    collectDashboard() {
      const get = id => {
        const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
        return el ? el.value : null;
      };
      const data = {
        date:         get('analysisDate') || new Date().toISOString().slice(0, 10),
        underlying:   get('underlying'),
        spotPrice:    parseFloat(get('spotPrice'))    || null,
        dayChange:    parseFloat(get('dayChange'))    || null,
        vix:          parseFloat(get('vix'))          || null,
        vixChange:    parseFloat(get('vixChange'))    || null,
        ivRank:       parseFloat(get('ivRank'))       || null,
        pcr:          parseFloat(get('pcr'))          || null,
        fiiNet:       parseFloat(get('fiiNet'))       || null,
        advDecline:   parseFloat(get('advDecline'))   || null,
        maxPain:      parseFloat(get('maxPain'))      || null,
        ema20:        parseFloat(get('ema20'))        || null,
        rsi:          parseFloat(get('rsi'))          || null,
        capital:      parseFloat(get('capital'))      || null,
      };
      Bridge.saveMarket(data);
      return data;
    },

    // ── ALGO: FILL FROM BRIDGE ───────────────────────────────────────────────
    fillAlgo() {
      const d = Bridge.loadMarket();
      if (!d) { Bridge._toast('⚠ No dashboard data found. Enter data on Dashboard first.', 'warn'); return; }

      const fieldMap = {
        underlying:  ['underlying', 'inputUnderlying'],
        spotPrice:   ['spotPrice',  'inputSpot',   'spot'],
        dayChange:   ['dayChange',  'inputDayChange'],
        vix:         ['vix',        'inputVIX',    'indiaVix'],
        vixChange:   ['vixChange',  'inputVixChange'],
        ivRank:      ['ivRank',     'inputIVR',    'ivr'],
        pcr:         ['pcr',        'inputPCR',    'pcr'],
        fiiNet:      ['fiiNet',     'inputFII',    'fii'],
        advDecline:  ['advDecline', 'inputAD',     'ad'],
        maxPain:     ['maxPain',    'inputMaxPain'],
        ema20:       ['ema20',      'inputEMA20',  'ema20'],
        rsi:         ['rsi',        'inputRSI',    'rsi'],
        capital:     ['capital',    'inputCapital'],
      };

      let filled = 0;
      Object.entries(fieldMap).forEach(([key, ids]) => {
        if (d[key] == null) return;
        ids.forEach(id => {
          const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`);
          if (el && !el.value) { el.value = d[key]; filled++; }
        });
      });

      Bridge._toast(`✅ Auto-filled ${filled} fields from Dashboard (${d._date})`, 'success');
      Bridge.refreshSyncBar();
    },

    // ── JOURNAL: FILL FROM BRIDGE ────────────────────────────────────────────
    fillJournal() {
      const market = Bridge.loadMarket();
      const signal = Bridge.loadSignal();

      if (!market && !signal) {
        Bridge._toast('⚠ No dashboard data. Run analysis on Dashboard first.', 'warn');
        return;
      }

      let filled = 0;

      // Market fields → journal form
      if (market) {
        const jMap = {
          vix:        ['fVix',      'journalVix'],
          ivRank:     ['fIVR',      'journalIVR'],
          underlying: ['fUnderlying'],
        };
        Object.entries(jMap).forEach(([key, ids]) => {
          if (market[key] == null) return;
          ids.forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.value) { el.value = market[key]; filled++; }
          });
        });
      }

      // Signal fields → pre-check triggers, fill SL/Target/phase
      if (signal) {
        // Auto-check trigger checkboxes
        const trigMap = {
          'T1': 'cT1', 'T1 VaR': 'cT1', 'T1 VaR Breach': 'cT1',
          'T2': 'cT2', 'T2 FII': 'cT2', 'T2 FII Drawdown': 'cT2',
          'T3': 'cT3', 'T3 Max': 'cT3', 'T3 Max Pain': 'cT3',
          'T4': 'cT4', 'T4 Margin': 'cT4', 'T4 Margin Cascade': 'cT4',
          'T5': 'cT5', 'T5 IV':  'cT5', 'T5 IV Crush': 'cT5',
          'T6': 'cT6', 'T6 Macro': 'cT6', 'T6 Macro FII': 'cT6',
        };
        (signal.triggers || []).forEach(t => {
          const cbId = trigMap[t] || trigMap[t.split(' ').slice(0, 2).join(' ')];
          if (cbId) {
            const cb = document.getElementById(cbId);
            if (cb) { cb.checked = true; filled++; }
          }
        });

        // Fill SL and Target from signal
        if (signal.stopLoss) {
          const slEl = document.getElementById('fSL');
          if (slEl && !slEl.value) { slEl.value = signal.stopLoss; filled++; }
        }
        if (signal.target) {
          const tEl = document.getElementById('fTarget');
          if (tEl && !tEl.value) { tEl.value = signal.target; filled++; }
        }
        if (signal.recSize) {
          const sEl = document.getElementById('fCapDeployed');
          if (sEl && !sEl.value) { sEl.value = signal.recSize; filled++; }
        }

        // Set phase from capital
        const cap = Bridge.loadCapital();
        const phEl = document.getElementById('fPhase');
        if (phEl) { phEl.value = cap.phase; filled++; }
      }

      Bridge._toast(`✅ Auto-filled ${filled} fields from last Dashboard analysis`, 'success');
      Bridge.refreshSyncBar();
    },

    // ── SAVE SIGNAL FROM ALGO / DASHBOARD ───────────────────────────────────
    saveFromAlgo({ triggers, confluenceScore, recSize, stopLoss, target, recType, rationale }) {
      Bridge.saveSignal({ triggers, confluenceScore, recSize, stopLoss, target, recType, rationale });
    },

    // ── TOAST ────────────────────────────────────────────────────────────────
    _toast(msg, type = 'info') {
      const t = document.createElement('div');
      const bg = type === 'success' ? '#22c55e20' : type === 'warn' ? '#f9731620' : '#3b82f620';
      const border = type === 'success' ? '#22c55e40' : type === 'warn' ? '#f9731640' : '#3b82f640';
      const color  = type === 'success' ? '#22c55e'   : type === 'warn' ? '#f97316'   : '#3b82f6';
      t.style.cssText = `
        position:fixed; bottom:24px; right:24px; z-index:9999;
        background:${bg}; border:1px solid ${border}; color:${color};
        font-family:'IBM Plex Mono',monospace; font-size:12px;
        padding:10px 16px; border-radius:6px;
        box-shadow:0 4px 24px #00000060;
        animation: slideIn .25s ease;
      `;
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    },

    // ── INTERNAL DISPATCH ────────────────────────────────────────────────────
    _dispatchSync(type, data) {
      try {
        window.dispatchEvent(new CustomEvent('it-sync', { detail: { type, data } }));
      } catch (e) {}
    },
  };

  // ── AUTO-INIT: detect which page we're on ─────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    const page = path.includes('journal') ? 'journal'
               : path.includes('algo')    ? 'algo'
               : path.includes('dashboard') || path.includes('ai-engine') ? 'dashboard'
               : null;

    if (!page) return;
    Bridge._syncPage = page;

    // Inject sync bar into the page's main container
    const possibleContainers = ['sync-bar-host', 'main-container', 'app', 'container', 'page'];
    for (const id of possibleContainers) {
      const el = document.getElementById(id);
      if (el) { Bridge.injectSyncBar(id, page); break; }
    }

    // On algo / journal pages: auto-fill silently if data < 4 hours old
    if ((page === 'algo' || page === 'journal') && !Bridge.isStale(240)) {
      setTimeout(() => Bridge.autoFillPage(), 600);
    }

    // Expose global shortcut functions
    window.IT_autofill     = () => Bridge.autoFillPage();
    window.IT_saveMarket   = d  => Bridge.saveMarket(d);
    window.IT_saveSignal   = d  => Bridge.saveSignal(d);
    window.IT_saveCapital  = (a, p) => Bridge.saveCapital(a, p);
    window.IT_loadMarket   = ()  => Bridge.loadMarket();
    window.IT_loadSignal   = ()  => Bridge.loadSignal();
    window.IT_loadCapital  = ()  => Bridge.loadCapital();
  });

})();

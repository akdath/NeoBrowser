'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   NEO BROWSER — RENDERER v4
   + Custom 3-color theme picker (Opera-style) in Settings
   + Production-ready polish improvements
═══════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
let tabs         = [];
let activeTabId  = null;
let tabCounter   = 0;
let aiOpen       = false;
let openPanel    = null;
let dragSrcIdx   = null;

// ── Neo AI chat state ─────────────────────────────────────────────────────────
let aiHistory    = [];
let aiPageText   = '';
let aiThinking   = false;

// ── Autocorrect state ─────────────────────────────────────────────────────────
let _autocorrectPending = false;

// ── Find in page state ────────────────────────────────────────────────────────
let findOpen     = false;

// ── Zoom state ────────────────────────────────────────────────────────────────
let currentZoom  = 100;

let settings = {
  theme:'dark', sidebar:true, aiEnabled:true, phishingEnabled:true, pinTools:false,
  customColors: { accent: '#7c6af7', bg: '#0e0e14', text: '#f0f0ff' },
};
let bookmarks=[], history=[], sidebarSites=[];

const SEARCH = 'https://www.google.com/search?q=';
const $ = id => document.getElementById(id);
const E = (tag, cls='') => { const e=document.createElement(tag); if(cls)e.className=cls; return e; };

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOM COLOR UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

/** Parse hex "#rrggbb" to {r,g,b} */
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r:0, g:0, b:0 };
  return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
}

/** Blend color toward black (amount 0..1) */
function darken(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - amount;
  return rgbToHex(Math.round(r*f), Math.round(g*f), Math.round(b*f));
}

/** Blend color toward white (amount 0..1) */
function lighten(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - amount;
  return rgbToHex(
    Math.round(r + (255-r)*(1-f)),
    Math.round(g + (255-g)*(1-f)),
    Math.round(b + (255-b)*(1-f))
  );
}

function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

/** Relative luminance (for contrast decision) */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*toLinear(r) + 0.7152*toLinear(g) + 0.0722*toLinear(b);
}

/** True if bg is dark (needs light text) */
function isDark(hex) { return luminance(hex) < 0.5; }

/** Generate a full custom palette from 3 seed colors */
function buildCustomPalette(accentHex, bgHex, textHex) {
  const dark = isDark(bgHex);

  // Background scale
  const bg  = bgHex;
  const bg2 = dark ? lighten(bgHex, 0.04)  : darken(bgHex, 0.03);
  const bg3 = dark ? lighten(bgHex, 0.10)  : darken(bgHex, 0.06);
  const bg4 = dark ? lighten(bgHex, 0.17)  : darken(bgHex, 0.10);
  const bd  = dark ? lighten(bgHex, 0.22)  : darken(bgHex, 0.15);

  // Text scale
  const tx  = textHex;
  const tx2 = dark ? darken(textHex, 0.25) : lighten(textHex, 0.35);
  const tx3 = dark ? darken(textHex, 0.50) : lighten(textHex, 0.55);

  // Accent scale
  const ac  = accentHex;
  const ac2 = isDark(accentHex) ? lighten(accentHex, 0.20) : darken(accentHex, 0.15);
  const { r:ar, g:ag, b:ab } = hexToRgb(accentHex);

  return {
    '--custom-bg':  bg,  '--custom-bg2': bg2, '--custom-bg3': bg3,
    '--custom-bg4': bg4, '--custom-bd':  bd,
    '--custom-tx':  tx,  '--custom-tx2': tx2, '--custom-tx3': tx3,
    '--custom-ac':  ac,  '--custom-ac2': ac2,
    '--custom-ac-bg':  `rgba(${ar},${ag},${ab},.12)`,
    '--custom-ac-bd':  `rgba(${ar},${ag},${ab},.30)`,
  };
}

/** Apply the custom palette to :root */
function applyCustomPalette(accent, bg, text) {
  const palette = buildCustomPalette(accent, bg, text);
  const root = document.documentElement;
  Object.entries(palette).forEach(([k, v]) => root.style.setProperty(k, v));
}

/** Clear custom palette vars */
function clearCustomPalette() {
  const keys = [
    '--custom-bg','--custom-bg2','--custom-bg3','--custom-bg4','--custom-bd',
    '--custom-tx','--custom-tx2','--custom-tx3',
    '--custom-ac','--custom-ac2','--custom-ac-bg','--custom-ac-bd',
  ];
  keys.forEach(k => document.documentElement.style.removeProperty(k));
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOM COLOR PICKER UI
// ══════════════════════════════════════════════════════════════════════════════

function wireCustomColorPicker() {
  const accentInput = $('custom-accent');
  const bgInput     = $('custom-bg');
  const textInput   = $('custom-text');

  function syncPreviews() {
    const accent = accentInput.value;
    const bg     = bgInput.value;
    const text   = textInput.value;

    // Update swatch previews next to each input
    $('cpi-preview-accent').style.background = accent;
    $('cpi-preview-bg').style.background     = bg;
    $('cpi-preview-text').style.background   = text;

    // Update hex labels
    $('cpi-hex-accent').textContent = accent;
    $('cpi-hex-bg').textContent     = bg;
    $('cpi-hex-text').textContent   = text;

    // Update live preview bar
    const palette = buildCustomPalette(accent, bg, text);
    const bar = $('custom-preview-bar');
    if (!bar) return;

    const swatchBg = $('cpb-swatch-bg');
    swatchBg.style.background = palette['--custom-bg'];
    swatchBg.style.color = palette['--custom-tx3'] || '#888';

    const swatchSurface = $('cpb-swatch-surface');
    swatchSurface.style.background = palette['--custom-bg2'];
    swatchSurface.style.color = palette['--custom-tx3'] || '#888';

    const swatchAccent = $('cpb-swatch-accent');
    swatchAccent.style.background = palette['--custom-ac'];
    swatchAccent.style.color = isDark(accent) ? '#fff' : '#000';

    const swatchText = $('cpb-swatch-text');
    swatchText.style.background = palette['--custom-bg3'];
    swatchText.style.color = palette['--custom-tx'];

    // If currently on custom theme, apply live
    if (settings.theme === 'custom') {
      applyCustomPalette(accent, bg, text);
    }
  }

  accentInput.addEventListener('input', syncPreviews);
  bgInput.addEventListener('input',     syncPreviews);
  textInput.addEventListener('input',   syncPreviews);

  $('apply-custom-colors').onclick = () => {
    const accent = accentInput.value;
    const bg     = bgInput.value;
    const text   = textInput.value;

    settings.customColors = { accent, bg, text };
    settings.theme = 'custom';

    // Deselect all preset theme buttons, select custom
    document.querySelectorAll('.theme-opt').forEach(b =>
      b.classList.toggle('active', b.dataset.value === 'custom'));

    applyCustomPalette(accent, bg, text);
    document.documentElement.setAttribute('data-theme', 'custom');

    window.electronAPI.saveSettings(settings).catch(()=>{});
    setStatus('Custom theme applied.');
  };

  $('reset-custom-colors').onclick = () => {
    const defaults = { accent: '#7c6af7', bg: '#0e0e14', text: '#f0f0ff' };
    accentInput.value = defaults.accent;
    bgInput.value     = defaults.bg;
    textInput.value   = defaults.text;
    settings.customColors = { ...defaults };
    syncPreviews();
  };

  // Initial sync
  syncPreviews();
}

function showCustomColorSection(show) {
  const section = $('custom-color-section');
  if (!section) return;
  section.classList.toggle('visible', show);
}

function loadCustomColorInputs() {
  const cc = settings.customColors || { accent: '#7c6af7', bg: '#0e0e14', text: '#f0f0ff' };
  const accentInput = $('custom-accent');
  const bgInput     = $('custom-bg');
  const textInput   = $('custom-text');
  if (accentInput) accentInput.value = cc.accent || '#7c6af7';
  if (bgInput)     bgInput.value     = cc.bg     || '#0e0e14';
  if (textInput)   textInput.value   = cc.text   || '#f0f0ff';
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  $('newtab-page').classList.remove('newtab-visible');

  try {
    const [s,bm,hist,sb] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.getBookmarks(),
      window.electronAPI.getHistory(),
      window.electronAPI.getSidebarSites(),
    ]);
    settings     = { ...settings, ...s };
    bookmarks    = bm   || [];
    history      = hist || [];
    sidebarSites = sb   || [];
  } catch(_){}

  // Restore custom palette if theme was 'custom'
  if (settings.theme === 'custom' && settings.customColors) {
    const { accent, bg, text } = settings.customColors;
    applyCustomPalette(accent, bg, text);
  }

  applySettings(false);
  wireControls();
  wireNeuroAI();
  wireFind();
  wireCustomColorPicker();
  createTab();
}

// ── Settings ──────────────────────────────────────────────────────────────────
function applySettings(save=true) {
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.value === settings.theme));
  $('sidebar').classList.toggle('sidebar-hidden', !settings.sidebar);
  $('set-sidebar').checked   = !!settings.sidebar;
  $('set-ai').checked        = !!settings.aiEnabled;
  $('set-phishing').checked  = settings.phishingEnabled !== false;
  $('set-pin-tools').checked = !!settings.pinTools;
  $('btn-ai').style.opacity  = settings.aiEnabled ? '' : '0.4';
  applyPinnedTools(!!settings.pinTools);
  renderSidebarSites();
  showCustomColorSection(settings.theme === 'custom');
  loadCustomColorInputs();

  // If custom, re-apply palette
  if (settings.theme === 'custom' && settings.customColors) {
    const { accent, bg, text } = settings.customColors;
    applyCustomPalette(accent, bg, text);
  } else {
    clearCustomPalette();
  }

  if (save) window.electronAPI.saveSettings(settings).catch(()=>{});
}

function setSetting(k,v){
  settings[k]=v;
  if (k === 'theme' && v !== 'custom') clearCustomPalette();
  applySettings();
}

// ── Pin tools to toolbar ──────────────────────────────────────────────────────
function applyPinnedTools(pin) {
  document.querySelectorAll('.pinned-tool-btn').forEach(el => el.remove());
  if (!pin) return;

  const navRight = $('nav-right');
  const moreWrap = $('more-menu-wrap');

  const zoomDiv = document.createElement('div');
  zoomDiv.className = 'pinned-tool-btn';
  zoomDiv.style.cssText = 'display:flex;align-items:center;gap:1px;background:var(--bg3);border:1px solid var(--bd);border-radius:7px;padding:1px 3px;flex-shrink:0;';
  zoomDiv.innerHTML = `
    <button class="nav-btn zoom-btn" id="zoom-out-pin" title="Zoom Out">−</button>
    <span id="zoom-level-pin" style="font-size:11px;font-weight:600;color:var(--tx2);min-width:34px;text-align:center">${currentZoom}%</span>
    <button class="nav-btn zoom-btn" id="zoom-in-pin" title="Zoom In">+</button>`;
  navRight.insertBefore(zoomDiv, moreWrap);

  $('zoom-out-pin').onclick = () => adjustZoom(-10);
  $('zoom-in-pin').onclick  = () => adjustZoom(10);

  const findBtn = document.createElement('button');
  findBtn.className = 'nav-btn pinned-tool-btn';
  findBtn.title = 'Find in page (Ctrl+F)';
  findBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M9 9L12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  findBtn.onclick = toggleFind;
  navRight.insertBefore(findBtn, moreWrap);
}

// ── Wire controls ─────────────────────────────────────────────────────────────
function wireControls() {
  $('btn-minimize').onclick = () => window.electronAPI.windowMinimize();
  $('btn-maximize').onclick = () => window.electronAPI.windowMaximize();
  $('btn-close').onclick    = () => window.electronAPI.windowClose();
  window.electronAPI.onWindowMaximized(v => $('btn-maximize').title = v?'Restore':'Maximize');

  $('btn-back').onclick    = () => activeWV()?.goBack();
  $('btn-forward').onclick = () => activeWV()?.goForward();
  $('btn-reload').onclick  = () => {
    const t=getTab(activeTabId); const wv=activeWV();
    if(!wv) return; t?.loading ? wv.stop() : wv.reload();
  };

  $('url-bar').onkeydown = e => { if(e.key==='Enter') navigate($('url-bar').value); };
  $('url-bar').onfocus   = () => $('url-bar').select();
  $('new-tab-btn').onclick = () => createTab();
  $('btn-bookmark-page').onclick = bookmarkCurrentPage;

  $('newtab-search-input').onkeydown = e => { if(e.key==='Enter') navigate($('newtab-search-input').value); };
  $('add-shortcut-btn').onclick = () => openModal('add-shortcut-modal');

  $('btn-ai').onclick = toggleAI;

  $('btn-bookmarks').onclick      = () => togglePanel('bookmarks-panel');
  $('btn-history').onclick        = () => togglePanel('history-panel');
  $('btn-sidebar-toggle').onclick = () => { settings.sidebar=!settings.sidebar; applySettings(); };

  document.querySelectorAll('.panel-close-btn').forEach(btn =>
    btn.onclick = () => closePanel(btn.dataset.panel));

  $('overlay').onclick = () => { closeAllPanels(); closeAllModals(); };

  // Settings inputs
  document.querySelectorAll('.theme-opt').forEach(btn =>
    btn.onclick = () => {
      const val = btn.dataset.value;
      settings.theme = val;
      showCustomColorSection(val === 'custom');
      if (val === 'custom') {
        // Apply current custom colors immediately
        loadCustomColorInputs();
        const { accent, bg, text } = settings.customColors || { accent:'#7c6af7', bg:'#0e0e14', text:'#f0f0ff' };
        applyCustomPalette(accent, bg, text);
        document.documentElement.setAttribute('data-theme', 'custom');
        document.querySelectorAll('.theme-opt').forEach(b =>
          b.classList.toggle('active', b.dataset.value === 'custom'));
      } else {
        clearCustomPalette();
        setSetting('theme', val);
      }
    }
  );

  $('set-sidebar').onchange   = e => setSetting('sidebar',         e.target.checked);
  $('set-ai').onchange        = e => setSetting('aiEnabled',       e.target.checked);
  $('set-phishing').onchange  = e => setSetting('phishingEnabled', e.target.checked);
  $('set-pin-tools').onchange = e => setSetting('pinTools',        e.target.checked);

  $('open-history-from-settings').onclick = () => { closePanel('settings-panel'); togglePanel('history-panel'); };
  $('open-cookies-from-settings').onclick = () => { closePanel('settings-panel'); togglePanel('cookies-panel'); loadCookies(); };

  $('clear-bookmarks-btn').onclick = () => {
    if(confirm('Clear all bookmarks?')) { bookmarks=[]; saveBookmarks(); renderBookmarks(); }
  };

  $('clear-history-btn').onclick = () => { window.electronAPI.clearHistory(); history=[]; renderHistory(); };
  $('history-search').oninput    = () => renderHistory($('history-search').value);

  $('clear-cookies-btn').onclick  = () => window.electronAPI.clearCookies().then(()=>{ renderCookies([]); setStatus('Cookies cleared.'); });
  $('refresh-cookies-btn').onclick= loadCookies;
  $('cookies-filter').oninput     = () => loadCookies($('cookies-filter').value);

  $('sidebar-add-site').onclick = () => openModal('add-sidebar-modal');
  $('sb-save-btn').onclick = () => {
    const t=$('sb-title').value.trim(), u=$('sb-url').value.trim(), ic=$('sb-icon').value.trim()||t[0]||'?';
    if(!t||!u) return;
    sidebarSites.push({ id:Date.now(), title:t, url:resolveURL(u), icon:ic });
    window.electronAPI.saveSidebarSites(sidebarSites);
    renderSidebarSites();
    closeModal('add-sidebar-modal');
    ['sb-title','sb-url','sb-icon'].forEach(id=>$(id).value='');
  };

  $('sc-save-btn').onclick = () => {
    const t=$('sc-title').value.trim(), u=$('sc-url').value.trim(), ic=$('sc-icon').value.trim()||t[0]||'?';
    if(!t||!u) return;
    shortcuts.push({ id:Date.now(), title:t, url:resolveURL(u), icon:ic });
    renderShortcuts();
    closeModal('add-shortcut-modal');
    ['sc-title','sc-url','sc-icon'].forEach(id=>$(id).value='');
  };

  document.querySelectorAll('.modal-close,.modal-cancel').forEach(btn =>
    btn.onclick = () => closeModal(btn.dataset.modal));

  $('btn-more').onclick = (e) => {
    e.stopPropagation();
    $('more-menu').classList.toggle('hidden');
  };
  document.addEventListener('click', (e) => {
    if (!$('more-menu-wrap').contains(e.target)) {
      $('more-menu').classList.add('hidden');
    }
  });
  $('more-menu').addEventListener('click', (e) => {
    const item = e.target.closest('.more-menu-item');
    if (item && !item.classList.contains('more-zoom-row')) {
      $('more-menu').classList.add('hidden');
    }
  });

  $('zoom-in-btn').onclick    = () => adjustZoom(10);
  $('zoom-out-btn').onclick   = () => adjustZoom(-10);
  $('zoom-reset-btn').onclick = () => setZoom(100);

  $('btn-print').onclick = () => {
    activeWV()?.executeJavaScript('window.print()').catch(()=>{});
  };

  $('btn-save-page').onclick = () => {
    const tab = getTab(activeTabId);
    if (!tab?.url) return;
    activeWV()?.executeJavaScript(`
      (() => {
        const a = document.createElement('a');
        a.href = location.href;
        a.download = (document.title || 'page').replace(/[^a-z0-9]/gi,'_') + '.html';
        a.click();
      })()
    `).catch(()=>{});
    setStatus('Saving page…');
  };

  $('btn-downloads').onclick  = () => togglePanel('downloads-panel');
  $('btn-more-settings').onclick = () => togglePanel('settings-panel');
  $('btn-find').onclick = toggleFind;

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey||e.metaKey;
    if (!mod) return;
    if (e.key==='t') { e.preventDefault(); createTab(); }
    if (e.key==='w') { e.preventDefault(); if(tabs.length) closeTab(activeTabId); }
    if (e.key==='l') { e.preventDefault(); $('url-bar').focus(); }
    if (e.key==='r') { e.preventDefault(); activeWV()?.reload(); }
    if (e.key==='d') { e.preventDefault(); bookmarkCurrentPage(); }
    if (e.key===',') { e.preventDefault(); togglePanel('settings-panel'); }
    if (e.key==='f') { e.preventDefault(); toggleFind(); }
    if (e.key==='=') { e.preventDefault(); adjustZoom(10); }
    if (e.key==='-') { e.preventDefault(); adjustZoom(-10); }
    if (e.key==='0') { e.preventDefault(); setZoom(100); }
    if (e.key==='p') { e.preventDefault(); activeWV()?.executeJavaScript('window.print()').catch(()=>{}); }
    if (e.altKey&&e.key==='ArrowLeft')  { e.preventDefault(); activeWV()?.goBack(); }
    if (e.altKey&&e.key==='ArrowRight') { e.preventDefault(); activeWV()?.goForward(); }
  });

  wireAutocorrect();
}

// ══════════════════════════════════════════════════════════════════════════════
// FIND IN PAGE
// ══════════════════════════════════════════════════════════════════════════════
function wireFind() {
  $('find-close').onclick = closeFind;
  $('find-next').onclick  = () => findInPage(1);
  $('find-prev').onclick  = () => findInPage(-1);
  $('find-input').onkeydown = e => {
    if (e.key === 'Enter')  { e.shiftKey ? findInPage(-1) : findInPage(1); }
    if (e.key === 'Escape') closeFind();
  };
  $('find-input').oninput = () => findInPage(1);
}

function toggleFind() { findOpen ? closeFind() : openFind(); }
function openFind() {
  findOpen = true;
  $('find-bar').classList.remove('find-hidden');
  setTimeout(() => $('find-input').focus(), 60);
}
function closeFind() {
  findOpen = false;
  $('find-bar').classList.add('find-hidden');
  $('find-input').value = '';
  $('find-count').textContent = '';
  try { activeWV()?.stopFindInPage('clearSelection'); } catch(_){}
}
function findInPage(direction=1) {
  const query = $('find-input').value.trim();
  if (!query) return;
  const wv = activeWV();
  if (!wv) return;
  try {
    wv.findInPage(query, { forward: direction > 0, findNext: true });
    wv.addEventListener('found-in-page', e => {
      const { activeMatchOrdinal, matches } = e.result;
      $('find-count').textContent = matches ? `${activeMatchOrdinal}/${matches}` : 'No results';
    }, { once: true });
  } catch(_){}
}

// ══════════════════════════════════════════════════════════════════════════════
// ZOOM
// ══════════════════════════════════════════════════════════════════════════════
function adjustZoom(delta) { setZoom(currentZoom + delta); }
function setZoom(level) {
  currentZoom = Math.max(25, Math.min(500, level));
  const zl = $('zoom-level');
  if (zl) zl.textContent = currentZoom + '%';
  const zlp = $('zoom-level-pin');
  if (zlp) zlp.textContent = currentZoom + '%';
  try { activeWV()?.setZoomFactor(currentZoom / 100); } catch(_){}
}

// ══════════════════════════════════════════════════════════════════════════════
// DOWNLOADS PANEL
// ══════════════════════════════════════════════════════════════════════════════
let downloads = [];
function addDownload(url, filename) {
  downloads.unshift({ id: Date.now(), url, filename, date: Date.now() });
  if (downloads.length > 100) downloads.splice(100);
  renderDownloads();
}
function renderDownloads() {
  const list = $('downloads-list');
  if (!list) return;
  list.innerHTML = '';
  if (!downloads.length) {
    list.innerHTML = '<div class="empty-state">No downloads yet.</div>';
    return;
  }
  downloads.forEach(d => {
    const el   = E('div', 'list-item');
    const info = E('div', 'list-item-info');
    const t    = E('div', 'list-item-title'); t.textContent = d.filename || 'Download';
    const u    = E('div', 'list-item-url');   u.textContent = d.url;
    info.append(t, u);
    const open = E('button', 'action-btn'); open.textContent = 'Open';
    open.onclick = () => navigate(d.url);
    el.append(info, open);
    list.appendChild(el);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTOCORRECT-ON-SPACE
// ══════════════════════════════════════════════════════════════════════════════
async function autocorrectLastWord(inputEl) {
  if (_autocorrectPending) return;
  const text   = inputEl.value;
  const cursor = inputEl.selectionStart ?? text.length;
  const before     = text.slice(0, cursor);
  const lastSpaceI = before.lastIndexOf(' ', cursor - 2);
  const wordStart  = lastSpaceI + 1;
  const word       = before.slice(wordStart, cursor - 1);
  if (word.length < 3 || /[./\\@#\d]/.test(word)) return;

  _autocorrectPending = true;
  try {
    const res = await window.electronAPI.aiSpellCorrect(word);
    if (!res?.result) return;
    const corrected = res.result.trim();
    if (!corrected || corrected === word) return;
    const newText   = text.slice(0, wordStart) + corrected + text.slice(wordStart + word.length);
    const newCursor = wordStart + corrected.length + 1;
    inputEl.value = newText;
    inputEl.setSelectionRange(newCursor, newCursor);
    inputEl.style.transition = 'box-shadow 0.15s';
    inputEl.style.boxShadow  = '0 0 0 2px rgba(100,220,130,0.45)';
    setTimeout(() => { inputEl.style.boxShadow = ''; }, 600);
  } catch (_) {
  } finally {
    _autocorrectPending = false;
  }
}

function wireAutocorrect() {
  const targets = [$('url-bar'), $('newtab-search-input')];
  targets.forEach(el => {
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === ' ' && el.value.trim().length > 0) {
        setTimeout(() => autocorrectLastWord(el), 0);
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// NEO AI CHAT PANEL
// ══════════════════════════════════════════════════════════════════════════════
function wireNeuroAI() {
  $('ai-close').onclick = closeAI;
  $('ai-clear-chat').onclick = () => {
    aiHistory  = [];
    aiPageText = '';
    clearAIMessages();
    setAICtx('');
  };

  document.querySelectorAll('.ai-pill').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      if (!aiPageText) {
        grabPageText().then(text => {
          if (!text) { addAIMessage('ai', '⚠ Navigate to a webpage first, then try again.', true); return; }
          runQuickAction(action);
        });
        return;
      }
      runQuickAction(action);
    };
  });

  $('ai-ctx-clear').onclick = () => { aiPageText = ''; setAICtx(''); };

  $('ai-chat-input').addEventListener('input', () => {
    const el = $('ai-chat-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  });

  $('ai-chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage(); }
  });

  $('ai-send-btn').onclick = sendAIMessage;
}

function toggleAI() { aiOpen ? closeAI() : openAI(); }
function openAI() {
  if (!settings.aiEnabled) { setStatus('AI is disabled in Settings.'); return; }
  aiOpen = true;
  $('ai-panel').classList.remove('panel-hidden');
  $('btn-ai').classList.add('active');
  grabPageText().then(text => {
    if (text && text !== aiPageText) {
      aiPageText = text;
      const tab  = getTab(activeTabId);
      setAICtx(tab?.title || tab?.url || 'current page');
    }
  });
  setTimeout(() => $('ai-chat-input').focus(), 120);
}
function closeAI() {
  aiOpen = false;
  $('ai-panel').classList.add('panel-hidden');
  $('btn-ai').classList.remove('active');
}

const TEXT_EXTRACT_JS = `(function(){
  const body = document.body; if(!body) return '';
  const skip = new Set(['script','style','noscript','head','nav','footer','header','aside']);
  const wk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      if(skip.has(n.parentElement?.tagName?.toLowerCase()||'')) return NodeFilter.FILTER_REJECT;
      return n.textContent.trim().length > 25 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const p=[]; let n;
  while((n=wk.nextNode()) && p.length<200) p.push(n.textContent.trim());
  return p.join(' ').slice(0,7000);
})()`;

async function grabPageText() {
  try {
    const wv = activeWV();
    if (!wv) return '';
    const text = await wv.executeJavaScript(TEXT_EXTRACT_JS);
    return (text || '').trim();
  } catch { return ''; }
}

function runQuickAction(action) {
  const prompts = {
    summarize: 'Please summarize this page in 4-5 clear bullet points.',
    keypoints: 'What are the key points and main takeaways from this page?',
    explain:   'Explain the content of this page in simple, plain language.',
  };
  const msg = prompts[action] || 'Tell me about this page.';
  addAIMessage('user', msg);
  dispatchToAI(msg, 'qa');
}

function sendAIMessage() {
  if (aiThinking) return;
  const input = $('ai-chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  addAIMessage('user', text);
  aiHistory.push({ role: 'user', content: text });
  dispatchToAI(text, 'chat');
}

function renderAIMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.1);color:inherit;padding:1px 5px;border-radius:3px;font-size:11.5px;font-family:monospace">$1</code>')
    .replace(/^[•\-\*]\s+(.+)$/gm, '<li style="margin:2px 0">$1</li>')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>)/g, '<ul style="padding-left:16px;margin:4px 0">$1</ul>')
    .replace(/\n/g, '<br>');
}

async function dispatchToAI(message, action = 'chat') {
  setAIThinking(true);
  addAITyping();

  window.electronAPI.offAIToken();
  window.electronAPI.offAIDone();

  let bubbleEl  = null;
  let fullReply = '';

  window.electronAPI.onAIToken(token => {
    fullReply += token;
    if (!bubbleEl) {
      removeAITyping();
      hideAIWelcome();
      const msgs   = $('ai-messages');
      const row    = E('div', 'ai-msg-row ai');
      const avatar = E('div', 'ai-msg-avatar');
      avatar.textContent = '✦';
      bubbleEl = E('div', 'ai-msg-bubble');
      row.appendChild(avatar);
      row.appendChild(bubbleEl);
      msgs.appendChild(row);
    }
    bubbleEl.innerHTML = renderAIMarkdown(fullReply) + '<span class="ai-cursor">▋</span>';
    const msgs = $('ai-messages');
    msgs.scrollTop = msgs.scrollHeight;
  });

  window.electronAPI.onAIDone(errMsg => {
    window.electronAPI.offAIToken();
    window.electronAPI.offAIDone();
    removeAITyping();
    if (errMsg) {
      if (!bubbleEl) addAIMessage('ai', errMsg, true);
      else { bubbleEl.classList.add('error'); bubbleEl.innerHTML = renderAIMarkdown(errMsg); }
    } else {
      if (bubbleEl) {
        bubbleEl.innerHTML = renderAIMarkdown(fullReply);
        aiHistory.push({ role: 'assistant', content: fullReply });
        if (aiHistory.length > 20) aiHistory = aiHistory.slice(-20);
      } else if (!fullReply) {
        addAIMessage('ai', '⚠ No response received.', true);
      }
    }
    setAIThinking(false);
    $('ai-chat-input').focus();
  });

  try {
    await window.electronAPI.aiChat({
      action, message,
      pageText: aiPageText,
      history:  aiHistory.slice(-10),
    });
  } catch (err) {
    window.electronAPI.offAIToken();
    window.electronAPI.offAIDone();
    removeAITyping();
    addAIMessage('ai', `⚠ Error: ${err.message}`, true);
    setAIThinking(false);
    $('ai-chat-input').focus();
  }
}

function setAIThinking(v) {
  aiThinking = v;
  $('ai-send-btn').disabled       = v;
  $('ai-chat-input').disabled     = v;
  $('ai-status-dot').className    = v ? 'thinking' : '';
  $('ai-status-text').textContent = v ? 'Thinking…' : 'Neo AI · Local model';
}
function setAICtx(title) {
  const bar = $('ai-ctx-bar');
  if (title) {
    $('ai-ctx-label').textContent = `⬡ ${title.slice(0, 45)}${title.length > 45 ? '…' : ''}`;
    bar.classList.add('visible');
  } else { bar.classList.remove('visible'); }
}
function clearAIMessages() {
  const msgs = $('ai-messages');
  msgs.innerHTML = `
    <div id="ai-welcome">
      <div id="ai-welcome-orb">✦</div>
      <div id="ai-welcome-title">Chat cleared</div>
      <div id="ai-welcome-sub">Start a new conversation or use the buttons above to analyze this page.</div>
    </div>`;
}
function hideAIWelcome() { $('ai-welcome')?.remove(); }
function addAIMessage(role, text, isError = false) {
  hideAIWelcome();
  const msgs   = $('ai-messages');
  const row    = E('div', `ai-msg-row ${role}`);
  const avatar = E('div', 'ai-msg-avatar');
  const bubble = E('div', 'ai-msg-bubble' + (isError ? ' error' : ''));
  avatar.textContent = role === 'user' ? '👤' : '✦';
  bubble.innerHTML = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
    .replace(/^[•\-\*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul style="padding-left:14px;margin:3px 0">$1</ul>')
    .replace(/\n/g, '<br>');
  row.appendChild(avatar);
  row.appendChild(bubble);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}
function addAITyping() {
  hideAIWelcome();
  const msgs   = $('ai-messages');
  const row    = E('div', 'ai-msg-row ai');
  row.id       = 'ai-typing-row';
  const avatar = E('div', 'ai-msg-avatar');
  avatar.textContent = '✦';
  const bubble = E('div', 'ai-msg-bubble');
  bubble.innerHTML = `<div class="ai-typing">
    <div class="ai-typing-dot"></div><div class="ai-typing-dot"></div><div class="ai-typing-dot"></div>
  </div>`;
  row.appendChild(avatar);
  row.appendChild(bubble);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}
function removeAITyping() { $('ai-typing-row')?.remove(); }

// ══════════════════════════════════════════════════════════════════════════════
// TABS — with drag-reorder
// ══════════════════════════════════════════════════════════════════════════════
let shortcuts = [];

function createTab(url='') {
  const id = ++tabCounter;
  const tab = {
    id, url:'', title:'New Tab', favicon:null,
    loading:false, category:null,
    pageText:'', webview:null,
    canGoBack:false, canGoForward:false,
  };
  tabs.push(tab);

  const wv = document.createElement('webview');
  wv.setAttribute('partition',    `persist:tab${id}`);
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('webpreferences','contextIsolation=yes');
  tab.webview = wv;
  $('webview-container').appendChild(wv);
  wireWV(wv, id);

  renderTabs();
  activateTab(id);

  if (url) {
    setTimeout(() => navigate(url, id), 80);
  } else {
    showNewTab(true);
    $('url-bar').value = '';
    setTimeout(() => $('newtab-search-input').focus(), 80);
  }
  return id;
}

function closeTab(id, e) {
  if (e) e.stopPropagation();
  const idx = tabs.findIndex(t=>t.id===id);
  if (idx<0) return;
  tabs[idx].webview?.remove();
  tabs.splice(idx,1);
  if (!tabs.length) { createTab(); return; }
  if (activeTabId===id) activateTab(tabs[Math.min(idx,tabs.length-1)].id);
  renderTabs();
}

function activateTab(id) {
  if (activeTabId!==null) getTab(activeTabId)?.webview?.classList.remove('active');
  activeTabId = id;
  const tab = getTab(id);
  if (!tab) return;
  tab.webview?.classList.add('active');
  $('url-bar').value = tab.url||'';
  updateNavBtns(tab);
  updateSecIcon(tab.url);
  showNewTab(!tab.url);
  updateBookmarkIcon(tab.url);
  setZoom(100);
  aiPageText = tab.pageText || '';
  if (aiOpen && aiPageText) setAICtx(tab.title || tab.url || '');
  else if (aiOpen) setAICtx('');
  renderTabs();
  renderSidebarTabs();
}

const getTab   = id => tabs.find(t=>t.id===id);
const activeWV = () => getTab(activeTabId)?.webview ?? null;

function renderTabs() {
  const bar = $('tab-bar');
  bar.innerHTML = '';

  tabs.forEach((tab, tabIdx) => {
    const el = E('div', 'tab' + (tab.id===activeTabId?' active':'') + (tab.category?' has-cat':''));
    el.dataset.tabId  = tab.id;
    el.dataset.tabIdx = tabIdx;
    el.draggable = true;

    const fav = E('div','tab-fav');
    if (tab.favicon) {
      const img = E('img'); img.src=tab.favicon;
      img.onerror = () => { fav.innerHTML=''; fav.textContent=(tab.title||'N')[0].toUpperCase(); };
      fav.appendChild(img);
    } else if (tab.loading) {
      fav.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:1.5px"></div>`;
    } else {
      fav.textContent = (tab.title||'N')[0].toUpperCase();
    }

    const title = E('div','tab-title');
    title.textContent = tab.title || 'New Tab';

    const catBadge = E('span','tab-cat');
    if (tab.category) catBadge.textContent = tab.category;

    const close = E('button','tab-close');
    close.innerHTML = `<svg width="8" height="8" viewBox="0 0 8 8">
      <path d="M1 1L7 7M7 1L1 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
    close.onclick = ev => closeTab(tab.id, ev);

    el.append(fav, title);
    if (tab.category) el.appendChild(catBadge);
    el.appendChild(close);
    el.onclick = () => activateTab(tab.id);

    el.addEventListener('dragstart', ev => {
      dragSrcIdx = tabIdx;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', String(tabIdx));
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', ev => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('drag-over'));
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', ev => {
      ev.preventDefault();
      el.classList.remove('drag-over');
      const srcIdx = dragSrcIdx;
      const dstIdx = tabIdx;
      if (srcIdx===null || srcIdx===dstIdx) return;
      const [moved] = tabs.splice(srcIdx, 1);
      tabs.splice(dstIdx, 0, moved);
      dragSrcIdx = null;
      renderTabs();
    });

    bar.appendChild(el);
  });

  renderSidebarTabs();
}

const CAT_ICONS = {
  technology:'💻', finance:'💰', news:'📰', education:'🎓',
  entertainment:'🎬', health:'❤️', science:'🔬', sports:'⚽',
  travel:'✈️', shopping:'🛍️', social_media:'💬', legal:'⚖️',
  adult:'🔞', general:'🌐', uncategorized:'📄',
};

const collapsedCats = new Set();

function renderSidebarTabs() {
  const list = $('sidebar-tabs-list');
  list.innerHTML = '';

  const groups = {};
  tabs.forEach(tab => {
    const cat = tab.category || 'uncategorized';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(tab);
  });

  const cats = Object.keys(groups).sort((a, b) => {
    if (a === 'uncategorized') return 1;
    if (b === 'uncategorized') return -1;
    return a.localeCompare(b);
  });

  cats.forEach(cat => {
    const tabsInCat   = groups[cat];
    const isCollapsed = collapsedCats.has(cat);
    const icon  = CAT_ICONS[cat] || '📄';
    const label = cat.charAt(0).toUpperCase() + cat.slice(1).replace('_', ' ');

    const header = E('div', 'sb-cat-header');
    const left   = E('div', 'sb-cat-left');
    left.innerHTML = `<span class="sb-cat-icon">${icon}</span><span class="sb-cat-name">${label}</span>`;
    const right = E('div', 'sb-cat-right');
    right.innerHTML = `<span class="sb-cat-count">${tabsInCat.length}</span>
      <span class="sb-cat-chevron">${isCollapsed ? '›' : '‹'}</span>`;
    header.append(left, right);
    header.onclick = () => {
      if (collapsedCats.has(cat)) collapsedCats.delete(cat);
      else collapsedCats.add(cat);
      renderSidebarTabs();
    };
    list.appendChild(header);

    if (!isCollapsed) {
      tabsInCat.forEach(tab => {
        const el    = E('div', 'sb-tab-item' + (tab.id === activeTabId ? ' active' : ''));
        const fav   = E('span', 'sb-tab-fav');
        const title = E('span', 'sb-tab-title');
        if (tab.favicon) {
          const img = E('img'); img.src = tab.favicon;
          img.onerror = () => { fav.innerHTML = ''; fav.textContent = (tab.title||'N')[0].toUpperCase(); };
          fav.appendChild(img);
        } else {
          fav.textContent = (tab.title || 'N')[0].toUpperCase();
        }
        title.textContent = tab.title || 'New Tab';
        el.append(fav, title);
        el.onclick = () => activateTab(tab.id);
        list.appendChild(el);
      });
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════
async function navigate(input, tabId=activeTabId) {
  if (!input?.trim()) return;
  input = input.trim();
  let url = resolveURL(input);

  if (settings.phishingEnabled) {
    try {
      const res = await window.electronAPI.aiPhishingDetect(url);
      if (res?.result) {
        let phishData = null;
        try { phishData = JSON.parse(res.result); } catch(_) {}
        if (phishData && (phishData.risk === 'HIGH' || phishData.risk === 'MEDIUM')) {
          renderTabs();
          const proceed = await showPhishingPopup(url, phishData);
          if (!proceed) return;
        }
      }
    } catch(e) { console.warn('[phishing]', e.message); }
  }

  const tab = getTab(tabId);
  if (!tab?.webview) return;
  tab.url = url;
  if (tabId===activeTabId) { $('url-bar').value=url; showNewTab(false); updateSecIcon(url); }
  tab.webview.src = url;
  setStatus('Loading…');
}

// ══════════════════════════════════════════════════════════════════════════════
// PHISHING POPUP
// ══════════════════════════════════════════════════════════════════════════════
function showPhishingPopup(url, phishData) {
  return new Promise(resolve => {
    const overlay  = $('phishing-overlay');
    const urlEl    = $('phish-url-display');
    const reasonUl = $('phish-reasons-list');
    const scoreBar = $('phish-score-bar');
    const scoreNum = $('phish-score-num');
    const exitBtn  = $('phish-exit-btn');
    const contBtn  = $('phish-continue-btn');

    urlEl.textContent = url.length > 70 ? url.slice(0, 67) + '...' : url;
    urlEl.title = url;
    reasonUl.innerHTML = '';
    const reasons = phishData.reasons || [];
    const showReasons = reasons.length > 0 ? reasons.slice(0, 5) : ['Multiple suspicious URL patterns detected'];
    showReasons.forEach(r => {
      const li = document.createElement('li');
      li.textContent = r;
      reasonUl.appendChild(li);
    });
    const pct = Math.min(100, Math.round((phishData.score / 16) * 100));
    scoreBar.style.width = pct + '%';
    scoreNum.textContent = phishData.score + '/16';
    overlay.classList.remove('hidden');

    function cleanup() {
      overlay.classList.add('hidden');
      exitBtn.removeEventListener('click', onExit);
      contBtn.removeEventListener('click', onContinue);
    }
    function onExit()     { cleanup(); resolve(false); }
    function onContinue() { cleanup(); resolve(true);  }
    exitBtn.addEventListener('click', onExit);
    contBtn.addEventListener('click', onContinue);
  });
}

function resolveURL(s) {
  s = s.trim();
  if (isURL(s)) return /^https?:\/\//i.test(s) ? s : 'https://'+s;
  return SEARCH + encodeURIComponent(s);
}
function isURL(s) {
  if (/^https?:\/\//i.test(s)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(s)) return true;
  return /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/.test(s.split('?')[0]);
}

// ══════════════════════════════════════════════════════════════════════════════
// WEBVIEW events
// ══════════════════════════════════════════════════════════════════════════════
const TEXT_JS = `(function(){
  const body=document.body; if(!body)return'';
  const skip=new Set(['script','style','noscript','head','nav','footer','header','aside']);
  const wk=document.createTreeWalker(body,NodeFilter.SHOW_TEXT,{
    acceptNode(n){
      if(skip.has(n.parentElement?.tagName?.toLowerCase()||''))return NodeFilter.FILTER_REJECT;
      return n.textContent.trim().length>25?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    }
  });
  const p=[];let n;
  while((n=wk.nextNode())&&p.length<250) p.push(n.textContent.trim());
  return p.join(' ').slice(0,7000);
})()`;

function wireWV(wv, tabId) {
  wv.addEventListener('did-start-loading', () => {
    const t=getTab(tabId); if(!t)return;
    t.loading=true;
    if(tabId===activeTabId){setLoading(true);setStatus('Loading…');setReloadBtn(true);}
    renderTabs();
  });

  wv.addEventListener('did-stop-loading', () => {
    const t=getTab(tabId); if(!t)return;
    t.loading=false; t.canGoBack=wv.canGoBack?.()??false; t.canGoForward=wv.canGoForward?.()??false;
    if(tabId===activeTabId){setLoading(false);setStatus('');updateNavBtns(t);setReloadBtn(false);}
    renderTabs();
  });

  wv.addEventListener('did-navigate', e => {
    const t=getTab(tabId); if(!t)return;
    t.url=e.url; t.canGoBack=wv.canGoBack?.()??false; t.canGoForward=wv.canGoForward?.()??false;
    if(tabId===activeTabId){$('url-bar').value=e.url;updateNavBtns(t);updateSecIcon(e.url);updateBookmarkIcon(e.url);}
  });

  wv.addEventListener('did-navigate-in-page', e => {
    const t=getTab(tabId); if(!t)return; t.url=e.url;
    if(tabId===activeTabId){$('url-bar').value=e.url;updateSecIcon(e.url);updateBookmarkIcon(e.url);}
  });

  wv.addEventListener('page-title-updated', e => {
    const t=getTab(tabId); if(!t)return; t.title=e.title||'Untitled'; renderTabs();
  });

  wv.addEventListener('page-favicon-updated', e => {
    const t=getTab(tabId); if(!t)return;
    if(e.favicons?.length){ t.favicon=e.favicons[0]; renderTabs(); }
  });

  wv.addEventListener('did-finish-load', () => {
    const t=getTab(tabId); if(!t)return;
    if(t.url&&!t.url.startsWith('about:')) addHistory(t.url, t.title);
    if(settings.aiEnabled) autoClassify(wv, tabId);
  });

  wv.addEventListener('did-fail-load', e => {
    if(e.errorCode===-3)return;
    const t=getTab(tabId); if(!t)return;
    t.loading=false;
    if(tabId===activeTabId){setLoading(false);setStatus(`⚠ ${e.errorDescription||'Failed'}`);setReloadBtn(false);}
    renderTabs();
  });

  wv.addEventListener('new-window', e => createTab(e.url));
}

async function autoClassify(wv, tabId) {
  try {
    const text = await wv.executeJavaScript(TEXT_JS);
    if (!text||text.length<80) return;
    const t = getTab(tabId);
    if (t) {
      t.pageText = text;
      if (tabId === activeTabId) {
        aiPageText = text;
        if (aiOpen) setAICtx(t.title || t.url || '');
      }
    }
    const res = await window.electronAPI.aiClassify(text);
    if (res?.result) {
      const category = res.result.split('|')[0].trim() || 'general';
      const tab = getTab(tabId);
      if (tab) { tab.category = category; renderTabs(); }
    }
  } catch(_){}
}

// ══════════════════════════════════════════════════════════════════════════════
// BOOKMARKS
// ══════════════════════════════════════════════════════════════════════════════
function bookmarkCurrentPage() {
  const tab=getTab(activeTabId);
  if(!tab?.url||tab.url==='') return;
  const idx=bookmarks.findIndex(b=>b.url===tab.url);
  if(idx>=0){ bookmarks.splice(idx,1); setStatus('Bookmark removed.'); }
  else { bookmarks.unshift({id:Date.now(),url:tab.url,title:tab.title||tab.url,date:Date.now()}); setStatus('Bookmarked!'); }
  saveBookmarks(); updateBookmarkIcon(tab.url); renderBookmarks();
}
function saveBookmarks(){ window.electronAPI.saveBookmarks(bookmarks).catch(()=>{}); }
function updateBookmarkIcon(url){
  const el=$('bookmark-icon');
  const on = url&&bookmarks.some(b=>b.url===url);
  el.style.fill=on?'var(--ac)':'none'; el.style.stroke=on?'var(--ac)':'currentColor';
}
function renderBookmarks(){
  const list=$('bookmarks-list'); list.innerHTML='';
  if(!bookmarks.length){ list.innerHTML='<div class="empty-state">No bookmarks yet.<br>Ctrl+D to bookmark.</div>'; return; }
  bookmarks.forEach((bm,i)=>{
    const el=E('div','list-item');
    const info=E('div','list-item-info');
    const t=E('div','list-item-title'); t.textContent=bm.title;
    const u=E('div','list-item-url');   u.textContent=bm.url;
    info.append(t,u); info.onclick=()=>{ navigate(bm.url); closePanel('bookmarks-panel'); };
    const del=E('button','list-del'); del.textContent='✕';
    del.onclick=()=>{ bookmarks.splice(i,1); saveBookmarks(); renderBookmarks(); };
    el.append(info,del); list.appendChild(el);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════════════════════════════════
function addHistory(url,title){
  if(!url||url.startsWith('about:'))return;
  const idx=history.findIndex(h=>h.url===url); if(idx>=0)history.splice(idx,1);
  history.unshift({id:Date.now(),url,title:title||url,date:Date.now()});
  if(history.length>500)history.splice(500);
  window.electronAPI.saveHistory(history).catch(()=>{});
}
function renderHistory(filter=''){
  const list=$('history-list'); list.innerHTML='';
  const fl=filter.toLowerCase();
  const items=fl?history.filter(h=>h.url.toLowerCase().includes(fl)||h.title.toLowerCase().includes(fl)):history;
  if(!items.length){ list.innerHTML='<div class="empty-state">No history.</div>'; return; }
  let lastDate='';
  items.forEach((h)=>{
    const d=new Date(h.date);
    const ds=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    if(ds!==lastDate){ const sep=E('div','date-sep'); sep.textContent=ds; list.appendChild(sep); lastDate=ds; }
    const el=E('div','list-item');
    const info=E('div','list-item-info');
    const t=E('div','list-item-title'); t.textContent=h.title;
    const u=E('div','list-item-url');   u.textContent=h.url;
    const time=E('div','list-item-time'); time.textContent=d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    info.append(t,u); info.onclick=()=>{ navigate(h.url); closePanel('history-panel'); };
    const del=E('button','list-del'); del.textContent='✕';
    del.onclick=()=>{ const i=history.indexOf(h); if(i>=0)history.splice(i,1); window.electronAPI.saveHistory(history); renderHistory(filter); };
    el.append(info,time,del); list.appendChild(el);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// COOKIES
// ══════════════════════════════════════════════════════════════════════════════
let allCookies=[];
async function loadCookies(filter=''){
  try{ allCookies=await window.electronAPI.getCookies(); renderCookies(allCookies,filter||$('cookies-filter').value); }catch(_){}
}
function renderCookies(cookies,filter=''){
  const list=$('cookies-list'); list.innerHTML='';
  const fl=filter.toLowerCase();
  const items=fl?cookies.filter(c=>c.name.toLowerCase().includes(fl)||c.domain.toLowerCase().includes(fl)):cookies;
  if(!items.length){ list.innerHTML='<div class="empty-state">No cookies.</div>'; return; }
  items.forEach(c=>{
    const el=E('div','list-item');
    const info=E('div','list-item-info');
    const t=E('div','list-item-title'); t.textContent=c.name;
    const u=E('div','list-item-url');   u.textContent=`${c.domain} • ${(c.value||'').slice(0,40)}${(c.value||'').length>40?'…':''}`;
    info.append(t,u);
    const del=E('button','list-del'); del.textContent='✕';
    del.onclick=()=>window.electronAPI.deleteCookie(`https://${c.domain}`,c.name).then(()=>loadCookies());
    el.append(info,del); list.appendChild(el);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SHORTCUTS & SIDEBAR SITES
// ══════════════════════════════════════════════════════════════════════════════
function renderShortcuts(){
  const grid=$('shortcuts-grid'); if(!grid) return; grid.innerHTML='';
  shortcuts.forEach((sc,i)=>{
    const el=E('div','shortcut');
    const icon=E('div','sc-icon'); icon.textContent=sc.icon||sc.title[0]||'?';
    const label=E('span','sc-label'); label.textContent=sc.title;
    const del=E('button','sc-del'); del.textContent='✕';
    del.onclick=ev=>{ ev.stopPropagation(); shortcuts.splice(i,1); renderShortcuts(); };
    el.append(icon,label,del); el.onclick=()=>navigate(sc.url); grid.appendChild(el);
  });
}
function renderSidebarSites(){
  const list=$('sidebar-sites-list'); if(!list) return; list.innerHTML='';
  sidebarSites.forEach((site,i)=>{
    const el=E('div','sb-site-item');
    const icon=E('div','sb-site-icon'); icon.textContent=site.icon||site.title[0];
    const lbl=E('span','sb-site-label'); lbl.textContent=site.title;
    const del=E('button','sb-site-del'); del.innerHTML='✕';
    del.onclick=ev=>{ ev.stopPropagation(); sidebarSites.splice(i,1); window.electronAPI.saveSidebarSites(sidebarSites); renderSidebarSites(); };
    el.append(icon,lbl,del); el.onclick=()=>navigate(site.url); list.appendChild(el);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// PANELS & MODALS
// ══════════════════════════════════════════════════════════════════════════════
function togglePanel(id){ id===openPanel?closePanel(id):openPanelFn(id); }
function openPanelFn(id){
  if(openPanel)closePanel(openPanel); openPanel=id;
  $(id).classList.remove('panel-hidden'); $('overlay').classList.remove('hidden');
  if(id==='bookmarks-panel')renderBookmarks();
  if(id==='history-panel')  renderHistory();
  if(id==='cookies-panel')  loadCookies();
  if(id==='downloads-panel')renderDownloads();
  if(id==='settings-panel') {
    loadCustomColorInputs();
    showCustomColorSection(settings.theme === 'custom');
  }
}
function closePanel(id){ $(id)?.classList.add('panel-hidden'); $('overlay').classList.add('hidden'); if(openPanel===id)openPanel=null; }
function closeAllPanels(){
  ['bookmarks-panel','history-panel','cookies-panel','settings-panel','downloads-panel'].forEach(closePanel);
}
function openModal(id){  $(id).classList.remove('hidden'); $('overlay').classList.remove('hidden'); }
function closeModal(id){ $(id).classList.add('hidden');    $('overlay').classList.add('hidden');    }
function closeAllModals(){ document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')); }

// ══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════
function showNewTab(show){
  $('newtab-page').classList.toggle('newtab-visible', show);
  if (show) setTimeout(() => $('newtab-search-input').focus(), 80);
}
function setStatus(msg){ $('status-text').textContent=msg; if(msg)setTimeout(()=>{ if($('status-text').textContent===msg)$('status-text').textContent=''; },4000); }
function setLoading(on){ $('load-indicator').classList.toggle('hidden',!on); }
function updateNavBtns(t){ $('btn-back').disabled=!t.canGoBack; $('btn-forward').disabled=!t.canGoForward; }
function updateSecIcon(url){
  const ic=$('security-icon');
  ic.className=!url?'neutral':url.startsWith('https')?'secure':url.startsWith('http')?'insecure':'neutral';
}

function setReloadBtn(loading) {
  const btn = $('btn-reload');
  if (loading) {
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="overflow:visible;display:block">
      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`;
    btn.title = 'Stop';
  } else {
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="overflow:visible;display:block">
      <path d="M13 3A6 6 0 1 0 13.5 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M13 1V4H10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    btn.title = 'Reload';
  }
}

init();
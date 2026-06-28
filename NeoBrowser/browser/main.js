'use strict';

const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs   = require('fs');
const http = require('http');

let mainWindow  = null;
let aiServer    = null;
const ROOT_DIR  = path.join(__dirname, '..');
const AI_PORT   = 7788;

const SETTINGS_PATH  = path.join(app.getPath('userData'), 'neo-settings.json');
const BOOKMARKS_PATH = path.join(app.getPath('userData'), 'neo-bookmarks.json');
const HISTORY_PATH   = path.join(app.getPath('userData'), 'neo-history.json');
const SIDEBAR_PATH   = path.join(app.getPath('userData'), 'neo-sidebar.json');

const DEFAULT_SETTINGS = { theme:'dark', sidebar:true, aiEnabled:true, phishingEnabled:true };
const DEFAULT_SIDEBAR_SITES = [
  { id:1, title:'YouTube', url:'https://youtube.com', icon:'▶'  },
  { id:2, title:'GitHub',  url:'https://github.com',  icon:'Gh' },
  { id:3, title:'Reddit',  url:'https://reddit.com',  icon:'R'  },
];

function readJSON(fp, def) {
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp,'utf8')); } catch(_){}
  return def;
}
function writeJSON(fp, data) {
  try { fs.writeFileSync(fp, JSON.stringify(data,null,2),'utf8'); } catch(e){ console.error(e.message); }
}

function findPython() {
  const candidates = [
    path.join(ROOT_DIR,'venv','Scripts','python.exe'),
    path.join(ROOT_DIR,'venv','bin','python3'),
    path.join(ROOT_DIR,'venv','bin','python'),
  ];
  const venv = candidates.find(p => fs.existsSync(p));
  if (venv) return venv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function startAIServer() {
  const scriptPath = path.join(ROOT_DIR, 'ai_chat', 'ai_chat_server.py');
  if (!fs.existsSync(scriptPath)) {
    console.warn('[NeoAI] ai_chat_server.py not found at', scriptPath);
    return;
  }
  const pyCmd = findPython();
  const env   = { ...process.env, PYTHONIOENCODING:'utf-8', PYTHONUNBUFFERED:'1' };
  aiServer = spawn(pyCmd, [scriptPath], { cwd: path.dirname(scriptPath), env });
  aiServer.stderr.on('data', d => console.log('[NeoAI]', d.toString().trim()));
  aiServer.on('close', code => {
    console.log('[NeoAI] Server exited with code', code);
    aiServer = null;
  });
}

function stopAIServer() {
  if (aiServer) { try { aiServer.kill(); } catch(_){} aiServer = null; }
}

// ─── Tor process ─────────────────────────────────────────────────────────────
let torProcess = null;
const TOR_PORT = 9050;

function startTor() {
  const torDir  = path.join(ROOT_DIR, 'tor');
  const torBin  = path.join(torDir, process.platform === 'win32' ? 'tor.exe' : 'tor');
  const torrc   = path.join(torDir, 'torrc');

  if (!fs.existsSync(torBin)) {
    console.warn('[Tor] Binary not found at', torBin, '— private tabs will not use Tor.');
    return;
  }

  const args = ['--SocksPort', String(TOR_PORT), '--DataDirectory', path.join(torDir, 'data')];
  if (fs.existsSync(torrc)) args.unshift('-f', torrc);

  torProcess = spawn(torBin, args, { cwd: torDir });
  torProcess.stdout.on('data', d => console.log('[Tor]', d.toString().trim()));
  torProcess.stderr.on('data', d => console.log('[Tor]', d.toString().trim()));
  torProcess.on('close', code => {
    console.log('[Tor] Process exited with code', code);
    torProcess = null;
  });
  console.log('[Tor] Started — SOCKS5 proxy on 127.0.0.1:' + TOR_PORT);
}

function stopTor() {
  if (torProcess) { try { torProcess.kill(); } catch(_){} torProcess = null; }
}
// ─────────────────────────────────────────────────────────────────────────────

// ─── Download session tracking ───────────────────────────────────────────────
const hookedSessions = new Set();

function hookSessionDownloads(sess, targetWindow) {
  if (hookedSessions.has(sess)) return;
  hookedSessions.add(sess);

  sess.on('will-download', (event, item) => {
    const filename = item.getFilename();
    const url      = item.getURL();

    const win = targetWindow || mainWindow;
    win?.webContents.send('download-started', {
      filename,
      url,
      date: Date.now(),
    });

    item.on('done', (e, state) => {
      if (state === 'completed') {
        win?.webContents.send('download-complete', {
          filename,
          url,
          savePath: item.getSavePath(),
          date: Date.now(),
        });
      } else {
        win?.webContents.send('download-failed', {
          filename,
          url,
          state,
          date: Date.now(),
        });
      }
    });
  });
}

// ─── Helper: get BrowserWindow from an IPC event sender ──────────────────────
function getWindowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width:1320, height:860, minWidth:900, minHeight:640,
    frame: false,
    backgroundColor: '#0d0d11',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      spellcheck: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window-maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized', false));
  mainWindow.on('closed',     () => { mainWindow = null; });
  session.defaultSession.setPermissionRequestHandler((_,__,cb) => cb(true));

  hookSessionDownloads(session.defaultSession, mainWindow);
}

// ─── Open Incognito Window ────────────────────────────────────────────────────
function createPrivateWindow(mode) {
  // mode: 'incognito' | 'tor'
  const win = new BrowserWindow({
    width:1280, height:840, minWidth:900, minHeight:640,
    frame: false,
    backgroundColor: mode === 'tor' ? '#0a0a10' : '#0d0d11',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      spellcheck: false,
      additionalArguments: [`--window-mode=${mode}`],
    },
  });

  // Pass the window mode as a query param so renderer knows what it is
  win.loadFile(path.join(__dirname, 'index.html'), {
    query: { windowMode: mode },
  });

  win.once('ready-to-show', () => win.show());
  win.on('maximize',   () => win.webContents.send('window-maximized', true));
  win.on('unmaximize', () => win.webContents.send('window-maximized', false));
  win.on('closed',     () => {});
  session.defaultSession.setPermissionRequestHandler((_,__,cb) => cb(true));
  return win;
}

app.whenReady().then(() => {
  startAIServer();
  startTor();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  stopAIServer();
  stopTor();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { stopAIServer(); stopTor(); });

// ─── Window controls — target the window that sent the event ─────────────────
ipcMain.on('window-minimize', (event) => getWindowFromEvent(event)?.minimize());
ipcMain.on('window-maximize', (event) => {
  const win = getWindowFromEvent(event);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window-close', (event) => getWindowFromEvent(event)?.close());

// ─── Open private windows ─────────────────────────────────────────────────────
ipcMain.handle('open-incognito-window', async () => {
  createPrivateWindow('incognito');
  return true;
});

ipcMain.handle('open-tor-window', async () => {
  createPrivateWindow('tor');
  return true;
});

ipcMain.handle('get-settings',       ()    => readJSON(SETTINGS_PATH,  DEFAULT_SETTINGS));
ipcMain.handle('save-settings',      (_,d) => { writeJSON(SETTINGS_PATH,d);  return true; });
ipcMain.handle('get-bookmarks',      ()    => readJSON(BOOKMARKS_PATH, []));
ipcMain.handle('save-bookmarks',     (_,d) => { writeJSON(BOOKMARKS_PATH,d); return true; });
ipcMain.handle('get-history',        ()    => readJSON(HISTORY_PATH,   []));
ipcMain.handle('save-history',       (_,d) => { writeJSON(HISTORY_PATH,d);   return true; });
ipcMain.handle('clear-history',      ()    => { writeJSON(HISTORY_PATH,[]);   return true; });
ipcMain.handle('get-sidebar-sites',  ()    => readJSON(SIDEBAR_PATH,   DEFAULT_SIDEBAR_SITES));
ipcMain.handle('save-sidebar-sites', (_,d) => { writeJSON(SIDEBAR_PATH,d);   return true; });

ipcMain.handle('get-cookies',   async ()            => session.defaultSession.cookies.get({}));
ipcMain.handle('delete-cookie', async (_,{url,name})=> session.defaultSession.cookies.remove(url,name));
ipcMain.handle('clear-cookies', async ()            => {
  await session.defaultSession.clearStorageData({ storages:['cookies'] });
  return true;
});

// ─── Hook a tab partition session for download tracking ──────────────────────
ipcMain.handle('hook-partition', async (event, partition) => {
  try {
    const sess = session.fromPartition(partition);

    if (partition.startsWith('tor:')) {
      // 1. Route all traffic through Tor SOCKS5 proxy
      await sess.setProxy({ proxyRules: 'socks5://127.0.0.1:9050', proxyBypassRules: '<-loopback>' });
      console.log('[Tor] Proxy set for partition:', partition);

      // 2. Spoof HTTP headers on every request — Electron UA is an instant bot flag
      const torUA = 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0';
      sess.webRequest.onBeforeSendHeaders((details, callback) => {
        const h = details.requestHeaders;
        h['User-Agent']      = torUA;
        h['Accept']          = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
        h['Accept-Language'] = 'en-US,en;q=0.5';
        h['Accept-Encoding'] = 'gzip, deflate, br';
        // Strip Chromium-only headers that contradict the Firefox UA
        delete h['X-Requested-With'];
        delete h['sec-ch-ua'];
        delete h['sec-ch-ua-mobile'];
        delete h['sec-ch-ua-platform'];
        delete h['sec-ch-ua-full-version-list'];
        delete h['sec-ch-ua-arch'];
        delete h['sec-ch-ua-bitness'];
        delete h['sec-ch-ua-model'];
        callback({ requestHeaders: h });
      });

      // 3. Block WebRTC — prevents real IP leaking through the proxy
      sess.setPermissionRequestHandler((webContents, permission, callback) => {
        const blocked = ['media', 'microphone', 'camera', 'geolocation'];
        callback(!blocked.includes(permission));
      });

      // 4. Inject anti-fingerprint script into EVERY page BEFORE page scripts run.
      //    This is the only reliable way — did-finish-load is too late.
      const torPreloadPath = path.join(__dirname, 'tor-preload.js');
      if (fs.existsSync(torPreloadPath)) {
        await sess.setPreloads([torPreloadPath]);
        console.log('[Tor] Anti-fingerprint preload registered');
      }
    }

    const win = getWindowFromEvent(event);
    hookSessionDownloads(sess, win || mainWindow);
    return true;
  } catch (e) {
    console.error('[hook-partition]', e.message);
    return false;
  }
});

function runPython(relScript, args=[], stdin=null, timeoutMs=30000) {
  return new Promise(resolve => {
    const scriptPath = path.join(ROOT_DIR, relScript);
    if (!fs.existsSync(scriptPath)) return resolve({ error:`Script not found: ${scriptPath}` });
    const pyCmd = findPython();
    const env   = { ...process.env, PYTHONIOENCODING:'utf-8', PYTHONUNBUFFERED:'1' };
    const proc  = spawn(pyCmd, [scriptPath, ...args], { cwd:path.dirname(scriptPath), env });
    let out='', err='';
    proc.stdout.on('data', d => out += d.toString('utf8'));
    proc.stderr.on('data', d => err += d.toString('utf8'));
    if (stdin !== null) { try { proc.stdin.write(stdin,'utf8'); } catch(_){} }
    try { proc.stdin.end(); } catch(_){}
    const timer = setTimeout(() => { proc.kill(); resolve({ error:`Timeout` }); }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      const text = out.trim();
      if (code===0||text) resolve({ result: text });
      else resolve({ error: err.trim()||`Exit ${code}` });
    });
    proc.on('error', e => { clearTimeout(timer); resolve({ error: e.message }); });
  });
}

ipcMain.handle('ai-classify',        (_,text) => runPython('content_classifier/classify_content.py', [], text?.slice(0,5000), 15000));
ipcMain.handle('ai-phishing-detect', async (_,url) => {
  if (!url?.trim()) return { result: JSON.stringify({score:0,risk:'SAFE',reasons:[]}) };
  return runPython('phishing_detector/detect_phishing.py', [url.trim()], null, 10000);
});
ipcMain.handle('ai-spell-correct', (_,word) =>
  runPython('spell_correct/spell_correct.py', [word.trim()], null, 5000)
);

ipcMain.handle('ai:health', () => {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${AI_PORT}/health`, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false, modelReady: false }));
    req.setTimeout(2000, () => { req.destroy(); resolve({ ok: false }); });
  });
});

ipcMain.handle('ai:chat', async (event, payload) => {
  const sender = event.sender;
  const body = JSON.stringify({
    action:   payload.action   || 'chat',
    message:  payload.message  || '',
    pageText: (payload.pageText || '').slice(0, 6000),
    history:  payload.history  || [],
  });

  return new Promise(resolve => {
    const options = {
      hostname: '127.0.0.1',
      port:     AI_PORT,
      path:     '/chat',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = http.request(options, res => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const msg = JSON.parse(raw);
            if (msg.token) sender.send('ai:token', msg.token);
            if (msg.done) { sender.send('ai:done'); resolve({ ok: true }); }
            if (msg.error) { sender.send('ai:done', msg.error); resolve({ ok: false, error: msg.error }); }
          } catch(_){}
        }
      });
      res.on('end', () => { sender.send('ai:done'); resolve({ ok: true }); });
    });

    req.on('error', err => {
      const msg = `⚠ AI server not running. Please restart Neo Browser. (${err.message})`;
      sender.send('ai:done', msg);
      resolve({ ok: false, error: msg });
    });
    req.setTimeout(120000, () => { req.destroy(); sender.send('ai:done', '⚠ Request timed out.'); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
});

ipcMain.handle('show-phishing-warning', async (event, payload) => {
  const win = getWindowFromEvent(event) || mainWindow;
  if (!win) return false;
  const url     = typeof payload === 'string' ? payload : (payload?.url ?? '');
  const score   = payload?.score ?? 0;
  const reasons = Array.isArray(payload?.reasons) ? payload.reasons : [];
  const reasonLines = reasons.slice(0,5).map(r=>`  ⚠  ${r}`).join('\n');
  const displayURL  = url.length > 80 ? url.slice(0,77)+'...' : url;
  const detail = [`Site: ${displayURL}`,`Risk Score: ${score}/20`,'',
    reasonLines ? `Why this was flagged:\n${reasonLines}` : '',
    '','This site shows strong signs of being a phishing page.',
    'It may steal your passwords or personal information.',
  ].filter(Boolean).join('\n').trim();
  const { response } = await dialog.showMessageBox(win, {
    type:'error', title:'Neo Browser — Phishing Site Detected',
    message:'🚨 This website is likely a phishing page!',
    detail, buttons:['🔒 Go Back (Stay Safe)','⚠ I understand the risk — proceed'],
    defaultId:0, cancelId:0, noLink:true,
  });
  return response === 1;
});
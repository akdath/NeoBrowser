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

// ─── Paths ────────────────────────────────────────────────────────────────────
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

// ─── Python finder ────────────────────────────────────────────────────────────
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

// ─── Start AI server ──────────────────────────────────────────────────────────
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

// ─── Window ───────────────────────────────────────────────────────────────────
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
}

app.whenReady().then(() => {
  startAIServer();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  stopAIServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopAIServer);

// ─── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close',    () => mainWindow?.close());

// ─── Persistence IPC ──────────────────────────────────────────────────────────
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

// ─── runPython helper ─────────────────────────────────────────────────────────
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

// ─── AI handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('ai-classify',        (_,text) => runPython('content_classifier/classify_content.py', [], text?.slice(0,5000), 15000));
ipcMain.handle('ai-phishing-detect', async (_,url) => {
  if (!url?.trim()) return { result: JSON.stringify({score:0,risk:'SAFE',reasons:[]}) };
  return runPython('phishing_detector/detect_phishing.py', [url.trim()], null, 10000);
});
ipcMain.handle('ai-spell-correct', (_,word) =>
  runPython('spell_correct/spell_correct.py', [word.trim()], null, 5000)
);

// ─── Neo AI: check server health ─────────────────────────────────────────────
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

// ─── Neo AI: streaming chat ───────────────────────────────────────────────────
ipcMain.handle('ai:chat', async (event, payload) => {
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
            if (msg.token) mainWindow?.webContents.send('ai:token', msg.token);
            if (msg.done) { mainWindow?.webContents.send('ai:done'); resolve({ ok: true }); }
            if (msg.error) { mainWindow?.webContents.send('ai:done', msg.error); resolve({ ok: false, error: msg.error }); }
          } catch(_){}
        }
      });
      res.on('end', () => { mainWindow?.webContents.send('ai:done'); resolve({ ok: true }); });
    });

    req.on('error', err => {
      const msg = `⚠ AI server not running. Please restart Neo Browser. (${err.message})`;
      mainWindow?.webContents.send('ai:done', msg);
      resolve({ ok: false, error: msg });
    });
    req.setTimeout(120000, () => { req.destroy(); mainWindow?.webContents.send('ai:done', '⚠ Request timed out.'); resolve({ ok: false }); });
    req.write(body);
    req.end();
  });
});

// ─── Phishing dialog ──────────────────────────────────────────────────────────
ipcMain.handle('show-phishing-warning', async (_, payload) => {
  if (!mainWindow) return false;
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
  const { response } = await dialog.showMessageBox(mainWindow, {
    type:'error', title:'Neo Browser — Phishing Site Detected',
    message:'🚨 This website is likely a phishing page!',
    detail, buttons:['🔒 Go Back (Stay Safe)','⚠ I understand the risk — proceed'],
    defaultId:0, cancelId:0, noLink:true,
  });
  return response === 1;
});
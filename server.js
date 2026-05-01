#!/usr/bin/env node
'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Serveur API REST v1.1                  ║
 * ║                                                              ║
 * ║   POST /api/predict       — Analyser un snippet JS          ║
 * ║   POST /api/compare       — Comparer deux snippets          ║
 * ║   GET  /api/status        — État du modèle                  ║
 * ║   GET  /api/formulas      — Liste des formules canoniques   ║
 * ║   GET  /api/health        — Health check                    ║
 * ║   POST /api/semantic      — Analyse sémantique complète     ║
 * ║   POST /api/semantic/repo — Analyse repo GitHub             ║
 * ║   GET  /                  — Interface web                   ║
 * ║                                                              ║
 * ║   v1.1 — Correctifs :                                       ║
 * ║     • CORS configurables via ALLOWED_ORIGINS (env)         ║
 * ║       (plus de wildcard * en production)                   ║
 * ║     • Rate limiting par IP : 60 req/min (configurable)     ║
 * ║     • Champ OOD exposé dans /api/predict + /api/compare    ║
 * ║     • configHash dans /api/status pour audit               ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const chalk = require('chalk');

const args   = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : def; };
const PORT   = parseInt(getArg('--port', process.env.PORT || '3000'), 10);
const HOST   = getArg('--host', process.env.HOST || '127.0.0.1');

// CORS — liste d'origines autorisées, séparées par des virgules.
// Exemple : ALLOWED_ORIGINS=http://localhost:5173,https://mon-app.com
// Si non défini → autorise uniquement localhost (développement local).
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT}`;
const ALLOWED_ORIGINS     = new Set(ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean));

// Rate limiting en mémoire : 60 requêtes/minute par IP.
// Configurable via RATE_LIMIT_MAX et RATE_LIMIT_WINDOW_MS.
const RATE_MAX    = parseInt(process.env.RATE_LIMIT_MAX    || '60',    10);
const RATE_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const _rateCounts = new Map(); // ip → { count, resetAt }

function checkRateLimit(ip) {
  const now  = Date.now();
  const slot = _rateCounts.get(ip);
  if (!slot || now > slot.resetAt) {
    _rateCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (slot.count >= RATE_MAX) return false;
  slot.count++;
  return true;
}

// Nettoyage périodique de la map (évite les fuites mémoire)
setInterval(() => {
  const now = Date.now();
  for (const [ip, slot] of _rateCounts) if (now > slot.resetAt) _rateCounts.delete(ip);
}, RATE_WINDOW * 2);

const { predict, loadModel, isModelReady } = require('./src/predictor');
const { compareFunctions }                 = require('./src/duplicate-detector');
const FORMULAS                             = require('./src/formulas.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico' : 'image/x-icon',
  '.png' : 'image/png',
};

// ─── Helpers HTTP ─────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 256_000) { req.destroy(); reject(new Error('Payload trop grand (max 256 KB)')); }
    });
    req.on('end',   () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Retourne les headers CORS adaptés à l'origine de la requête.
 * Seules les origines connues reçoivent un Access-Control-Allow-Origin explicite.
 * Les autres ne reçoivent pas de header CORS → le navigateur bloque.
 */
function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : null;
  return allowed ? {
    'Access-Control-Allow-Origin' : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary'                        : 'Origin',
  } : { 'Vary': 'Origin' };
}

function sendJson(res, status, data, origin) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type'  : 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(origin),
  });
  res.end(body);
}

function sendError(res, status, message, details = null, origin) {
  sendJson(res, status, { error: message, ...(details ? { details } : {}) }, origin);
}

function serveStatic(res, filePath) {
  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch (_) {
    sendError(res, 404, 'Fichier introuvable');
  }
}

// ─── Lazy-loading du modèle ───────────────────────────────────────
let _modelLoaded = false;
async function ensureModel() {
  if (_modelLoaded) return;
  await loadModel();
  _modelLoaded = true;
}

// ─── Handlers ────────────────────────────────────────────────────

// POST /api/predict — { "source": "..." }
async function handlePredict(req, res, origin) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (_) { return sendError(res, 400, 'JSON invalide', null, origin); }

  const { source, topK = 5 } = body || {};
  if (!source || typeof source !== 'string') return sendError(res, 400, 'Champ "source" manquant', null, origin);
  if (source.length > 32_000) return sendError(res, 400, 'Source trop longue (max 32 000 caractères)', null, origin);
  if (!isModelReady()) return sendError(res, 503, 'Modèle non disponible — lancez generate + train', null, origin);

  try {
    await ensureModel();
    const predictions = await predict(source, Math.min(topK, 10));
    sendJson(res, 200, {
      ok         : true,
      predictions,
      ood        : predictions[0]?.ood || null,
      analyzedAt : new Date().toISOString(),
    }, origin);
  } catch (err) {
    sendError(res, 500, 'Erreur interne', err.message, origin);
  }
}

// POST /api/compare — { "source1": "...", "source2": "..." }
async function handleCompare(req, res, origin) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (_) { return sendError(res, 400, 'JSON invalide', null, origin); }

  const { source1, source2 } = body || {};
  if (!source1 || !source2) return sendError(res, 400, 'Champs "source1" et "source2" requis', null, origin);
  if (!isModelReady()) return sendError(res, 503, 'Modèle non disponible', null, origin);

  try {
    await ensureModel();
    const result = await compareFunctions(source1, source2);
    sendJson(res, 200, { ok: true, ...result, analyzedAt: new Date().toISOString() }, origin);
  } catch (err) {
    sendError(res, 500, 'Erreur interne', err.message, origin);
  }
}

// GET /api/status
async function handleStatus(req, res, origin) {
  if (!isModelReady())
    return sendJson(res, 200, { ready: false, message: 'Modèle non entraîné. Lancez : npm run generate && npm run train' }, origin);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'models/logic-lens/meta.json'), 'utf8'));
    sendJson(res, 200, { ready: true, meta }, origin);
  } catch (err) {
    sendError(res, 500, err.message, null, origin);
  }
}

// GET /api/formulas

// POST /api/semantic — { "source": "..." }
async function handleSemantic(req, res, origin) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (_) { return sendError(res, 400, 'JSON invalide', null, origin); }

  const { source } = body || {};
  if (!source || typeof source !== 'string') return sendError(res, 400, 'Champ "source" manquant', null, origin);
  if (source.length > 64_000) return sendError(res, 400, 'Source trop longue (max 64 000 caractères)', null, origin);

  try {
    const { analyze } = require('./src/semantic/synthesizer');
    const result = analyze(source);
    sendJson(res, 200, { ok: true, ...result, analyzedAt: new Date().toISOString() }, origin);
  } catch (err) {
    sendError(res, 500, 'Erreur analyse sémantique', err.message, origin);
  }
}

// POST /api/semantic/repo — { "url": "...", "token": "...", "maxFiles": 30 }
async function handleSemanticRepo(req, res, origin) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (_) { return sendError(res, 400, 'JSON invalide', null, origin); }

  const { url, token = null, maxFiles = 30, concurrency = 4 } = body || {};
  if (!url) return sendError(res, 400, 'Champ "url" manquant', null, origin);

  try {
    const { analyzeRepo } = require('./src/semantic/repo-analyzer');
    const result = await analyzeRepo(url, { token, maxFiles, concurrency });
    sendJson(res, 200, { ok: true, ...result, analyzedAt: new Date().toISOString() }, origin);
  } catch (err) {
    sendError(res, 500, 'Erreur analyse repo', err.message, origin);
  }
}

function handleFormulas(req, res, origin) {
  sendJson(res, 200, FORMULAS, origin);
}

// GET /api/health
function handleHealth(req, res, origin) {
  sendJson(res, 200, { status: 'ok', modelReady: isModelReady(), uptime: process.uptime() }, origin);
}

// ─── Routeur ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || null;
  const url    = req.url.split('?')[0];
  const method = req.method.toUpperCase();
  const ip     = req.socket.remoteAddress || 'unknown';

  // Preflight CORS
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(origin),
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  // Rate limiting sur les routes API
  if (url.startsWith('/api/') && !checkRateLimit(ip)) {
    return sendError(res, 429, 'Trop de requêtes — réessayez dans une minute.', null, origin);
  }

  if (method === 'POST' && url === '/api/predict')  return handlePredict(req, res, origin);
  if (method === 'POST' && url === '/api/compare')  return handleCompare(req, res, origin);
  if (method === 'GET'  && url === '/api/status')   return handleStatus(req, res, origin);
  if (method === 'GET'  && url === '/api/formulas') return handleFormulas(req, res, origin);
  if (method === 'GET'  && url === '/api/health')      return handleHealth(req, res, origin);
  if (method === 'POST' && url === '/api/semantic')    return handleSemantic(req, res, origin);
  if (method === 'POST' && url === '/api/semantic/repo') return handleSemanticRepo(req, res, origin);

  if (method === 'GET') {
    const staticPath = url === '/' ? '/index.html' : url;
    const filePath   = path.join(__dirname, 'public', staticPath);
    if (fs.existsSync(filePath)) return serveStatic(res, filePath);
  }

  sendError(res, 404, 'Route introuvable', null, origin);
});

// ─── Démarrage ────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('   🔭  LOGIC-LENS — Serveur API REST v1.1        ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.green(`  ✓ Serveur démarré → http://${HOST}:${PORT}`));
  console.log('');
  console.log(chalk.gray(`  ├─ POST /api/predict   — analyser un snippet`));
  console.log(chalk.gray(`  ├─ POST /api/compare   — comparer deux snippets`));
  console.log(chalk.gray(`  ├─ GET  /api/status    — état du modèle`));
  console.log(chalk.gray(`  ├─ GET  /api/formulas  — formules canoniques`));
  console.log(chalk.gray(`  ├─ GET  /api/health    — health check`));
  console.log(chalk.gray(`  ├─ POST /api/semantic     — analyse sémantique`));
  console.log(chalk.gray(`  ├─ POST /api/semantic/repo — analyse repo`));
  console.log(chalk.gray(`  └─ GET  /              — interface web`));
  console.log('');
  console.log(chalk.gray(`  CORS : ${[...ALLOWED_ORIGINS].join(', ')}`));
  console.log(chalk.gray(`  Rate : ${RATE_MAX} req/${RATE_WINDOW / 1000}s par IP`));
  console.log('');
  if (!isModelReady()) {
    console.log(chalk.yellow('  ⚠  Modèle non entraîné — /api/predict retournera 503'));
    console.log(chalk.gray('  → Lancez : npm run generate && npm run train'));
    console.log('');
  }
});

server.on('error', (err) => {
  console.error(chalk.red(`  ❌ Erreur serveur : ${err.message}`));
  if (err.code === 'EADDRINUSE')
    console.error(chalk.gray(`  → Port ${PORT} occupé. Essayez : node server.js --port 3001`));
  process.exit(1);
});

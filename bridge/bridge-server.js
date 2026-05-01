'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Bridge Server v1.1                     ║
 * ║                                                              ║
 * ║   Serveur de passerelle permettant l'interopérabilité       ║
 * ║   avec d'autres moteurs d'analyse (ex: js-ranker).          ║
 * ║   Protocole : JSON over HTTP (voir bridge-protocol.md)      ║
 * ║                                                              ║
 * ║   Endpoints :                                               ║
 * ║     POST /bridge/analyze    — analyse + métadonnées moteur  ║
 * ║     POST /bridge/pipeline   — pipeline multi-moteurs        ║
 * ║     GET  /bridge/info       — capacités de ce moteur        ║
 * ║     GET  /bridge/health     — état du bridge                ║
 * ║                                                              ║
 * ║   v1.1 — Correctifs sécurité :                             ║
 * ║     • Authentification par secret partagé                   ║
 * ║       Header : X-Bridge-Secret <secret>                     ║
 * ║       Env    : BRIDGE_SECRET (requis en production)         ║
 * ║       Les endpoints /bridge/info et /bridge/health          ║
 * ║       restent publics ; analyze et pipeline sont protégés.  ║
 * ║     • CORS : Access-Control-Allow-Origin restreint          ║
 * ║       (ALLOWED_ORIGINS env, plus de wildcard *)             ║
 * ║     • Rate limiting : 120 req/min par IP                    ║
 * ║     • Champ OOD exposé dans les réponses analyze            ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const http  = require('http');
const https = require('https');
const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs');

const args   = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : def; };
const PORT   = parseInt(getArg('--port', process.env.BRIDGE_PORT || '4000'), 10);
const HOST   = getArg('--host', process.env.BRIDGE_HOST || '127.0.0.1');

// ─── Sécurité — secret partagé ────────────────────────────────────
// Définir BRIDGE_SECRET dans l'environnement pour activer l'auth.
// Si absent → avertissement au démarrage, endpoints protégés accessibles sans auth
//             (utile en dev local, dangereux en production).
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || null;
const AUTH_REQUIRED = !!BRIDGE_SECRET;

function isAuthorized(req) {
  if (!AUTH_REQUIRED) return true;
  const header = req.headers['x-bridge-secret'] || '';
  return header === BRIDGE_SECRET;
}

// ─── CORS configurable ───────────────────────────────────────────
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || `http://localhost:${PORT},http://127.0.0.1:${PORT}`;
const ALLOWED_ORIGINS     = new Set(ALLOWED_ORIGINS_RAW.split(',').map(s => s.trim()).filter(Boolean));

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : null;
  return allowed ? {
    'Access-Control-Allow-Origin' : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Engine-Id, X-Bridge-Secret',
    'Vary'                        : 'Origin',
  } : { 'Vary': 'Origin' };
}

// ─── Rate limiting ───────────────────────────────────────────────
const RATE_MAX    = parseInt(process.env.RATE_LIMIT_MAX || '120', 10);
const RATE_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const _rateCounts = new Map();

function checkRateLimit(ip) {
  const now  = Date.now();
  const slot = _rateCounts.get(ip);
  if (!slot || now > slot.resetAt) { _rateCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return true; }
  if (slot.count >= RATE_MAX) return false;
  slot.count++;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, slot] of _rateCounts) if (now > slot.resetAt) _rateCounts.delete(ip);
}, RATE_WINDOW * 2);

// ─── Modules Logic-Lens ──────────────────────────────────────────
const { predict, isModelReady, loadModel } = require('../src/predictor');
const { compareFunctions }                  = require('../src/duplicate-detector');
const FORMULAS                              = require('../src/formulas.json');
const pkg                                  = require('../package.json');

// ─── Identité du moteur ───────────────────────────────────────────
const ENGINE_INFO = {
  id          : 'logic-lens',
  version     : pkg.version,
  description : 'Extracts the logical formula or mathematical invariant from JavaScript functions',
  capabilities: ['formula_classification', 'duplicate_detection', 'top_k_predictions', 'batch_analysis', 'ood_detection', 'semantic_analysis', 'intent_inference', 'quality_scoring'],
  supportedCategories: [...new Set(FORMULAS.map(f => f.category))],
  formulaCount  : FORMULAS.length,
  bridgeProtocol: '1.1',
};

// ─── Helpers HTTP ─────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 512_000) { req.destroy(); reject(new Error('Payload trop grand')); } });
    req.on('end',   () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, data, origin) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type'    : 'application/json; charset=utf-8',
    'Content-Length'  : Buffer.byteLength(body),
    'X-Logic-Lens-Bridge': '1.1',
    ...corsHeaders(origin),
  });
  res.end(body);
}

function sendError(res, status, message, details = null, origin) {
  sendJson(res, status, { ok: false, error: message, engine: ENGINE_INFO.id, ...(details ? { details } : {}) }, origin);
}

// ─── Lazy load ────────────────────────────────────────────────────
let _loaded = false;
async function ensureModel() {
  if (_loaded) return;
  await loadModel();
  _loaded = true;
}

// ─── Appel distant vers un autre moteur ──────────────────────────
function callRemoteEngine(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(payload);
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port    : parsed.port,
      path    : parsed.pathname,
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Engine-Id'   : ENGINE_INFO.id,
      },
    };
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (_) { reject(new Error(`Réponse non-JSON du moteur : ${targetUrl}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout moteur : ${targetUrl}`)); });
    req.write(body);
    req.end();
  });
}

// ─── Handlers ────────────────────────────────────────────────────

// GET /bridge/info — public
function handleInfo(req, res, origin) {
  let modelMeta = { ready: false };
  if (isModelReady()) {
    try { modelMeta = { ready: true, ...JSON.parse(fs.readFileSync(path.join(__dirname, '../models/logic-lens/meta.json'), 'utf8')) }; }
    catch (_) {}
  }
  sendJson(res, 200, { ok: true, engine: ENGINE_INFO, model: modelMeta }, origin);
}

// GET /bridge/health — public
function handleHealth(req, res, origin) {
  sendJson(res, 200, {
    ok: true, status: 'healthy', engine: ENGINE_INFO.id,
    modelReady: isModelReady(), uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }, origin);
}

// POST /bridge/analyze — protégé
async function handleAnalyze(req, res, origin) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (_) { return sendError(res, 400, 'JSON invalide', null, origin); }

  const { source, topK = 3, requestId, originEngine } = body || {};
  if (!source || typeof source !== 'string') return sendError(res, 400, 'Champ "source" manquant', null, origin);
  if (!isModelReady()) return sendError(res, 503, 'Modèle non prêt', null, origin);

  try {
    await ensureModel();
    const predictions = await predict(source, Math.min(topK, 10));
    sendJson(res, 200, {
      ok         : true,
      engine     : ENGINE_INFO.id,
      requestId  : requestId || null,
      originEngine: originEngine || null,
      predictions,
      ood        : predictions[0]?.ood || null,
      analyzedAt : new Date().toISOString(),
    }, origin);
  } catch (err) {
    sendError(res, 500, "Erreur d'analyse", err.message, origin);
  }
}


// POST /bridge/semantic — protégé
async function handleBridgeSemantic(req, res, origin) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (_) { return sendError(res, 400, 'JSON invalide', null, origin); }

  const { source, requestId, originEngine } = body || {};
  if (!source || typeof source !== 'string') return sendError(res, 400, 'Champ "source" manquant', null, origin);

  try {
    const { analyze } = require('../src/semantic/synthesizer');
    const result = analyze(source);
    sendJson(res, 200, {
      ok: true, engine: ENGINE_INFO.id,
      requestId: requestId || null,
      originEngine: originEngine || null,
      ...result,
      analyzedAt: new Date().toISOString(),
    }, origin);
  } catch (err) {
    sendError(res, 500, "Erreur d'analyse sémantique", err.message, origin);
  }
}

// POST /bridge/pipeline — protégé
async function handlePipeline(req, res, origin) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch (_) { return sendError(res, 400, 'JSON invalide', null, origin); }

  const { source, engines = [], mergeStrategy = 'union', requestId } = body || {};
  if (!source) return sendError(res, 400, 'Champ "source" manquant', null, origin);
  if (!isModelReady()) return sendError(res, 503, 'Modèle non prêt', null, origin);

  const results = [];

  try {
    await ensureModel();
    const predictions = await predict(source, 5);
    results.push({ engine: ENGINE_INFO.id, predictions, ood: predictions[0]?.ood || null, error: null });
  } catch (err) {
    results.push({ engine: ENGINE_INFO.id, predictions: [], ood: null, error: err.message });
  }

  for (const eng of engines) {
    try {
      const remote = await callRemoteEngine(eng.url, { source, topK: 5, requestId, originEngine: ENGINE_INFO.id });
      results.push({ engine: eng.id, predictions: remote.predictions || [], ood: remote.ood || null, error: null });
    } catch (err) {
      results.push({ engine: eng.id, predictions: [], ood: null, error: err.message });
    }
  }

  sendJson(res, 200, {
    ok           : true,
    requestId    : requestId || null,
    mergeStrategy,
    engineResults: results,
    merged       : mergeResults(results, mergeStrategy),
    analyzedAt   : new Date().toISOString(),
  }, origin);
}

function mergeResults(results, strategy) {
  if (strategy === 'first') {
    const first = results.find(r => r.predictions && r.predictions.length > 0);
    return first ? first.predictions : [];
  }
  const scores = {};
  for (const r of results) {
    for (const p of (r.predictions || [])) {
      if (!scores[p.id]) scores[p.id] = { id: p.id, label: p.label, category: p.category, totalConf: 0, votes: 0 };
      scores[p.id].totalConf += p.confidence;
      scores[p.id].votes++;
    }
  }
  const merged = Object.values(scores)
    .map(s => ({ ...s, avgConfidence: parseFloat((s.totalConf / s.votes).toFixed(2)) }))
    .sort((a, b) => b.avgConfidence - a.avgConfidence);

  if (strategy === 'intersection') {
    const n = results.filter(r => r.predictions?.length > 0).length;
    return merged.filter(s => s.votes >= n);
  }
  return merged.slice(0, 5).map((s, i) => ({ rank: i + 1, id: s.id, label: s.label, category: s.category, avgConfidence: s.avgConfidence, votes: s.votes }));
}

// ─── Routeur ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || null;
  const url    = req.url.split('?')[0];
  const method = req.method.toUpperCase();
  const ip     = req.socket.remoteAddress || 'unknown';

  if (method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(origin), 'Access-Control-Max-Age': '86400' });
    return res.end();
  }

  // Endpoints publics
  if (method === 'GET' && url === '/bridge/info')   return handleInfo(req, res, origin);
  if (method === 'GET' && url === '/bridge/health') return handleHealth(req, res, origin);

  // Rate limiting sur les endpoints protégés
  if (!checkRateLimit(ip))
    return sendError(res, 429, 'Trop de requêtes — réessayez dans une minute.', null, origin);

  // Authentification sur les endpoints protégés
  if (!isAuthorized(req))
    return sendError(res, 401, 'Non autorisé — header X-Bridge-Secret requis.', null, origin);

  if (method === 'POST' && url === '/bridge/analyze')  return handleAnalyze(req, res, origin);
  if (method === 'POST' && url === '/bridge/pipeline') return handlePipeline(req, res, origin);
  if (method === 'POST' && url === '/bridge/semantic') return handleBridgeSemantic(req, res, origin);

  sendError(res, 404, `Route bridge introuvable : ${url}`, null, origin);
});

// ─── Démarrage ────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('   🔗  LOGIC-LENS — Bridge Server v1.1           ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.green(`  ✓ Bridge démarré → http://${HOST}:${PORT}`));
  console.log('');
  console.log(chalk.gray(`  ├─ GET  /bridge/info     — capacités (public)`));
  console.log(chalk.gray(`  ├─ GET  /bridge/health   — état (public)`));
  console.log(chalk.gray(`  ├─ POST /bridge/analyze  — analyse (protégé)`));
  console.log(chalk.gray(`  └─ POST /bridge/pipeline — pipeline (protégé)`));
  console.log('');

  if (!AUTH_REQUIRED) {
    console.log(chalk.yellow('  ⚠  BRIDGE_SECRET non défini — endpoints protégés accessibles sans auth.'));
    console.log(chalk.gray('  → En production : export BRIDGE_SECRET=<secret_fort>'));
    console.log('');
  } else {
    console.log(chalk.green('  ✓ Authentification active (X-Bridge-Secret)'));
    console.log('');
  }

  if (!isModelReady()) {
    console.log(chalk.yellow('  ⚠  Modèle non entraîné — /bridge/analyze retournera 503'));
    console.log('');
  }
});

server.on('error', (err) => {
  console.error(chalk.red(`  ❌ Erreur bridge : ${err.message}`));
  if (err.code === 'EADDRINUSE')
    console.error(chalk.gray(`  → Port ${PORT} occupé. Essayez : node bridge/bridge-server.js --port 4001`));
  process.exit(1);
});

'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Démonstration Intégrée v1.1            ║
 * ║                                                              ║
 * ║   Montre les deux moteurs sur les mêmes exemples :          ║
 * ║     • Moteur formules (classifieur Transformer)             ║
 * ║     • Moteur sémantique (pipeline structurel complet)       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const chalk = require('chalk');
const { analyze } = require('./semantic/synthesizer');

const DEMO_CASES = [
  {
    title : 'Fonction pure mathématique',
    source: `
function euclideanDistance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}`,
  },
  {
    title : 'Pipeline de transformation de données',
    source: `
function parseCSV(raw) {
  return raw.trim().split('\\n').map(line => line.split(','));
}

function normalize(rows) {
  const headers = rows[0];
  return rows.slice(1).map(row =>
    headers.reduce((obj, h, i) => ({ ...obj, [h]: row[i] }), {})
  );
}

function filterEmpty(records) {
  return records.filter(r => Object.values(r).every(v => v && v.trim()));
}

function processCSV(raw) {
  return filterEmpty(normalize(parseCSV(raw)));
}

module.exports = { processCSV };`,
  },
  {
    title : 'Singleton avec état partagé',
    source: `
let _instance = null;

function createStore(initialState) {
  const state    = { ...initialState };
  const listeners = [];

  function getState() { return { ...state }; }

  function dispatch(action) {
    if (action.type === 'SET') Object.assign(state, action.payload);
    listeners.forEach(fn => fn(getState()));
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  return { getState, dispatch, subscribe };
}

function getStore(initialState = {}) {
  if (!_instance) _instance = createStore(initialState);
  return _instance;
}

module.exports = { getStore };`,
  },
  {
    title : 'Middleware Express-like',
    source: `
function logger(req, res, next) {
  const start = Date.now();
  console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.url}\`);
  res.on('finish', () => {
    console.log(\`→ \${res.statusCode} (\${Date.now() - start}ms)\`);
  });
  next();
}

function authenticate(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) { res.writeHead(401); res.end('Unauthorized'); return; }
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    res.writeHead(403); res.end('Forbidden');
  }
}

function rateLimiter(windowMs, max) {
  const counts = new Map();
  return function(req, res, next) {
    const ip  = req.socket.remoteAddress;
    const now = Date.now();
    const slot = counts.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > slot.resetAt) { slot.count = 0; slot.resetAt = now + windowMs; }
    if (slot.count >= max) { res.writeHead(429); res.end('Too Many Requests'); return; }
    slot.count++;
    counts.set(ip, slot);
    next();
  };
}`,
  },
  {
    title : 'Récursion et algorithme',
    source: `
function quickSort(arr) {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)];
  const left  = arr.filter(x => x < pivot);
  const mid   = arr.filter(x => x === pivot);
  const right = arr.filter(x => x > pivot);
  return [...quickSort(left), ...mid, ...quickSort(right)];
}

function binarySearch(arr, target, lo = 0, hi = arr.length - 1) {
  if (lo > hi) return -1;
  const mid = Math.floor((lo + hi) / 2);
  if (arr[mid] === target) return mid;
  if (arr[mid] < target)  return binarySearch(arr, target, mid + 1, hi);
  return binarySearch(arr, target, lo, mid - 1);
}

module.exports = { quickSort, binarySearch };`,
  },
];

// ─── Affichage ────────────────────────────────────────────────────

function sep(char = '─', width = 62) { return char.repeat(width); }

function printHeader() {
  console.log('\n');
  console.log(chalk.cyan('  ╔' + sep('═') + '╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('         🔭  LOGIC-LENS — Démonstration v1.1        ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('    Moteur sémantique structurel — aucun pattern matching ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚' + sep('═') + '╝'));
  console.log('');
}

function printCase(demo, index, total) {
  console.log(chalk.cyan(`\n  ┌${ sep() }`));
  console.log(chalk.cyan('  │') + chalk.white.bold(` [${index}/${total}] ${demo.title}`));
  console.log(chalk.cyan(`  └${ sep() }`));

  // Source
  console.log(chalk.gray('\n  Code source :'));
  demo.source.trim().split('\n').forEach(line =>
    console.log(chalk.gray('  │ ') + chalk.dim(line))
  );

  // Analyse sémantique
  console.log(chalk.cyan('\n  ── Analyse sémantique ──────────────────────────────────'));
  let result;
  try {
    result = analyze(demo.source);
  } catch (err) {
    console.log(chalk.red(`  ✗ Erreur : ${err.message}`));
    return;
  }

  const syn = result['6_SYNTHESE_FINALE'];
  const sem = result['3_ANALYSE_SEMANTIQUE'];
  const int = result['4_INTENTIONS'];
  const qlt = result['5_ANALYSE_QUALITE'];
  const str = result['1_STRUCTURE'];
  const grph= result['2_GRAPHE_LOGIQUE'];

  // Structure
  console.log(chalk.gray(`\n  Structure : `) +
    chalk.white(`${str.modules.functions} fonction(s)`) +
    (str.modules.classes > 0 ? chalk.white(`, ${str.modules.classes} classe(s)`) : '') +
    (str.modules.imports > 0 ? chalk.gray(`, ${str.modules.imports} import(s)`) : '') +
    (str.modules.exports > 0 ? chalk.gray(`, ${str.modules.exports} export(s)`) : '')
  );

  // Rôles fonctionnels
  console.log(chalk.gray(`  Rôles     : `));
  str.functions.forEach(fn => {
    const role = sem.roles.find(r => r.fn === fn.name);
    const bar  = fn.complexity > 5 ? chalk.red(`cx:${fn.complexity}`) : chalk.gray(`cx:${fn.complexity}`);
    console.log(
      chalk.gray('             ') +
      chalk.white(fn.name.padEnd(24)) +
      chalk.yellow((role?.role || '?').padEnd(18)) +
      bar + (fn.async ? chalk.cyan(' ⚡async') : '') +
      (role?.effects?.length ? chalk.red(` [${role.effects.join(',')}]`) : '')
    );
  });

  // Graphe
  if (grph.fluxCritiques.length > 0) {
    console.log(chalk.gray(`\n  Flux      : `) + chalk.cyan(grph.fluxCritiques[0]));
  }
  if (grph.composantsCentraux.length > 0) {
    console.log(chalk.gray(`  Hubs      : `) + chalk.white(grph.composantsCentraux.join(', ')));
  }

  // Patterns
  if (sem.patternsDetectés.length > 0) {
    console.log(chalk.gray(`  Patterns  : `) + chalk.cyan(sem.patternsDetectés.join(', ')));
  }

  // Intentions
  console.log(chalk.gray(`\n  Intention globale :`));
  console.log(chalk.gray('  → ') + chalk.white(int.globale.narrative));

  if (int.locale.length > 0) {
    console.log(chalk.gray(`\n  Intentions locales :`));
    int.locale.forEach(l =>
      console.log(chalk.gray('  │ ') + chalk.white(`${l.fn} `) + chalk.gray('— ') + chalk.dim(l.intention || l.intent || ''))
    );
  }

  // Architecture
  console.log(chalk.gray(`\n  Architecture implicite : `) + chalk.cyan(syn.architectureImplicite));
  console.log(chalk.gray(`  Comportement réel      : `) + chalk.white(syn.comportementRéel));

  // Qualité
  const scoreColor = qlt.scoreGlobal >= 80 ? chalk.green : qlt.scoreGlobal >= 60 ? chalk.yellow : chalk.red;
  console.log(chalk.gray(`  Score qualité          : `) + scoreColor(`${qlt.scoreGlobal}/100`));

  if (syn.pointsFaiblesMajeurs.length > 0) {
    console.log(chalk.gray(`  Points faibles :`));
    syn.pointsFaiblesMajeurs.forEach(w => console.log(chalk.gray('  │ ') + chalk.red(w)));
  }

  if (qlt.recommandations.length > 0) {
    console.log(chalk.gray(`  Recommandations :`));
    qlt.recommandations.slice(0, 2).forEach(r => {
      if (typeof r === 'string') {
        console.log(chalk.gray('  │ ') + chalk.yellow(r.slice(0, 90)));
      } else {
        const action = (r.action || '').slice(0, 60);
        console.log(chalk.gray('  │ ') + chalk.yellow(`[${r.priority||'?'}] `) + chalk.white(`${r.scope||''} — ${action}`));
      }
    });
  }
}

function printSummary(results) {
  console.log(chalk.cyan(`\n\n  ╔${ sep('═') }╗`));
  console.log(chalk.cyan('  ║') + chalk.white.bold('                   Récapitulatif démo                  ') + chalk.cyan('║'));
  console.log(chalk.cyan(`  ╚${ sep('═') }╝\n`));

  results.forEach(({ title, syn, qlt }) => {
    const sc = qlt >= 80 ? chalk.green : qlt >= 60 ? chalk.yellow : chalk.red;
    console.log(
      chalk.gray('  ') + chalk.white(title.slice(0, 38).padEnd(38)) +
      sc(`${qlt}/100`.padEnd(8)) +
      chalk.cyan(syn.slice(0, 32))
    );
  });
  console.log('');
}

// ─── Point d'entrée ──────────────────────────────────────────────

async function runDemo() {
  printHeader();

  const summary = [];

  for (let i = 0; i < DEMO_CASES.length; i++) {
    const demo = DEMO_CASES[i];
    printCase(demo, i + 1, DEMO_CASES.length);

    try {
      const r = analyze(demo.source);
      summary.push({
        title : demo.title,
        syn   : r['6_SYNTHESE_FINALE'].architectureImplicite.slice(0, 32),
        qlt   : r['5_ANALYSE_QUALITE'].scoreGlobal,
      });
    } catch (_) {
      summary.push({ title: demo.title, syn: 'Erreur', qlt: 0 });
    }

    // Pause visuelle entre les cas
    await new Promise(r => setTimeout(r, 60));
  }

  printSummary(summary);
  console.log(chalk.gray('  Commandes disponibles :'));
  console.log(chalk.white('    node index.js semantic    <fichier.js>      ') + chalk.gray('— analyser un fichier'));
  console.log(chalk.white('    node index.js semantic-url <url>            ') + chalk.gray('— analyser depuis une URL'));
  console.log(chalk.white('    node index.js semantic-repo <github-url>   ') + chalk.gray('— analyser un repo GitHub'));
  console.log(chalk.white('    node index.js serve                         ') + chalk.gray('— API REST (:3000)'));
  console.log('');
}

runDemo().catch(err => {
  console.error(chalk.red(`\n  ✗ ${err.message}`));
  console.error(chalk.gray(err.stack));
  process.exit(1);
});

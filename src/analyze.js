'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Module d'Analyse v1.1                  ║
 * ║                                                              ║
 * ║   analyzeFile(filePath)          — fichier JS local         ║
 * ║   analyzeSnippet(code)           — snippet inline           ║
 * ║   analyzeUrl(url, topK, token)   — URL distante             ║
 * ║   analyzeRepo(repoUrl, opts)     — repo GitHub complet      ║
 * ║                                                              ║
 * ║   v1.1 — Correctifs :                                       ║
 * ║     • --token GitHub propagé dans tous les appels HTTP      ║
 * ║       (fetchUrl + fetchJson) → repos privés fonctionnels    ║
 * ║     • Affichage du flag OOD dans le rapport de repo         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const chalk = require('chalk');

const { predict, isModelReady }                           = require('./predictor');
const { displayResult, displayError, displayModelNotReady } = require('./ui');

function checkModelReady() {
  if (!isModelReady()) { displayModelNotReady(); return false; }
  return true;
}

function sourceSummary(source) {
  return source.trim().split('\n')[0].trim();
}

// ─── HTTP helpers ────────────────────────────────────────────────

/**
 * Télécharge le contenu d'une URL.
 * @param {string}      url
 * @param {string|null} token  — GitHub PAT (optionnel, ajouté dans Authorization)
 */
function fetchUrl(url, token = null) {
  return new Promise((resolve, reject) => {
    const client  = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': 'logic-lens/1.1' };
    if (token) headers['Authorization'] = `token ${token}`;

    const req = client.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location, token).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Télécharge et parse un JSON depuis une URL (API GitHub).
 * @param {string}      url
 * @param {string|null} token
 */
function fetchJson(url, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'logic-lens/1.1',
      'Accept'    : 'application/vnd.github.v3+json',
    };
    if (token) headers['Authorization'] = `token ${token}`;

    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetchJson(res.headers.location, token).then(resolve).catch(reject);
      if (res.statusCode === 401)
        return reject(new Error('Token GitHub invalide ou expiré (HTTP 401)'));
      if (res.statusCode === 403)
        return reject(new Error('Accès refusé — token insuffisant ou rate-limit atteint (HTTP 403)'));
      if (res.statusCode === 404)
        return reject(new Error('Repo introuvable ou privé — utilisez --token (HTTP 404)'));
      if (res.statusCode !== 200)
        return reject(new Error(`GitHub API HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function toGithubRaw(url) {
  return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
}

// ─── Analyses individuelles ──────────────────────────────────────

async function analyzeSnippet(code, topK = 3) {
  if (!checkModelReady()) return;
  if (!code || !code.trim()) { displayError('Snippet vide.'); return; }
  process.stdout.write(chalk.gray('  Analyse en cours…\r'));
  try {
    const predictions = await predict(code, topK);
    process.stdout.write('                       \r');
    displayResult(predictions, sourceSummary(code));
  } catch (err) {
    process.stdout.write('                       \r');
    displayError(err.message);
  }
}

async function analyzeFile(filePath, topK = 3) {
  if (!checkModelReady()) return;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) { displayError(`Fichier introuvable : ${resolved}`); return; }
  console.log(chalk.gray(`  Fichier : ${resolved}`));
  await analyzeSnippet(fs.readFileSync(resolved, 'utf8'), topK);
}

/**
 * @param {string}      url
 * @param {number}      topK
 * @param {string|null} token   — GitHub PAT pour les fichiers de repos privés
 */
async function analyzeUrl(url, topK = 3, token = null) {
  if (!checkModelReady()) return;
  const rawUrl = url.includes('github.com') ? toGithubRaw(url) : url;
  console.log(chalk.gray(`  URL : ${rawUrl}`));
  process.stdout.write(chalk.gray('  Téléchargement…\r'));
  let source;
  try {
    source = await fetchUrl(rawUrl, token);
    process.stdout.write('                       \r');
  } catch (err) {
    process.stdout.write('                       \r');
    displayError(`Téléchargement échoué : ${err.message}`);
    return;
  }
  await analyzeSnippet(source, topK);
}

// ─── Analyse de repo GitHub ──────────────────────────────────────

function parseGithubUrl(url) {
  const cleaned = url.replace(/^https?:\/\//, '').replace(/^github\.com\//, '');
  const parts   = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error(`URL GitHub invalide : ${url}`);
  return { owner: parts[0], repo: parts[1], branch: parts[3] || 'HEAD' };
}

async function getRepoTree(owner, repo, branch, token) {
  const data = await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token
  );
  if (!data.tree) throw new Error("Impossible de lire l'arbre du repo (privé ou inexistant ?)");
  const JS_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'];
  const SKIP    = ['node_modules', 'dist', 'build', '.min.', 'vendor', 'coverage'];
  return data.tree.filter(item =>
    item.type === 'blob' &&
    JS_EXTS.includes(path.extname(item.path).toLowerCase()) &&
    !SKIP.some(s => item.path.includes(s)) &&
    item.size < 150_000
  );
}

function printRepoProgress(done, total, file) {
  const pct  = Math.round((done / total) * 100);
  const bar  = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  const name = file.length > 40 ? '…' + file.slice(-39) : file.padEnd(40);
  process.stdout.write(`\r  [${bar}] ${pct}% | ${chalk.gray(name)}`);
}

function printRepoReport(results, owner, repo, elapsed) {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold(`   📊  Rapport — ${owner}/${repo}`.padEnd(51)) + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  console.log('');

  const errors   = results.filter(r => r.error).length;
  const analyzed = results.length - errors;
  const oodCount = results.filter(r => r.predictions?.[0]?.ood?.isOOD).length;

  console.log(chalk.white(`  Fichiers analysés : ${chalk.green(analyzed)} / ${results.length}`) +
    (errors   > 0 ? chalk.red(`  (${errors} erreurs)`)          : '') +
    (oodCount > 0 ? chalk.yellow(`  (${oodCount} hors-distribution)`) : ''));
  console.log(chalk.gray(`  Temps             : ${(elapsed / 1000).toFixed(1)}s\n`));

  const byCategory = {};
  const byFormula  = {};
  for (const r of results) {
    if (r.error || !r.predictions?.[0]) continue;
    const top = r.predictions[0];
    byCategory[top.category] = (byCategory[top.category] || 0) + 1;
    if (!byFormula[top.id]) byFormula[top.id] = { label: top.label, count: 0, files: [] };
    byFormula[top.id].count++;
    byFormula[top.id].files.push(r.file);
  }

  console.log(chalk.cyan('  ┌─ Distribution par catégorie ──────────────────────'));
  const cats     = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const maxCount = cats[0]?.[1] || 1;
  for (const [cat, count] of cats) {
    const bar = '█'.repeat(Math.round((count / maxCount) * 20));
    const pct = ((count / analyzed) * 100).toFixed(1);
    console.log(
      chalk.gray('  │  ') + chalk.yellow(cat.padEnd(22)) +
      chalk.cyan(bar.padEnd(22)) + chalk.white(`${count} (${pct}%)`)
    );
  }
  console.log('');

  console.log(chalk.cyan('  ┌─ Top formules logiques ───────────────────────────'));
  const formulas = Object.entries(byFormula).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  formulas.forEach(([, data], i) => {
    const medal = ['🥇','🥈','🥉'][i] || `${i + 1}.`;
    console.log(chalk.gray('  │  ') + medal + ' ' + chalk.white(data.label.padEnd(35)) + chalk.cyan(`×${data.count}`));
    data.files.slice(0, 2).forEach(f => console.log(chalk.gray(`  │       └ ${f}`)));
    if (data.files.length > 2) console.log(chalk.gray(`  │       └ … et ${data.files.length - 2} autres`));
  });
  console.log('');

  console.log(chalk.cyan('  ┌─ Détail par fichier ──────────────────────────────'));
  results.filter(r => !r.error && r.predictions?.[0]).slice(0, 30).forEach(r => {
    const top  = r.predictions[0];
    const conf = top.confidence >= 70 ? chalk.green(`${top.confidence}%`) :
                 top.confidence >= 40 ? chalk.yellow(`${top.confidence}%`) :
                                        chalk.red(`${top.confidence}%`);
    const ood  = top.ood?.isOOD ? chalk.yellow(' ⚠') : '';
    const name = r.file.length > 36 ? '…' + r.file.slice(-35) : r.file;
    console.log(chalk.gray('  │  ') + chalk.white(name.padEnd(38)) + conf + ood + '  ' + chalk.gray(top.label.slice(0, 28)));
  });
  if (results.length > 30) console.log(chalk.gray(`  │  … et ${results.length - 30} autres fichiers`));
  console.log('');
}

/**
 * @param {string} repoUrl
 * @param {{ topK?, concurrency?, token? }} opts
 */
async function analyzeRepo(repoUrl, opts = {}) {
  if (!checkModelReady()) return;
  const { topK = 3, concurrency = 5, token = null } = opts;

  let owner, repo, branch;
  try {
    ({ owner, repo, branch } = parseGithubUrl(repoUrl));
  } catch (err) {
    displayError(err.message); return;
  }

  console.log(chalk.cyan(`\n  🔭 Repo : ${chalk.white(`${owner}/${repo}`)}`) + chalk.gray(` (branche : ${branch})`));
  if (token) console.log(chalk.gray('  🔑 Token GitHub actif'));

  process.stdout.write(chalk.gray("  Chargement de l'arbre du repo…"));
  let files;
  try {
    files = await getRepoTree(owner, repo, branch, token);
    process.stdout.write(`\r  ${chalk.green('✓')} ${files.length} fichiers JS/TS trouvés${' '.repeat(20)}\n`);
  } catch (err) {
    process.stdout.write('\n');
    displayError(err.message);
    if (!token) console.log(chalk.gray('  Astuce : pour les repos privés, utilisez --token <GITHUB_TOKEN>'));
    return;
  }

  if (files.length === 0) {
    console.log(chalk.yellow('  ⚠  Aucun fichier JS/TS source trouvé.')); return;
  }

  console.log(chalk.gray(`  Analyse de ${files.length} fichiers (concurrence ${concurrency})…\n`));

  const results = [];
  let done = 0;
  const startAt = Date.now();

  async function analyzeOne(item) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
    try {
      const source      = await fetchUrl(rawUrl, token);
      const predictions = await predict(source, topK);
      results.push({ file: item.path, predictions, error: null });
    } catch (err) {
      results.push({ file: item.path, predictions: [], error: err.message });
    }
    printRepoProgress(++done, files.length, item.path);
  }

  for (let i = 0; i < files.length; i += concurrency)
    await Promise.all(files.slice(i, i + concurrency).map(analyzeOne));

  process.stdout.write('\n');
  printRepoReport(results, owner, repo, Date.now() - startAt);
}

module.exports = { analyzeSnippet, analyzeFile, analyzeUrl, analyzeRepo };

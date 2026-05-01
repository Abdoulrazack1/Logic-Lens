'use strict';

/**
 * LOGIC LENS — Analyse sémantique de repo GitHub
 * Agrège les analyses de tous les fichiers JS/TS d'un repo
 * et produit une synthèse architecturale globale.
 */

const path  = require('path');
const https = require('https');
const http  = require('http');
const chalk = require('chalk');
const { analyze } = require('./synthesizer');

// ─── HTTP helpers ─────────────────────────────────────────────────

function fetchUrl(url, token = null) {
  return new Promise((resolve, reject) => {
    const client  = url.startsWith('https') ? https : http;
    const headers = { 'User-Agent': 'logic-lens/1.1' };
    if (token) headers['Authorization'] = `token ${token}`;
    const req = client.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetchUrl(res.headers.location, token).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchJson(url, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'logic-lens/1.1', 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode === 404) return reject(new Error('Repo introuvable ou privé (404)'));
      if (res.statusCode === 401) return reject(new Error('Token invalide (401)'));
      if (res.statusCode !== 200) return reject(new Error(`GitHub API HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseGithubUrl(url) {
  const cleaned = url.replace(/^https?:\/\//, '').replace(/^github\.com\//, '');
  const parts   = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error(`URL GitHub invalide : ${url}`);
  return { owner: parts[0], repo: parts[1], branch: parts[3] || 'HEAD' };
}

async function getRepoTree(owner, repo, branch, token) {
  const data = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token);
  const JS_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx'];
  const SKIP    = ['node_modules', 'dist', 'build', '.min.', 'vendor', 'coverage', '.test.', '.spec.'];
  return data.tree.filter(item =>
    item.type === 'blob' &&
    JS_EXTS.includes(path.extname(item.path).toLowerCase()) &&
    !SKIP.some(s => item.path.includes(s)) &&
    item.size < 200_000
  );
}

// ─── Agrégation multi-fichiers ────────────────────────────────────

function aggregateRepoAnalysis(fileResults) {
  const allRoles       = {};
  const allPatterns    = {};
  const allEffects     = {};
  const allWeaknesses  = [];
  const qualityScores  = [];
  const allArchStyles  = {};

  for (const r of fileResults) {
    if (r.error || !r.analysis) continue;
    const a = r.analysis;

    // Rôles
    if (a['3_ANALYSE_SEMANTIQUE']?.roles) {
      for (const role of a['3_ANALYSE_SEMANTIQUE'].roles) {
        allRoles[role.role] = (allRoles[role.role] || 0) + 1;
        for (const eff of role.effects || [])
          allEffects[eff] = (allEffects[eff] || 0) + 1;
      }
    }

    // Patterns de conception
    for (const p of (a['3_ANALYSE_SEMANTIQUE']?.patternsDetectés || []))
      allPatterns[p] = (allPatterns[p] || 0) + 1;

    // Qualité
    if (a['5_ANALYSE_QUALITE']?.scoreGlobal != null)
      qualityScores.push(a['5_ANALYSE_QUALITE'].scoreGlobal);

    // Points faibles
    allWeaknesses.push(...(a['6_SYNTHESE_FINALE']?.pointsFaiblesMajeurs || []));

    // Styles architecturaux
    const style = a['6_SYNTHESE_FINALE']?.architectureImplicite;
    if (style) allArchStyles[style] = (allArchStyles[style] || 0) + 1;
  }

  const avgQuality = qualityScores.length
    ? Math.round(qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length)
    : 0;

  const topRoles    = Object.entries(allRoles).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topPatterns = Object.entries(allPatterns).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topEffects  = Object.entries(allEffects).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topStyles   = Object.entries(allArchStyles).sort((a, b) => b[1] - a[1]).slice(0, 4);

  // Top weaknesses (dédoublonnées)
  const weaknessFreq = {};
  for (const w of allWeaknesses) weaknessFreq[w] = (weaknessFreq[w] || 0) + 1;
  const topWeaknesses = Object.entries(weaknessFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    filesAnalyzed   : fileResults.filter(r => !r.error).length,
    filesError      : fileResults.filter(r => r.error).length,
    avgQualityScore : avgQuality,
    topRoles        : topRoles.map(([role, count]) => ({ role, count })),
    topPatterns     : topPatterns.map(([pattern, files]) => ({ pattern, files })),
    topEffects      : topEffects.map(([effect, count]) => ({ effect, count })),
    topStyles       : topStyles.map(([style, count]) => ({ style, count })),
    topWeaknesses   : topWeaknesses.map(([msg, count]) => ({ msg, count })),
    qualityDistribution: {
      excellent: qualityScores.filter(s => s >= 80).length,
      good     : qualityScores.filter(s => s >= 60 && s < 80).length,
      fair     : qualityScores.filter(s => s >= 40 && s < 60).length,
      poor     : qualityScores.filter(s => s < 40).length,
    },
  };
}

// ─── Point d'entrée ──────────────────────────────────────────────

/**
 * Analyse sémantique complète d'un repo GitHub.
 * @param {string} repoUrl
 * @param {{ token?, concurrency?, maxFiles?, onProgress? }} opts
 */
async function analyzeRepo(repoUrl, opts = {}) {
  const { token = null, concurrency = 4, maxFiles = 100, onProgress = null } = opts;

  const { owner, repo, branch } = parseGithubUrl(repoUrl);
  const files = await getRepoTree(owner, repo, branch, token);
  const limited = files.slice(0, maxFiles);

  const results = [];
  let done = 0;

  async function processFile(item) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
    try {
      const source   = await fetchUrl(rawUrl, token);
      const analysis = analyze(source);
      results.push({ file: item.path, analysis, error: null });
    } catch (err) {
      results.push({ file: item.path, analysis: null, error: err.message });
    }
    done++;
    if (onProgress) onProgress(done, limited.length, item.path);
  }

  for (let i = 0; i < limited.length; i += concurrency)
    await Promise.all(limited.slice(i, i + concurrency).map(processFile));

  const aggregated = aggregateRepoAnalysis(results);

  return {
    repo        : `${owner}/${repo}`,
    branch,
    totalFiles  : files.length,
    analyzedFiles: limited.length,
    aggregated,
    files       : results.map(r => ({
      file  : r.file,
      error : r.error,
      synthesis: r.analysis?.['6_SYNTHESE_FINALE'] || null,
      quality  : r.analysis?.['5_ANALYSE_QUALITE']?.scoreGlobal || null,
      roles    : r.analysis?.['3_ANALYSE_SEMANTIQUE']?.roles?.map(n => n.role) || [],
    })),
  };
}

module.exports = { analyzeRepo, analyze };

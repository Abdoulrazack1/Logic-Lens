'use strict';

/**
 * COUCHE 5 — ANALYSE DE QUALITÉ
 * Évalue : complexité, couplage, cohésion, redondances,
 * dette technique, zones critiques.
 */

// ─── Complexité structurelle ──────────────────────────────────────

function evaluateComplexity(nodes, metrics) {
  const issues = [];

  for (const node of nodes) {
    if (node.complexity > 10)
      issues.push({ severity: 'high', fn: node.id, metric: 'cyclomatique', value: node.complexity, msg: `Complexité cyclomatique très élevée (${node.complexity}) — difficile à tester et maintenir` });
    else if (node.complexity > 7)
      issues.push({ severity: 'medium', fn: node.id, metric: 'cyclomatique', value: node.complexity, msg: `Complexité cyclomatique élevée (${node.complexity})` });

    if (node.nesting > 4)
      issues.push({ severity: 'high', fn: node.id, metric: 'imbrication', value: node.nesting, msg: `Imbrication excessive (${node.nesting} niveaux) — candidate au refactoring` });
    else if (node.nesting > 3)
      issues.push({ severity: 'medium', fn: node.id, metric: 'imbrication', value: node.nesting, msg: `Imbrication profonde (${node.nesting} niveaux)` });

    if (node.lines > 80)
      issues.push({ severity: 'medium', fn: node.id, metric: 'longueur', value: node.lines, msg: `Fonction longue (${node.lines} lignes) — candidat à la décomposition` });
    else if (node.lines > 150)
      issues.push({ severity: 'high', fn: node.id, metric: 'longueur', value: node.lines, msg: `Fonction très longue (${node.lines} lignes)` });

    if (node.params.length > 5)
      issues.push({ severity: 'medium', fn: node.id, metric: 'paramètres', value: node.params.length, msg: `Trop de paramètres (${node.params.length}) — envisager un objet de configuration` });
  }

  return {
    score  : computeComplexityScore(nodes, metrics),
    issues,
    avgCyclomaticComplexity: metrics.avgComplexity,
    hotspots: nodes.filter(n => n.complexity > 7 || n.nesting > 3).map(n => n.id),
  };
}

function computeComplexityScore(nodes, metrics) {
  if (nodes.length === 0) return 100;
  const avgC   = metrics.avgComplexity;
  const maxN   = Math.max(...nodes.map(n => n.nesting), 0);
  const longFn = nodes.filter(n => n.lines > 80).length / nodes.length;
  const score  = 100 - (avgC - 1) * 8 - maxN * 5 - longFn * 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Couplage inter-modules ───────────────────────────────────────

function evaluateCoupling(nodes, edges, metrics) {
  const issues = [];

  // Fonctions avec trop de dépendances sortantes (fan-out élevé)
  for (const node of nodes) {
    const out = metrics.fanOut[node.id] || 0;
    const ext = edges.filter(e => e.from === node.id && e.kind === 'external').length;
    if (out > 7)
      issues.push({ severity: 'high', fn: node.id, metric: 'fan-out', value: out, msg: `Fan-out très élevé (${out}) — trop de dépendances sortantes` });
    else if (out > 4)
      issues.push({ severity: 'medium', fn: node.id, metric: 'fan-out', value: out, msg: `Fan-out élevé (${out})` });
    if (ext > 5)
      issues.push({ severity: 'medium', fn: node.id, metric: 'external-calls', value: ext, msg: `${ext} appels vers des modules externes — couplage fort` });
  }

  // Hub global (nœud central dont tout dépend)
  const globalHubs = (metrics.hubs || []).filter(h => h.score > 10);
  for (const hub of globalHubs)
    issues.push({ severity: 'medium', fn: hub.id, metric: 'hub', value: hub.score, msg: `Nœud central (hub) — point de défaillance unique potentiel` });

  return {
    score : computeCouplingScore(nodes, metrics),
    issues,
    afferentCoupling : metrics.fanIn,
    efferentCoupling : metrics.fanOut,
    instability      : computeInstability(nodes, metrics),
  };
}

function computeCouplingScore(nodes, metrics) {
  if (nodes.length === 0) return 100;
  const avgFanOut = Object.values(metrics.fanOut).reduce((a, b) => a + b, 0) / (nodes.length || 1);
  const score     = 100 - avgFanOut * 6 - (metrics.hubs?.length || 0) * 4;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeInstability(nodes, metrics) {
  // Instabilité = Ce / (Ca + Ce) — proche de 1 = instable, proche de 0 = stable
  const result = {};
  for (const node of nodes) {
    const ca = metrics.fanIn[node.id]  || 0;
    const ce = metrics.fanOut[node.id] || 0;
    result[node.id] = ca + ce > 0 ? parseFloat((ce / (ca + ce)).toFixed(2)) : 0;
  }
  return result;
}

// ─── Cohésion interne ─────────────────────────────────────────────

function evaluateCohesion(nodes, semantic) {
  const issues = [];

  // Fonctions avec responsabilités multiples (god functions)
  for (const node of nodes) {
    const roleSignals = [
      node.transforms.length > 5,
      node.effects.length > 3,
      node.complexity > 8 && node.calls.length > 5,
    ];
    const godSignals = roleSignals.filter(Boolean).length;
    if (godSignals >= 2)
      issues.push({ severity: 'high', fn: node.id, metric: 'cohésion', msg: `Fonction "God Object" probable — trop de responsabilités mélangées` });
    else if (node.transforms.length > 3 && node.effects.length >= 2)
      issues.push({ severity: 'medium', fn: node.id, metric: 'cohésion', msg: `Mélange de logique et d'effets de bord — séparer les responsabilités` });
  }

  // Fonctions isolées qui effectuent la même transformation
  const pure = nodes.filter(n => n.role === 'pure-function' && n.transforms.length > 0);
  const txMap = {};
  for (const n of pure) {
    const key = n.transforms.slice().sort().join(':');
    if (!txMap[key]) txMap[key] = [];
    txMap[key].push(n.id);
  }
  for (const [key, fns] of Object.entries(txMap)) {
    if (fns.length >= 2)
      issues.push({ severity: 'low', fns, metric: 'redondance', msg: `${fns.length} fonctions pures avec des transformations similaires (${key}) — potentiel doublon logique` });
  }

  return {
    score : computeCohesionScore(nodes, issues),
    issues,
    isolatedFunctions: (nodes.filter(n => n.calls.length === 0 && (semantic?.dataFlows?.variableFlows || []).every(f => !f.to.includes(n.id)))).map(n => n.id),
  };
}

function computeCohesionScore(nodes, issues) {
  if (nodes.length === 0) return 100;
  const highIssues   = issues.filter(i => i.severity === 'high').length;
  const mediumIssues = issues.filter(i => i.severity === 'medium').length;
  const score        = 100 - highIssues * 20 - mediumIssues * 8;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Dette technique ──────────────────────────────────────────────

function evaluateTechnicalDebt(nodes, structure, metrics) {
  const items = [];

  // Fonctions sans paramètres qui lisent des variables globales
  const globalReaders = nodes.filter(n => n.params.length === 0 && n.reads.length > 3);
  if (globalReaders.length > 0)
    items.push({ severity: 'medium', category: 'couplage global', count: globalReaders.length, msg: `${globalReaders.length} fonction(s) lisent l'état global sans paramètres — difficile à tester` });

  // Pas de gestion d'erreur pour les fonctions async
  const asyncWithoutCatch = nodes.filter(n => n.async && !n.effects.includes('throws') && !n.calls.some(c => c.includes('catch')));
  if (asyncWithoutCatch.length > 0)
    items.push({ severity: 'high', category: 'gestion d\'erreur', count: asyncWithoutCatch.length, fns: asyncWithoutCatch.map(n => n.id), msg: `${asyncWithoutCatch.length} fonction(s) async sans gestion d'erreur explicite (try/catch ou .catch())` });

  // Mutations d'objets reçus en paramètre
  const mutators = nodes.filter(n => n.effects.includes('mutation') && n.params.length > 0);
  if (mutators.length > 0)
    items.push({ severity: 'medium', category: 'mutation', count: mutators.length, msg: `${mutators.length} fonction(s) mutent leurs paramètres — imprévisible pour l'appelant` });

  // Trop de fonctions génériques (utility) non structurées
  const utilityRatio = nodes.filter(n => n.role === 'utility').length / (nodes.length || 1);
  if (utilityRatio > 0.4 && nodes.length > 4)
    items.push({ severity: 'low', category: 'structure', msg: `${Math.round(utilityRatio * 100)}% des fonctions non classifiées — manque de structure claire` });

  // Profondeur d'appels excessive (spaghetti)
  if (metrics.maxCallDepth > 6)
    items.push({ severity: 'medium', category: 'profondeur', value: metrics.maxCallDepth, msg: `Profondeur d'appels de ${metrics.maxCallDepth} — risque de stack overflow et de débogage difficile` });

  return {
    score: computeDebtScore(items),
    items,
    estimatedRefactoringHours: estimateRefactoringHours(nodes, items),
  };
}

function computeDebtScore(items) {
  const score = 100 - items.filter(i => i.severity === 'high').length * 18
                     - items.filter(i => i.severity === 'medium').length * 8
                     - items.filter(i => i.severity === 'low').length * 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function estimateRefactoringHours(nodes, items) {
  // Estimation grossière basée sur les issues
  const hours = items.reduce((sum, i) => {
    if (i.severity === 'high')   return sum + (i.count || 1) * 3;
    if (i.severity === 'medium') return sum + (i.count || 1) * 1.5;
    return sum + 0.5;
  }, 0);
  return parseFloat(hours.toFixed(1));
}

// ─── Score global et recommandations ─────────────────────────────

function generateRecommendations(complexity, coupling, cohesion, debt) {
  const recs = [];
  const seen = new Set(); // dédoublonnage par message

  function addRec(priority, scope, action) {
    const key = `${action.slice(0, 60)}`;
    if (seen.has(key)) return;
    seen.add(key);
    recs.push({ priority, scope: scope || 'global', action });
  }

  const allIssues = [
    ...complexity.issues,
    ...coupling.issues,
    ...cohesion.issues,
    ...debt.items,
  ].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] ?? 2) - ({ high: 0, medium: 1, low: 2 }[b.severity] ?? 2));

  for (const issue of allIssues.filter(i => i.severity === 'high').slice(0, 4))
    addRec('haute', issue.fn || issue.category, issue.msg);

  for (const issue of allIssues.filter(i => i.severity === 'medium').slice(0, 3))
    addRec('moyenne', issue.fn || issue.fns?.join(', ') || issue.category, issue.msg);

  if (complexity.hotspots.length > 0)
    addRec('haute', complexity.hotspots.slice(0, 3).join(', '), 'Décomposer en fonctions plus petites et mieux ciblées');

  if (coupling.instability) {
    const unstable = Object.entries(coupling.instability).filter(([, v]) => v > 0.8).map(([k]) => k);
    if (unstable.length > 0)
      addRec('moyenne', unstable.slice(0, 3).join(', '), "Réduire l'instabilité en inversant les dépendances ou en ajoutant une abstraction");
  }

  return recs;
}

// ─── Point d'entrée ──────────────────────────────────────────────

/**
 * @param {{ nodes, edges, metrics }} graph
 * @param {{ enrichedNodes, designPatterns, dataFlows }} semantic
 * @param {{ functions, classes, imports, exports }} structure
 * @returns {{ complexity, coupling, cohesion, technicalDebt, globalScore, recommendations }}
 */
function analyzeQuality(graph, semantic, structure) {
  const { nodes, edges, metrics } = graph;
  const { enrichedNodes }         = semantic;

  const complexity   = evaluateComplexity(enrichedNodes, metrics);
  const coupling     = evaluateCoupling(enrichedNodes, edges, metrics);
  const cohesion     = evaluateCohesion(enrichedNodes, semantic);
  const technicalDebt= evaluateTechnicalDebt(enrichedNodes, structure, metrics);

  const globalScore = Math.round(
    complexity.score  * 0.30 +
    coupling.score    * 0.25 +
    cohesion.score    * 0.25 +
    technicalDebt.score * 0.20
  );

  const recommendations = generateRecommendations(complexity, coupling, cohesion, technicalDebt);

  return { complexity, coupling, cohesion, technicalDebt, globalScore, recommendations };
}

module.exports = { analyzeQuality };

'use strict';

/**
 * COUCHE 6 — SYNTHÈSE LOGIC LENS
 * Orchestre les 5 couches et produit la sortie finale normalisée.
 *
 * Pipeline :
 *   source → parseStructure → buildCallGraph → analyzeSemantic
 *          → inferIntent → analyzeQuality → buildSynthesis
 */

const { parseStructure } = require('./structural-parser');
const { buildCallGraph }  = require('./call-graph');
const { analyzeSemantic } = require('./semantic-analyzer');
const { inferIntent }     = require('./intent-engine');
const { analyzeQuality }  = require('./quality-analyzer');

// ─── Rapport de synthèse finale ───────────────────────────────────

function buildSynthesis(structure, graph, semantic, intent, quality) {
  const { nodes, metrics } = graph;
  const { enrichedNodes, designPatterns, dataFlows } = semantic;
  const globalIntent = intent.global;

  // Architecture implicite
  const architecturalStyle = detectArchitecturalStyle(structure, graph, semantic);

  // Comportement global réel (narratif court)
  const behaviorSummary = buildBehaviorSummary(structure, graph, semantic, intent);

  // Points faibles majeurs (top 3)
  const topWeaknesses = [
    ...quality.complexity.issues.filter(i => i.severity === 'high'),
    ...quality.coupling.issues.filter(i => i.severity === 'high'),
    ...quality.cohesion.issues.filter(i => i.severity === 'high'),
    ...quality.technicalDebt.items.filter(i => i.severity === 'high'),
  ].slice(0, 3).map(i => i.msg);

  return {
    architecturalStyle,
    behaviorSummary,
    globalIntent    : globalIntent.narrative,
    designPatterns,
    topWeaknesses,
    globalScore     : quality.globalScore,
  };
}

function detectArchitecturalStyle(structure, graph, semantic) {
  const { imports, classes, exports } = structure;
  const { designPatterns }            = semantic;
  const { metrics, nodes }            = graph;

  const signals = [];

  if (classes.length > 0 && classes.some(c => c.parent))         signals.push('OOP avec héritage');
  else if (classes.length > 0)                                    signals.push('OOP sans héritage');

  const hasPipeline    = designPatterns.includes('Pipeline');
  const hasMiddleware  = designPatterns.includes('Middleware Chain');
  const hasObserver    = designPatterns.includes('Observer/EventEmitter');
  const hasSingleton   = designPatterns.includes('Singleton');
  const hasMemo        = designPatterns.includes('Memoization');

  // Détection pipeline par structure du graphe (A→B→C sans branching) même sans pattern explicite
  const transformChains = (semantic?.dataFlows?.transformChains || []);
  const longestChain    = transformChains.reduce((max, c) => Math.max(max, c.length), 0);
  const hasLinearFlow   = longestChain >= 3;

  if (hasPipeline && hasMiddleware)   signals.push('Architecture pipeline/middleware (Express-like)');
  else if (hasPipeline || hasLinearFlow) signals.push('Architecture pipeline de traitement');
  else if (hasMiddleware)             signals.push('Chaîne de responsabilités (middleware)');

  if (hasObserver)                   signals.push('Système événementiel (Event-Driven)');
  if (hasSingleton && imports.length > 3) signals.push('Module avec état partagé');

  const pureFns = nodes.filter(n => n.role === 'pure-function').length;
  if (pureFns / (nodes.length || 1) > 0.5)  signals.push('Style fonctionnel (majorité de fonctions pures)');

  const asyncRatio = nodes.filter(n => n.async).length / (nodes.length || 1);
  if (asyncRatio > 0.3)              signals.push('Architecture asynchrone');

  if (signals.length === 0) {
    if (nodes.length <= 3)           signals.push('Module utilitaire simple');
    else                             signals.push('Module procédural non structuré');
  }

  return signals.join(' + ');
}

function buildBehaviorSummary(structure, graph, semantic, intent) {
  const { functions, imports, exports, classes } = structure;
  const { nodes, metrics }                       = graph;
  const { dataFlows }                            = semantic;
  const global                                   = intent.global;

  const parts = [];

  // Qu'est-ce que ce code fait en entrée ?
  const inputNodes = nodes.filter(n => n.role === 'io-handler' || n.role === 'event-handler' || (n.params.length > 0 && n.role !== 'factory'));
  if (inputNodes.length > 0)
    parts.push(`Reçoit des données via ${inputNodes.length} point(s) d'entrée`);

  // Quelles transformations réalise-t-il ?
  const allTransforms = new Set(nodes.flatMap(n => n.transforms));
  if (allTransforms.size > 0) {
    const txLabels = {
      arithmetic: 'calculs numériques', comparison: 'comparaisons',
      array_ops: 'transformations de collections', string_ops: 'traitement de texte',
      object_ops: 'manipulation de structures', conditional: 'branchements conditionnels',
      iteration: 'itérations',
    };
    const txDesc = [...allTransforms].map(t => txLabels[t] || t).slice(0, 4).join(', ');
    parts.push(`applique ${txDesc}`);
  }

  // Chaînes de transformation significatives
  if (dataFlows.transformChains.length > 0) {
    const chain = dataFlows.transformChains[0];
    parts.push(`flux principal : ${chain.join(' → ')}`);
  }

  // Effets de bord / sorties
  const allEffects = new Set(nodes.flatMap(n => n.effects));
  if (allEffects.has('network'))  parts.push('communique via le réseau');
  if (allEffects.has('io'))       parts.push('lit/écrit sur le système de fichiers');
  if (allEffects.has('dom'))      parts.push('modifie l\'interface utilisateur');
  if (allEffects.has('mutation')) parts.push('maintient un état mutable');

  // Sortie
  if (exports.length > 0)
    parts.push(`expose ${exports.length} symbole(s) public(s)`);

  return parts.length > 0 ? parts.join(' — ') : 'Comportement interne sans interface publique identifiée';
}

// ─── Formatage de la sortie finale ───────────────────────────────

function formatOutput(structure, graph, semantic, intent, quality, synthesis, source, options = {}) {
  const { nodes, edges, metrics } = graph;
  const { enrichedNodes, designPatterns, dataFlows } = semantic;
  const { local, intermediate, global: globalIntent } = intent;
  const short = options.short || false;

  const out = {
    '1_STRUCTURE': {
      modules     : { functions: structure.functions.length, classes: structure.classes.length, imports: structure.imports.length, exports: structure.exports.length },
      classes     : structure.classes.map(c => ({ name: c.name, parent: c.parent, methods: c.methods.length })),
      functions   : enrichedNodes.map(n => ({ name: n.id, role: n.role, complexity: n.complexity, lines: n.lines, async: n.async })),
      imports     : structure.imports.map(i => ({ source: i.source, kind: i.kind })),
      exports     : structure.exports.map(e => ({ name: e.name, kind: e.kind })),
      entryPoints : structure.entryPoints.map(e => e.type),
    },

    '2_GRAPHE_LOGIQUE': {
      relations   : edges.slice(0, 20).map(e => ({ from: e.from, to: e.to, kind: e.kind })),
      fluxCritiques: dataFlows.transformChains.slice(0, 5).map(c => c.join(' → ')),
      composantsCentraux: metrics.hubs.map(h => h.id),
      fonctionsIsolées: metrics.isolated,
      metriques   : {
        noeuds: metrics.nodeCount, arêtes: metrics.edgeCount,
        profondeurMax: metrics.maxCallDepth,
        complexitéMoyenne: metrics.avgComplexity,
        appelsExternes: metrics.externalCalls,
      },
    },

    '3_ANALYSE_SEMANTIQUE': {
      roles: enrichedNodes.map(n => ({ fn: n.id, role: n.role, description: n.roleDescription, effects: n.effects, transforms: n.transforms })),
      fluxDeDonnées: dataFlows.variableFlows.slice(0, 8).map(f => ({ de: f.from, variable: f.variable, vers: f.to })),
      patternsDetectés: designPatterns,
    },

    '4_INTENTIONS': {
      locale      : local.map(l => ({ fn: l.id, role: l.role, intention: l.intent })),
      intermédiaire: intermediate.filter(g => g.ids.length >= 2).map(g => ({ groupe: g.ids, intention: g.intent })),
      globale     : {
        narrative     : globalIntent.narrative,
        rolesDominants: globalIntent.dominantRoles,
        patternsConception: globalIntent.designPatterns,
        pointsEntrée  : globalIntent.entryPoints,
      },
    },

    '5_ANALYSE_QUALITE': {
      scoreGlobal : quality.globalScore,
      complexité  : { score: quality.complexity.score, problèmes: quality.complexity.issues.map(i => `[${i.severity.toUpperCase()}] ${i.fn || ''} — ${i.msg}`) },
      couplage    : { score: quality.coupling.score, problèmes: quality.coupling.issues.map(i => `[${i.severity.toUpperCase()}] ${i.fn || ''} — ${i.msg}`) },
      cohésion    : { score: quality.cohesion.score, problèmes: quality.cohesion.issues.map(i => `[${i.severity.toUpperCase()}] ${i.fns?.join(', ') || i.fn || ''} — ${i.msg}`) },
      detteTechnique: { score: quality.technicalDebt.score, estimationRefactoring: `${quality.technicalDebt.estimatedRefactoringHours}h`, items: quality.technicalDebt.items.map(i => `[${i.severity.toUpperCase()}] ${i.msg}`) },
      recommandations: quality.recommendations.map(r => `[${r.priority.toUpperCase()}] ${r.scope} — ${r.action}`),
    },

    '6_SYNTHESE_FINALE': {
      architectureImplicite: synthesis.architecturalStyle,
      comportementRéel     : synthesis.behaviorSummary,
      intentionSystème     : synthesis.globalIntent,
      patternsConception   : synthesis.designPatterns,
      pointsFaiblesMajeurs : synthesis.topWeaknesses,
      scoreQualité         : `${synthesis.globalScore}/100`,
    },
  };

  return out;
}

// ─── Pipeline complet ─────────────────────────────────────────────

/**
 * Analyse sémantique complète d'un source JS.
 *
 * @param {string} source
 * @param {object} options
 * @returns {object} — rapport Logic Lens complet (6 sections)
 */
function analyze(source, options = {}) {
  // Couche 1 — Parsing structurel
  const structure = parseStructure(source);
  if (structure.error) {
    return { error: `Parse impossible : ${structure.error}`, source: source.slice(0, 100) };
  }

  // Couche 2 — Graphe logique
  const graph = buildCallGraph(structure, source);

  // Couche 3 — Sémantique
  const semantic = analyzeSemantic(graph);

  // Couche 4 — Intentions
  const intent = inferIntent(structure, graph, semantic);

  // Couche 5 — Qualité
  const quality = analyzeQuality(graph, semantic, structure);

  // Couche 6 — Synthèse
  const synthesis = buildSynthesis(structure, graph, semantic, intent, quality);

  return formatOutput(structure, graph, semantic, intent, quality, synthesis, source, options);
}

module.exports = { analyze };

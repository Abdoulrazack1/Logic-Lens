'use strict';

/**
 * COUCHE 2 — GRAPHE LOGIQUE
 * Construit :
 *   - graphe d'appels (qui appelle qui)
 *   - dépendances de données (quels identifiants sont lus/écrits)
 *   - flux de contrôle (chemins, points de décision)
 *   - interactions inter-modules (imports utilisés)
 */

const walk = require('acorn-walk');

// ─── Collecte des appels de fonctions dans un nœud AST ───────────
function collectCalls(bodyNode) {
  const calls = [];
  if (!bodyNode) return calls;

  walk.full(bodyNode, (node) => {
    if (node.type !== 'CallExpression') return;
    let callee = '';
    if (node.callee?.type === 'Identifier') {
      callee = node.callee.name;
    } else if (node.callee?.type === 'MemberExpression') {
      const obj  = node.callee.object?.name || node.callee.object?.type || '?';
      const prop = node.callee.property?.name || node.callee.property?.value || '?';
      callee = `${obj}.${prop}`;
    } else if (node.callee?.type === 'ArrowFunctionExpression' || node.callee?.type === 'FunctionExpression') {
      callee = '<IIFE>';
    }
    if (callee) calls.push(callee);
  });
  return [...new Set(calls)];
}

// ─── Collecte des identifiants lus et écrits ─────────────────────
function collectDataDeps(bodyNode) {
  const reads  = new Set();
  const writes = new Set();
  if (!bodyNode) return { reads: [], writes: [] };

  walk.full(bodyNode, (node) => {
    if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier')
      writes.add(node.left.name);
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier')
      writes.add(node.id.name);
    if (node.type === 'Identifier' && !writes.has(node.name))
      reads.add(node.name);
  });
  return { reads: [...reads], writes: [...writes] };
}

// ─── Comptage des points de décision (complexité cyclomatique) ───
function countDecisionPoints(bodyNode) {
  let count = 1; // chemin de base
  if (!bodyNode) return count;

  walk.full(bodyNode, (node) => {
    if ([
      'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
      'WhileStatement', 'DoWhileStatement', 'SwitchCase',
      'ConditionalExpression', 'CatchClause',
    ].includes(node.type)) count++;
    // && et || ajoutent aussi un chemin
    if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||' || node.operator === '??'))
      count++;
  });
  return count;
}

// ─── Profondeur d'imbrication maximale ───────────────────────────
function maxNestingDepth(bodyNode) {
  if (!bodyNode) return 0;
  let maxDepth = 0;

  function traverse(node, depth) {
    if (!node || typeof node !== 'object') return;
    if ([
      'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
      'WhileStatement', 'DoWhileStatement', 'TryStatement', 'SwitchStatement',
      'FunctionExpression', 'ArrowFunctionExpression',
    ].includes(node.type)) {
      maxDepth = Math.max(maxDepth, depth + 1);
      for (const key of Object.keys(node)) {
        const child = node[key];
        if (child && typeof child === 'object') {
          if (Array.isArray(child)) child.forEach(c => traverse(c, depth + 1));
          else traverse(child, depth + 1);
        }
      }
      return;
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object' && key !== 'parent') {
        if (Array.isArray(child)) child.forEach(c => traverse(c, depth));
        else traverse(child, depth);
      }
    }
  }
  traverse(bodyNode, 0);
  return maxDepth;
}

// ─── Détection des effets de bord ─────────────────────────────────
const SIDE_EFFECT_PATTERNS = {
  io      : ['console.', 'process.', 'fs.', 'readline.', 'stream.'],
  network : ['fetch(', 'http.', 'https.', 'axios.', 'request(', 'XMLHttpRequest'],
  dom     : ['document.', 'window.', 'navigator.', 'localStorage.', 'sessionStorage.'],
  async   : ['Promise.', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
  mutation: [], // détecté structurellement
};

function detectSideEffects(bodyNode, source) {
  if (!bodyNode) return [];
  const effects = new Set();

  // Analyse textuelle rapide sur le source du nœud
  const src = source.slice(bodyNode.range?.[0] || 0, bodyNode.range?.[1] || source.length);
  for (const [kind, patterns] of Object.entries(SIDE_EFFECT_PATTERNS)) {
    if (patterns.some(p => src.includes(p))) effects.add(kind);
  }

  // Mutation de paramètres (accès en écriture à des propriétés de params)
  walk.full(bodyNode, (node) => {
    if (
      node.type === 'AssignmentExpression' &&
      node.left?.type === 'MemberExpression'
    ) effects.add('mutation');

    if (node.type === 'ThrowStatement') effects.add('throws');
    if (node.type === 'AwaitExpression') effects.add('async');
    if (node.type === 'YieldExpression') effects.add('generator');
  });

  return [...effects];
}

// ─── Construction du graphe complet ──────────────────────────────

/**
 * @param {{ functions, ast }} structure  — résultat de parseStructure
 * @param {string}             source
 * @returns {{ nodes, edges, adjacency, metrics }}
 */
function buildCallGraph(structure, source) {
  const { functions, imports } = structure;

  // Nœuds : une fonction = un nœud
  const nodes = functions.map((fn) => {
    const body       = fn.node.body || fn.node;
    const calls      = collectCalls(body);
    const dataDeps   = collectDataDeps(body);
    const complexity = countDecisionPoints(body);
    const nesting    = maxNestingDepth(body);
    const effects    = detectSideEffects(body, source);

    // Type de transformations réalisées dans le corps
    const transforms = detectTransforms(body, source);

    return {
      id          : fn.name,
      kind        : fn.kind,
      params      : fn.params,
      loc         : fn.loc,
      lines       : fn.lines,
      async       : fn.async,
      generator   : fn.generator,
      calls,
      reads       : dataDeps.reads,
      writes      : dataDeps.writes,
      complexity,
      nesting,
      effects,
      transforms,
    };
  });

  // Arêtes : caller → callee (dans le graphe des fonctions connues)
  const fnNames = new Set(nodes.map(n => n.id));
  const edges   = [];
  for (const node of nodes) {
    for (const callee of node.calls) {
      edges.push({
        from  : node.id,
        to    : callee,
        kind  : fnNames.has(callee) ? 'internal' : 'external',
      });
    }
  }

  // Matrice d'adjacence (pour analyses de graphe)
  const adjacency = {};
  for (const n of nodes) adjacency[n.id] = [];
  for (const e of edges.filter(e => e.kind === 'internal'))
    adjacency[e.from].push(e.to);

  // Métriques globales du graphe
  const metrics = computeGraphMetrics(nodes, edges, adjacency, imports);

  return { nodes, edges, adjacency, metrics };
}

// ─── Transformations de données ───────────────────────────────────
const TRANSFORM_PATTERNS = {
  arithmetic  : ['+', '-', '*', '/', '%', '**', 'Math.'],
  comparison  : ['===', '!==', '<', '>', '<=', '>='],
  array_ops   : ['.map(', '.filter(', '.reduce(', '.forEach(', '.find(', '.some(', '.every(', '.flat'],
  string_ops  : ['.split(', '.join(', '.replace(', '.trim(', '.slice(', '.substring(', 'template `'],
  object_ops  : ['Object.', 'JSON.', 'spread {', '...'],
  conditional : ['if (', 'switch (', '? '],
  iteration   : ['for (', 'while (', 'for..of', 'for..in'],
  recursion   : [], // détecté par appel à soi-même
};

function detectTransforms(bodyNode, source) {
  if (!bodyNode) return [];
  const src = source.slice(bodyNode.range?.[0] || 0, bodyNode.range?.[1] || source.length);
  const found = new Set();

  for (const [kind, patterns] of Object.entries(TRANSFORM_PATTERNS)) {
    if (patterns.some(p => src.includes(p))) found.add(kind);
  }

  // Détection des templates littéraux
  walk.full(bodyNode, (node) => {
    if (node.type === 'TemplateLiteral') found.add('string_ops');
    if (node.type === 'SpreadElement')    found.add('object_ops');
    if (node.type === 'RestElement')      found.add('object_ops');
  });

  return [...found];
}

// ─── Métriques globales du graphe ────────────────────────────────
function computeGraphMetrics(nodes, edges, adjacency, imports) {
  // Couplage afférent (fan-in) : combien de fonctions appellent cette fonction
  const fanIn  = {};
  const fanOut = {};
  for (const n of nodes) { fanIn[n.id] = 0; fanOut[n.id] = 0; }
  for (const e of edges.filter(e => e.kind === 'internal')) {
    if (fanIn[e.to]  !== undefined) fanIn[e.to]++;
    if (fanOut[e.from] !== undefined) fanOut[e.from]++;
  }

  // Nœuds centraux (hubs) : fan-in + fan-out élevé
  const hubs = nodes
    .map(n => ({ id: n.id, score: (fanIn[n.id] || 0) + (fanOut[n.id] || 0) }))
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Fonctions isolées (pas appelées, n'appellent rien d'interne)
  const isolated = nodes.filter(n => fanIn[n.id] === 0 && fanOut[n.id] === 0).map(n => n.id);

  // Complexité moyenne
  const avgComplexity = nodes.length
    ? (nodes.reduce((s, n) => s + n.complexity, 0) / nodes.length).toFixed(1)
    : 0;

  // Profondeur max d'appels (BFS depuis les racines)
  const roots   = nodes.filter(n => fanIn[n.id] === 0 && fanOut[n.id] > 0).map(n => n.id);
  const maxDepth = computeMaxCallDepth(adjacency, roots);

  return {
    nodeCount  : nodes.length,
    edgeCount  : edges.length,
    internalEdges: edges.filter(e => e.kind === 'internal').length,
    externalCalls: [...new Set(edges.filter(e => e.kind === 'external').map(e => e.to))].length,
    hubs,
    isolated,
    avgComplexity: parseFloat(avgComplexity),
    maxCallDepth: maxDepth,
    fanIn,
    fanOut,
    importCount: imports.length,
  };
}

function computeMaxCallDepth(adjacency, roots) {
  let max = 0;
  const visited = new Set();

  function dfs(id, depth) {
    if (visited.has(id)) return;
    visited.add(id);
    max = Math.max(max, depth);
    for (const callee of (adjacency[id] || [])) dfs(callee, depth + 1);
    visited.delete(id);
  }

  for (const root of roots) dfs(root, 0);
  return max;
}

module.exports = { buildCallGraph };

'use strict';

/**
 * COUCHE 3 — ANALYSE SÉMANTIQUE
 * Pour chaque nœud du graphe : rôle réel, responsabilité fonctionnelle,
 * données consommées/produites, patterns de conception détectés.
 * Basé exclusivement sur structure + flux — pas les noms.
 */

// ─── Patterns structurels de rôles fonctionnels ──────────────────
// Chaque pattern est une règle sur les propriétés du nœud (pas son nom).

const ROLE_PATTERNS = [
  {
    role : 'transformer',
    desc : "Transforme des données d'entrée en une nouvelle forme",
    match: (n) => n.params.length > 0 && n.transforms.includes('arithmetic') && n.effects.length === 0,
  },
  {
    role : 'predicate',
    desc : 'Teste une condition et retourne un booléen',
    match: (n) => n.transforms.includes('comparison') && n.complexity >= 2 && n.effects.length === 0,
  },
  {
    role : 'aggregator',
    desc : 'Accumule ou réduit une collection de données',
    match: (n) => n.transforms.includes('array_ops') && n.params.length >= 1,
  },
  {
    role : 'factory',
    desc : 'Construit et retourne un objet ou une structure',
    match: (n) => n.transforms.includes('object_ops') && n.effects.length === 0 && n.params.length > 0,
  },
  {
    role : 'orchestrator',
    desc : 'Coordonne plusieurs autres fonctions sans logique propre',
    match: (n) => n.calls.length >= 3 && n.complexity <= 3 && n.transforms.length <= 1,
  },
  {
    role : 'io-handler',
    desc : 'Gère des entrées/sorties (réseau, fichiers, console)',
    match: (n) => n.effects.some(e => ['io', 'network', 'dom'].includes(e)),
  },
  {
    role : 'async-handler',
    desc : 'Gère des opérations asynchrones',
    match: (n) => n.async || n.effects.includes('async'),
  },
  {
    role : 'validator',
    desc : "Valide des données d'entrée et lève des erreurs",
    match: (n) => n.effects.includes('throws') && n.transforms.includes('comparison'),
  },
  {
    role : 'iterator',
    desc : 'Parcourt une structure de données séquentiellement',
    match: (n) => n.transforms.includes('iteration') && !n.transforms.includes('array_ops'),
  },
  {
    role : 'router',
    desc : 'Dirige le flux vers différents chemins selon des conditions',
    match: (n) => n.complexity >= 4 && n.transforms.includes('conditional') && n.calls.length >= 2,
  },
  {
    role : 'initializer',
    desc : 'Configure ou initialise un état ou un module',
    match: (n) => n.writes.length >= 3 && n.complexity <= 2 && n.calls.length <= 2,
  },
  {
    role : 'pure-function',
    desc : "Fonction pure : pas d'effets de bord, retour déterministe",
    match: (n) => n.effects.length === 0 && n.params.length > 0 && n.writes.filter(w => !n.params.includes(w)).length === 0,
  },
  {
    role : 'closure',
    desc : 'Capture un état externe dans sa portée',
    match: (n) => n.kind === 'arrow' || n.kind === 'expression',
  },
  {
    role : 'middleware',
    desc : 'Intercepte et transforme un flux de traitement (req/res/next)',
    match: (n) => n.params.length >= 2 && n.calls.some(c => c.includes('next') || c.includes('next(')),
  },
  {
    role : 'event-handler',
    desc : 'Réagit à un événement externe',
    match: (n) => n.params.some(p => p.toLowerCase().includes('event') || p === 'e' || p === 'evt'),
  },
  {
    role : 'generator-fn',
    desc : 'Génère une séquence de valeurs à la demande',
    match: (n) => n.generator,
  },
];

function assignRole(node) {
  const matched = ROLE_PATTERNS.filter(p => p.match(node));
  if (matched.length === 0) return { role: 'utility', desc: 'Fonction utilitaire générale' };

  // Règles de priorité explicites pour éviter les ambiguïtés
  const roles = matched.map(p => p.role);

  // middleware > orchestrator > router > validator > io-handler > async-handler
  for (const priority of ['middleware','generator-fn','event-handler','validator','io-handler','async-handler','router','orchestrator','aggregator','iterator','initializer','factory','transformer','predicate','closure','pure-function','utility']) {
    if (roles.includes(priority)) return matched.find(p => p.role === priority);
  }
  return matched[matched.length - 1];
}

// ─── Patterns de conception (Design Patterns) ────────────────────
const DESIGN_PATTERNS = [
  {
    name : 'Singleton',
    match: (nodes) => nodes.some(n =>
      (n.writes.some(w => w.toLowerCase().includes('instance')) ||
       n.writes.some(w => w === '_instance' || w === 'instance')) &&
      n.complexity >= 2
    ),
  },
  {
    name : 'Observer/EventEmitter',
    match: (nodes) => nodes.some(n =>
      n.calls.some(c => c.includes('.on(') || c.includes('.emit(') || c.includes('.addEventListener'))
    ),
  },
  {
    name : 'Factory',
    match: (nodes) => {
      const factories = nodes.filter(n => n.role === 'factory');
      return factories.length >= 2;
    },
  },
  {
    name : 'Middleware Chain',
    match: (nodes) => nodes.filter(n => n.role === 'middleware').length >= 2,
  },
  {
    name : 'Pipeline',
    match: (nodes, edges) => {
      // Chaîne linéaire : au moins 3 fonctions où chacune appelle exactement la suivante
      const internal = edges.filter(e => e.kind === 'internal');
      const inDeg  = {};
      const outDeg = {};
      nodes.forEach(n => { inDeg[n.id] = 0; outDeg[n.id] = 0; });
      internal.forEach(e => { if(outDeg[e.from]!==undefined) outDeg[e.from]++; if(inDeg[e.to]!==undefined) inDeg[e.to]++; });
      // Nœuds avec exactement 1 entrée et 1 sortie = maillon de pipeline
      const links = nodes.filter(n => outDeg[n.id] === 1 && inDeg[n.id] <= 1);
      return links.length >= 2;
    },
  },
  {
    name : 'Strategy',
    match: (nodes) => {
      const orchestrators = nodes.filter(n => n.role === 'orchestrator');
      return orchestrators.some(o => o.params.some(p => p.toLowerCase().includes('strategy') || p.toLowerCase().includes('handler') || p.toLowerCase().includes('fn')));
    },
  },
  {
    name : 'Decorator/HOF',
    // Higher-order function: takes a function param AND returns a function (closure pattern)
    match: (nodes) => nodes.some(n =>
      n.params.length >= 1 &&
      n.role === 'factory' &&
      n.calls.length >= 1 &&
      nodes.some(inner => inner.id !== n.id && inner.kind === 'closure' &&
        (inner.calls.some(c => n.calls.includes(c)) || inner.reads.some(r => n.params.includes(r)))
      )
    ),
  },
  {
    name : 'Memoization',
    match: (nodes) => nodes.some(n =>
      (n.reads.some(r => r.toLowerCase().includes('cache') || r.toLowerCase().includes('memo') || r.toLowerCase().includes('map')) &&
       n.effects.length === 0)
    ),
  },
  {
    name : 'Builder',
    match: (nodes, edges) => {
      const chains = nodes.filter(n => n.effects.length === 0 && n.calls.length >= 2 && n.role === 'factory');
      return chains.length >= 3;
    },
  },
  {
    name : 'Recursive Descent',
    match: (nodes, edges) => {
      return edges.some(e => e.from === e.to);
    },
  },
];

function detectDesignPatterns(nodes, edges) {
  return DESIGN_PATTERNS
    .filter(p => p.match(nodes, edges))
    .map(p => p.name);
}

// ─── Analyse des flux de données ──────────────────────────────────
function analyzeDataFlows(nodes, edges, adjacency) {
  const flows = [];

  // Suivi de propagation : variable produite par A → consommée par B
  for (const node of nodes) {
    for (const written of node.writes) {
      const consumers = nodes.filter(n => n.id !== node.id && n.reads.includes(written));
      if (consumers.length > 0)
        flows.push({ from: node.id, variable: written, to: consumers.map(c => c.id) });
    }
  }

  // Chaînes de transformations (A retourne → B consomme via appel)
  const chains = [];
  for (const [from, callees] of Object.entries(adjacency)) {
    for (const to of callees) {
      const chain = [from];
      let current = to;
      const visited = new Set([from]);
      while (current && !visited.has(current)) {
        chain.push(current);
        visited.add(current);
        current = (adjacency[current] || [])[0];
      }
      if (chain.length >= 3) chains.push(chain);
    }
  }

  // Dédoublonne les chaînes
  const uniqueChains = [];
  const seen = new Set();
  for (const c of chains) {
    const key = c.join('→');
    if (!seen.has(key)) { seen.add(key); uniqueChains.push(c); }
  }

  return { variableFlows: flows, transformChains: uniqueChains.slice(0, 8) };
}

// ─── Analyse sémantique complète ─────────────────────────────────

/**
 * @param {{ nodes, edges, adjacency, metrics }} graph
 * @returns {{ enrichedNodes, designPatterns, dataFlows }}
 */
function analyzeSemantic(graph) {
  const { nodes, edges, adjacency, metrics } = graph;

  // Enrichit chaque nœud avec son rôle fonctionnel
  const enrichedNodes = nodes.map(node => {
    const { role, desc } = assignRole(node);
    return { ...node, role, roleDescription: desc };
  });

  // Détecte les patterns de conception à l'échelle du système
  const designPatterns = detectDesignPatterns(enrichedNodes, edges);

  // Analyse les flux de données
  const dataFlows = analyzeDataFlows(enrichedNodes, edges, adjacency);

  return { enrichedNodes, designPatterns, dataFlows };
}

module.exports = { analyzeSemantic };

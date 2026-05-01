'use strict';

/**
 * COUCHE 4 — INFÉRENCE D'INTENTION (3 niveaux)
 *
 * Locale       : ce que fait chaque fonction isolément
 * Intermédiaire: ce que fait chaque groupe cohérent de fonctions
 * Globale      : ce que fait le système entier
 *
 * Basé uniquement sur : structure, flux, dépendances, rôles.
 * Les noms sont utilisés uniquement comme signal de confirmation
 * JAMAIS comme source primaire d'inférence.
 */

// ─── Niveau 1 : intention locale ─────────────────────────────────

const LOCAL_INTENT_TEMPLATES = {
  'transformer'   : (n) => `Reçoit ${n.params.length} entrée(s) et produit une valeur transformée via ${describeTransforms(n.transforms)}`,
  'predicate'     : (n) => `Évalue ${n.complexity - 1} condition(s) et retourne un résultat booléen`,
  'aggregator'    : (n) => `Parcourt une collection et ${n.transforms.includes('arithmetic') ? 'calcule un agrégat numérique' : 'sélectionne ou réorganise des éléments'}`,
  'factory'       : (n) => `Construit et retourne une structure de données à partir de ${n.params.length} paramètre(s)`,
  'orchestrator'  : (n) => `Coordonne ${n.calls.length} appels de fonctions pour accomplir une tâche composite`,
  'io-handler'    : (n) => `Interagit avec ${describeEffects(n.effects)} — produit des effets de bord`,
  'async-handler' : (n) => `Gère un flux asynchrone${n.calls.length > 0 ? ` en coordonnant ${n.calls.length} opération(s)` : ''}`,
  'validator'     : (n) => `Vérifie ${n.complexity - 1} contrainte(s) et lève une erreur si elles ne sont pas satisfaites`,
  'iterator'      : (n) => `Parcourt séquentiellement une structure ${n.transforms.includes('arithmetic') ? 'en calculant sur chaque élément' : 'pour en extraire ou traiter des éléments'}`,
  'router'        : (n) => `Dirige le flux vers l'un de ${n.complexity - 1} chemins d'exécution selon des conditions`,
  'initializer'   : (n) => `Configure un état initial en définissant ${n.writes.length} variable(s)`,
  'pure-function' : (n) => `Calcule un résultat de manière déterministe depuis ${n.params.length} paramètre(s), sans effets de bord`,
  'middleware'    : (n) => `Intercepte une requête, applique une transformation et délègue au maillon suivant`,
  'event-handler' : (n) => `Réagit à un événement ${n.params[0] ? `("${n.params[0]}")` : 'externe'} et déclenche une réaction`,
  'generator-fn'  : (n) => `Génère une séquence de valeurs à la demande via ${n.complexity} point(s) de production`,
  'closure'       : (n) => `Capture un contexte externe et expose une opération${n.calls.length > 0 ? ` via ${n.calls.length} sous-appel(s)` : ''}`,
  'validator'     : (n) => `Contrôle l'intégrité de données selon ${n.complexity - 1} règle(s)`,
  'utility'       : (n) => `Réalise une opération technique de support (${describeTransforms(n.transforms) || 'logique interne'})`,
};

function describeTransforms(transforms) {
  const labels = {
    arithmetic  : 'calcul numérique',
    comparison  : 'comparaison',
    array_ops   : 'manipulation de tableau',
    string_ops  : 'traitement de chaîne',
    object_ops  : 'manipulation d\'objet',
    conditional : 'branchement conditionnel',
    iteration   : 'itération',
    recursion   : 'récursion',
  };
  return transforms.map(t => labels[t] || t).slice(0, 3).join(', ') || 'opérations génériques';
}

function describeEffects(effects) {
  const labels = {
    io      : 'le système de fichiers ou la console',
    network : 'le réseau',
    dom     : 'le DOM du navigateur',
    async   : 'des opérations asynchrones',
    mutation: 'des structures partagées (mutation)',
    throws  : 'un mécanisme de gestion d\'erreurs',
  };
  return effects.map(e => labels[e] || e).join(' et ') || 'un système externe';
}

function inferLocalIntent(node) {
  const template = LOCAL_INTENT_TEMPLATES[node.role];
  const base     = template ? template(node) : `Réalise une opération de type "${node.role}"`;

  const qualifiers = [];
  if (node.async)          qualifiers.push('de manière asynchrone');
  if (node.generator)      qualifiers.push('en mode générateur');
  if (node.complexity > 8) qualifiers.push(`avec une complexité élevée (${node.complexity} chemins)`)  ;
  if (node.nesting > 4)    qualifiers.push(`avec une imbrication profonde (${node.nesting} niveaux)`);

  return qualifiers.length > 0 ? `${base} — ${qualifiers.join(', ')}` : base;
}

// ─── Niveau 2 : intention intermédiaire (groupes) ─────────────────

function detectFunctionalGroups(nodes, adjacency) {
  const groups = [];
  const assigned = new Set();

  // Groupe 1 : composants fortement connectés (clusters)
  const fnNames = new Set(nodes.map(n => n.id));
  const visited = new Set();

  function bfs(startId) {
    const group = new Set();
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      if (group.has(id)) continue;
      group.add(id);
      for (const neighbor of (adjacency[id] || []))
        if (fnNames.has(neighbor) && !group.has(neighbor)) queue.push(neighbor);
    }
    return [...group];
  }

  for (const node of nodes) {
    if (assigned.has(node.id)) continue;
    const cluster = bfs(node.id);
    if (cluster.length >= 2) {
      cluster.forEach(id => assigned.add(id));
      const clusterNodes = nodes.filter(n => cluster.includes(n.id));
      groups.push({ ids: cluster, nodes: clusterNodes, type: 'cluster' });
    }
  }

  // Groupe 2 : fonctions isolées de même rôle
  const isolated = nodes.filter(n => !assigned.has(n.id));
  const byRole   = {};
  for (const n of isolated) {
    if (!byRole[n.role]) byRole[n.role] = [];
    byRole[n.role].push(n);
  }
  for (const [role, roleNodes] of Object.entries(byRole)) {
    if (roleNodes.length >= 2) {
      groups.push({ ids: roleNodes.map(n => n.id), nodes: roleNodes, type: 'role-group', role });
      roleNodes.forEach(n => assigned.add(n.id));
    }
  }

  // Singletons non assignés
  const singletons = nodes.filter(n => !assigned.has(n.id));
  for (const n of singletons) groups.push({ ids: [n.id], nodes: [n], type: 'singleton' });

  return groups;
}

const GROUP_INTENT_TEMPLATES = {
  cluster    : (group, roles) =>
    `Sous-système de ${group.ids.length} fonctions interdépendantes — ` +
    `rôles dominants : ${roles.slice(0, 3).join(', ')} — ` +
    `implémente probablement une fonctionnalité cohérente`,

  'role-group': (group, roles) =>
    `Ensemble de ${group.ids.length} fonctions de type "${group.role}" — ` +
    `variations ou spécialisations d'une même responsabilité`,

  singleton  : (group, roles) =>
    `Fonction autonome de type "${roles[0]}" — ` +
    `${group.nodes[0]?.roleDescription || 'opération indépendante'}`,
};

function inferGroupIntent(group) {
  const roles = group.nodes.map(n => n.role);
  const roleFreq = {};
  roles.forEach(r => { roleFreq[r] = (roleFreq[r] || 0) + 1; });
  const dominantRoles = Object.entries(roleFreq).sort((a, b) => b[1] - a[1]).map(([r]) => r);

  const template = GROUP_INTENT_TEMPLATES[group.type];
  return {
    ids    : group.ids,
    type   : group.type,
    intent : template ? template(group, dominantRoles) : `Groupe de fonctions (${group.type})`,
    roles  : dominantRoles,
  };
}

// ─── Niveau 3 : intention globale ────────────────────────────────

function inferGlobalIntent(structure, graph, semantic, groups) {
  const { functions, imports, exports, classes, entryPoints } = structure;
  const { metrics }                    = graph;
  const { designPatterns, enrichedNodes: nodes } = semantic; // rôles déjà assignés

  const signals = [];

  // Signal 1 : patterns de conception détectés
  if (designPatterns.length > 0)
    signals.push(`implémente les patterns : ${designPatterns.join(', ')}`);

  // Signal 2 : nature des effets de bord dominants
  const allEffects = nodes.flatMap(n => n.effects);
  const effectFreq = {};
  allEffects.forEach(e => { effectFreq[e] = (effectFreq[e] || 0) + 1; });
  const dominantEffect = Object.entries(effectFreq).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominantEffect === 'network') signals.push('orienté communication réseau');
  if (dominantEffect === 'io')      signals.push('orienté entrées/sorties système');
  if (dominantEffect === 'dom')     signals.push('orienté manipulation d\'interface utilisateur');

  // Signal 3 : rôles dominants
  const roleFreq = {};
  nodes.forEach(n => { roleFreq[n.role] = (roleFreq[n.role] || 0) + 1; });
  const topRoles = Object.entries(roleFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r);

  // Signal 4 : structure de sortie
  const hasDefaultExport = exports.some(e => e.kind === 'default');
  const hasCjsExport     = exports.some(e => e.kind === 'cjs');
  const isModule         = hasDefaultExport || hasCjsExport || exports.length > 0;

  // Signal 5 : présence de classes
  const hasClasses = classes.length > 0;
  const classInheritance = classes.filter(c => c.parent).length;

  // Signal 6 : complexité globale
  const isComplex = metrics.avgComplexity > 5 || metrics.maxCallDepth > 4;

  // Synthèse narrative
  const parts = [];

  if (hasClasses && classInheritance > 0)
    parts.push(`Système orienté objet avec ${classes.length} classe(s) (dont ${classInheritance} avec héritage)`);
  else if (hasClasses)
    parts.push(`Système à base de classes (${classes.length} classe(s))`);
  else
    parts.push(`Système fonctionnel (${nodes.length} fonction(s), pas de classe)`);

  if (isModule)
    parts.push(`expose une API publique (${exports.length} export(s))`);

  if (imports.length > 0)
    parts.push(`dépend de ${imports.length} module(s) externe(s)`);

  if (topRoles.length > 0)
    parts.push(`principalement composé de ${topRoles.join(', ')}`);

  if (signals.length > 0)
    parts.push(signals.join(' ; '));

  if (metrics.maxCallDepth > 0)
    parts.push(`profondeur d'appels max : ${metrics.maxCallDepth} niveau(x)`);

  if (isComplex)
    parts.push('complexité structurelle élevée');

  return {
    narrative    : parts.join(' — '),
    dominantRoles: topRoles,
    designPatterns,
    isModule,
    hasClasses,
    complexity   : isComplex ? 'high' : metrics.avgComplexity > 3 ? 'medium' : 'low',
    entryPoints  : entryPoints.map(e => e.type),
  };
}

// ─── Point d'entrée ──────────────────────────────────────────────

/**
 * @param {{ functions, classes, imports, exports, entryPoints }} structure
 * @param {{ nodes, edges, adjacency, metrics }}                  graph
 * @param {{ enrichedNodes, designPatterns, dataFlows }}          semantic
 * @returns {{ local, intermediate, global }}
 */
function inferIntent(structure, graph, semantic) {
  const { enrichedNodes, designPatterns, dataFlows } = semantic;

  // Niveau 1 — locale
  const local = enrichedNodes.map(node => ({
    id    : node.id,
    role  : node.role,
    intent: inferLocalIntent(node),
  }));

  // Niveau 2 — intermédiaire
  const groups       = detectFunctionalGroups(enrichedNodes, graph.adjacency);
  const intermediate = groups.map(g => inferGroupIntent(g));

  // Niveau 3 — globale
  const global = inferGlobalIntent(structure, graph, semantic, intermediate);

  return { local, intermediate, global };
}

module.exports = { inferIntent };

'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Détecteur de Logique Dupliquée v1.1    ║
 * ║                                                              ║
 * ║   v1.1 — Correctifs :                                       ║
 * ║     • Fonctions OOD (hors-distribution) explicitement       ║
 * ║       signalées et exclues des groupes de doublons          ║
 * ║     • compareFunctions() retourne le champ ood de chaque    ║
 * ║       côté + un flag global cannotCompare si l'un ou        ║
 * ║       l'autre est OOD                                       ║
 * ║     • detectDuplicates() inclut les fonctions exclues dans  ║
 * ║       un champ separé `oodFunctions` pour diagnostic       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const { predict } = require('./predictor');

// Confiance minimale pour que deux fonctions soient considérées logiquement équivalentes.
// En dessous de ce seuil ou si OOD → pas de doublon.
const SIMILARITY_THRESHOLD = 0.70;

/**
 * Analyse plusieurs fonctions JS et regroupe celles qui partagent
 * la même formule logique sous-jacente.
 *
 * Les fonctions hors-distribution (OOD) sont retournées séparément
 * dans `oodFunctions` — elles ne participent à aucun groupe.
 *
 * @param {Array<{name?: string, source: string}>} functions
 * @param {number} threshold — seuil de confiance [0..1]
 * @returns {Promise<{
 *   groups: Array<{formula, category, functions}>,
 *   oodFunctions: Array<{name, entropy, normalizedEntropy}>
 * }>}
 */
async function detectDuplicates(functions, threshold = SIMILARITY_THRESHOLD) {
  if (!functions || functions.length < 2)
    throw new Error('Au moins 2 fonctions sont requises pour la détection de doublons.');

  const analyzed    = [];
  const oodFunctions = [];

  for (const fn of functions) {
    const name = fn.name || `function_${analyzed.length + oodFunctions.length + 1}`;
    try {
      const predictions = await predict(fn.source, 1);
      const top = predictions[0];

      if (top.ood?.isOOD) {
        // Hors-distribution → exclue des comparaisons
        oodFunctions.push({
          name,
          normalizedEntropy: top.ood.normalizedEntropy,
          entropy          : top.ood.entropy,
          topLabel         : top.label,
          topConfidence    : top.confidence,
        });
        continue;
      }

      analyzed.push({
        name,
        source    : fn.source,
        formulaId : top.id,
        label     : top.label,
        category  : top.category,
        confidence: top.confidence,
        ood       : top.ood,
      });
    } catch (_) {
      analyzed.push({
        name,
        source    : fn.source,
        formulaId : null,
        label     : 'Analyse échouée',
        category  : 'unknown',
        confidence: 0,
        ood       : null,
      });
    }
  }

  // Regroupe par formulaId avec confiance >= seuil
  const groups = {};
  for (const fn of analyzed) {
    if (!fn.formulaId || fn.confidence < threshold * 100) continue;
    if (!groups[fn.formulaId])
      groups[fn.formulaId] = { formula: fn.label, category: fn.category, functions: [] };
    groups[fn.formulaId].functions.push({ name: fn.name, confidence: fn.confidence });
  }

  return {
    groups      : Object.values(groups).filter(g => g.functions.length >= 2),
    oodFunctions,
  };
}

/**
 * Version simplifiée : compare exactement 2 fonctions.
 *
 * Si l'une ou l'autre est OOD, `cannotCompare` est vrai — la comparaison
 * serait non fiable car le modèle n'a pas confiance en sa classification.
 *
 * @param {string} source1
 * @param {string} source2
 * @returns {Promise<{
 *   areDuplicates: boolean,
 *   cannotCompare: boolean,
 *   formula?: string,
 *   confidences: [number, number],
 *   formulaIds: [string, string],
 *   ood: [object, object]
 * }>}
 */
async function compareFunctions(source1, source2) {
  const [pred1, pred2] = await Promise.all([predict(source1, 1), predict(source2, 1)]);
  const top1 = pred1[0];
  const top2 = pred2[0];

  const cannotCompare = !!(top1.ood?.isOOD || top2.ood?.isOOD);

  const areDuplicates = !cannotCompare &&
                        top1.id === top2.id &&
                        top1.confidence >= SIMILARITY_THRESHOLD * 100 &&
                        top2.confidence >= SIMILARITY_THRESHOLD * 100;

  return {
    areDuplicates,
    cannotCompare,
    formula    : areDuplicates ? top1.label : null,
    confidences: [top1.confidence, top2.confidence],
    formulaIds : [top1.id, top2.id],
    ood        : [top1.ood, top2.ood],
    ...(cannotCompare && {
      oodReason: [
        top1.ood?.isOOD ? `source1 hors-distribution (entropie ${(top1.ood.normalizedEntropy * 100).toFixed(0)}%)` : null,
        top2.ood?.isOOD ? `source2 hors-distribution (entropie ${(top2.ood.normalizedEntropy * 100).toFixed(0)}%)` : null,
      ].filter(Boolean).join(' · '),
    }),
  };
}

module.exports = { detectDuplicates, compareFunctions, SIMILARITY_THRESHOLD };

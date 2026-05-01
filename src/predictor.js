'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Module d'Inférence v1.1                ║
 * ║                                                              ║
 * ║   v1.1 — Ajout :                                            ║
 * ║     • Détection hors-distribution (OOD) par entropie        ║
 * ║       entropy / log(numClasses) > 0.55 → flag isOOD         ║
 * ║     • Score d'entropie normalisé dans chaque prédiction     ║
 * ║                                                              ║
 * ║   API publique :                                             ║
 * ║     isModelReady()      → boolean                           ║
 * ║     loadModel()         → { model, meta }                   ║
 * ║     predict(source, k)  → prediction[]                      ║
 * ║     predictTop1(source) → prediction                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const tf   = require('./tf-setup');
const fs   = require('fs');
const path = require('path');

const { LogicLensModel } = require('./model');
const { encode }         = require('./ast-encoder');

const MODEL_DIR    = path.join(__dirname, '../models/logic-lens');
const WEIGHTS_PATH = path.join(MODEL_DIR, 'weights.json');
const META_PATH    = path.join(MODEL_DIR, 'meta.json');
const FORMULAS     = require('./formulas.json');

// Seuil d'entropie normalisée au-delà duquel la prédiction est considérée OOD.
// log(25) ≈ 3.22 nats = entropie max pour 25 classes uniformes.
// 0.55 = ~55% de l'entropie maximale → signal "confiance faible / hors distribution".
const OOD_ENTROPY_THRESHOLD = 0.55;

// ─── Singleton ───────────────────────────────────────────────────
let _model = null;
let _meta  = null;

function isModelReady() {
  return fs.existsSync(WEIGHTS_PATH) && fs.existsSync(META_PATH);
}

async function loadModel() {
  if (_model) return { model: _model, meta: _meta };

  if (!isModelReady()) {
    throw new Error(
      'Aucun modèle entraîné trouvé.\n' +
      '  → Lancez : npm run generate  puis  npm run train'
    );
  }

  _meta  = JSON.parse(fs.readFileSync(META_PATH,  'utf8'));
  _model = new LogicLensModel(_meta.numClasses, _meta.vocabSize, _meta.seqLen, _meta.config);
  _model.loadWeights(JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf8')));

  return { model: _model, meta: _meta };
}

// ─── Calcul d'entropie ───────────────────────────────────────────

/**
 * Entropie de Shannon sur un vecteur de probabilités (toutes classes).
 * @param {number[]} probs  — probabilités sommant à 1
 * @param {number}   numClasses
 * @returns {{ entropy: number, normalizedEntropy: number, isOOD: boolean }}
 */
function computeEntropy(probs, numClasses) {
  const maxEntropy = Math.log(numClasses);  // entropie d'une distribution uniforme
  const entropy    = -probs.reduce((acc, p) => acc + (p > 1e-12 ? p * Math.log(p) : 0), 0);
  const normalized = entropy / maxEntropy;
  return {
    entropy           : parseFloat(entropy.toFixed(4)),
    normalizedEntropy : parseFloat(normalized.toFixed(4)),
    isOOD             : normalized > OOD_ENTROPY_THRESHOLD,
  };
}

// ─── Prédiction ──────────────────────────────────────────────────

/**
 * Prédit les formules canoniques correspondant à un source JS.
 * Chaque résultat inclut un champ `ood` avec le score d'entropie.
 *
 * @param {string} source
 * @param {number} topK
 * @returns {Promise<Array<{rank, id, label, category, confidence, ood}>>}
 */
async function predict(source, topK = 3) {
  const { model, meta } = await loadModel();

  const tokens    = encode(source);
  const tokensTf  = tf.tensor2d([tokens], [1, meta.seqLen], 'int32');

  // Top-K pour l'affichage
  const { indices, probabilities } = model.predict(tokensTf, topK);

  // Toutes les classes pour l'entropie
  const { probabilities: allProbs } = model.predictAll(tokensTf);
  tokensTf.dispose();

  const oodInfo = computeEntropy(allProbs[0], meta.numClasses);

  return indices[0].map((classIdx, rank) => {
    const id      = meta.labelIndex[classIdx];
    const formula = FORMULAS.find(f => f.id === id) || { label: id, category: 'unknown' };
    return {
      rank      : rank + 1,
      id,
      label     : formula.label,
      category  : formula.category,
      confidence: parseFloat((probabilities[0][rank] * 100).toFixed(2)),
      ood       : oodInfo,
    };
  });
}

async function predictTop1(source) {
  const results = await predict(source, 1);
  return results[0];
}

module.exports = { predict, predictTop1, loadModel, isModelReady, computeEntropy, OOD_ENTROPY_THRESHOLD };

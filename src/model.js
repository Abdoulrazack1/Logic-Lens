'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Architecture Transformer v1.1          ║
 * ║                                                              ║
 * ║   Token IDs [batch, seqLen]                                 ║
 * ║     → Embedding + Positional Encoding (sinusoïdal)          ║
 * ║     → × numLayers (Multi-Head Attention + FFN + Norm)       ║
 * ║     → Masked Average Pooling → Dense → Softmax              ║
 * ║                                                              ║
 * ║   v1.1 — Correctifs :                                       ║
 * ║     • Masque de padding dans l'attention (PAD_ID = 0)       ║
 * ║     • Pooling moyen masqué (tokens réels uniquement)        ║
 * ║     • Validation des formes de tenseurs au chargement       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const tf = require('./tf-setup');

const MODEL_CONFIG = {
  embedDim    : 64,
  numHeads    : 4,
  ffnDim      : 128,
  numLayers   : 4,
  learningRate: 5e-4,
  epochs      : 500,
  batchSize   : 128,
};

const PAD_ID = 0; // doit correspondre à ast-encoder.js

// ─── Positional Encoding sinusoïdal (fixe) ───────────────────────
function buildPositionalEncoding(seqLen, embedDim) {
  const pe = [];
  for (let pos = 0; pos < seqLen; pos++) {
    const row = [];
    for (let i = 0; i < embedDim; i++) {
      const angle = pos / Math.pow(10000, (2 * Math.floor(i / 2)) / embedDim);
      row.push(i % 2 === 0 ? Math.sin(angle) : Math.cos(angle));
    }
    pe.push(row);
  }
  return tf.tensor2d(pe); // [seqLen, embedDim]
}

// ─── Attention scalée ────────────────────────────────────────────
// mask : [batch*numHeads, 1, seqLen] — 0 sur réels, -1e9 sur PAD
function scaledDotProductAttention(Q, K, V, mask = null) {
  const headDim = Q.shape[Q.shape.length - 1];
  let scores = tf.matMul(Q, K, false, true).div(tf.scalar(Math.sqrt(headDim)));
  if (mask !== null) scores = scores.add(mask);
  return tf.matMul(tf.softmax(scores, -1), V);
}

// ─── Multi-Head Self-Attention ───────────────────────────────────
function createMultiHeadAttention(embedDim, numHeads, name) {
  if (embedDim % numHeads !== 0)
    throw new Error(`embedDim (${embedDim}) doit être divisible par numHeads (${numHeads})`);
  const headDim = embedDim / numHeads;
  const Wq = tf.variable(tf.randomNormal([embedDim, embedDim], 0, 0.02), true, `${name}/Wq`);
  const Wk = tf.variable(tf.randomNormal([embedDim, embedDim], 0, 0.02), true, `${name}/Wk`);
  const Wv = tf.variable(tf.randomNormal([embedDim, embedDim], 0, 0.02), true, `${name}/Wv`);
  const Wo = tf.variable(tf.randomNormal([embedDim, embedDim], 0, 0.02), true, `${name}/Wo`);
  const variables = [Wq, Wk, Wv, Wo];

  function call(x, paddingMask = null) {
    const [batch, seqLen] = [x.shape[0], x.shape[1]];
    const flat = x.reshape([-1, embedDim]);
    const Q = tf.matMul(flat, Wq).reshape([batch, seqLen, numHeads, headDim]);
    const K = tf.matMul(flat, Wk).reshape([batch, seqLen, numHeads, headDim]);
    const V = tf.matMul(flat, Wv).reshape([batch, seqLen, numHeads, headDim]);
    const Qt = Q.transpose([0, 2, 1, 3]).reshape([batch * numHeads, seqLen, headDim]);
    const Kt = K.transpose([0, 2, 1, 3]).reshape([batch * numHeads, seqLen, headDim]);
    const Vt = V.transpose([0, 2, 1, 3]).reshape([batch * numHeads, seqLen, headDim]);

    // paddingMask : [batch, seqLen], 1=réel, 0=PAD
    // → masque d'attention : [batch*numHeads, 1, seqLen], réel=0, PAD=-1e9
    let attnMask = null;
    if (paddingMask !== null) {
      attnMask = paddingMask
        .reshape([batch, 1, 1, seqLen])
        .tile([1, numHeads, 1, 1])
        .reshape([batch * numHeads, 1, seqLen])
        .mul(tf.scalar(-1)).add(tf.scalar(1))   // 1-mask : réel→0, PAD→1
        .mul(tf.scalar(-1e9));                   // réel→0, PAD→-1e9
    }

    const out = scaledDotProductAttention(Qt, Kt, Vt, attnMask)
      .reshape([batch, numHeads, seqLen, headDim])
      .transpose([0, 2, 1, 3])
      .reshape([batch, seqLen, embedDim]);
    return tf.matMul(out.reshape([-1, embedDim]), Wo).reshape([batch, seqLen, embedDim]);
  }
  return { call, variables };
}

// ─── Feed-Forward ────────────────────────────────────────────────
function createFeedForward(embedDim, ffnDim, name) {
  const W1 = tf.variable(tf.randomNormal([embedDim, ffnDim], 0, 0.02), true, `${name}/W1`);
  const b1 = tf.variable(tf.zeros([ffnDim]),                           true, `${name}/b1`);
  const W2 = tf.variable(tf.randomNormal([ffnDim, embedDim], 0, 0.02), true, `${name}/W2`);
  const b2 = tf.variable(tf.zeros([embedDim]),                         true, `${name}/b2`);
  const variables = [W1, b1, W2, b2];

  function call(x) {
    const [batch, seqLen] = [x.shape[0], x.shape[1]];
    const h = tf.relu(x.reshape([-1, embedDim]).matMul(W1).add(b1));
    return h.matMul(W2).add(b2).reshape([batch, seqLen, embedDim]);
  }
  return { call, variables };
}

// ─── Layer Norm ──────────────────────────────────────────────────
function createLayerNorm(embedDim, name) {
  const gamma = tf.variable(tf.ones([embedDim]),  true, `${name}/gamma`);
  const beta  = tf.variable(tf.zeros([embedDim]), true, `${name}/beta`);
  const variables = [gamma, beta];

  function call(x) {
    const mean = x.mean(-1, true);
    const std  = x.sub(mean).square().mean(-1, true).add(1e-6).sqrt();
    return x.sub(mean).div(std).mul(gamma).add(beta);
  }
  return { call, variables };
}

// ─── Bloc Transformer ────────────────────────────────────────────
function createTransformerBlock(embedDim, numHeads, ffnDim, index) {
  const attn  = createMultiHeadAttention(embedDim, numHeads, `attn_${index}`);
  const ffn   = createFeedForward(embedDim, ffnDim, `ffn_${index}`);
  const norm1 = createLayerNorm(embedDim, `norm1_${index}`);
  const norm2 = createLayerNorm(embedDim, `norm2_${index}`);
  const variables = [...attn.variables, ...ffn.variables, ...norm1.variables, ...norm2.variables];

  function call(x, paddingMask = null) {
    const x1 = norm1.call(x.add(attn.call(x, paddingMask)));
    return norm2.call(x1.add(ffn.call(x1)));
  }
  return { call, variables };
}

// ─── Modèle Logic-Lens ───────────────────────────────────────────
class LogicLensModel {
  constructor(numClasses, vocabSize, seqLen, config = MODEL_CONFIG) {
    this.numClasses = numClasses;
    this.vocabSize  = vocabSize;
    this.seqLen     = seqLen;
    this.config     = config;
    const { embedDim, numHeads, ffnDim, numLayers } = config;

    this.embedding   = tf.variable(tf.randomNormal([vocabSize, embedDim], 0, 0.02), true, 'embedding');
    this.posEncoding = buildPositionalEncoding(seqLen, embedDim);
    this.blocks      = Array.from({ length: numLayers }, (_, i) =>
      createTransformerBlock(embedDim, numHeads, ffnDim, i)
    );
    this.Wout = tf.variable(tf.randomNormal([embedDim, numClasses], 0, 0.02), true, 'Wout');
    this.bout = tf.variable(tf.zeros([numClasses]), true, 'bout');

    this.trainableVariables = [
      this.embedding,
      ...this.blocks.flatMap(b => b.variables),
      this.Wout,
      this.bout,
    ];
  }

  forward(tokenIds) {
    return tf.tidy(() => {
      // Masque : 1 = token réel, 0 = PAD
      const paddingMask = tokenIds.cast('int32')
        .notEqual(tf.scalar(PAD_ID, 'int32'))
        .cast('float32');                              // [batch, seqLen]

      let x = tf.gather(this.embedding, tokenIds.cast('int32')).add(this.posEncoding);
      for (const block of this.blocks) x = block.call(x, paddingMask);

      // Pooling moyen masqué — exclut les positions PAD
      const maskExp    = paddingMask.expandDims(2);                   // [batch, seqLen, 1]
      const maskedX    = x.mul(maskExp);
      const tokenCount = maskExp.sum(1).clipByValue(1, this.seqLen);  // [batch, 1]
      const pooled     = maskedX.sum(1).div(tokenCount);              // [batch, embedDim]

      return pooled.matMul(this.Wout).add(this.bout);
    });
  }

  predict(tokenIds, topK = 3) {
    return tf.tidy(() => {
      const probs = tf.softmax(this.forward(tokenIds));
      const { values, indices } = tf.topk(probs, topK);
      return { probabilities: values.arraySync(), indices: indices.arraySync() };
    });
  }

  /**
   * Retourne toutes les probabilités des numClasses classes.
   * Utilisé pour le calcul d'entropie (détection hors-distribution).
   */
  predictAll(tokenIds) {
    return tf.tidy(() => {
      const probs = tf.softmax(this.forward(tokenIds));
      const { values, indices } = tf.topk(probs, this.numClasses);
      return { probabilities: values.arraySync(), indices: indices.arraySync() };
    });
  }

  async serializeWeights() {
    const out = {};
    for (const v of this.trainableVariables) out[v.name] = await v.array();
    return out;
  }

  /**
   * Charge les poids depuis un objet sérialisé.
   * Valide les formes de tenseurs — lève une erreur en cas d'incompatibilité.
   */
  loadWeights(weights) {
    const mismatches = [];
    const missing    = [];

    for (const v of this.trainableVariables) {
      if (weights[v.name] === undefined) {
        missing.push(v.name);
        continue;
      }
      const loaded = tf.tensor(weights[v.name]);
      const shapeOk = v.shape.length === loaded.shape.length &&
                      v.shape.every((dim, i) => dim === loaded.shape[i]);
      if (!shapeOk) {
        mismatches.push(`  • "${v.name}" : attendu [${v.shape}], reçu [${loaded.shape}]`);
        loaded.dispose();
        continue;
      }
      v.assign(loaded);
      loaded.dispose();
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Incompatibilité de poids — rechargez un modèle entraîné avec cette architecture :\n` +
        mismatches.join('\n')
      );
    }
    if (missing.length > 0) {
      console.warn(
        `[LogicLens] Poids absents (conservés aléatoires) :\n` +
        missing.map(n => `  • ${n}`).join('\n')
      );
    }
  }
}

module.exports = { LogicLensModel, MODEL_CONFIG, buildPositionalEncoding };

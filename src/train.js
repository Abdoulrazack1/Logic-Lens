'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Script d'Entraînement v1.1             ║
 * ║                                                              ║
 * ║   v1.1 — Correctifs :                                       ║
 * ║     • runTraining(opts) — API explicite, plus de            ║
 * ║       couplage via process.argv                             ║
 * ║     • meta.json versionné : hash de configuration          ║
 * ║       (embedDim, numLayers, vocabSize, seqLen)              ║
 * ║       pour détecter les incompatibilités modèle/poids       ║
 * ║     • Lecture CLI conservée pour node src/train.js direct   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const tf   = require('./tf-setup');
const fs   = require('fs');
const path = require('path');

const chalk       = require('chalk');
const cliProgress = require('cli-progress');

const { LogicLensModel, MODEL_CONFIG } = require('./model');
const { VOCAB_SIZE, MAX_SEQ_LEN }      = require('./ast-encoder');

const DATASET_PATH    = path.join(__dirname, '../data/training-dataset.json');
const MODEL_DIR       = path.join(__dirname, '../models/logic-lens');
const CHECKPOINT_PATH = path.join(MODEL_DIR, 'checkpoint.json');
const CHECKPOINT_EVERY = 5;

// ─── Hash de configuration ───────────────────────────────────────
// Permet de détecter qu'un weights.json a été produit par une architecture
// différente de celle actuellement chargée (embedDim, numLayers changés…).
function buildConfigHash(config, vocabSize, seqLen) {
  const key = [
    config.embedDim,
    config.numLayers,
    config.numHeads,
    config.ffnDim,
    vocabSize,
    seqLen,
  ].join(':');
  // Hash djb2 simple — déterministe, pas besoin de crypto
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h) ^ key.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ─── Bannière ────────────────────────────────────────────────────
function printBanner(epochs, lr) {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('   🔭  LOGIC-LENS — Entraînement Transformer v1.1') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   Encoder AST → Classification de formules       ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray(`  Epochs        : ${epochs}`));
  console.log(chalk.gray(`  Learning rate : ${lr}`));
  console.log('');
}

function printSection(title) {
  console.log(chalk.cyan(`\n  ┌─ ${title} ${'─'.repeat(Math.max(0, 44 - title.length))}`));
}

// ─── Chargement du dataset ───────────────────────────────────────
function loadDataset() {
  if (!fs.existsSync(DATASET_PATH))
    throw new Error(`Dataset introuvable : ${DATASET_PATH}\n  → Lancez d'abord : npm run generate`);
  const raw = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  console.log(chalk.green(`  ✓ ${raw.samples.length} samples chargés`));
  console.log(chalk.gray(`  ├─ ${raw.labelIndex.length} classes`));
  console.log(chalk.gray(`  ├─ Vocab size : ${raw.vocabSize}`));
  console.log(chalk.gray(`  └─ Seq length : ${raw.seqLen}`));
  return raw;
}

// ─── Tenseurs ─────────────────────────────────────────────────────
function buildTensors(samples, labelIndex, seqLen) {
  const shuffled = [...samples].sort(() => Math.random() - 0.5);
  const splitAt  = Math.floor(shuffled.length * 0.9);
  const toTensors = (set) => ({
    tokens: tf.tensor2d(set.map(s => s.tokens), [set.length, seqLen], 'int32'),
    labels: tf.tensor1d(set.map(s => labelIndex.indexOf(s.label)), 'int32'),
    size  : set.length,
  });
  return { train: toTensors(shuffled.slice(0, splitAt)), val: toTensors(shuffled.slice(splitAt)) };
}

// ─── Métriques ────────────────────────────────────────────────────
function crossEntropyLoss(logits, labels, numClasses) {
  return tf.tidy(() => {
    const oneHot  = tf.oneHot(labels, numClasses).cast('float32');
    const logProb = tf.logSoftmax(logits);
    return oneHot.mul(logProb).sum(-1).neg().mean();
  });
}

function computeAccuracy(logits, labels) {
  return tf.tidy(() =>
    logits.argMax(-1).equal(labels).cast('float32').mean().dataSync()[0]
  );
}

function* miniBatchIter(tokens, labels, batchSize) {
  const n = tokens.shape[0];
  for (let start = 0; start < n; start += batchSize) {
    const end = Math.min(start + batchSize, n);
    yield {
      batchTokens: tokens.slice([start, 0], [end - start, -1]),
      batchLabels: labels.slice(start, end - start),
    };
  }
}

// ─── Checkpoint ──────────────────────────────────────────────────
async function saveCheckpoint(epoch, bestValAcc, bestWeights, history, totalEpochs, lr, configHash) {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({
    epoch, totalEpochs, lr, bestValAcc, history, configHash,
    savedAt: new Date().toISOString(), weights: bestWeights,
  }), 'utf8');
  if (bestWeights)
    fs.writeFileSync(path.join(MODEL_DIR, 'weights.json'), JSON.stringify(bestWeights), 'utf8');
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8')); }
  catch { return null; }
}

// ─── Sauvegarde d'urgence ─────────────────────────────────────────
let emergencySaveCallback = null;

['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(sig => {
  process.on(sig, async () => {
    console.log(chalk.yellow(`\n  ⚡ ${sig} reçu — sauvegarde d'urgence…`));
    if (emergencySaveCallback) await emergencySaveCallback();
    process.exit(0);
  });
});

// ─── Boucle d'entraînement (API publique) ─────────────────────────
/**
 * @param {{ epochs?: number, learningRate?: number }} opts
 */
async function runTraining(opts = {}) {
  const EPOCHS     = opts.epochs       || MODEL_CONFIG.epochs;
  const LR         = opts.learningRate || MODEL_CONFIG.learningRate;
  const BATCH_SIZE = MODEL_CONFIG.batchSize;

  printBanner(EPOCHS, LR);

  printSection('Chargement du Dataset');
  const raw = loadDataset();
  const { samples, labelIndex } = raw;
  const numClasses = labelIndex.length;
  const seqLen     = raw.seqLen    || MAX_SEQ_LEN;
  const vocabSize  = raw.vocabSize || VOCAB_SIZE;

  printSection('Préparation des Tenseurs');
  const { train: trainData, val: valData } = buildTensors(samples, labelIndex, seqLen);
  console.log(chalk.green(`  ✓ Train : ${trainData.size} | Val : ${valData.size}`));

  printSection('Architecture du Modèle');
  const config    = { ...MODEL_CONFIG, learningRate: LR, epochs: EPOCHS };
  const configHash = buildConfigHash(config, vocabSize, seqLen);
  const model     = new LogicLensModel(numClasses, vocabSize, seqLen, config);
  const optimizer = tf.train.adam(LR);

  console.log(chalk.green('  ✓ Transformer Encoder'));
  console.log(chalk.gray(`  ├─ Embedding      : ${vocabSize} → ${config.embedDim}`));
  console.log(chalk.gray(`  ├─ Blocs          : ${config.numLayers} × (MHA ${config.numHeads} heads + FFN ${config.ffnDim})`));
  console.log(chalk.gray(`  ├─ GAP masqué → Dense(${config.embedDim} → ${numClasses}) → Softmax`));
  console.log(chalk.gray(`  ├─ Optimizer      : Adam (lr=${LR})`));
  console.log(chalk.gray(`  ├─ Variables      : ${model.trainableVariables.length}`));
  console.log(chalk.gray(`  └─ Config hash    : ${configHash}`));

  // ─── Reprise depuis checkpoint ────────────────────────────────
  let startEpoch    = 1;
  let bestValAcc    = 0;
  let bestWeights   = null;
  let patienceCount = 0;
  let lastValAcc    = 0;
  const history     = { loss: [], acc: [], valAcc: [] };

  const chk = loadCheckpoint();
  if (chk && chk.totalEpochs === EPOCHS && chk.configHash === configHash) {
    printSection('Reprise depuis checkpoint');
    console.log(chalk.green(`  ✓ Reprise à l'epoch ${chk.epoch + 1}/${EPOCHS}`));
    console.log(chalk.gray(`  ├─ Sauvegardé le : ${new Date(chk.savedAt).toLocaleString('fr-FR')}`));
    console.log(chalk.gray(`  └─ Meilleure val acc : ${(chk.bestValAcc * 100).toFixed(2)}%`));
    startEpoch  = chk.epoch + 1;
    bestValAcc  = chk.bestValAcc;
    bestWeights = chk.weights;
    lastValAcc  = chk.bestValAcc;
    Object.assign(history, chk.history);
    if (bestWeights) model.loadWeights(bestWeights);
  } else if (chk) {
    const reason = chk.configHash !== configHash
      ? `architecture différente (hash ${chk.configHash} vs ${configHash})`
      : `epochs différentes (${chk.totalEpochs} vs ${EPOCHS})`;
    console.log(chalk.yellow(`\n  ⚠  Checkpoint ignoré : ${reason}`));
  }

  printSection(`Entraînement (${EPOCHS} epochs)`);
  console.log(chalk.gray(`  💾 Checkpoint automatique toutes les ${CHECKPOINT_EVERY} epochs\n`));

  const bar = new cliProgress.SingleBar({
    format         : `  {bar} {percentage}% | Epoch {value}/{total} | Loss: {loss} | Acc: {acc}% | Val: {valAcc}%`,
    barCompleteChar  : '█',
    barIncompleteChar: '░',
    hideCursor       : true,
    clearOnComplete  : false,
  });
  bar.start(EPOCHS, startEpoch - 1, { loss: '—', acc: '—', valAcc: lastValAcc > 0 ? (lastValAcc * 100).toFixed(1) : '—' });

  const PATIENCE  = 80;
  const VAL_EVERY = 10;

  emergencySaveCallback = async () => {
    bar.stop();
    if (bestWeights) {
      await saveCheckpoint(startEpoch - 1, bestValAcc, bestWeights, history, EPOCHS, LR, configHash);
      console.log(chalk.green('  ✓ Sauvegarde d\'urgence → models/logic-lens/checkpoint.json'));
    } else {
      console.log(chalk.yellow('  ⚠  Aucun poids à sauvegarder.'));
    }
  };

  for (let epoch = startEpoch; epoch <= EPOCHS; epoch++) {
    let epochLoss = 0, epochAcc = 0, steps = 0;

    for (const { batchTokens, batchLabels } of miniBatchIter(trainData.tokens, trainData.labels, BATCH_SIZE)) {
      let batchAcc = 0;
      const loss = optimizer.minimize(() => {
        const logits = model.forward(batchTokens);
        batchAcc = computeAccuracy(logits, batchLabels);
        tf.dispose(logits);
        return crossEntropyLoss(logits, batchLabels, numClasses);
      }, true, model.trainableVariables);

      epochLoss += loss.dataSync()[0];
      epochAcc  += batchAcc;
      steps++;
      tf.dispose(loss);
      batchTokens.dispose();
      batchLabels.dispose();
    }

    let valAcc = lastValAcc;
    if (epoch % VAL_EVERY === 0 || epoch === EPOCHS) {
      const valLogits = model.forward(valData.tokens);
      valAcc     = computeAccuracy(valLogits, valData.labels);
      lastValAcc = valAcc;
      tf.dispose(valLogits);
    }

    const avgLoss = (epochLoss / steps).toFixed(4);
    const avgAcc  = ((epochAcc / steps) * 100).toFixed(1);
    const vAcc    = (valAcc * 100).toFixed(1);

    history.loss.push(parseFloat(avgLoss));
    history.acc.push(parseFloat(avgAcc));
    history.valAcc.push(parseFloat(vAcc));

    bar.update(epoch, { loss: avgLoss, acc: avgAcc, valAcc: vAcc });

    if (epoch % VAL_EVERY === 0 || epoch === EPOCHS) {
      if (valAcc > bestValAcc) { bestValAcc = valAcc; bestWeights = await model.serializeWeights(); patienceCount = 0; }
      else { patienceCount++; }
    }

    if (epoch % CHECKPOINT_EVERY === 0 && bestWeights)
      await saveCheckpoint(epoch, bestValAcc, bestWeights, history, EPOCHS, LR, configHash);

    if (patienceCount >= PATIENCE && epoch > EPOCHS * 0.3) {
      bar.stop();
      console.log(chalk.yellow(`\n  ⚡ Early stopping à l'epoch ${epoch} (patience ${PATIENCE})`));
      break;
    }
    startEpoch = epoch + 1;
  }

  bar.stop();
  emergencySaveCallback = null;

  printSection('Sauvegarde du Modèle');
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  fs.writeFileSync(path.join(MODEL_DIR, 'weights.json'), JSON.stringify(bestWeights), 'utf8');

  const meta = {
    version    : '1.1',
    trainedAt  : new Date().toISOString(),
    configHash,              // ← clé de compatibilité poids ↔ architecture
    numClasses,
    labelIndex,
    bestValAcc : `${(bestValAcc * 100).toFixed(2)}%`,
    config,
    vocabSize,
    seqLen,
    history    : {
      finalLoss  : history.loss.at(-1),
      finalAcc   : history.acc.at(-1),
      finalValAcc: history.valAcc.at(-1),
      epochs     : history.loss.length,
    },
  };

  fs.writeFileSync(path.join(MODEL_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);

  console.log(chalk.green('  ✓ Poids       → models/logic-lens/weights.json'));
  console.log(chalk.green('  ✓ Métadonnées → models/logic-lens/meta.json'));
  console.log(chalk.gray(`  └─ Meilleure val accuracy : ${(bestValAcc * 100).toFixed(2)}%`));
  console.log('');

  trainData.tokens.dispose();
  trainData.labels.dispose();
  valData.tokens.dispose();
  valData.labels.dispose();
}

module.exports = { runTraining };

// ─── Exécution directe : node src/train.js ────────────────────────
if (require.main === module) {
  const args   = process.argv.slice(2);
  const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 && args[i + 1] ? args[i + 1] : def; };
  runTraining({
    epochs      : parseInt(getArg('--epochs', MODEL_CONFIG.epochs), 10),
    learningRate: parseFloat(getArg('--lr', MODEL_CONFIG.learningRate)),
  }).catch(err => {
    console.error(chalk.red('\n  ❌ Entraînement échoué :'), err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Console UI v1.1                        ║
 * ║   v1.1 : affichage du score OOD (hors-distribution)        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const chalk = require('chalk');

const CATEGORY_BADGES = {
  algebra          : chalk.cyan('⟨ algèbre ⟩'),
  physics          : chalk.blue('⟨ physique ⟩'),
  statistics       : chalk.magenta('⟨ statistiques ⟩'),
  finance          : chalk.green('⟨ finance ⟩'),
  geometry         : chalk.cyan('⟨ géométrie ⟩'),
  algorithm        : chalk.yellow('⟨ algorithme ⟩'),
  neural_networks  : chalk.red('⟨ réseaux de neurones ⟩'),
  number_theory    : chalk.blue('⟨ théorie des nombres ⟩'),
  combinatorics    : chalk.magenta('⟨ combinatoire ⟩'),
  linear_algebra   : chalk.cyan('⟨ algèbre linéaire ⟩'),
  graphics         : chalk.green('⟨ graphisme ⟩'),
  utility          : chalk.gray('⟨ utilitaire ⟩'),
  sequence         : chalk.yellow('⟨ suite ⟩'),
  signal_processing: chalk.blue('⟨ traitement du signal ⟩'),
};

function getCategoryBadge(cat) {
  return CATEGORY_BADGES[cat] || chalk.gray(`⟨ ${cat} ⟩`);
}

function getColorForConfidence(pct) {
  if (pct >= 70) return chalk.cyan;
  if (pct >= 40) return chalk.blue;
  if (pct >= 20) return chalk.hex('#F59E0B');
  return chalk.hex('#FF6B6B');
}

function buildConfidenceBar(pct, width = 28) {
  const filled = Math.round((pct / 100) * width);
  const empty  = width - filled;
  return getColorForConfidence(pct)('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

/**
 * Affiche un indicateur OOD si l'entropie normalisée dépasse le seuil.
 */
function displayOODWarning(ood) {
  if (!ood || !ood.isOOD) return;
  console.log(
    chalk.yellow('  ⚠  Hors-distribution') +
    chalk.gray(` (entropie ${(ood.normalizedEntropy * 100).toFixed(0)}% — la fonction ne ressemble à aucune formule connue)`)
  );
  console.log('');
}

/**
 * Affiche le résultat d'analyse dans le terminal.
 * @param {Array<{rank, id, label, category, confidence, ood}>} predictions
 * @param {string} sourceSummary
 */
function displayResult(predictions, sourceSummary) {
  const top = predictions[0];
  console.log('');
  console.log(chalk.gray('  ' + '─'.repeat(60)));
  console.log(chalk.gray('  Source : ') + chalk.dim((sourceSummary || '').slice(0, 62)));
  console.log(chalk.gray('  ' + '─'.repeat(60)));
  console.log('');

  displayOODWarning(top.ood);

  console.log(chalk.cyan.bold('  FORMULE DÉTECTÉE'));
  console.log('');
  console.log('  ' + chalk.white.bold(top.label));
  console.log('  ' + getCategoryBadge(top.category));
  console.log('');
  console.log('  ' + buildConfidenceBar(top.confidence) + chalk.white(` ${top.confidence.toFixed(1)}%`));
  console.log('');

  if (predictions.length > 1) {
    console.log(chalk.gray('  ┌─ Alternatives ─────────────────────────────────────'));
    for (const p of predictions.slice(1)) {
      const medal = p.rank === 2 ? chalk.gray(' #2') : chalk.gray(' #3');
      const bar   = buildConfidenceBar(p.confidence, 16);
      console.log(
        chalk.gray('  │') + medal + '  ' +
        chalk.white(p.label.slice(0, 40).padEnd(40)) + ' ' +
        bar + chalk.gray(` ${p.confidence.toFixed(1)}%`)
      );
    }
    console.log(chalk.gray('  └' + '─'.repeat(59)));
  }
  console.log('');
}

function displayError(msg) {
  console.log('');
  console.log(chalk.red('  ✗ ') + chalk.white(msg));
  console.log('');
}

function displayModelNotReady() {
  console.log('');
  console.log(chalk.yellow('  ⚠  Aucun modèle entraîné détecté.'));
  console.log('');
  console.log('  Lancez ces commandes dans l\'ordre :');
  console.log('');
  console.log(chalk.white.bold('    npm run generate'));
  console.log(chalk.gray('      → génère le dataset (~7 525 paires mutées)'));
  console.log('');
  console.log(chalk.white.bold('    npm run train'));
  console.log(chalk.gray('      → entraîne le Transformer (500 epochs par défaut)'));
  console.log(chalk.gray('      → ou : node src/train.js --epochs 1000'));
  console.log('');
  console.log(chalk.white.bold('    node index.js analyze <fichier.js>'));
  console.log('');
}

module.exports = { displayResult, displayError, displayModelNotReady, buildConfidenceBar, getCategoryBadge };

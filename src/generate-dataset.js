'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Générateur de Dataset v1.0             ║
 * ║                                                              ║
 * ║   Moteur de mutation : génère N variantes mutées pour       ║
 * ║   chaque formule canonique (paires code muté → label).      ║
 * ║                                                              ║
 * ║   Mutations :                                               ║
 * ║     1. Renommage de variables                               ║
 * ║     2. Injection de bruit mort (dead code)                  ║
 * ║     3. Swap for ↔ while                                     ║
 * ║     4. Équivalences opérateurs (x*x ↔ Math.pow(x,2))       ║
 * ║     5. Extraction de variable intermédiaire                 ║
 * ║     6. Renommage d'accumulateur                             ║
 * ║                                                              ║
 * ║   Usage : node src/generate-dataset.js                      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const fs   = require('fs');
const path = require('path');
const chalk = require('chalk');

const { encode, VOCAB_SIZE, MAX_SEQ_LEN } = require('./ast-encoder');
const FORMULAS = require('./formulas.json');

// v1.1 : porté de 120 → 500 pour réduire le surapprentissage.
// 500 × 25 formules = 12 525 paires (+ 25 canoniques = 12 550 total).
const MUTATIONS_PER_FORMULA = 500;
const OUT_PATH = path.join(__dirname, '../data/training-dataset.json');

// ─── Pools de nommage ────────────────────────────────────────────
const PARAM_POOLS = [
  ['a', 'b', 'c', 'd', 'e', 'f'],
  ['p', 'q', 'r', 's', 't', 'u'],
  ['x', 'y', 'z', 'w', 'v', 'k'],
  ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
  ['val', 'num', 'data', 'input', 'arg', 'param'],
  ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'],
  ['foo', 'bar', 'baz', 'qux', 'quux', 'corge'],
  ['m', 'n', 'o', 'p', 'q', 'r'],
];

const ACCUM_NAMES  = ['sum', 'total', 'acc', 'result', 'out', 'ret', 'res', 'val', 'answer', 'tally'];
const TEMP_NAMES   = ['tmp', 'temp', 'aux', 'intermediate', 'partial', 'hold', 'step', 'interim'];
const LOOP_VARS    = ['i', 'j', 'k', 'idx', 'counter', 'pos', 'step', 'iter', 'cursor'];

const NOISE_SNIPPETS = [
  'const _unused = 0;\n',
  'if (false) { /* noop */ }\n',
  'let _noise = null; void _noise;\n',
  '/* logic-lens: variant */\n',
  'const _dummy = typeof undefined;\n',
  'for (let _k = 0; _k < 0; _k++) {}\n',
  'void 0;\n',
  'const _check = true;\n',
  'let _skip; void _skip;\n',
];

// ─── Utilitaires ─────────────────────────────────────────────────
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr)  { return arr[randomInt(0, arr.length - 1)]; }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function extractParams(source) {
  const match = source.match(/function\s+\w+\s*\(([^)]*)\)/);
  if (!match || !match[1].trim()) return [];
  return match[1].split(',').map(p => p.trim()).filter(Boolean);
}

// ─── Mutations ───────────────────────────────────────────────────

function mutateNames(source, params) {
  if (params.length === 0) return source;
  const pool = shuffle(pick(PARAM_POOLS));
  let result = source;
  params.forEach((p, i) => {
    if (!pool[i] || pool[i] === p) return;
    result = result.replace(new RegExp(`\\b${p}\\b`, 'g'), pool[i]);
  });
  return result;
}

function injectNoise(source) {
  const count   = randomInt(1, 3);
  const snippet = shuffle(NOISE_SNIPPETS).slice(0, count).join('');
  return source.replace(/{/, `{\n${snippet}`);
}

function swapForToWhile(source) {
  const loopVar = pick(LOOP_VARS);
  return source.replace(
    /for\s*\(\s*let\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*([<>]=?)\s*([^;]+)\s*;\s*\1\+\+\s*\)\s*\{/g,
    (_, v, init, op, limit) => {
      const newV = loopVar;
      return `let ${newV} = ${init};\nwhile (${newV} ${op} ${limit.trim()}) {\n${newV}++;`;
    }
  );
}

function squareToPow(source) {
  return source.replace(/(\w+)\s*\*\s*\1/g, (_, v) => `Math.pow(${v}, 2)`);
}

function powToSquare(source) {
  return source.replace(/Math\.pow\((\w+),\s*2\)/g, (_, v) => `${v} * ${v}`);
}

function extractIntermediate(source) {
  const tmp = pick(TEMP_NAMES);
  return source.replace(/return\s+([^;{}]+);/, `const ${tmp} = $1;\n  return ${tmp};`);
}

function renameAccumulator(source) {
  const knownAccums = ['sum', 'total', 'acc', 'result', 'out', 'res'];
  const newName = pick(ACCUM_NAMES);
  for (const old of knownAccums) {
    if (source.includes(` ${old}`) && old !== newName) {
      return source.replace(new RegExp(`\\b${old}\\b`, 'g'), newName);
    }
  }
  return source;
}

function renameFunctionName(source) {
  const names = ['compute', 'calculate', 'eval', 'process', 'run', 'execute', 'solve', 'derive', 'apply'];
  const newName = pick(names);
  return source.replace(/function\s+\w+\s*\(/, `function ${newName}(`);
}

function addReturnParens(source) {
  return source.replace(/return\s+([^;{}(][^;{}]*);/, 'return ($1);');
}

// Table de mutations pondérées
const MUTATIONS = [
  { fn: injectNoise,         weight: 0.90 },
  { fn: squareToPow,         weight: 0.45 },
  { fn: powToSquare,         weight: 0.45 },
  { fn: extractIntermediate, weight: 0.65 },
  { fn: renameAccumulator,   weight: 0.60 },
  { fn: swapForToWhile,      weight: 0.35 },
  { fn: renameFunctionName,  weight: 0.80 },
  { fn: addReturnParens,     weight: 0.40 },
];

function applyMutations(source, params) {
  let code = source;

  if (params.length > 0 && Math.random() < 0.88) {
    code = mutateNames(code, params);
  }

  const chosen = shuffle(MUTATIONS)
    .filter(m => Math.random() < m.weight)
    .slice(0, randomInt(1, 4));

  for (const { fn } of chosen) {
    try { code = fn(code); } catch (_) { /* mutation échouée — ignorée */ }
  }

  return code;
}

// ─── Génération ──────────────────────────────────────────────────

function printBanner() {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('   🧬  LOGIC-LENS — Générateur de Dataset v1.0  ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   Moteur de mutation AST — paires (code, label) ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  console.log('');
}

async function generate() {
  printBanner();
  console.log(chalk.gray(`  Formules              : ${FORMULAS.length}`));
  console.log(chalk.gray(`  Variantes / formule   : ${MUTATIONS_PER_FORMULA}`));
  console.log(chalk.gray(`  Total estimé          : ~${FORMULAS.length * (MUTATIONS_PER_FORMULA + 1)} paires`));
  console.log('');
  console.log(chalk.cyan('  ┌─ Mutation en cours ────────────────────────────'));

  const dataset    = [];
  const labelIndex = FORMULAS.map(f => f.id);

  for (const formula of FORMULAS) {
    const params = extractParams(formula.code);

    // Original non muté
    dataset.push({
      label    : formula.id,
      labelText: formula.label,
      category : formula.category,
      tokens   : encode(formula.code),
      source   : formula.code,
    });

    // Variantes mutées
    for (let i = 0; i < MUTATIONS_PER_FORMULA; i++) {
      const mutated = applyMutations(formula.code, params);
      dataset.push({
        label    : formula.id,
        labelText: formula.label,
        category : formula.category,
        tokens   : encode(mutated),
        source   : mutated,
      });
    }

    console.log(
      chalk.green('  │  ✓ ') +
      chalk.white(formula.id.padEnd(28)) +
      chalk.gray(`${MUTATIONS_PER_FORMULA + 1} samples`)
    );
  }

  console.log(chalk.cyan('  └────────────────────────────────────────────────'));

  // Distribution par catégorie
  const cats = {};
  for (const f of FORMULAS) cats[f.category] = (cats[f.category] || 0) + 1;

  console.log('');
  console.log(chalk.cyan('  ┌─ Distribution par catégorie ───────────────────'));
  for (const [cat, count] of Object.entries(cats)) {
    console.log(chalk.gray(`  │  ${cat.padEnd(22)} ${count} formule(s)`));
  }
  console.log(chalk.cyan('  └────────────────────────────────────────────────'));

  const output = {
    version             : '1.1',
    description         : 'Logic-Lens training dataset — paires (code muté, formule canonique)',
    generatedAt         : new Date().toISOString(),
    formulaCount        : FORMULAS.length,
    mutationsPerFormula : MUTATIONS_PER_FORMULA,
    totalSamples        : dataset.length,
    vocabSize           : VOCAB_SIZE,
    seqLen              : MAX_SEQ_LEN,
    labelIndex,
    categoryDistribution: cats,
    samples             : dataset,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');

  console.log('');
  console.log(chalk.green('  ✓ Dataset sauvegardé → data/training-dataset.json'));
  console.log(chalk.gray(`  ├─ ${dataset.length} samples`));
  console.log(chalk.gray(`  ├─ ${labelIndex.length} classes`));
  console.log(chalk.gray(`  ├─ Vocab size : ${VOCAB_SIZE}`));
  console.log(chalk.gray(`  └─ Seq len    : ${MAX_SEQ_LEN}`));
  console.log('');
}

generate().catch(err => {
  console.error(chalk.red('  ❌ Génération échouée :'), err.message);
  process.exit(1);
});

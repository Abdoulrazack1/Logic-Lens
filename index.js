#!/usr/bin/env node
'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           LOGIC-LENS v1.0 — CLI Principal                   ║
 * ║                                                              ║
 * ║   node index.js analyze <fichier.js>                        ║
 * ║   node index.js snippet "function f(x) { ... }"            ║
 * ║   node index.js url <https://...fichier.js>                 ║
 * ║   node index.js repo <https://github.com/owner/repo>       ║
 * ║   node index.js compare <f1.js> <f2.js>                    ║
 * ║   node index.js generate                                     ║
 * ║   node index.js train [--epochs 500] [--lr 0.0005]          ║
 * ║   node index.js demo                                         ║
 * ║   node index.js serve [--port 3000]                         ║
 * ║   node index.js bridge [--port 4000]                        ║
 * ║   node index.js status                                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const { Command } = require('commander');
const chalk = require('chalk');
const path  = require('path');
const fs    = require('fs');

const program = new Command();

// ─── Bannière ─────────────────────────────────────────────────────
function printBanner() {
  console.log('\n');
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║') + chalk.white.bold('         🔭  L O G I C - L E N S  v1.1          ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   Extraction de formules logiques par IA        ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ║') + chalk.gray('   Transformer Encoder sur séquences AST         ') + chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════╝'));
  console.log('');
}

// ─── CLI ──────────────────────────────────────────────────────────
program
  .name('logic-lens')
  .description('🔭 Extrait la formule logique ou l\'invariant mathématique d\'une fonction JavaScript')
  .version('1.1.0');

// ── analyze ───────────────────────────────────────────────────────
program
  .command('analyze <file>')
  .alias('a')
  .description('Analyser un fichier JS local')
  .option('-k, --top <n>', 'Nombre de prédictions', parseInt, 3)
  .action(async (file, opts) => {
    printBanner();
    const { analyzeFile } = require('./src/analyze');
    await analyzeFile(file, opts.top);
  });

// ── snippet ───────────────────────────────────────────────────────
program
  .command('snippet <code>')
  .alias('s')
  .description('Analyser un snippet de code inline')
  .option('-k, --top <n>', 'Nombre de prédictions', parseInt, 3)
  .action(async (code, opts) => {
    printBanner();
    const { analyzeSnippet } = require('./src/analyze');
    await analyzeSnippet(code, opts.top);
  });

// ── url ───────────────────────────────────────────────────────────
program
  .command('url <url>')
  .alias('u')
  .description('Analyser un fichier JS depuis une URL (GitHub, CDN…)')
  .option('-k, --top <n>',    'Nombre de prédictions', parseInt, 3)
  .option('--token <token>',  'GitHub Personal Access Token (fichiers de repos privés)')
  .action(async (url, opts) => {
    printBanner();
    const { analyzeUrl } = require('./src/analyze');
    await analyzeUrl(url, opts.top, opts.token || null);
  });

// ── repo ───────────────────────────────────────────────────────────
program
  .command('repo <url>')
  .alias('r')
  .description('Analyser un repo GitHub complet (tous les fichiers JS/TS)')
  .option('-k, --top <n>', 'Nombre de prédictions par fichier', parseInt, 3)
  .option('-c, --concurrency <n>', 'Nombre de fichiers en parallèle', parseInt, 5)
  .option('--token <token>', 'GitHub Personal Access Token (repos privés)')
  .action(async (url, opts) => {
    printBanner();
    const { analyzeRepo } = require('./src/analyze');
    await analyzeRepo(url, {
      topK       : opts.top,
      concurrency: opts.concurrency,
      token      : opts.token,
    });
  });


// ── compare ───────────────────────────────────────────────────────
program
  .command('compare <file1> <file2>')
  .alias('c')
  .description('Comparer deux fichiers JS — détecte si même logique sous-jacente')
  .action(async (file1, file2) => {
    printBanner();
    const { compareFunctions } = require('./src/duplicate-detector');
    const { isModelReady }     = require('./src/predictor');
    const { displayModelNotReady } = require('./src/ui');

    if (!isModelReady()) { displayModelNotReady(); return; }

    const r1 = path.resolve(file1);
    const r2 = path.resolve(file2);
    if (!fs.existsSync(r1)) { console.log(chalk.red(`  ✗ Fichier introuvable : ${r1}`)); return; }
    if (!fs.existsSync(r2)) { console.log(chalk.red(`  ✗ Fichier introuvable : ${r2}`)); return; }

    const src1 = fs.readFileSync(r1, 'utf8');
    const src2 = fs.readFileSync(r2, 'utf8');

    console.log(chalk.gray(`  Fichier 1 : ${r1}`));
    console.log(chalk.gray(`  Fichier 2 : ${r2}`));
    process.stdout.write(chalk.gray('  Comparaison…\r'));

    try {
      const result = await compareFunctions(src1, src2);
      process.stdout.write('                \r');
      if (result.areDuplicates) {
        console.log(chalk.green('  ✓ Logique identique détectée'));
        console.log(chalk.gray(`  ├─ Formule : ${result.formula}`));
        console.log(chalk.gray(`  ├─ Conf. 1 : ${result.confidences[0].toFixed(1)}%`));
        console.log(chalk.gray(`  └─ Conf. 2 : ${result.confidences[1].toFixed(1)}%`));
      } else {
        console.log(chalk.yellow('  ~ Logiques différentes ou confiance insuffisante'));
        console.log(chalk.gray(`  ├─ Formule 1 : ${result.formulaIds[0]} (${result.confidences[0].toFixed(1)}%)`));
        console.log(chalk.gray(`  └─ Formule 2 : ${result.formulaIds[1]} (${result.confidences[1].toFixed(1)}%)`));
      }
    } catch (err) {
      process.stdout.write('                \r');
      console.log(chalk.red(`  ✗ ${err.message}`));
    }
    console.log('');
  });

// ── generate ──────────────────────────────────────────────────────
program
  .command('generate')
  .alias('g')
  .description('Générer le dataset d\'entraînement (moteur de mutation)')
  .action(() => {
    require('./src/generate-dataset');
  });

// ── train ─────────────────────────────────────────────────────────
program
  .command('train')
  .alias('t')
  .description('Entraîner le Transformer Encoder')
  .option('-e, --epochs <n>', 'Nombre d\'epochs (défaut: 500)', parseInt, 500)
  .option('--lr <f>',         'Learning rate (défaut: 0.0005)', parseFloat, 5e-4)
  .action(async (opts) => {
    // v1.1 : passe la config explicitement — plus de couplage via process.argv
    const { runTraining } = require('./src/train');
    await runTraining({ epochs: opts.epochs, learningRate: opts.lr });
  });

// ── demo ──────────────────────────────────────────────────────────
program
  .command('demo')
  .alias('d')
  .description('Démonstration sur des fonctions obfusquées')
  .action(() => {
    require('./src/demo');
  });

// ── serve ─────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Démarrer le serveur API REST + interface web')
  .option('-p, --port <n>', 'Port', parseInt, 3000)
  .option('--host <h>',     'Hôte', '127.0.0.1')
  .action((opts) => {
    process.env.PORT = opts.port;
    process.env.HOST = opts.host;
    require('./server');
  });

// ── bridge ────────────────────────────────────────────────────────
program
  .command('bridge')
  .description('Démarrer le serveur Bridge (interopérabilité inter-moteurs)')
  .option('-p, --port <n>', 'Port bridge', parseInt, 4000)
  .option('--host <h>',     'Hôte bridge', '127.0.0.1')
  .action((opts) => {
    process.env.BRIDGE_PORT = opts.port;
    process.env.BRIDGE_HOST = opts.host;
    require('./bridge/bridge-server');
  });


// ── semantic ──────────────────────────────────────────────────────
program
  .command('semantic <file>')
  .alias('sem')
  .description('Analyse sémantique complète d\'un fichier JS (structure, graphe, intentions, qualité)')
  .option('--json',  'Sortie en JSON brut')
  .option('--short', 'Synthèse uniquement (section 6)')
  .action(async (file, opts) => {
    printBanner();
    const { analyze } = require('./src/semantic/synthesizer');
    const resolved = path.resolve(file);
    if (!require('fs').existsSync(resolved)) { console.error(`Fichier introuvable : ${resolved}`); process.exit(1); }
    const source = require('fs').readFileSync(resolved, 'utf8');
    console.log(chalk.gray(`  Analyse sémantique : ${resolved}\n`));
    const result = analyze(source, { short: opts.short });
    if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
    printSemanticReport(result, opts.short);
  });

program
  .command('semantic-url <url>')
  .alias('semurl')
  .description('Analyse sémantique d\'un fichier JS depuis une URL')
  .option('--token <token>', 'GitHub Personal Access Token')
  .option('--json',          'Sortie en JSON brut')
  .action(async (url, opts) => {
    printBanner();
    const https = require('https'), http = require('http');
    const { analyze } = require('./src/semantic/synthesizer');
    const rawUrl = url.includes('github.com') ? url.replace('github.com','raw.githubusercontent.com').replace('/blob/','/')  : url;
    console.log(chalk.gray(`  Téléchargement : ${rawUrl}`));
    const source = await new Promise((res, rej) => {
      const client = rawUrl.startsWith('https') ? https : http;
      const headers = { 'User-Agent': 'logic-lens/1.1' };
      if (opts.token) headers['Authorization'] = `token ${opts.token}`;
      client.get(rawUrl, { headers }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d)); }).on('error',rej);
    });
    const result = analyze(source);
    if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
    printSemanticReport(result, false);
  });

program
  .command('semantic-repo <url>')
  .alias('semrepo')
  .description('Analyse sémantique architecturale d\'un repo GitHub complet')
  .option('--token <token>',   'GitHub Personal Access Token')
  .option('--max-files <n>',   'Nombre max de fichiers', parseInt, 50)
  .option('--concurrency <n>', 'Parallélisme',           parseInt, 4)
  .option('--json',            'Sortie en JSON brut')
  .action(async (url, opts) => {
    printBanner();
    const { analyzeRepo } = require('./src/semantic/repo-analyzer');
    console.log(chalk.cyan(`  Analyse sémantique du repo : ${chalk.white(url)}\n`));
    const result = await analyzeRepo(url, {
      token: opts.token || null, concurrency: opts.concurrency, maxFiles: opts.maxFiles,
      onProgress: (done, total, file) => {
        const pct = Math.round(done/total*100);
        const bar = '█'.repeat(Math.round(pct/5))+'░'.repeat(20-Math.round(pct/5));
        const name = file.length>38?'…'+file.slice(-37):file.padEnd(38);
        process.stdout.write(`\r  [${bar}] ${pct}% | ${chalk.gray(name)}`);
      },
    });
    process.stdout.write('\n\n');
    if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
    printRepoSemanticReport(result);
  });

// ── helper : formatage console sémantique ─────────────────────────
function printSemanticReport(r, shortMode) {
  if (r.error) { console.error(chalk.red(`  ✗ ${r.error}`)); return; }
  const S = (n, t) => console.log(chalk.cyan(`\n  ╔═ ${n}. ${t} ${'═'.repeat(Math.max(0,46-t.length))}╗`));
  const L = (label, val) => console.log(chalk.gray('  │  ') + chalk.white((label+' ').padEnd(26,'·')) + ' ' + chalk.cyan(String(val)));
  const I = (txt) => console.log(chalk.gray('  │  • ') + txt);

  if (!shortMode) {
    S(1,'STRUCTURE DU PROGRAMME');
    const s = r['1_STRUCTURE'];
    L('Fonctions', s.modules.functions); L('Classes', s.modules.classes);
    L('Imports', s.modules.imports); L('Exports', s.modules.exports);
    if (s.entryPoints.length) L('Points d\'entrée', s.entryPoints.join(', '));
    console.log(chalk.gray('\n  │  Fonctions :'));
    s.functions.forEach(f => I(`${chalk.white(f.name.padEnd(26))} ${chalk.yellow(f.role.padEnd(18))} cx:${f.complexity}${f.async?' ⚡':''}`));

    S(2,'GRAPHE LOGIQUE');
    const g = r['2_GRAPHE_LOGIQUE'];
    L('Nœuds/Arêtes', `${g.metriques.noeuds} / ${g.metriques.arêtes}`);
    L('Profondeur max', g.metriques.profondeurMax);
    L('Complexité moy.', g.metriques.complexitéMoyenne);
    if (g.composantsCentraux.length) L('Hubs', g.composantsCentraux.join(', '));
    if (g.fluxCritiques.length) { console.log(chalk.gray('\n  │  Flux :')); g.fluxCritiques.forEach(f=>I(chalk.cyan(f))); }

    S(3,'ANALYSE SÉMANTIQUE');
    const sem = r['3_ANALYSE_SEMANTIQUE'];
    if (sem.patternsDetectés.length) L('Patterns', sem.patternsDetectés.join(', '));
    console.log(chalk.gray('\n  │  Rôles :'));
    sem.roles.forEach(n => I(`${chalk.white(n.fn.padEnd(26))} ${chalk.yellow(n.role.padEnd(16))} ${n.effects.length?chalk.red(n.effects.join(',')):chalk.green('pur')}`));

    S(4,'INTENTIONS');
    const int = r['4_INTENTIONS'];
    console.log(chalk.gray('\n  │  Locale :')); int.locale.forEach(l=>I(chalk.white(`${l.fn} `)+chalk.gray('— ')+l.intention));
    if (int.intermédiaire.length) { console.log(chalk.gray('\n  │  Intermédiaire :')); int.intermédiaire.forEach(g=>I(chalk.cyan(`[${g.groupe.join(', ')}] `)+chalk.gray('— ')+g.intention)); }
    console.log(chalk.gray('\n  │  Globale :')); I(chalk.white(int.globale.narrative));

    S(5,'ANALYSE DE QUALITÉ');
    const q = r['5_ANALYSE_QUALITE'];
    const sc = q.scoreGlobal>=80?chalk.green:q.scoreGlobal>=60?chalk.yellow:chalk.red;
    L('Score global', sc(`${q.scoreGlobal}/100`));
    L('Complexité', `${q.complexité.score}/100`); L('Couplage', `${q.couplage.score}/100`);
    L('Cohésion', `${q.cohésion.score}/100`); L('Dette', `${q.detteTechnique.score}/100 (${q.detteTechnique.estimationRefactoring})`);
    if (q.recommandations.length) { console.log(chalk.gray('\n  │  Recommandations :')); q.recommandations.forEach(rec=>I(chalk.yellow(rec))); }
  }

  S(6,'SYNTHÈSE FINALE');
  const syn = r['6_SYNTHESE_FINALE'];
  L('Architecture', syn.architectureImplicite); L('Score', syn.scoreQualité);
  console.log(chalk.gray('\n  │  Comportement :')); I(chalk.white(syn.comportementRéel));
  console.log(chalk.gray('\n  │  Intention :')); I(chalk.white(syn.intentionSystème));
  if (syn.patternsConception.length) { console.log(chalk.gray('\n  │  Patterns :')); syn.patternsConception.forEach(p=>I(chalk.cyan(p))); }
  if (syn.pointsFaiblesMajeurs.length) { console.log(chalk.gray('\n  │  Points faibles :')); syn.pointsFaiblesMajeurs.forEach(w=>I(chalk.red(w))); }
  console.log('');
}

function printRepoSemanticReport(result) {
  const a = result.aggregated;
  console.log(chalk.cyan('  ╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('  ║')+chalk.white.bold(`   📊  Rapport Sémantique — ${result.repo}`.padEnd(54))+chalk.cyan('║'));
  console.log(chalk.cyan('  ╚══════════════════════════════════════════════════════╝\n'));
  console.log(chalk.gray(`  Fichiers JS : ${result.totalFiles} · Analysés : ${a.filesAnalyzed} · Erreurs : ${a.filesError}`));
  const sc = a.avgQualityScore>=70?chalk.green:a.avgQualityScore>=50?chalk.yellow:chalk.red;
  console.log(chalk.gray(`  Score qualité moyen : `)+sc(`${a.avgQualityScore}/100\n`));
  console.log(chalk.cyan('  ┌─ Styles architecturaux ──────────────────────────────'));
  a.topStyles.forEach(({style,count})=>console.log(chalk.gray('  │  ')+chalk.white(`${count}×`.padEnd(5))+chalk.cyan(style)));
  console.log('');
  console.log(chalk.cyan('  ┌─ Patterns de conception ────────────────────────────'));
  a.topPatterns.length ? a.topPatterns.forEach(({pattern,files})=>console.log(chalk.gray('  │  ')+chalk.yellow(pattern.padEnd(30))+chalk.gray(`${files} fichier(s)`))) : console.log(chalk.gray('  │  Aucun'));
  console.log('');
  console.log(chalk.cyan('  ┌─ Rôles fonctionnels (top) ──────────────────────────'));
  const mx = a.topRoles[0]?.count||1;
  a.topRoles.forEach(({role,count})=>{const bar='█'.repeat(Math.round(count/mx*18));console.log(chalk.gray('  │  ')+chalk.white(role.padEnd(20))+chalk.cyan(bar.padEnd(20))+chalk.gray(`${count}`));});
  console.log('');
  console.log(chalk.cyan('  ┌─ Distribution de qualité ───────────────────────────'));
  const d=a.qualityDistribution;
  console.log(chalk.gray('  │  ')+chalk.green(`Excellent ≥80 : ${d.excellent}`)+chalk.gray('  ')+chalk.yellow(`Bon 60–79 : ${d.good}`)+chalk.gray('  ')+chalk.hex('#F59E0B')(`Moyen 40–59 : ${d.fair}`)+chalk.gray('  ')+chalk.red(`Faible <40 : ${d.poor}`));
  console.log('');
  if (a.topWeaknesses.length) {
    console.log(chalk.cyan('  ┌─ Points faibles récurrents ─────────────────────────'));
    a.topWeaknesses.forEach(({msg,count})=>console.log(chalk.gray('  │  ')+chalk.red(`×${count} `)+chalk.white(msg.slice(0,72))));
    console.log('');
  }
  console.log(chalk.cyan('  ┌─ Détail fichiers ───────────────────────────────────'));
  result.files.slice(0,25).forEach(f=>{
    const sc=f.quality!=null?(f.quality>=70?chalk.green:f.quality>=50?chalk.yellow:chalk.red)(`${f.quality}`):chalk.gray('—');
    const name=f.file.length>42?'…'+f.file.slice(-41):f.file.padEnd(42);
    console.log(chalk.gray('  │  ')+chalk.white(name)+sc+chalk.gray('  '+(f.roles||[]).slice(0,3).join(', ')));
  });
  if (result.files.length>25) console.log(chalk.gray(`  │  … et ${result.files.length-25} autres`));
  console.log('');
}

// ── status ────────────────────────────────────────────────────────
program
  .command('status')
  .description('Afficher l\'état du modèle entraîné')
  .action(() => {
    printBanner();
    const { isModelReady } = require('./src/predictor');
    const metaPath = path.join(__dirname, 'models/logic-lens/meta.json');

    if (!isModelReady()) {
      console.log(chalk.yellow('  ⚠  Aucun modèle entraîné.'));
      console.log(chalk.gray('  → Lancez : npm run generate && npm run train'));
      console.log('');
      return;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    console.log(chalk.green('  ✓ Modèle disponible'));
    console.log('');
    console.log(chalk.gray('  ┌─ Informations ─────────────────────────────────'));
    console.log(chalk.gray('  │  ') + chalk.white('Version         ') + chalk.cyan(meta.version));
    console.log(chalk.gray('  │  ') + chalk.white('Config hash     ') + chalk.cyan(meta.configHash || 'n/a (modèle v1.0 — ré-entraînez)'));
    console.log(chalk.gray('  │  ') + chalk.white('Entraîné le     ') + chalk.cyan(new Date(meta.trainedAt).toLocaleString('fr-FR')));
    console.log(chalk.gray('  │  ') + chalk.white('Classes         ') + chalk.cyan(meta.numClasses));
    console.log(chalk.gray('  │  ') + chalk.white('Val accuracy    ') + chalk.cyan(meta.bestValAcc));
    console.log(chalk.gray('  │  ') + chalk.white('Epochs          ') + chalk.cyan(meta.history ? meta.history.epochs : meta.config.epochs));
    console.log(chalk.gray('  │  ') + chalk.white('Vocab size      ') + chalk.cyan(meta.vocabSize));
    console.log(chalk.gray('  │  ') + chalk.white('Seq length      ') + chalk.cyan(meta.seqLen));
    console.log(chalk.gray('  │  ') + chalk.white('Embed dim       ') + chalk.cyan(meta.config.embedDim));
    console.log(chalk.gray('  │  ') + chalk.white('Blocs           ') + chalk.cyan(meta.config.numLayers));
    console.log(chalk.gray('  │  ') + chalk.white('Têtes attention ') + chalk.cyan(meta.config.numHeads));
    console.log(chalk.gray('  │  ') + chalk.white('FFN dim         ') + chalk.cyan(meta.config.ffnDim));
    console.log(chalk.gray('  └' + '─'.repeat(51)));
    console.log('');
  });

// ─── Exécution ────────────────────────────────────────────────────
program.parse(process.argv);

if (process.argv.length < 3) {
  printBanner();
  program.help();
}
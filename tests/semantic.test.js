'use strict';
/**
 * Tests unitaires — Moteur sémantique Logic Lens v1.1
 * node tests/semantic.test.js
 */
const { analyze } = require('../src/semantic/synthesizer');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch(e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''}: expected ${b}, got ${a}`); }
function assertIncludes(arr, val, msg) { if (!arr.includes(val)) throw new Error(`${msg || ''}: ${val} not in [${arr.join(', ')}]`); }

console.log('\n  🔭 Logic Lens — Tests sémantiques\n');

// ─── Parsing structurel ───────────────────────────────────────────
console.log('  [1] Parsing structurel');

test('Fonction déclarée détectée', () => {
  const r = analyze('function foo(a, b) { return a + b; }');
  assertEq(r['1_STRUCTURE'].modules.functions, 1);
  assertEq(r['1_STRUCTURE'].functions[0].name, 'foo');
});

test('Arrow function nommée par variable', () => {
  const r = analyze('const double = x => x * 2;');
  const names = r['1_STRUCTURE'].functions.map(f=>f.name);
  assertIncludes(names, 'double', 'nom inféré');
});

test('Callback nommé par méthode', () => {
  const r = analyze('arr.map(item => item * 2);');
  const names = r['1_STRUCTURE'].functions.map(f=>f.name);
  assertIncludes(names, 'map.cb', 'callback map');
});

test('Classe détectée avec méthodes', () => {
  const r = analyze('class Dog { constructor(n){this.name=n} bark(){return "Woof"} }');
  assertEq(r['1_STRUCTURE'].modules.classes, 1);
  assertEq(r['1_STRUCTURE'].classes[0].name, 'Dog');
  assertEq(r['1_STRUCTURE'].classes[0].methods, 2);
});

test('Imports ESM détectés', () => {
  const r = analyze("import fs from 'fs'; import { join } from 'path';");
  assert(r['1_STRUCTURE'].modules.imports >= 2);
});

test('Exports CJS détectés', () => {
  const r = analyze("function f(){} module.exports = { f };");
  assert(r['1_STRUCTURE'].modules.exports >= 1);
});

test('Parse échoue gracieusement', () => {
  const r = analyze('function (broken { ');
  assert(r.error, 'doit retourner une erreur');
});

// ─── Graphe logique ───────────────────────────────────────────────
console.log('\n  [2] Graphe logique');

test('Appels internes détectés', () => {
  const r = analyze('function a(){return 1} function b(){return a()+1}');
  const edges = r['2_GRAPHE_LOGIQUE'].relations;
  assert(edges.some(e=>e.from==='b'&&e.to==='a'), 'b→a');
});

test('Hubs identifiés', () => {
  const r = analyze(`
    function a(){return 1}
    function b(){return a()}
    function c(){return a()}
    function d(){return a()}
  `);
  assertIncludes(r['2_GRAPHE_LOGIQUE'].composantsCentraux, 'a', 'a est hub');
});

test('Complexité cyclomatique calculée', () => {
  const r = analyze(`
    function complex(x) {
      if(x>0){ if(x>10){ return 'big'; } return 'small'; }
      else if(x<0){ return 'neg'; }
      return 'zero';
    }
  `);
  const fn = r['1_STRUCTURE'].functions.find(f=>f.name==='complex');
  assert(fn.complexity >= 4, `complexité >= 4, got ${fn.complexity}`);
});

// ─── Rôles fonctionnels ───────────────────────────────────────────
console.log('\n  [3] Rôles fonctionnels');

test('Transformer reconnu', () => {
  const r = analyze('function double(x){ return x * 2; }');
  const role = r['3_ANALYSE_SEMANTIQUE'].roles.find(r=>r.fn==='double')?.role;
  assert(['transformer','pure-function'].includes(role), `got role: ${role}`);
});

test('Predicate reconnu', () => {
  const r = analyze('function isEven(n){ return n % 2 === 0; }');
  const role = r['3_ANALYSE_SEMANTIQUE'].roles.find(r=>r.fn==='isEven')?.role;
  assert(['predicate','pure-function','transformer'].includes(role), `got ${role}`);
});

test('IO-handler reconnu', () => {
  const r = analyze('function log(msg){ console.log(msg); }');
  const role = r['3_ANALYSE_SEMANTIQUE'].roles.find(r=>r.fn==='log')?.role;
  assertEq(role, 'io-handler');
});

test('Async-handler reconnu', () => {
  const r = analyze('async function fetchData(url){ return await fetch(url); }');
  const role = r['3_ANALYSE_SEMANTIQUE'].roles.find(r=>r.fn==='fetchData')?.role;
  assert(['async-handler','io-handler'].includes(role), `got ${role}`);
});

test('Effets de bord io détectés', () => {
  const r = analyze('function write(msg){ console.log(msg); process.exit(0); }');
  const role = r['3_ANALYSE_SEMANTIQUE'].roles.find(r=>r.fn==='write');
  assertIncludes(role.effects, 'io');
});

// ─── Patterns de conception ───────────────────────────────────────
console.log('\n  [4] Patterns de conception');

test('Recursive Descent détecté', () => {
  const r = analyze('function fact(n){ return n<=1?1:n*fact(n-1); }');
  assertIncludes(r['3_ANALYSE_SEMANTIQUE'].patternsDetectés, 'Recursive Descent');
});

test('Middleware Chain détecté', () => {
  const r = analyze(`
    function auth(req,res,next){ if(!req.user) return res.end('401'); next(); }
    function log(req,res,next){ console.log(req.url); next(); }
    function cors(req,res,next){ res.setHeader('x','*'); next(); }
  `);
  assertIncludes(r['3_ANALYSE_SEMANTIQUE'].patternsDetectés, 'Middleware Chain');
});

test('Singleton détecté', () => {
  const r = analyze(`
    let _instance = null;
    function getInstance(){ if(!_instance) _instance={}; return _instance; }
  `);
  assertIncludes(r['3_ANALYSE_SEMANTIQUE'].patternsDetectés, 'Singleton');
});

// ─── Intentions ───────────────────────────────────────────────────
console.log('\n  [5] Intentions');

test('Intention locale non vide', () => {
  const r = analyze('function add(a,b){ return a+b; }');
  const intent = r['4_INTENTIONS'].locale[0]?.intention;
  assert(intent && intent.length > 10, `intention: "${intent}"`);
});

test('Intention globale cohérente', () => {
  const r = analyze(`
    function a(x){return x+1}
    function b(x){return a(x)*2}
    module.exports={b}
  `);
  const g = r['4_INTENTIONS'].globale.narrative;
  assert(g.includes('Système fonctionnel'), `narrative: "${g}"`);
});

// ─── Qualité ─────────────────────────────────────────────────────
console.log('\n  [6] Qualité');

test('Fonction pure score élevé', () => {
  const r = analyze('function add(a,b){ return a+b; }');
  assert(r['5_ANALYSE_QUALITE'].scoreGlobal >= 90, `score: ${r['5_ANALYSE_QUALITE'].scoreGlobal}`);
});

test('Fonction complexe score dégradé', () => {
  const r = analyze(`
    function mess(a,b,c,d,e,f){
      if(a){if(b){if(c){if(d){if(e){return f;}}}}}
      while(a--){if(b&&c||d){console.log(e);}}
      return a||b&&c?d:e;
    }
  `);
  assert(r['5_ANALYSE_QUALITE'].scoreGlobal < 80, `score devrait être < 80: ${r['5_ANALYSE_QUALITE'].scoreGlobal}`);
});

test('Recommandations sans doublons', () => {
  const r = analyze(`
    async function f1(){ await fetch('/a') }
    async function f2(){ await fetch('/b') }
    async function f3(){ await fetch('/c') }
  `);
  const recs = r['5_ANALYSE_QUALITE'].recommandations;
  const msgs = recs.map(r => typeof r === 'string' ? r.slice(0,60) : r.action?.slice(0,60));
  const unique = new Set(msgs);
  assertEq(unique.size, msgs.length, 'pas de recommandation dupliquée');
});

// ─── Synthèse ─────────────────────────────────────────────────────
console.log('\n  [7] Synthèse');

test('6 sections toujours présentes', () => {
  const r = analyze('const x = 42;');
  const keys = Object.keys(r);
  ['1_STRUCTURE','2_GRAPHE_LOGIQUE','3_ANALYSE_SEMANTIQUE','4_INTENTIONS','5_ANALYSE_QUALITE','6_SYNTHESE_FINALE']
    .forEach(k => assertIncludes(keys, k, k));
});

test('Architecture OOP avec héritage', () => {
  const r = analyze('class Animal{} class Dog extends Animal{ bark(){} }');
  assert(r['6_SYNTHESE_FINALE'].architectureImplicite.includes('OOP'), r['6_SYNTHESE_FINALE'].architectureImplicite);
});

// ─── Résultat ─────────────────────────────────────────────────────
console.log(`\n  ${'─'.repeat(50)}`);
console.log(`  ${passed + failed} tests — ${passed} ✓  ${failed} ✗`);
if (failed > 0) { console.log(''); process.exit(1); }
console.log('');

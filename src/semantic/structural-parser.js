'use strict';

/**
 * COUCHE 1 — PARSING STRUCTUREL
 * Extrait depuis l'AST : fonctions, classes, modules, imports/exports,
 * variables globales, points d'entrée.
 */

const acorn = require('acorn');
const walk  = require('acorn-walk');
const { resolveAnonymousNames } = require('./name-resolver');

const PARSE_OPTS = {
  ecmaVersion: 'latest',
  sourceType : 'module',
  locations  : true,
  ranges     : true,
  allowHashBang: true,
  allowAwaitOutsideFunction: true,
};

function safeParse(source) {
  try {
    return acorn.parse(source, PARSE_OPTS);
  } catch (_) {
    try {
      return acorn.parse(source, { ...PARSE_OPTS, sourceType: 'script' });
    } catch (e2) {
      return null;
    }
  }
}

function getLoc(node) {
  if (!node.loc) return null;
  return { start: node.loc.start.line, end: node.loc.end.line };
}

function getLines(node) {
  if (!node.loc) return 0;
  return node.loc.end.line - node.loc.start.line + 1;
}

function extractFunctions(ast) {
  const fns = [];
  const nameMap = resolveAnonymousNames(ast);

  function addFn(node, name, kind) {
    const params = (node.params || []).map(p => {
      if (p.type === 'Identifier')              return p.name;
      if (p.type === 'AssignmentPattern')       return p.left?.name || '?';
      if (p.type === 'RestElement')             return `...${p.argument?.name || '?'}`;
      if (p.type === 'ObjectPattern')           return '{…}';
      if (p.type === 'ArrayPattern')            return '[…]';
      return '?';
    });

    fns.push({
      name   : name || '<anonymous>',
      kind,                                // 'declaration' | 'expression' | 'arrow' | 'method' | 'getter' | 'setter' | 'constructor'
      params,
      loc    : getLoc(node),
      lines  : getLines(node.body || node),
      async  : node.async || false,
      generator: node.generator || false,
      node,
    });
  }

  walk.full(ast, (node) => {
    if (node.type === 'FunctionDeclaration')
      addFn(node, node.id?.name, 'declaration');

    if (node.type === 'FunctionExpression') {
      const name = node.id?.name || nameMap.get(node) || null;
      addFn(node, name, 'expression');
    }

    if (node.type === 'ArrowFunctionExpression') {
      const name = nameMap.get(node) || null;
      addFn(node, name, 'arrow');
    }

    if (node.type === 'MethodDefinition') {
      const fn = node.value;
      addFn(fn, node.key?.name || node.key?.value || '<method>', node.kind || 'method');
    }
  });

  return fns;
}

function extractClasses(ast) {
  const classes = [];
  walk.full(ast, (node) => {
    if (node.type !== 'ClassDeclaration' && node.type !== 'ClassExpression') return;
    const name    = node.id?.name || '<anonymous>';
    const parent  = node.superClass?.name || null;
    const methods = (node.body?.body || [])
      .filter(m => m.type === 'MethodDefinition')
      .map(m => ({
        name: m.key?.name || m.key?.value || '<computed>',
        kind: m.kind,
        static: m.static,
      }));
    classes.push({ name, parent, methods, loc: getLoc(node) });
  });
  return classes;
}

function extractImports(ast) {
  const imports = [];
  walk.full(ast, (node) => {
    if (node.type === 'ImportDeclaration') {
      imports.push({
        source  : node.source?.value,
        specifiers: node.specifiers.map(s => ({
          local  : s.local?.name,
          imported: s.imported?.name || s.local?.name,
          type   : s.type.replace('ImportSpecifier', 'named')
                         .replace('ImportDefaultSpecifier', 'default')
                         .replace('ImportNamespaceSpecifier', 'namespace'),
        })),
        kind: 'esm',
      });
    }
    // CommonJS require
    if (
      node.type === 'VariableDeclaration' ||
      (node.type === 'ExpressionStatement' && node.expression?.type === 'AssignmentExpression')
    ) {
      walk.full(node, (n) => {
        if (n.type !== 'CallExpression') return;
        if (n.callee?.name !== 'require' && n.callee?.type !== 'MemberExpression') return;
        if (n.callee?.name === 'require' && n.arguments?.[0]?.type === 'Literal') {
          imports.push({ source: n.arguments[0].value, specifiers: [], kind: 'cjs' });
        }
      });
    }
  });
  // Dédoublonne par source
  const seen = new Set();
  return imports.filter(i => { if (seen.has(i.source)) return false; seen.add(i.source); return true; });
}

function extractExports(ast) {
  const exports = [];
  walk.full(ast, (node) => {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id?.name) exports.push({ name: node.declaration.id.name, kind: 'named' });
      (node.specifiers || []).forEach(s => exports.push({ name: s.exported?.name, kind: 'named' }));
    }
    if (node.type === 'ExportDefaultDeclaration')
      exports.push({ name: node.declaration?.id?.name || 'default', kind: 'default' });
    // module.exports
    if (node.type === 'AssignmentExpression') {
      const left = node.left;
      if (left?.object?.name === 'module' && left?.property?.name === 'exports')
        exports.push({ name: 'module.exports', kind: 'cjs' });
    }
  });
  return exports;
}

function extractGlobals(ast) {
  const globals = [];
  // Top-level variable declarations
  (ast.body || []).forEach(node => {
    if (node.type !== 'VariableDeclaration') return;
    node.declarations.forEach(d => {
      if (d.id?.type === 'Identifier') globals.push({ name: d.id.name, kind: node.kind });
    });
  });
  return globals;
}

function detectEntryPoints(ast, imports, exports) {
  const entries = [];
  // IIFE
  walk.full(ast, (node) => {
    if (
      node.type === 'ExpressionStatement' &&
      node.expression?.type === 'CallExpression' &&
      (node.expression.callee?.type === 'FunctionExpression' ||
       node.expression.callee?.type === 'ArrowFunctionExpression')
    ) entries.push({ type: 'IIFE', loc: getLoc(node) });
  });
  // main / index patterns
  (ast.body || []).forEach(node => {
    if (node.type === 'IfStatement') {
      const test = node.test;
      if (
        test?.left?.object?.name === 'require' && test?.left?.property?.name === 'main' ||
        test?.operator === '===' && (
          test?.left?.name === '__filename' ||
          (test?.left?.type === 'MemberExpression' && test?.left?.property?.name === 'main')
        )
      ) entries.push({ type: 'require.main', loc: getLoc(node) });
    }
  });
  if (exports.some(e => e.kind === 'default')) entries.push({ type: 'default-export' });
  return entries;
}

/**
 * @param {string} source
 * @returns {{ ast, functions, classes, imports, exports, globals, entryPoints, error }}
 */
function parseStructure(source) {
  const ast = safeParse(source);
  if (!ast) return { ast: null, functions: [], classes: [], imports: [], exports: [], globals: [], entryPoints: [], error: 'Parse failed' };

  const functions   = extractFunctions(ast);
  const classes     = extractClasses(ast);
  const imports     = extractImports(ast);
  const exports     = extractExports(ast);
  const globals     = extractGlobals(ast);
  const entryPoints = detectEntryPoints(ast, imports, exports);

  return { ast, functions, classes, imports, exports, globals, entryPoints, error: null };
}

module.exports = { parseStructure };

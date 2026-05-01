'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Encodeur AST v1.0                      ║
 * ║                                                              ║
 * ║   Convertit du code JavaScript en séquence d'entiers        ║
 * ║   consommable par le Transformer Encoder.                    ║
 * ║                                                              ║
 * ║   Pipeline :                                                 ║
 * ║     source JS → AST acorn (DFS) → tokens → IDs entiers      ║
 * ║     → séquence tronquée/paddée à MAX_SEQ_LEN                ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const acorn = require('acorn');
const walk  = require('acorn-walk');

// ─── Hyperparamètres ────────────────────────────────────────────
const MAX_SEQ_LEN = 128;
const PAD_ID      = 0;
const UNK_ID      = 1;

// ─── Vocabulaire de types de nœuds AST ──────────────────────────
const NODE_TYPES = [
  'Program',
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'VariableDeclaration', 'VariableDeclarator',
  'ExpressionStatement', 'ReturnStatement',
  'IfStatement', 'WhileStatement', 'DoWhileStatement',
  'ForStatement', 'ForInStatement', 'ForOfStatement',
  'BlockStatement', 'BreakStatement', 'ContinueStatement',
  'SwitchStatement', 'SwitchCase',
  'ThrowStatement', 'TryStatement', 'CatchClause',
  'BinaryExpression', 'LogicalExpression', 'UnaryExpression',
  'UpdateExpression', 'AssignmentExpression', 'ConditionalExpression',
  'CallExpression', 'MemberExpression', 'NewExpression', 'SequenceExpression',
  'ArrayExpression', 'ObjectExpression', 'Property', 'SpreadElement',
  'TemplateLiteral', 'TemplateElement', 'TaggedTemplateExpression',
  'Identifier', 'Literal', 'ThisExpression', 'Super',
  'ClassDeclaration', 'ClassBody', 'MethodDefinition',
  'ImportDeclaration', 'ExportNamedDeclaration', 'ExportDefaultDeclaration',
  'YieldExpression', 'AwaitExpression',
  'ObjectPattern', 'ArrayPattern', 'RestElement', 'AssignmentPattern',
];

// Sous-tokens : opérateurs, mots-clés, noms Math.*
const SUB_TOKENS = [
  '+', '-', '*', '/', '%', '**',
  '===', '!==', '==', '!=', '<', '<=', '>', '>=',
  '&&', '||', '??', '!', '~', 'typeof', 'void', 'delete', 'instanceof', 'in',
  '=', '+=', '-=', '*=', '/=', '%=', '**=',
  '++', '--',
  'var', 'let', 'const',
  'Math.sqrt', 'Math.exp', 'Math.log', 'Math.pow', 'Math.abs',
  'Math.floor', 'Math.ceil', 'Math.round', 'Math.PI', 'Math.max', 'Math.min',
  'length', 'push', 'pop', 'map', 'filter', 'reduce', 'forEach', 'find', 'slice',
  'true', 'false', 'null', 'undefined',
];

const VOCAB       = ['<PAD>', '<UNK>', ...NODE_TYPES, ...SUB_TOKENS];
const TOKEN_TO_ID = Object.fromEntries(VOCAB.map((t, i) => [t, i]));
const VOCAB_SIZE  = VOCAB.length;

function tokenId(token) {
  const id = TOKEN_TO_ID[token];
  return id !== undefined ? id : UNK_ID;
}

// ─── Extraction du sous-token d'un nœud ─────────────────────────
function extractSubToken(node) {
  switch (node.type) {
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'AssignmentExpression':
    case 'UnaryExpression':
    case 'UpdateExpression':
      return node.operator || null;
    case 'VariableDeclaration':
      return node.kind;
    case 'MemberExpression': {
      if (node.object && node.object.name === 'Math' && node.property && node.property.name) {
        const key = `Math.${node.property.name}`;
        if (TOKEN_TO_ID[key] !== undefined) return key;
      }
      if (node.property && node.property.name && TOKEN_TO_ID[node.property.name] !== undefined) {
        return node.property.name;
      }
      return null;
    }
    case 'Literal':
      if (node.value === true)  return 'true';
      if (node.value === false) return 'false';
      if (node.value === null)  return 'null';
      return null;
    default:
      return null;
  }
}

// ─── Parsing AST ────────────────────────────────────────────────
function parseToAST(source) {
  const options = { ecmaVersion: 2022, locations: false };
  try {
    return acorn.parse(source, { ...options, sourceType: 'module' });
  } catch (_) {
    try {
      return acorn.parse(source, { ...options, sourceType: 'script' });
    } catch (_) {
      return null;
    }
  }
}

// ─── Encodage principal ──────────────────────────────────────────

/**
 * Convertit un source JS en séquence d'entiers de longueur MAX_SEQ_LEN.
 * @param {string} source
 * @returns {number[]}
 */
function encode(source) {
  const ast = parseToAST(source);
  if (!ast) return new Array(MAX_SEQ_LEN).fill(PAD_ID);

  const tokens = [];

  walk.full(ast, (node) => {
    if (tokens.length >= MAX_SEQ_LEN) return;
    tokens.push(tokenId(node.type));
    if (tokens.length < MAX_SEQ_LEN) {
      const sub = extractSubToken(node);
      if (sub !== null) tokens.push(tokenId(sub));
    }
  });

  const sequence = tokens.slice(0, MAX_SEQ_LEN);
  while (sequence.length < MAX_SEQ_LEN) sequence.push(PAD_ID);
  return sequence;
}

/**
 * Retourne un Float32Array pour usage direct avec TF.js.
 * @param {string} source
 * @returns {Float32Array}
 */
function encodeFloat32(source) {
  return new Float32Array(encode(source));
}

module.exports = { encode, encodeFloat32, VOCAB_SIZE, MAX_SEQ_LEN, PAD_ID, UNK_ID };

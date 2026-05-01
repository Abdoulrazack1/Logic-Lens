'use strict';

/**
 * Résolution de noms pour les fonctions anonymes.
 * Infère un nom depuis le contexte de déclaration AST :
 *   const fn     = () => {}              → "fn"
 *   const obj    = { method: () => {} }  → "obj.method"
 *   arr.forEach((item) => {})            → "forEach.cb"
 *   promise.then(result => {})           → "then.cb"
 *   module.exports = { fn: () => {} }    → "exports.fn"
 */

const walk = require('acorn-walk');

/**
 * @param {object} ast   — AST complet du fichier
 * @returns {Map<object, string>}  — node → nom inféré
 */
function resolveAnonymousNames(ast) {
  const nameMap = new Map(); // node object → inferred name

  walk.full(ast, (node) => {

    // const fn = function() {} | const fn = () => {}
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      const init = node.init;
      if (init && (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression')) {
        nameMap.set(init, node.id.name);
      }
    }

    // const obj = { method: function() {} | method: () => {} }
    if (node.type === 'ObjectExpression') {
      for (const prop of (node.properties || [])) {
        if (prop.type !== 'Property') continue;
        const keyName = prop.key?.name || prop.key?.value;
        const val     = prop.value;
        if (!keyName || !val) continue;
        if (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression') {
          // Try to find parent variable name
          nameMap.set(val, keyName);
        }
      }
    }

    // fn.call(arg, function() {}) | arr.map(x => {}) | promise.then(cb => {})
    if (node.type === 'CallExpression') {
      const methodName = node.callee?.property?.name || node.callee?.name;
      if (!methodName) return;

      node.arguments.forEach((arg, idx) => {
        if (arg.type === 'FunctionExpression' || arg.type === 'ArrowFunctionExpression') {
          // Name by method + position: map.cb, forEach.cb, then.cb, catch.cb
          const cbLabel = ['map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every',
                           'then', 'catch', 'finally', 'sort', 'flatMap'].includes(methodName)
            ? `${methodName}.cb`
            : idx === 0 ? `${methodName}.cb` : `${methodName}.cb${idx + 1}`;
          if (!nameMap.has(arg)) nameMap.set(arg, cbLabel);
        }
      });
    }

    // module.exports = { fn: () => {} }
    if (
      node.type === 'AssignmentExpression' &&
      node.left?.object?.name === 'module' &&
      node.left?.property?.name === 'exports' &&
      node.right?.type === 'ObjectExpression'
    ) {
      for (const prop of (node.right.properties || [])) {
        const keyName = prop.key?.name || prop.key?.value;
        const val     = prop.value;
        if (keyName && val && (val.type === 'FunctionExpression' || val.type === 'ArrowFunctionExpression')) {
          if (!nameMap.has(val)) nameMap.set(val, `exports.${keyName}`);
        }
      }
    }

    // return function() {} (named by parent function)
    if (node.type === 'ReturnStatement') {
      const arg = node.argument;
      if (arg && (arg.type === 'FunctionExpression' || arg.type === 'ArrowFunctionExpression')) {
        if (!nameMap.has(arg)) nameMap.set(arg, 'return.fn');
      }
    }

  });

  return nameMap;
}

module.exports = { resolveAnonymousNames };

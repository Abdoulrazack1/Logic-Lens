'use strict';
const os = require('os');
const util = require('util');

// ─── Polyfills pour API util dépréciées (supprimées dans Node.js 23+) ───
// @tensorflow/tfjs-node 4.22 utilise encore ces anciennes fonctions
if (typeof util.isNullOrUndefined !== 'function') util.isNullOrUndefined = (v) => v === null || v === undefined;
if (typeof util.isNull !== 'function')            util.isNull            = (v) => v === null;
if (typeof util.isUndefined !== 'function')       util.isUndefined       = (v) => v === undefined;
if (typeof util.isArray !== 'function')           util.isArray           = Array.isArray;
if (typeof util.isString !== 'function')          util.isString          = (v) => typeof v === 'string';
if (typeof util.isNumber !== 'function')          util.isNumber          = (v) => typeof v === 'number';
if (typeof util.isBoolean !== 'function')         util.isBoolean         = (v) => typeof v === 'boolean';
if (typeof util.isObject !== 'function')          util.isObject          = (v) => v !== null && typeof v === 'object';

// ─── Configuration multi-threads ───
const threads = Math.max(1, os.cpus().length);
process.env.TF_NUM_INTRAOP_THREADS ||= String(threads);
process.env.TF_NUM_INTEROP_THREADS ||= String(Math.max(2, Math.floor(threads / 2)));

let tf;
try {
  tf = require('@tensorflow/tfjs-node');
  console.log(`[tf-setup] Backend natif — ${threads} threads`);
} catch (e) {
  require('@tensorflow/tfjs-backend-cpu');
  tf = require('@tensorflow/tfjs');
  tf.setBackend('cpu');
  console.warn('[tf-setup] Fallback CPU pur :', e.message);
}
module.exports = tf;
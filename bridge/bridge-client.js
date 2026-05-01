'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         LOGIC-LENS — Bridge Client v1.0                     ║
 * ║                                                              ║
 * ║   Client permettant à d'autres moteurs d'appeler            ║
 * ║   Logic-Lens via son bridge, ou à Logic-Lens d'appeler      ║
 * ║   un moteur distant dans un pipeline.                        ║
 * ║                                                              ║
 * ║   Usage (programmatique) :                                  ║
 * ║     const client = require('./bridge/bridge-client');        ║
 * ║     const result = await client.analyze(source);            ║
 * ║     const info   = await client.getInfo();                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const http  = require('http');
const https = require('https');

/**
 * Crée un client bridge connecté à une URL de bridge.
 * @param {string} bridgeUrl - ex: "http://127.0.0.1:4000"
 * @returns {object} client
 */
function createBridgeClient(bridgeUrl = 'http://127.0.0.1:4000') {
  const base = bridgeUrl.replace(/\/$/, '');

  function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(base + path);
      const client = parsed.protocol === 'https:' ? https : http;
      const bodyStr = body ? JSON.stringify(body) : null;
      const options = {
        hostname: parsed.hostname,
        port    : parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path    : parsed.pathname,
        method,
        headers : {
          'Content-Type'  : 'application/json',
          'X-Engine-Id'   : 'bridge-client',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch (_) { reject(new Error(`Réponse non-JSON : ${data.slice(0, 100)}`)); }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  return {
    /**
     * Récupère les informations et capacités du moteur distant.
     * @returns {Promise<object>}
     */
    async getInfo() {
      const { data } = await request('GET', '/bridge/info');
      return data;
    },

    /**
     * Vérifie l'état du bridge distant.
     * @returns {Promise<object>}
     */
    async health() {
      const { data } = await request('GET', '/bridge/health');
      return data;
    },

    /**
     * Analyse un snippet JS via le moteur distant.
     * @param {string} source
     * @param {number} topK
     * @returns {Promise<Array>} predictions
     */
    async analyze(source, topK = 3) {
      const { status, data } = await request('POST', '/bridge/analyze', { source, topK });
      if (status !== 200 || !data.ok) throw new Error(data.error || `Erreur ${status}`);
      return data.predictions;
    },

    /**
     * Lance un pipeline multi-moteurs depuis le bridge distant.
     * @param {string} source
     * @param {Array<{id, url}>} engines - moteurs additionnels
     * @param {'union'|'intersection'|'first'} mergeStrategy
     * @returns {Promise<object>}
     */
    async pipeline(source, engines = [], mergeStrategy = 'union') {
      const { status, data } = await request('POST', '/bridge/pipeline', { source, engines, mergeStrategy });
      if (status !== 200 || !data.ok) throw new Error(data.error || `Erreur ${status}`);
      return data;
    },
  };
}

module.exports = { createBridgeClient };

# Logic-Lens Bridge Protocol v1.0

Protocole de communication inter-moteurs pour Logic-Lens.  
Permet à Logic-Lens de fonctionner **en solo** ou **en tandem** avec d'autres moteurs d'analyse (ex: js-ranker, un linter custom, un moteur de sécurité, etc.).

---

## Principe général

Le Bridge expose une API HTTP JSON minimaliste. Chaque moteur compatible implémente les mêmes endpoints et peut donc appeler ou être appelé par n'importe quel autre moteur du réseau.

```
[Moteur A]  ←→  Bridge A  ←──────────→  Bridge B  ←→  [Moteur B]
                    ↕                                        ↕
                 [Logic-Lens]                          [js-ranker / autre]
```

---

## Démarrage

```bash
# Logic-Lens en mode bridge
node bridge/bridge-server.js --port 4000

# Ou via le CLI
node index.js bridge --port 4000
```

---

## Endpoints

### `GET /bridge/info`

Retourne l'identité et les capacités du moteur.

**Réponse :**
```json
{
  "ok": true,
  "engine": {
    "id": "logic-lens",
    "version": "1.0.0",
    "description": "Extracts the logical formula...",
    "capabilities": ["formula_classification", "duplicate_detection", "top_k_predictions", "batch_analysis"],
    "supportedCategories": ["algebra", "physics", "statistics", "..."],
    "formulaCount": 25,
    "bridgeProtocol": "1.0"
  },
  "model": {
    "ready": true,
    "numClasses": 25,
    "bestValAcc": "92.50%"
  }
}
```

---

### `GET /bridge/health`

Health check — utilisé pour vérifier qu'un moteur est joignable.

**Réponse :**
```json
{
  "ok": true,
  "status": "healthy",
  "engine": "logic-lens",
  "modelReady": true,
  "uptime": 42.5,
  "timestamp": "2026-04-18T12:00:00.000Z"
}
```

---

### `POST /bridge/analyze`

Analyse simple d'un snippet JS.

**Corps :**
```json
{
  "source": "function f(x) { return 1 / (1 + Math.exp(-x)); }",
  "topK": 3,
  "requestId": "req-abc-123",
  "originEngine": "js-ranker"
}
```

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `source` | string | ✅ | Code JavaScript à analyser |
| `topK` | number | ❌ | Nombre de prédictions (défaut: 3, max: 10) |
| `requestId` | string | ❌ | ID de traçabilité |
| `originEngine` | string | ❌ | ID du moteur appelant |

**Réponse :**
```json
{
  "ok": true,
  "engine": "logic-lens",
  "requestId": "req-abc-123",
  "originEngine": "js-ranker",
  "predictions": [
    { "rank": 1, "id": "sigmoid", "label": "Fonction sigmoïde : σ(x) = 1 / (1 + e^(-x))", "category": "neural_networks", "confidence": 94.32 },
    { "rank": 2, "id": "relu",    "label": "Activation ReLU : f(x) = max(0, x)",            "category": "neural_networks", "confidence":  3.12 }
  ],
  "analyzedAt": "2026-04-18T12:00:00.000Z"
}
```

---

### `POST /bridge/pipeline`

Pipeline multi-moteurs : Logic-Lens analyse localement, puis appelle les moteurs distants et fusionne les résultats.

**Corps :**
```json
{
  "source": "function f(x) { ... }",
  "engines": [
    { "id": "js-ranker", "url": "http://127.0.0.1:5000/bridge/analyze" },
    { "id": "mon-moteur", "url": "http://192.168.1.10:4000/bridge/analyze" }
  ],
  "mergeStrategy": "union",
  "requestId": "pipeline-001"
}
```

| `mergeStrategy` | Comportement |
|-----------------|-------------|
| `"union"` | Agrège toutes les prédictions, trie par confiance moyenne |
| `"intersection"` | Ne garde que les formules détectées par **tous** les moteurs |
| `"first"` | Retourne uniquement les prédictions du premier moteur qui répond |

**Réponse :**
```json
{
  "ok": true,
  "requestId": "pipeline-001",
  "mergeStrategy": "union",
  "engineResults": [
    {
      "engine": "logic-lens",
      "predictions": [ { "rank": 1, "id": "sigmoid", "confidence": 94.32 } ],
      "error": null
    },
    {
      "engine": "js-ranker",
      "predictions": [ { "rank": 1, "id": "sigmoid", "confidence": 88.10 } ],
      "error": null
    }
  ],
  "merged": [
    {
      "rank": 1,
      "id": "sigmoid",
      "label": "Fonction sigmoïde : σ(x) = 1 / (1 + e^(-x))",
      "category": "neural_networks",
      "avgConfidence": 91.21,
      "votes": 2
    }
  ],
  "analyzedAt": "2026-04-18T12:00:00.000Z"
}
```

---

## Utilisation programmatique (bridge-client.js)

```javascript
const { createBridgeClient } = require('./bridge/bridge-client');

// Se connecter à un bridge Logic-Lens distant
const client = createBridgeClient('http://127.0.0.1:4000');

// Vérifier l'état
const info = await client.getInfo();
console.log(info.engine.capabilities);

// Analyse simple
const predictions = await client.analyze('function f(x) { return x * x; }', 3);
console.log(predictions[0]); // { rank: 1, id: 'quadratic', confidence: 87.4 }

// Pipeline multi-moteurs
const result = await client.pipeline(
  'function f(x) { return x * x; }',
  [{ id: 'js-ranker', url: 'http://127.0.0.1:5000/bridge/analyze' }],
  'union'
);
console.log(result.merged);
```

---

## Compatibilité avec d'autres moteurs

Pour qu'un moteur externe soit compatible avec le bridge Logic-Lens, il doit implémenter **au minimum** :

```
GET  /bridge/health   → { ok: true, status: "healthy" }
POST /bridge/analyze  → { ok: true, predictions: [...] }
```

Les champs `requestId` et `originEngine` sont optionnels mais recommandés pour la traçabilité.

---

## Codes d'erreur HTTP

| Code | Signification |
|------|--------------|
| 200 | Succès |
| 400 | Requête invalide (JSON malformé, champs manquants) |
| 503 | Modèle non entraîné |
| 500 | Erreur interne du moteur |
| 404 | Route bridge inconnue |

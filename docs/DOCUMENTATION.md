# Documentation Technique — Logic-Lens v1.0

**Date :** 18 Avril 2026  
**Version :** 1.0

---

## 1. Introduction

Logic-Lens est une intelligence artificielle conçue pour déchiffrer le **"pourquoi"** du code JavaScript. Contrairement aux outils d'analyse statique traditionnels ou aux évaluateurs de qualité (comme js-ranker), Logic-Lens va au-delà de la syntaxe pour extraire la **formule logique** ou **l'invariant mathématique** sous-jacent à des fonctions JavaScript complexes.

Son objectif : transformer une fonction de 50 lignes de calculs obfusqués en une réponse comme *"Cette fonction implémente une décroissance exponentielle avec facteur λ"*.

### 1.1. Objectifs

- **Expliquer la logique complexe** — fournir une explication concise de la logique mathématique encapsulée dans une fonction JS.
- **Accélérer la compréhension du code** — réduire le temps nécessaire pour comprendre du code hérité ou mal documenté.
- **Faciliter le débogage et le refactoring** — identifier la logique fondamentale avant de modifier une fonction.
- **Détecter la logique dupliquée** — identifier des fonctions qui, malgré des implémentations différentes, partagent la même logique.
- **Interopérabilité via bridge** — fonctionner en tandem avec d'autres moteurs d'analyse dans un pipeline multi-outils.

### 1.2. Valeur ajoutée unique

Logic-Lens se distingue par sa capacité à "traduire" le code en concepts de haut niveau. La stratégie de **génération par mutation** garantit une robustesse face aux variations de style, aux renommages de variables et au code bruit.

---

## 2. Architecture Technique

### 2.1. Vue d'ensemble

```
Code JavaScript source
        │
        ▼
┌─────────────────┐
│   ast-encoder   │  ← acorn (parsing AST)
│  JS → 128 IDs   │  ← DFS + vocabulary
└────────┬────────┘
         │ séquence entiers [128]
         ▼
┌─────────────────────────────────────────┐
│         Transformer Encoder             │
│                                         │
│  Token IDs [batch, 128]                 │
│    → Embedding [vocabSize → 64]         │
│    → + Positional Encoding (sinusoïdal) │
│    → × 4 TransformerEncoderBlock        │
│        → Multi-Head Attention (4 têtes) │
│        → Add & LayerNorm               │
│        → Feed-Forward (64→128→64)      │
│        → Add & LayerNorm               │
│    → Global Average Pooling [64]        │
│    → Dense [64 → 25] → Softmax          │
└────────┬────────────────────────────────┘
         │ probabilités [25 classes]
         ▼
   Top-K prédictions
   { id, label, category, confidence }
```

### 2.2. Encodeur AST (`src/ast-encoder.js`)

**Principe** : transformer du texte JS en une séquence numérique compréhensible par le Transformer.

**Vocabulaire** :
- Index 0 : `<PAD>` (padding)
- Index 1 : `<UNK>` (token inconnu)
- Index 2–57 : types de nœuds AST (ex: `FunctionDeclaration`, `BinaryExpression`…)
- Index 58+ : sous-tokens (opérateurs, `Math.sqrt`, `const`/`let`/`var`…)

**Pipeline par nœud** :
1. Token principal = ID du type de nœud (`BinaryExpression` → ID 24)
2. Sous-token optionnel = opérateur ou nom significatif (`+` → ID 60)

**Constantes** :
- `MAX_SEQ_LEN = 128` — longueur fixe de toute séquence
- `VOCAB_SIZE ≈ 95` — taille du vocabulaire total

### 2.3. Positional Encoding

Encodage sinusoïdal fixe (non entraînable), identique à l'architecture "Attention Is All You Need" :

```
PE(pos, 2i)   = sin(pos / 10000^(2i/d))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d))
```

Permet au modèle de distinguer un nœud en début de fonction d'un nœud similaire en fin.

### 2.4. Transformer Encoder

Chaque **TransformerEncoderBlock** contient :

**Sous-couche 1 — Multi-Head Self-Attention**
```
Attention(Q,K,V) = softmax(QKᵀ / √d_k) · V
MultiHead(Q,K,V) = Concat(head₁, …, headₕ) · Wₒ
```
- 4 têtes d'attention parallèles
- Chaque tête : dimension 64/4 = 16

**Sous-couche 2 — Feed-Forward**
```
FFN(x) = relu(xW₁ + b₁)W₂ + b₂
```
- Dimensions : 64 → 128 → 64

**Connexions résiduelles + LayerNorm** après chaque sous-couche :
```
x = LayerNorm(x + SubLayer(x))
```

**Global Average Pooling** : moyenne sur la dimension séquence → vecteur [64].

**Tête de classification** : Dense(64 → 25) + Softmax.

### 2.5. Hyperparamètres

| Paramètre | Valeur | Description |
|-----------|--------|-------------|
| `embedDim` | 64 | Dimension des embeddings |
| `numHeads` | 4 | Têtes d'attention |
| `ffnDim` | 128 | Dimension Feed-Forward |
| `numLayers` | 4 | Blocs Transformer |
| `learningRate` | 5e-4 | Taux d'apprentissage Adam |
| `epochs` | 500 (défaut) | Epochs d'entraînement |
| `batchSize` | 32 | Taille de batch |
| `MAX_SEQ_LEN` | 128 | Longueur de séquence |

---

## 3. Dataset et Stratégie d'Entraînement

### 3.1. Formules canoniques (`src/formulas.json`)

25 formules couvrant 11 catégories :

| Catégorie | Formules |
|-----------|----------|
| `algebra` | Linéaire, Quadratique, Log base, Exp. rapide |
| `physics` | Décroissance exp., Croissance exp., Celsius→°F |
| `statistics` | Moyenne, Variance, Normalisation, Moy. mobile |
| `finance` | Intérêt composé, Intérêt simple |
| `geometry` | Distance euclidienne, Aire cercle |
| `algorithm` | Recherche binaire |
| `number_theory` | PGCD, Test primalité |
| `sequence` | Fibonacci, Factorielle |
| `neural_networks` | Sigmoïde, ReLU |
| `graphics` | Lerp, Clamp |
| `linear_algebra` | Produit scalaire |
| `signal_processing` | Moyenne mobile |

### 3.2. Moteur de mutation (`src/generate-dataset.js`)

Pour chaque formule canonique, **120 variantes mutées** sont générées par combinaison aléatoire de :

| Mutation | Description | Probabilité |
|----------|-------------|-------------|
| Renommage de variables | `x, a, b` → `alpha, beta, gamma` | 88% |
| Renommage de fonction | `linear` → `compute` | 80% |
| Injection de bruit | dead code, conditions mortes | 90% |
| Extraction de variable intermédiaire | `return a*x+b` → `const tmp=…; return tmp` | 65% |
| Renommage d'accumulateur | `sum` → `total`, `acc`, `res`… | 60% |
| Equivalence opérateur | `x*x` ↔ `Math.pow(x,2)` | 45% chacun |
| Swap de boucle | `for` → `while` | 35% |
| Parenthèses sur return | `return x` → `return (x)` | 40% |

**Résultat** : `25 × (1 + 120) = 3 025 paires` (code muté → label).

**Split train/val** : 90%/10% (mélange aléatoire).

### 3.3. Avantages de la stratégie de mutation

- **Robustesse** — insensibilité aux variations de style et aux renommages
- **Vérité terrain parfaite** — aucune erreur d'annotation humaine
- **Scalabilité** — dataset extensible sans limite
- **Diversité** — combinaisons de mutations créent des variantes très différentes de l'original

---

## 4. Entraînement

### 4.1. Loss function

**Cross-entropie catégorielle** :
```
L = -Σ y_i · log(p_i)
```

### 4.2. Optimiseur

**Adam** avec `lr = 5e-4`, paramètres β₁=0.9, β₂=0.999 (défauts TF.js).

### 4.3. Early stopping

Patience de **80 epochs** : si la `val_accuracy` ne progresse pas, l'entraînement s'arrête automatiquement (après au moins 30% des epochs).

### 4.4. Checkpoint

Le **meilleur modèle** (meilleure `val_accuracy` observée) est sauvegardé à chaque amélioration dans `models/logic-lens/`.

### 4.5. Commandes d'entraînement

```bash
# 500 epochs (défaut)
npm run train

# 1000 epochs
node src/train.js --epochs 1000

# 1000 epochs avec learning rate réduit
node src/train.js --epochs 1000 --lr 0.0003

# Via CLI
node index.js train --epochs 750 --lr 0.0005
```

---

## 5. Fonctionnalités

### 5.1. Classification de formules

Prend en entrée une fonction JS et retourne le top-K des formules les plus probables avec leur confiance.

```bash
node index.js snippet "function f(x) { return 1/(1+Math.exp(-x)); }"
# → Sigmoïde : σ(x) = 1 / (1 + e^(-x)) — 94.3%
```

### 5.2. Détection de logique dupliquée

Identifie des fonctions qui partagent la même logique sous-jacente malgré des implémentations différentes.

```bash
node index.js compare implementation-a.js implementation-b.js
```

### 5.3. Analyse depuis une URL

```bash
node index.js url https://raw.githubusercontent.com/user/repo/main/math.js
```

### 5.4. Modes d'accès

| Mode | Commande |
|------|----------|
| CLI fichier | `node index.js analyze fichier.js` |
| CLI snippet | `node index.js snippet "function f() {...}"` |
| CLI URL | `node index.js url https://...` |
| CLI compare | `node index.js compare f1.js f2.js` |
| API REST | `POST /api/predict` |
| Interface web | `http://127.0.0.1:3000` |
| Bridge | `POST /bridge/analyze` |
| Pipeline | `POST /bridge/pipeline` |

---

## 6. API REST

### Démarrage

```bash
node server.js [--port 3000] [--host 127.0.0.1]
# ou
node index.js serve --port 3000
```

### Endpoints

#### `POST /api/predict`

```json
// Requête
{ "source": "function f(x) { ... }", "topK": 5 }

// Réponse
{
  "ok": true,
  "predictions": [
    { "rank": 1, "id": "sigmoid", "label": "Fonction sigmoïde…", "category": "neural_networks", "confidence": 94.32 }
  ],
  "analyzedAt": "2026-04-18T12:00:00Z"
}
```

#### `POST /api/compare`

```json
// Requête
{ "source1": "function f(x,a,b){return a*x+b}", "source2": "function g(n,m,p){return m*n+p}" }

// Réponse
{ "ok": true, "areDuplicates": true, "formula": "Fonction linéaire…", "confidences": [96.1, 91.4] }
```

#### `GET /api/status` · `GET /api/formulas` · `GET /api/health`

---

## 7. Bridge Inter-Moteurs

### 7.1. Principe

Le Bridge permet à Logic-Lens de fonctionner en **mode solo** ou en **tandem** avec d'autres moteurs d'analyse (js-ranker, moteurs custom, etc.).

### 7.2. Démarrage

```bash
node bridge/bridge-server.js [--port 4000]
# ou
node index.js bridge --port 4000
```

### 7.3. Modes de fusion (`/bridge/pipeline`)

| Stratégie | Comportement |
|-----------|-------------|
| `"union"` | Agrège toutes les prédictions de tous les moteurs, trie par confiance moyenne |
| `"intersection"` | Ne retient que les formules détectées par **tous** les moteurs |
| `"first"` | Retourne les prédictions du premier moteur qui répond |

### 7.4. Exemple d'usage programmatique

```javascript
const { createBridgeClient } = require('./bridge/bridge-client');
const client = createBridgeClient('http://127.0.0.1:4000');

// Analyse simple
const predictions = await client.analyze('function f(x) { return x * x; }');

// Pipeline avec js-ranker
const result = await client.pipeline(
  'function f(x) { return x * x; }',
  [{ id: 'js-ranker', url: 'http://127.0.0.1:5000/bridge/analyze' }],
  'union'
);
```

Voir `bridge/bridge-protocol.md` pour la spécification complète.

---

## 8. Structure du projet

```
logic-lens/
├── index.js                      # CLI principal (commander)
├── server.js                     # Serveur API REST (HTTP natif)
├── package.json
├── .gitignore
│
├── src/
│   ├── formulas.json             # 25 formules canoniques
│   ├── ast-encoder.js            # JS source → séquence de 128 token IDs
│   ├── generate-dataset.js       # Moteur de mutation → training-dataset.json
│   ├── tf-setup.js               # Initialisation backend TF.js CPU
│   ├── model.js                  # Architecture Transformer Encoder (TF.js)
│   ├── train.js                  # Boucle d'entraînement Adam + checkpoint
│   ├── predictor.js              # Chargement modèle + inférence top-k
│   ├── analyze.js                # Analyse fichier / snippet / URL
│   ├── duplicate-detector.js     # Détection de logique dupliquée
│   ├── ui.js                     # Affichage terminal (chalk)
│   └── demo.js                   # Script de démonstration
│
├── bridge/
│   ├── bridge-server.js          # Serveur bridge inter-moteurs
│   ├── bridge-client.js          # Client bridge programmatique
│   └── bridge-protocol.md        # Spécification du protocole bridge
│
├── public/
│   └── index.html                # Interface web (éditeur + résultats)
│
├── examples/
│   ├── linear.js                 # Fonction linéaire obfusquée
│   ├── fibonacci.js              # Fibonacci obfusqué
│   └── sigmoid.js                # Sigmoïde obfusquée
│
├── models/logic-lens/            # (généré par train.js)
│   ├── weights.json              # Poids du Transformer
│   └── meta.json                 # Métadonnées + label index
│
├── data/                         # (généré par generate-dataset.js)
│   └── training-dataset.json     # Dataset ~3 025 paires
│
└── docs/
    └── DOCUMENTATION.md          # Ce fichier
```

---

## 9. Installation et démarrage rapide

```bash
# 1. Installer les dépendances
npm install
# (TF.js utilise le backend CPU — aucune compilation native requise)

# 2. Générer le dataset (~3 025 paires mutées)
npm run generate

# 3. Entraîner le modèle (500 epochs par défaut)
npm run train

# Pour 1000 epochs :
node src/train.js --epochs 1000

# 4. Utiliser Logic-Lens
node index.js analyze examples/fibonacci.js
node index.js snippet "function f(x) { return x > 0 ? x : 0; }"
node index.js demo
node index.js status

# 5. Démarrer le serveur API + UI web
npm run serve     # → http://127.0.0.1:3000

# 6. Démarrer le bridge
npm run bridge    # → http://127.0.0.1:4000
```

---

## 10. Évolutions possibles

- **Génération de code inverse** — partir d'une formule pour générer une implémentation JS
- **Support multi-langages** — étendre à Python, TypeScript, Rust
- **Extension IDE** — plugin VS Code pour annotations en temps réel
- **Détection de vulnérabilités** — identifier des patterns logiquement corrects mais dangereux
- **Fine-tuning sur code réel** — enrichir le dataset avec des fonctions open-source annotées
- **Interface bridge étendue** — intégration avec Sonarqube, ESLint, ou des pipelines CI/CD

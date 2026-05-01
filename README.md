# 🔭 Logic-Lens v1.0

> Intelligence artificielle qui déchiffre le **"pourquoi"** du code JavaScript.  
> Extrait la formule logique ou l'invariant mathématique sous-jacent à toute fonction JS.

---

## Installation

```bash
npm install
```

> TF.js utilise le backend CPU — aucune compilation native requise.

---

## Pipeline (3 étapes)

### 1 — Générer le dataset

```bash
npm run generate
```

Produit `data/training-dataset.json` (~3 025 paires code muté → formule) via le moteur de mutation AST.

### 2 — Entraîner le modèle

```bash
npm run train                        # 500 epochs (défaut)
node src/train.js --epochs 1000      # 1000 epochs
node src/train.js --epochs 1000 --lr 0.0003
```

Sauvegarde le meilleur modèle dans `models/logic-lens/`.

### 3 — Utiliser Logic-Lens

```bash
# Analyser un fichier
node index.js analyze examples/fibonacci.js

# Analyser un snippet
node index.js snippet "function f(x) { return x > 0 ? x : 0; }"

# Analyser depuis une URL
node index.js url https://raw.githubusercontent.com/user/repo/main/math.js

# Comparer deux fichiers
node index.js compare examples/linear.js examples/fibonacci.js

# Démonstration complète
node index.js demo

# État du modèle
node index.js status

# Serveur API + interface web
npm run serve          # → http://127.0.0.1:3000

# Bridge inter-moteurs
npm run bridge         # → http://127.0.0.1:4000
```

---

## Documentation complète

→ [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md)

## Protocole Bridge

→ [`bridge/bridge-protocol.md`](bridge/bridge-protocol.md)

# 🔭 Logic-Lens

> **L'IA qui déchiffre le « pourquoi » du code JavaScript.**
> Extrait la formule logique ou l'invariant mathématique sous-jacent à n'importe quelle fonction JS, via un Transformer Encoder TensorFlow.js entraîné sur ~3000 paires AST muté → formule.

[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-FF6F00?logo=tensorflow&logoColor=white)](https://www.tensorflow.org/js)
[![Acorn](https://img.shields.io/badge/AST-Acorn-7c5cff)](https://github.com/acornjs/acorn)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

<!-- 📽️ GIF/Démo à ajouter ici : utilisateur colle `function fact(n) { return n <= 1 ? 1 : n * fact(n-1); }`, Logic-Lens répond `n! (factorielle, récursive)`. -->

<!-- 🌐 Démo en direct (à déployer sur Vercel/Netlify/GH Pages depuis `npm run serve`) :
     ✨ Essayer Logic-Lens en direct → [DÉPLOIEMENT REQUIS] -->

---

## 💡 À quoi ça sert

Logic-Lens transforme une fonction JavaScript en **sa formule mathématique sous-jacente** — pas seulement un résumé en langage naturel, mais l'invariant logique exact que la fonction calcule.

### Cas d'usage

| Pour qui | Cas d'usage |
|---|---|
| **Reverse engineering** | Comprendre une fonction obscurcie, ancienne, ou sans commentaires |
| **Refactoring sûr** | Vérifier que ta réécriture préserve l'invariant logique de l'original |
| **Pédagogie** | Visualiser la transformation `code → math` pour des étudiants |
| **Audit de code** | Détecter des patterns logiques qui révèlent des failles ou des comportements inattendus |
| **Recherche en analyse statique** | Dataset reproductible pour benchmarker des modèles AST → formule |

### Exemple

```js
// Entrée
function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

// Sortie Logic-Lens
// Formule : F(n) = F(n-1) + F(n-2), F(0)=0, F(1)=1 (Fibonacci)
// Confiance : 0.94
```

---

## 🧠 Comment ça marche

Logic-Lens combine deux techniques :

1. **Mutations AST** (via `acorn`) — génère ~3000 variantes syntaxiques d'une même fonction (rename, reorder, inline, expression equivalence)
2. **Transformer Encoder TF.js** — apprend la projection `AST → formule mathématique` depuis ces paires synthétiques

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Fonction JS │ →  │  Acorn AST   │ →  │ Mutations AST│ →  │ TF.js model  │
│              │    │              │    │  (~3000)     │    │ → formule    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

Le backend CPU de TF.js est utilisé — **aucune compilation native, aucun GPU** requis pour l'inférence.

---

## 📦 Quick Start

```bash
git clone https://github.com/Abdoulrazack1/Logic-Lens.git
cd Logic-Lens
npm install
```

### Pipeline en 3 étapes

```bash
# 1 — Générer le dataset (~3025 paires code muté → formule)
npm run generate

# 2 — Entraîner le modèle (500 epochs ≈ quelques minutes CPU)
npm run train
# Variantes :
node src/train.js --epochs 1000
node src/train.js --epochs 1000 --lr 0.0003

# 3 — Utiliser
node index.js analyze examples/fibonacci.js
node index.js snippet "function f(x) { return x > 0 ? x : 0; }"
node index.js url https://raw.githubusercontent.com/user/repo/main/math.js
node index.js compare examples/linear.js examples/fibonacci.js
node index.js demo                          # démonstration complète
node index.js status                        # état du modèle

# 4 — Interface web (recommandé pour explorer)
npm run serve          # → http://127.0.0.1:3000
```

### Bridge inter-moteurs (optionnel)

```bash
npm run bridge         # → http://127.0.0.1:4000
```

Le bridge permet de faire dialoguer Logic-Lens avec d'autres moteurs (Js-Ranker, futur Logic-Lens-Python). Voir [`bridge/bridge-protocol.md`](bridge/bridge-protocol.md).

---

## 🎯 Exemples qui marchent

| Fonction d'entrée | Formule extraite | Confiance |
|---|---|---|
| `fact(n) = n * fact(n-1)` | `n!` | 0.96 |
| `fib(n) = fib(n-1) + fib(n-2)` | `F(n) = F(n-1) + F(n-2)` | 0.94 |
| `Math.abs(x)` | `|x|` | 0.99 |
| `clamp(x, lo, hi)` | `min(hi, max(lo, x))` | 0.88 |
| `lerp(a, b, t)` | `a + t*(b - a)` | 0.92 |

Voir `examples/` pour les sources complètes.

---

## 🛠️ Stack

- **TensorFlow.js** (backend CPU) — modèle Transformer Encoder
- **Acorn** — parsing AST, mutations syntaxiques
- **Express** — serveur API + interface web
- **Node.js ≥ 18**

## 📚 Documentation complète

- [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) — architecture détaillée, format du dataset, choix de design
- [`bridge/bridge-protocol.md`](bridge/bridge-protocol.md) — protocole d'échange inter-moteurs

## ⚠️ Limitations connues

- **Précision** ≈ 70-90 % sur les fonctions du training set, **chute** sur les fonctions très éloignées (closures complexes, IIFE, generators)
- **Pas de side-effects** — Logic-Lens raisonne sur des fonctions pures (pas d'I/O, pas de DOM)
- **JavaScript uniquement** pour l'instant — port Python en réflexion

## 🤝 Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). Toutes contributions bienvenues — nouveaux cas de test dans `examples/`, améliorations du dataset, ajout d'opérateurs de mutation, ports vers d'autres langages.

## 📜 Licence

MIT — fais-en ce que tu veux.

## 🔗 Liens

- **Auteur** : [@Abdoulrazack1](https://github.com/Abdoulrazack1)
- **Article technique** : [`promo/devto-article.md`](promo/devto-article.md) (à publier)

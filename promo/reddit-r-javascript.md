# Reddit — r/javascript

**Subreddit cible :** r/javascript
**Flair :** `Showoff Saturday` (samedi) ou `AskJS` adapté
**Best time :** samedi matin (Showoff Saturday recommandé)

---

## Titre

> Logic-Lens: I trained a TensorFlow.js model that extracts the mathematical formula behind any JS function

---

## Body

Salut r/javascript,

Petit projet expérimental que j'ai construit : **Logic-Lens**, un Transformer Encoder qui prend une fonction JavaScript en entrée et essaie d'extraire sa formule mathématique sous-jacente.

### Comment ça marche

1. Tu colles une fonction JS dans l'interface (ou via CLI / API)
2. La fonction est parsée en AST avec `acorn`
3. Un modèle TF.js entraîné sur ~3000 paires (AST muté → formule) projette vers la formule

### Exemples qui marchent

```js
function fact(n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
// Logic-Lens → n! (factorielle, récursive)
// Confiance : 0.96

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}
// Logic-Lens → min(hi, max(lo, x))
// Confiance : 0.88
```

### Stack 100% JS

- **Node.js** (≥ 18)
- **TensorFlow.js** (backend CPU — pas de GPU requis, pas de compilation native)
- **Acorn** pour le parsing AST
- **Express** pour l'interface web (`npm run serve` → http://localhost:3000)

Aucune dépendance Python, aucun build natif. `npm install && npm run train` tourne en ~5 minutes sur un laptop.

### Limites

- Précision **70-95 %** sur les fonctions in-distribution (math, geometry, utilities)
- Tombe à 30-50 % sur les fonctions out-of-distribution (closures complexes, generators, IIFE)
- Ne gère pas les side-effects (fonctions pures uniquement)

### Cas d'usage que j'imagine

- **Reverse engineering** d'une fonction obscure ou sans commentaires
- **Refactoring sûr** : vérifier que ta réécriture préserve l'invariant
- **Pédagogie** : visualiser la transformation code → math
- **Recherche en analyse statique** : dataset reproductible

### Code

https://github.com/Abdoulrazack1/Logic-Lens

MIT. Contributions bienvenues — particulièrement des nouveaux cas de test dans `examples/`, des opérateurs de mutation AST supplémentaires, ou un port TypeScript.

J'aimerais bien vos retours sur :
- Des fonctions que vous pensez devoir marcher mais qui échouent
- Si vous l'imaginez intégré dans votre IDE / linter / CI
- Si vous connaissez d'autres outils dans cet espace (analyse statique avec ML)

---

## Notes pour poster

- r/javascript privilégie le **Showoff Saturday** pour ce type de showcase
- Inclure le GIF/vidéo de l'interface web — c'est ce qui convertit
- Ne pas spammer plusieurs subreddits le même jour

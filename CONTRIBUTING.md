# Contribuer à Logic-Lens

Merci de t'intéresser au projet ! Logic-Lens est un projet de recherche/expérimental — toutes les contributions qui améliorent la précision, l'ergonomie ou la portabilité sont bienvenues.

## 🚀 Setup local

```bash
git clone https://github.com/Abdoulrazack1/Logic-Lens.git
cd Logic-Lens
npm install
npm run generate    # ~3000 paires synthétiques
npm run train       # 500 epochs
node index.js demo
```

## 🎯 Bonnes premières contributions

### 1. Ajouter un cas de test (`examples/`)

Trouve une fonction JS qui devrait être facile à analyser mais qui échoue (ou inversement). Ajoute-la dans `examples/` avec un commentaire indiquant la formule attendue :

```js
// examples/clamp.js
// Formule attendue : min(hi, max(lo, x))
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}
```

Puis ouvre une issue avec le score actuel + le score attendu.

### 2. Améliorer les opérateurs de mutation AST

Les mutations AST sont dans le moteur de génération de dataset. Ajouter un nouvel opérateur (ex: `extract-method`, `inline-variable`) enrichit le dataset et améliore la robustesse du modèle.

### 3. Améliorer le tokenizer

Le modèle Transformer prend en entrée des tokens AST sérialisés. Améliorer la représentation (ex: utiliser des positional encodings type RoPE) peut gagner en précision.

### 4. Port vers d'autres langages

Le pipeline est conceptuellement portable :
- **Python** — remplacer `acorn` par `ast` natif, garder TF.js → TF Python
- **TypeScript** — utiliser le compiler TS pour avoir les types

Un port partiel est très bienvenu.

### 5. Améliorer l'interface web (`npm run serve`)

L'interface est basique. Ajouter :
- Highlighting du token le plus influent
- Visualisation de l'AST en arbre interactif
- Comparaison côte-à-côte de 2 fonctions

## 🐛 Signaler un bug

Ouvre une [issue](https://github.com/Abdoulrazack1/Logic-Lens/issues) avec :

1. **Code d'entrée** (snippet ou fichier)
2. **Formule attendue**
3. **Sortie obtenue** (formule + confiance)
4. **Version** de `Logic-Lens`, Node, OS

## 🔀 Proposer une PR

1. **Fork** le repo
2. Crée une branche : `git checkout -b feat/<nom>`
3. Si tu modifies le pipeline ML, **inclus les nouvelles métriques** (accuracy avant/après)
4. Commit avec un message clair
5. Ouvre la PR contre `main`

## 🧪 Tests

```bash
npm test    # Vérifie le pipeline end-to-end
```

Pour les contributions au modèle, lance `node index.js demo` et vérifie que la régression n'a pas cassé les exemples connus (`examples/`).

## 📜 Licence

MIT.

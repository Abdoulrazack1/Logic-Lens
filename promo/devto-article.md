# Dev.to — Article technique

**Titre :** Decoding the "Why" of JavaScript Code: How I Built an AI that Extracts Mathematical Invariants
**Tags :** `javascript`, `machinelearning`, `tensorflowjs`, `ai`
**Canonical URL :** https://github.com/Abdoulrazack1/Logic-Lens

---

## Plan

### 1. Le problème
- Tu lis une fonction sans commentaires. Tu *peux* en déduire ce qu'elle fait. Mais ça prend du temps.
- Les outils existants (linters, formatters) te disent *si* le code est bon, pas *quoi* il calcule.
- Question : peut-on entraîner une IA à extraire la **formule mathématique** derrière n'importe quelle fonction ?

### 2. L'intuition
- Si on prend la même fonction et qu'on la mute syntaxiquement (rename, reorder, inline), la formule sous-jacente est invariante.
- Donc : si on génère un dataset de **(mutations) → (formule unique)**, un modèle devrait apprendre à projeter dans la direction (code → formule).

### 3. L'architecture
```
Function JS  →  Acorn AST  →  Tokenizer  →  Transformer Encoder  →  Formule
                              (DFS)          (TF.js, 4L, 8H, d=128)
```

### 4. Le pipeline de génération de dataset
- Fonctions seed (factorial, fibonacci, abs, clamp, lerp, polynomial evals)
- Opérateurs de mutation :
  - Variable rename
  - Statement reorder (quand sémantiquement équivalent)
  - Expression equivalence (`a + b` → `b + a`, `a * 2` → `a << 1`)
  - Inline / extract
- **~3000 paires générées en quelques secondes**

### 5. Le modèle TF.js
- Pourquoi TF.js (cible : devs JS, inférence dans le navigateur)
- Architecture détaillée
- Training : Adam, lr=1e-3, 500 epochs, ~5 min CPU
- Hyperparamètres choisis empiriquement

### 6. Résultats
- Accuracy par token : 0.91
- Accuracy exact match : 0.72
- Tableau de fonctions testées avec confiance

### 7. Limites
- Dataset synthétique → biais
- Side-effects pas modélisés
- Out-of-distribution chute rapide

### 8. Roadmap
- Enrichir le dataset via scraping GitHub
- Port Python (richesse de l'écosystème ML)
- Plugin VS Code (inline formula extraction)
- Comparaison contre CodeBERT / GPT-4

### 9. Liens
- Repo : https://github.com/Abdoulrazack1/Logic-Lens
- Démo en ligne : [à déployer]

---

## Conseils rédaction

- **Inclure du code visible** dans Dev.to (les snippets sont highlightés)
- 3-5 visuels :
  1. Diagramme architecture
  2. Screenshot interface web
  3. Table de résultats
  4. AST visualization avant/après mutation
  5. Loss curve du training
- Cible : 2000-3000 mots
- CTA fin : "Star sur GitHub, ouvre une issue avec une fonction qui devrait marcher mais qui échoue"

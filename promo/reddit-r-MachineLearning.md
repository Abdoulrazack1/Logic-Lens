# Reddit — r/MachineLearning

**Subreddit cible :** r/MachineLearning
**Flair :** `[P] Project`
**Best time :** mardi-jeudi, 15h-19h UTC

---

## Titre

> [P] Logic-Lens — Transformer Encoder (TF.js) that extracts mathematical invariants from JavaScript functions

---

## Body

Hi r/MachineLearning,

J'ai construit un proof of concept : un Transformer Encoder qui prend en entrée un AST JavaScript et apprend à projeter vers la **formule mathématique sous-jacente** de la fonction.

### Architecture

- **Tokenization** : nodes AST sérialisés en séquence (DFS traversal avec tags de type)
- **Encoder** : Transformer (TF.js CPU backend) — 4 layers, 8 heads, d_model=128
- **Decoder** : projection linéaire vers vocab de formules mathématiques
- **Training** : 500 epochs, Adam, lr=1e-3 → 0.7-0.9 accuracy sur held-out set

### Dataset

Synthétique, généré via mutations AST :
1. Fonctions seed (factorial, fibonacci, abs, clamp, lerp, polynomial evaluations…)
2. Pour chaque seed → ~30-50 mutations (rename, reorder, inline/extract, expression equivalence)
3. Label : la formule mathématique en notation symbolique (LaTeX-ish)
4. **Total : ~3000 paires**

Le code de génération est dans `npm run generate`.

### Résultats

Sur held-out :
- **Accuracy exact match** : 0.72
- **Accuracy par token** : 0.91
- **Confiance moyenne** sur des fonctions in-distribution : 0.85-0.95

Sur out-of-distribution :
- Closures complexes / IIFE / generators → 0.3-0.5 confiance (le modèle "sait" qu'il sait pas)

### Pourquoi TF.js et pas PyTorch

- Cible : devs JS (l'outil tourne dans leur stack)
- Inférence dans le navigateur via `npm run serve` (pas de backend nécessaire)
- CPU backend = pas de compilation native, install en 30s

### Limites connues

- **Dataset trop synthétique** — le prochain step est de scraper GitHub via `generate-dataset.js` pour enrichir avec du code réel annoté
- **Pas de side-effect modeling** — fonctions pures uniquement
- **Vocab limité** — pas (encore) capable d'inventer une nouvelle formule, juste de matcher contre le training set

### Code

https://github.com/Abdoulrazack1/Logic-Lens

MIT, contributions bienvenues — surtout sur l'enrichissement du dataset et les ports vers d'autres langages (Python via `ast`, TypeScript via compiler API).

Je serais intéressé par vos retours sur :
- Si vous connaissez des papiers pertinents sur `code → symbolic representation` (au-delà de program synthesis qui va dans le sens inverse)
- Si vous voyez des biais dans le pipeline que je n'ai pas vus
- Si quelqu'un veut benchmarker contre d'autres approches (CodeBERT fine-tuné ? GPT-4 prompté ?)

---

## Notes

- r/MachineLearning est exigeant sur la rigueur — **inclure les numbers** (accuracy, dataset size, training time)
- Pas de cross-post sur r/MachineLearningPapers (réservé aux papiers académiques)
- Si la discussion devient technique pointue, prépare-toi à défendre tes choix d'archi

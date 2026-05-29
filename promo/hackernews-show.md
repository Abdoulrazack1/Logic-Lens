# Hacker News — Show HN

**URL :** https://news.ycombinator.com/submit
**Best time :** mardi-jeudi 8h-11h EST (best traffic + algo boost)

---

## Titre

> Show HN: Logic-Lens – AI that extracts mathematical invariants from JS functions

Alternatives :
- "Show HN: Logic-Lens – TensorFlow.js model that decodes the 'why' of JavaScript code"
- "Show HN: Logic-Lens – Extracting mathematical formulas from JS via AST mutations + Transformer"

---

## URL

Si la démo est déployée → URL de la démo en direct (max effet HN)
Sinon → URL du repo : https://github.com/Abdoulrazack1/Logic-Lens

⚠️ **HN privilégie les démos jouables.** Déployer `npm run serve` sur Vercel/Netlify/Render avant de poster.

---

## First comment (à poster toi-même immédiatement après submit)

Hey HN,

Logic-Lens is an experimental project that asks: **can we train a small Transformer to extract the mathematical invariant behind a JavaScript function — not just summarize it in natural language?**

### The approach

1. Take a JS function → parse it with `acorn` → get the AST
2. Generate ~3000 syntactic mutations of that same function (rename vars, reorder operations, expression equivalence, inline/extract)
3. Train a Transformer Encoder (TensorFlow.js, CPU backend) on the (mutation → formula) pairs
4. At inference, the model projects an unseen AST to its formula

### What works

Functions in the training distribution (factorial, fibonacci, abs, clamp, lerp, polynomial evaluations) get extracted with 70-95% confidence:

```
fact(n) = n * fact(n-1)        →  n!                                (0.96)
fib(n)  = fib(n-1) + fib(n-2)  →  F(n) = F(n-1) + F(n-2)            (0.94)
Math.abs(x)                    →  |x|                               (0.99)
clamp(x, lo, hi)               →  min(hi, max(lo, x))               (0.88)
lerp(a, b, t)                  →  a + t*(b - a)                     (0.92)
```

### What doesn't work (yet)

- Functions far from the training distribution (complex closures, IIFEs, generators) get low confidence
- No side-effect awareness — Logic-Lens reasons on pure functions
- Dataset is currently 3000 pairs — generated synthetically, not from real-world code

### Why this matters

If we can reliably extract invariants from arbitrary code, it opens doors for:
- **Verified refactoring** (does your rewrite preserve the invariant?)
- **Reverse engineering** of obscured / legacy / uncommented code
- **Educational tooling** (visualize the code → math transformation)
- **Static analysis** (detect functions whose formula reveals a security flaw)

### The stack

Vanilla Node.js, TensorFlow.js (CPU backend, no GPU needed for inference), `acorn` for AST. Zero native compilation — `npm install && npm run train` runs in ~5 minutes on a laptop.

### Code

https://github.com/Abdoulrazack1/Logic-Lens

### Limits I'm honest about

- This is a **proof of concept**, not a production tool yet
- The synthetic dataset has bias — extending to real-world code (via `generate-dataset.js` scraping GitHub) is the next step
- A port to TypeScript types or Python would significantly enrich it

I'd love feedback on:
- Whether you'd find this useful in your workflow
- Functions you expect should work but don't
- Pointers to academic work on AST→formula extraction (I know about [program synthesis] but this is the inverse direction)

Happy to answer questions in the comments.

---

## Comment optimiser

- **Soumettre seul** depuis ta propre IP (pas de coordination upvote — HN détecte et pénalise)
- Répondre dans les 30 min à chaque commentaire pendant les 4 premières heures
- **Pas de surclaim** — la doc HN community déteste les pitchs survendus
- Si quelqu'un mentionne un papier académique pertinent, **lis-le** et réponds techniquement
- Si tu atteins la front page, ne re-poste pas dans les 30 jours

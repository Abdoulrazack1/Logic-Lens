// Exemple : fibonacci obfusqué (for → while + variables renommées)
// Logic-Lens devrait détecter : "Suite de Fibonacci : F(n) = F(n-1) + F(n-2)"

function sequence(val) {
  const _unused = 0;
  if (val <= 1) return val;
  let p = 0, q = 1;
  let counter = 2;
  while (counter <= val) {
    const hold = p + q;
    p = q;
    q = hold;
    counter++;
  }
  return q;
}

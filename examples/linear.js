// Exemple : fonction linéaire obfusquée
// Logic-Lens devrait détecter : "Fonction linéaire : y = ax + b"

function weirdCalc(alpha, beta, gamma) {
  const tmp = beta * alpha;
  return tmp + gamma;
}

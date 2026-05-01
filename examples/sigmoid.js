// Exemple : sigmoïde obfusquée (variable intermédiaire extraite)
// Logic-Lens devrait détecter : "Fonction sigmoïde : σ(x) = 1 / (1 + e^(-x))"

function activate(input) {
  const intermediate = Math.exp(-input);
  const result = 1 / (1 + intermediate);
  return result;
}

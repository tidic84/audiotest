// Intervalle entre deux ticks affichés sur la timeline. Sert aussi de pas de
// snap par défaut pour rester aligné sur la grille visible.
export function pickTickInterval(duration) {
    if (duration < 5) return 0.2;
    if (duration < 20) return 0.5;
    if (duration < 60) return 1;
    if (duration < 300) return 5;
    return 30;
}

// Renvoie la valeur snappée la plus proche de `t` parmi :
//  - les valeurs dans `candidates` (bords de clips, playhead…)
//  - les multiples de `snapStep` (grille temporelle)
// dans un rayon `thresholdSec`. Renvoie `t` inchangé si rien n'est assez proche.
//
// `minTarget`/`maxTarget` permettent un filtre directionnel : pendant un drag
// vers la droite, on borne par `minTarget = position d'origine` pour empêcher
// le snap de tirer en arrière.
export function snapTime(
    t,
    { snapStep, candidates = [], thresholdSec, minTarget = -Infinity, maxTarget = Infinity },
) {
    let best = t;
    let bestDist = thresholdSec;

    // Comparaisons strictes : si minTarget/maxTarget = position d'origine du
    // bord du clip, on EXCLUT cette position d'origine pour ne pas snapper en
    // arrière à un drag de quelques pixels quand le clip était déjà aligné.
    for (const c of candidates) {
        if (c <= minTarget || c >= maxTarget) continue;
        const d = Math.abs(c - t);
        if (d <= bestDist) {
            best = c;
            bestDist = d;
        }
    }

    if (snapStep > 0) {
        const gridT = Math.round(t / snapStep) * snapStep;
        if (gridT > minTarget && gridT < maxTarget) {
            const d = Math.abs(gridT - t);
            if (d <= bestDist) {
                best = gridT;
                bestDist = d;
            }
        }
    }

    return best;
}

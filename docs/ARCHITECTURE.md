# Architecture de l'éditeur audio

## 1. Modèle mental : édition non-destructive (EDL)

Toute l'app repose sur un principe : **le fichier audio brut n'est jamais modifié**. On stocke à la place une liste d'opérations (Edit Decision List) qui décrit quoi lire, dans quel ordre.

### Le buffer

Quand on enregistre ou qu'on importe un audio :
1. Le blob brut (sortie de `MediaRecorder`) est sauvegardé tel quel sur disque (`.webm`).
2. Il est décodé en `AudioBuffer` en mémoire pour pouvoir le lire et calculer les peaks.
3. Ce buffer est **immutable** — on ne le coupe ni ne le réécrit jamais.

### Les segments

Un segment pointe dans le buffer :

```js
{ id, srcStart, srcEnd }   // en secondes dans le buffer
```

Il représente "joue le buffer de la seconde X à la seconde Y".

### Les pistes

Une piste = un buffer + une EDL (liste ordonnée de segments) + des métadonnées :

```js
{
    id,           // UUID — sert aussi de nom de fichier (.webm)
    name,         // affiché à l'utilisateur
    buffer,       // AudioBuffer (en mémoire seulement)
    edl: [        // ordre = ordre de lecture
        { id, srcStart, srcEnd },
        ...
    ]
}
```

La **timeline visible/audible** d'une piste = concaténation des segments dans l'ordre. Une piste fraîchement enregistrée a un seul segment qui couvre tout le buffer (`srcStart=0`, `srcEnd=buffer.duration`).

### Une édition = une transformation de l'EDL

- **Couper de t1 à t2** → on remplace le segment qui couvre cette plage par deux segments (l'avant et l'après).
- **Coller B dans A** → on insère un ou plusieurs segments référençant le buffer de B au milieu de l'EDL de A.
- **Annuler** → on garde l'EDL précédente.

Aucune de ces opérations ne touche au buffer audio. C'est rapide, réversible, et économique en stockage.

---

## 2. Arbre des fichiers

```
src/
├── AudioRecorder.jsx              ← orchestrateur (state, controls, JSX)
├── TrackView.jsx                  ← UI d'une piste (waveform + boutons)
├── lib/
│   ├── edl.js                     ← modèle EDL pur (fonctions, pas de React)
│   ├── playback.js                ← scheduling Web Audio
│   └── pithekosStorage.js         ← API backend (paths + fetch helpers)
└── hooks/
    ├── useProjectPersistence.js   ← charge le projet, sauve le JSON debounced
    └── useRecorder.js             ← encapsule MediaRecorder
```

### Responsabilité de chaque fichier

| Fichier | Rôle | Dépend de |
|---|---|---|
| `lib/edl.js` | Modèle pur : créer des segments/pistes, calculer la durée virtuelle, générer les peaks à afficher. Testable sans navigateur. | rien |
| `lib/playback.js` | Schedule les `AudioBufferSourceNode` pour lire une piste en respectant son EDL. Toutes les pistes démarrent au même instant. | Web Audio API |
| `lib/pithekosStorage.js` | Construit les URLs `/burrito/...`, lit/écrit les blobs et le JSON. Si on changeait de backend, on ne modifierait que ce fichier. | `fetch` |
| `hooks/useProjectPersistence.js` | Au mount : charge le `_project.json` et re-décode les `.webm` en `AudioBuffer`. À chaque modif de `tracks` : sauve le JSON (debounced 500 ms). | `lib/edl`, `lib/pithekosStorage` |
| `hooks/useRecorder.js` | Possède le `MediaRecorder`, les chunks, l'état `isRecording`. À l'arrêt : sauve le blob, décode, ajoute une piste. | `lib/edl`, `lib/pithekosStorage` |
| `TrackView.jsx` | Affiche une piste : waveform via `WavesurferPlayer`, calcule les peaks depuis l'EDL, expose les boutons d'action. | `lib/edl`, `@wavesurfer/react` |
| `AudioRecorder.jsx` | Compose le tout : state `tracks`, branche les deux hooks, gère lecture/stop et les actions transverses. | tout le reste |

---

## 3. Cycle de vie

### Au mount

1. `AudioRecorder` calcule `paths` à partir de `metadata.local_path` et `obs` (chapitre, paragraphe).
2. `useProjectPersistence` tente de `GET _project.json`.
3. **Si trouvé** : pour chaque entrée du JSON, on `GET` le `.webm`, on le décode en `AudioBuffer`, on reconstruit la piste avec son EDL.
4. **Sinon** : on importe `audioUrl` (le mp3 par défaut), on l'upload comme piste 1.
5. `setProjectLoaded(true)` débloque les sauvegardes futures.

### Pendant une session

| Action utilisateur | Effet sur `tracks` | Effet sur disque |
|---|---|---|
| Clic sur **Record** | rien (encore) | rien |
| Clic sur **Stop record** | `setTracks(prev => [...prev, makeTrack(...)])` | upload du `.webm` + (via le useEffect debounced) update du `_project.json` |
| Clic sur **Couper** | `setTracks` avec une nouvelle EDL | update du `_project.json` uniquement |
| Clic sur **Supprimer piste** | `setTracks(ts => ts.filter(...))` | `DELETE` du `.webm` + update du `_project.json` |

Le découplage critique : **modifier l'EDL ne touche jamais aux fichiers `.webm`**. Seul l'enregistrement et la suppression de piste les manipulent.

### Lecture

`scheduleTracks(ctx, tracks)` crée un `AudioBufferSourceNode` par segment de chaque piste, calcule le moment auquel chaque segment doit démarrer (`currentTime + lead + offsetDansLaPiste`), et appelle `src.start(...)`. Toutes les pistes démarrent au même instant absolu, donc elles restent synchronisées. Le rendu visuel (la waveform) n'a rien à voir avec ça — il vient des peaks pré-calculés.

---

## 4. Comment ajouter une opération d'édition

C'est l'étape qui prouve que l'architecture marche. Trois exemples concrets.

### Exemple 1 : couper une plage [t1, t2] sur une piste

Ajouter dans `lib/edl.js` :

```js
export function cutRange(edl, vStart, vEnd) {
    if (vEnd <= vStart) return edl;
    const result = [];
    let acc = 0;
    for (const seg of edl) {
        const segDur = seg.srcEnd - seg.srcStart;
        const segVStart = acc;
        const segVEnd = acc + segDur;
        if (segVEnd <= vStart || segVStart >= vEnd) {
            result.push(seg); // hors zone coupée
        } else {
            if (segVStart < vStart) {
                result.push(makeSegment(
                    seg.srcStart,
                    seg.srcStart + (vStart - segVStart),
                ));
            }
            if (segVEnd > vEnd) {
                result.push(makeSegment(
                    seg.srcStart + (vEnd - segVStart),
                    seg.srcEnd,
                ));
            }
        }
        acc += segDur;
    }
    return result;
}
```

Puis dans le composant : `setTracks(ts => ts.map(t => t.id === id ? {...t, edl: cutRange(t.edl, t1, t2)} : t))`.

### Exemple 2 : convertir un temps virtuel vers une position source

Utile pour copier un morceau (il faut savoir où il se trouve dans le buffer original) :

```js
export function virtualToSource(edl, vTime) {
    let acc = 0;
    for (const seg of edl) {
        const segDur = seg.srcEnd - seg.srcStart;
        if (vTime <= acc + segDur) {
            return { srcTime: seg.srcStart + (vTime - acc) };
        }
        acc += segDur;
    }
    const last = edl[edl.length - 1];
    return { srcTime: last.srcEnd };
}
```

### Exemple 3 : copier-coller

- **Copier** : on lit `[vStart, vEnd]` sur la piste source. On résout les positions sources via `virtualToSource`. On stocke `{ bufferRef, srcStart, srcEnd }` dans un state "clipboard".
- **Coller à `vAt` sur la piste cible** : on splitte la piste cible en `vAt`, et on insère un segment qui pointe vers le buffer source.

**Subtilité importante** : si on colle un morceau de la piste A dans la piste B, le segment collé pointe toujours vers le buffer de A. Ça veut dire que :
- Soit on accepte qu'une piste référence plusieurs buffers (modèle plus puissant — il faut alors qu'un segment porte aussi `bufferId`).
- Soit on duplique : on copie le morceau du buffer A dans un nouveau buffer/fichier dédié pour la piste B.

La première option est plus propre et plus efficace en stockage. Si tu pars dans cette direction, il faudra renommer `track.buffer` en `track.buffers: { [id]: AudioBuffer }` et ajouter `bufferId` dans chaque segment.

---

## 5. Afficher une timeline commune entre les pistes

Aujourd'hui, chaque `TrackView` rend sa waveform indépendamment, en remplissant 100% de sa largeur. Conséquence : une piste de 10s et une piste de 20s ont la même largeur à l'écran, donc 1 seconde n'a pas la même position horizontale d'une piste à l'autre — visuellement, c'est désynchronisé.

### Étape A : un facteur d'échelle commun

Dans `AudioRecorder.jsx`, calculer :

```js
const projectDuration = useMemo(
    () => tracks.reduce((m, t) => Math.max(m, virtualDuration(t)), 0),
    [tracks],
);
```

C'est la longueur de la piste la plus longue. Toutes les pistes seront affichées sur cette base.

### Étape B : largeur proportionnelle par piste

Dans `TrackView`, passer `projectDuration` en prop et calculer une largeur relative :

```jsx
function TrackView({ track, projectDuration, onDelete, onDemoCut }) {
    const dur = useMemo(() => virtualDuration(track), [track]);
    const widthPct = projectDuration > 0
        ? (dur / projectDuration) * 100
        : 100;
    // ...
    return (
        <Box sx={{ /* ... */ }}>
            {/* header avec nom + boutons */}
            <Box sx={{ width: `${widthPct}%` }}>
                <WavesurferPlayer
                    height={80}
                    peaks={[peaks]}
                    duration={dur}
                    /* ... */
                />
            </Box>
        </Box>
    );
}
```

À partir de là, une piste deux fois plus courte fait la moitié de la largeur — 1 seconde occupe la même distance à l'écran d'une piste à l'autre.

### Étape C : un composant `Timeline` au-dessus des pistes

Créer `src/Timeline.jsx`. Il dessine des graduations en SVG sur la largeur du projet :

```jsx
export default function Timeline({ projectDuration, height = 24 }) {
    if (projectDuration === 0) return null;
    const tickEvery = pickTickInterval(projectDuration); // 1s, 5s, 10s...
    const ticks = [];
    for (let t = 0; t <= projectDuration; t += tickEvery) {
        const xPct = (t / projectDuration) * 100;
        ticks.push({ t, xPct });
    }
    return (
        <Box sx={{ position: "relative", height, width: "100%", borderBottom: "1px solid #ccc" }}>
            {ticks.map(({ t, xPct }) => (
                <Box
                    key={t}
                    sx={{
                        position: "absolute",
                        left: `${xPct}%`,
                        top: 0,
                        bottom: 0,
                        borderLeft: "1px solid #999",
                        fontSize: 10,
                        pl: "2px",
                    }}
                >
                    {formatTime(t)}
                </Box>
            ))}
        </Box>
    );
}

function pickTickInterval(dur) {
    if (dur < 10) return 1;
    if (dur < 60) return 5;
    if (dur < 300) return 30;
    return 60;
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
}
```

Dans `AudioRecorder.jsx`, l'inclure au-dessus des pistes :

```jsx
<Timeline projectDuration={projectDuration} />
{tracks.map(t => (
    <TrackView key={t.id} track={t} projectDuration={projectDuration} ... />
))}
```

### Étape D (optionnelle) : playhead synchronisé

Pour avoir un curseur vertical qui traverse toutes les pistes en lecture :

1. Dans `AudioRecorder.jsx`, stocker `playStartedAt` (le `ctx.currentTime` au moment du `play`).
2. Lancer une boucle `requestAnimationFrame` qui calcule `elapsed = ctx.currentTime - playStartedAt` et met à jour un state `playheadTime`.
3. Rendre une `<Box>` absolument positionnée dans un wrapper qui contient le timeline + les pistes, à `left: (playheadTime / projectDuration) * 100%`.

Voilà : un seul curseur, traversant toutes les pistes, synchrone avec l'audio (parce que le temps vient du même `AudioContext` qui pilote la lecture).

---

## 6. Réintégrer les régions wavesurfer

Le plugin `Regions` de wavesurfer permet à l'utilisateur de dessiner des plages sur la waveform (cliquer-glisser). Dans notre modèle non-destructif, **une région est une sélection sur la timeline virtuelle**, pas une modification du buffer.

### Installer le plugin

`@wavesurfer/react` v1 expose wavesurfer.js v7. Le plugin Regions est importé depuis le package wavesurfer principal :

```jsx
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
```

(Si l'import ne marche pas avec ton bundler, essaye `wavesurfer.js/plugins/regions` ou regarde le contenu de `node_modules/wavesurfer.js/dist/plugins/`.)

### Brancher le plugin dans `TrackView`

```jsx
import { useState, useMemo, useRef } from "react";
import WavesurferPlayer from "@wavesurfer/react";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";

export default function TrackView({ track, projectDuration, onCutSelection, ... }) {
    const [selection, setSelection] = useState(null); // { start, end } en temps virtuel
    const regionsRef = useRef(null);

    const handleReady = (ws) => {
        const regions = ws.registerPlugin(RegionsPlugin.create());
        regionsRef.current = regions;
        regions.enableDragSelection({ color: "rgba(255, 100, 0, 0.2)" });
        regions.on("region-created", (region) => {
            // wavesurfer autorise plusieurs régions ; on n'en garde qu'une
            regions.getRegions().forEach(r => { if (r.id !== region.id) r.remove(); });
            setSelection({ start: region.start, end: region.end });
        });
        regions.on("region-updated", (region) => {
            setSelection({ start: region.start, end: region.end });
        });
    };

    return (
        <Box sx={{ /* ... */ }}>
            <Stack direction="row" justifyContent="space-between">
                <strong>{track.name}</strong>
                <Button
                    disabled={!selection}
                    onClick={() => {
                        onCutSelection(selection.start, selection.end);
                        regionsRef.current?.clearRegions();
                        setSelection(null);
                    }}
                >
                    Couper la sélection
                </Button>
            </Stack>
            <WavesurferPlayer
                height={80}
                peaks={[peaks]}
                duration={dur}
                onReady={handleReady}
                /* ... */
            />
        </Box>
    );
}
```

Côté `AudioRecorder.jsx`, le handler utilise `cutRange` :

```jsx
import { cutRange } from "./lib/edl";

const cutSelection = (trackId, vStart, vEnd) => {
    setTracks(ts => ts.map(t =>
        t.id === trackId ? { ...t, edl: cutRange(t.edl, vStart, vEnd) } : t
    ));
};

// dans le JSX :
<TrackView
    onCutSelection={(s, e) => cutSelection(t.id, s, e)}
    /* ... */
/>
```

### Le point clé à comprendre

Quand wavesurfer dit "la région est à `region.start = 3.2s`", ce 3.2s est dans **la timeline virtuelle de la piste** (celle qu'on a passée via `duration={dur}`). C'est exactement ce dont `cutRange` a besoin. La traduction vers les positions dans le buffer (qui peut être complètement différente à cause des coupes précédentes) est gérée par `cutRange` en interne.

C'est ce qui rend cette architecture confortable : **l'UI travaille toujours en temps virtuel**, et seules les fonctions de `lib/edl.js` connaissent le mapping vers le buffer.

### Pour aller plus loin

- Régions persistantes (visualiser les coupes après application) : il faudrait inverser la logique — au lieu de stocker des segments à garder, stocker les coupes à appliquer, et calculer l'EDL au vol. Choix de design, ni meilleur ni pire.
- Drag pour redimensionner une région : géré par le plugin via `region-updated`.
- Régions multiples (sélection multi-coupes en une fois) : retirer le `forEach` qui supprime les autres, et appliquer `cutRange` plusieurs fois en cascade (attention : couper modifie les positions virtuelles, donc il faut couper de droite à gauche pour que les sélections suivantes restent valides).

# Le buffer, c'est quoi ?

Un `AudioBuffer` c'est l'audio **décodé**, sous forme de tableaux de nombres en mémoire — un échantillon par valeur, prêt à être joué par la carte son.

Concrètement, quand on enregistre un .wav/.webm, le fichier brut est compressé/encodé. Avant de pouvoir le lire ou le manipuler, il faut le décoder :

```js
const blob = await fetch(url).then(r => r.blob());
const arrayBuffer = await blob.arrayBuffer();
const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
// audioBuffer.getChannelData(0)  -> Float32Array de tous les samples du canal 0
// audioBuffer.duration            -> durée en secondes
// audioBuffer.sampleRate          -> 44100, 48000, etc.
```

Un AudioBuffer typique pour 10 secondes à 48 kHz = **480 000 nombres flottants**. C'est gros, mais c'est ce que la Web Audio API joue directement (`AudioBufferSourceNode.buffer = audioBuffer`).

---

## Comment ça s'organise dans le projet

Modèle **non-destructif** (utilisé par les vrais éditeurs audio comme Audacity, Reaper). Le commentaire en haut de `src/lib/edl.js` le dit :

```
track   = { id, name, buffer, edl: Segment[] }
segment = { id, srcStart, srcEnd, buffer?, bufferTrackId? }
```

- `track.buffer` : l'AudioBuffer "original" décodé du fichier de la piste. **Immutable** : on ne le modifie jamais.
- `track.edl` : la liste de segments qui décrit ce qu'on entend/voit. Chaque segment dit "joue les secondes [srcStart..srcEnd] du buffer".

Exemple : on enregistre 10 s d'audio, on obtient un track avec un seul segment `{ srcStart: 0, srcEnd: 10 }`. On coupe de 3 à 5 s ? On ne touche pas au buffer, on remplace l'EDL par `[{0, 3}, {5, 10}]`. La timeline visible passe de 10 s à 8 s, mais le buffer est intact — on peut faire revert/undo en remettant l'ancien EDL.

---

## Pourquoi un buffer par segment ?

Tant qu'on reste dans la même piste, le segment référence `track.buffer` implicitement et c'est suffisant. Mais dès qu'on **copie-colle inter-pistes**, le segment importé ne référence plus le bon buffer — il vient d'une autre piste avec son propre AudioBuffer.

D'où `segment.buffer` (optionnel) :

```js
// segmentBuffer renvoie le buffer effectif à utiliser pour ce segment :
function segmentBuffer(seg, trackBuffer) {
  return seg.buffer && typeof seg.buffer.getChannelData === "function"
    ? seg.buffer          // override : segment importé d'une autre piste
    : trackBuffer;        // par défaut : buffer de la piste hôte
}
```

Au moment de `play` ou de `computeVirtualPeaks`, on regarde segment par segment quel buffer utiliser.

---

## Pourquoi deux champs (`buffer` + `bufferTrackId`) ?

Un `AudioBuffer` est un **objet en mémoire** lié au navigateur courant. Il n'est **pas sérialisable** :
- `JSON.stringify(audioBuffer)` → `"{}"` (perd toute l'info).
- Au reload de la page, l'objet a disparu.

Donc pour persister le projet, deux champs sur le segment :

| Champ | Type | Sérialisable ? | Utilité |
|---|---|---|---|
| `buffer` | `AudioBuffer` | non | Réf runtime directe, rapide à utiliser |
| `bufferTrackId` | `string` (id de piste) | oui | Réf logique qui survit au save/reload |

Au **save** (dans `useProjectPersistence`), on strip `buffer` :

```js
edl: edl.map(({ buffer: _b, ...rest }) => rest)  // on garde bufferTrackId
```

Au **load**, on charge les buffers de toutes les pistes via leur audio file, puis on ré-attache la réf :

```js
const buffersById = new Map(loaded.map(t => [t.id, t.buffer]));
seg.buffer = seg.bufferTrackId ? buffersById.get(seg.bufferTrackId) : null;
```

C'est ce qui a corrigé le crash entre navigateurs : avant, `seg.buffer` était sérialisé en `{}` (objet vide), au reload `segBuf.getChannelData()` plantait parce que `{}` n'a évidemment pas cette méthode.

---

## En résumé visuel

```
Fichier audio (.wav)           <- stocké sur disque (pithekos)
        |
        v decodeAudioData
   AudioBuffer (RAM)            <- gros tableau de samples, immutable, non sérialisable
        |
        v référencé par
   track.buffer                 <- la piste pointe sur SON buffer
        |
        v
   segment { srcStart, srcEnd } <- "joue cette plage de SON buffer"
        |
        v pour le copier-coller :
   segment { ..., buffer (réf runtime), bufferTrackId (réf persistante) }
                                <- le segment peut pointer vers un AUTRE buffer
```

On ne manipule **jamais** les samples directement : on ne fait que jouer avec les `srcStart`/`srcEnd` (timings) et les références. C'est la magie du modèle EDL non-destructif.

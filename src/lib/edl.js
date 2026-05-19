// EDL (Edit Decision List) — modèle non-destructif. Pas de React, pas d'audio context.
//
// track   = { id, name, buffer (AudioBuffer immutable), edl: Segment[] }
// segment = { id, srcStart, srcEnd, buffer?, bufferTrackId? }
//
// La timeline visible/audible d'une piste = concaténation des segments dans l'ordre.
// Le buffer n'est jamais modifié ; toute édition = transformation de l'EDL.
//
// Pour le copier-coller inter-pistes, un segment porte deux champs liés :
//   - `buffer`         : réf runtime vers un AudioBuffer (non sérialisable, perdue au reload).
//   - `bufferTrackId`  : id de la piste dont vient ce buffer (sérialisable). Au chargement
//                        du projet on l'utilise pour ré-attacher la réf runtime.
// Si les deux sont absents, le segment utilise le buffer de la piste qui le contient.

export function makeSegment(srcStart, srcEnd, buffer = null, bufferTrackId = null) {
    return { id: crypto.randomUUID(), srcStart, srcEnd, buffer, bufferTrackId };
}

export function makeTrack(buffer, name, id = crypto.randomUUID()) {
    return {
        id,
        name,
        buffer,
        edl: [makeSegment(0, buffer.duration)],
    };
}

export function virtualDuration(track) {
    return track.edl.reduce((s, seg) => s + (seg.srcEnd - seg.srcStart), 0);
}

// Buffer effectif pour un segment : son override runtime, sinon celui de la piste.
// On vérifie qu'il s'agit bien d'un AudioBuffer (présence de getChannelData) pour
// éviter de tomber sur un objet résiduel issu d'une sérialisation JSON.
export function segmentBuffer(seg, trackBuffer) {
    const b = seg.buffer;
    return b && typeof b.getChannelData === "function" ? b : trackBuffer;
}

// Construit les peaks de la timeline virtuelle à partir du buffer + EDL.
// Pour chaque segment, on remplit la portion correspondante du tableau de sortie.
export function computeVirtualPeaks(buffer, edl, targetLen) {
    const total = edl.reduce((s, seg) => s + (seg.srcEnd - seg.srcStart), 0);
    const peaks = new Float32Array(targetLen);
    if (total === 0) return peaks;

    let virt = 0;
    for (const seg of edl) {
        const segBuf = segmentBuffer(seg, buffer);
        const ch = segBuf.getChannelData(0);
        const sr = segBuf.sampleRate;
        const segDur = seg.srcEnd - seg.srcStart;
        const b0 = Math.floor((virt / total) * targetLen);
        const b1 = Math.floor(((virt + segDur) / total) * targetLen);
        const s0 = Math.floor(seg.srcStart * sr);
        const s1 = Math.floor(seg.srcEnd * sr);
        const binSize = (s1 - s0) / Math.max(b1 - b0, 1);
        for (let i = b0; i < b1; i++) {
            const a = Math.floor(s0 + (i - b0) * binSize);
            const b = Math.floor(s0 + (i - b0 + 1) * binSize);
            let max = 0;
            for (let j = a; j < b && j < ch.length; j++) {
                const v = Math.abs(ch[j]);
                if (v > max) max = v;
            }
            peaks[i] = max;
        }
        virt += segDur;
    }
    return peaks;
}

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
                    seg.buffer,
                    seg.bufferTrackId,
                ));
            }
            if (segVEnd > vEnd) {
                result.push(makeSegment(
                    seg.srcStart + (vEnd - segVStart),
                    seg.srcEnd,
                    seg.buffer,
                    seg.bufferTrackId,
                ));
            }
        }
        acc += segDur;
    }
    return result;
}

// Extrait les segments couvrant la plage virtuelle [vStart, vEnd], clippés aux bords.
// Retourne un nouvel array de segments avec des id frais. `sourceBuffer` et `sourceTrackId`
// sont attachés aux segments qui n'avaient pas déjà leur propre réf (utile pour le
// copier-coller inter-pistes : le buffer survit en mémoire, l'id survit à la persistance).
export function extractRange(edl, vStart, vEnd, sourceBuffer = null, sourceTrackId = null) {
    if (vEnd <= vStart) return [];
    const result = [];
    let acc = 0;
    for (const seg of edl) {
        const segDur = seg.srcEnd - seg.srcStart;
        const segVStart = acc;
        const segVEnd = acc + segDur;
        if (segVEnd > vStart && segVStart < vEnd) {
            const clipStart = Math.max(0, vStart - segVStart);
            const clipEnd = Math.min(segDur, vEnd - segVStart);
            result.push(makeSegment(
                seg.srcStart + clipStart,
                seg.srcStart + clipEnd,
                seg.buffer || sourceBuffer,
                seg.bufferTrackId || sourceTrackId,
            ));
        }
        acc += segDur;
    }
    return result;
}

// Insère des segments dans l'EDL à la position virtuelle vTime. Découpe le segment
// en cours si vTime tombe au milieu. Retourne un nouvel EDL.
export function insertAt(edl, vTime, segments) {
    if (!segments?.length) return edl;
    const result = [];
    let acc = 0;
    let inserted = false;
    for (const seg of edl) {
        const segDur = seg.srcEnd - seg.srcStart;
        const segVStart = acc;
        const segVEnd = acc + segDur;
        if (!inserted && vTime <= segVEnd) {
            const splitPoint = vTime - segVStart;
            if (splitPoint > 0) {
                result.push(makeSegment(seg.srcStart, seg.srcStart + splitPoint, seg.buffer, seg.bufferTrackId));
            }
            for (const s of segments) {
                result.push(makeSegment(s.srcStart, s.srcEnd, s.buffer, s.bufferTrackId));
            }
            if (splitPoint < segDur) {
                result.push(makeSegment(seg.srcStart + splitPoint, seg.srcEnd, seg.buffer, seg.bufferTrackId));
            }
            inserted = true;
        } else {
            result.push(seg);
        }
        acc += segDur;
    }
    if (!inserted) {
        for (const s of segments) {
            result.push(makeSegment(s.srcStart, s.srcEnd, s.buffer, s.bufferTrackId));
        }
    }
    return result;
}

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

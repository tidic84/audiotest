// EDL (Edit Decision List) — modèle non-destructif. Pas de React, pas d'audio context.
//
// track   = { id, name, buffer (AudioBuffer immutable), edl: Segment[] }
// segment = { id, srcStart, srcEnd }                // secondes dans `buffer`
//
// La timeline visible/audible d'une piste = concaténation des segments dans l'ordre.
// Le buffer n'est jamais modifié ; toute édition = transformation de l'EDL.

export function makeSegment(srcStart, srcEnd) {
    return { id: crypto.randomUUID(), srcStart, srcEnd };
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

// Construit les peaks de la timeline virtuelle à partir du buffer + EDL.
// Pour chaque segment, on remplit la portion correspondante du tableau de sortie.
export function computeVirtualPeaks(buffer, edl, targetLen) {
    const ch = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const total = edl.reduce((s, seg) => s + (seg.srcEnd - seg.srcStart), 0);
    const peaks = new Float32Array(targetLen);
    if (total === 0) return peaks;

    let virt = 0;
    for (const seg of edl) {
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
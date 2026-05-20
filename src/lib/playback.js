// Scheduling Web Audio : on lance toutes les pistes en parallèle à `currentTime + lead`,
// chaque piste joue ses segments dans l'ordre. Pas de re-render React déclenché.

import { segmentBuffer } from "./edl";

export function scheduleTracks(ctx, tracks, leadSeconds = 0.05) {
    const startAt = ctx.currentTime + leadSeconds;
    const sources = [];
    for (const t of tracks) {
        let when = startAt;
        for (const seg of t.edl) {
            const src = ctx.createBufferSource();
            src.buffer = segmentBuffer(seg, t.buffer);
            src.connect(ctx.destination);
            const dur = seg.srcEnd - seg.srcStart;
            src.start(when, seg.srcStart, dur);
            when += dur;
            sources.push(src);
        }
    }
    return sources;
}

// Joue une seule piste à partir d'un temps virtuel `vStart`.
// Pour chaque segment de l'EDL : ignoré si déjà passé, partiel si on tombe dedans,
// complet sinon. Le buffer source n'est jamais modifié.
export function scheduleTrackFrom(ctx, track, vStart = 0, leadSeconds = 0.05) {
    const startAt = ctx.currentTime + leadSeconds;
    const sources = [];
    let acc = 0;
    let when = startAt;
    for (const seg of track.edl) {
        const segDur = seg.srcEnd - seg.srcStart;
        const segVEnd = acc + segDur;
        if (segVEnd > vStart) {
            const offsetInSeg = Math.max(0, vStart - acc);
            const srcStart = seg.srcStart + offsetInSeg;
            const durToPlay = seg.srcEnd - srcStart;
            const src = ctx.createBufferSource();
            src.buffer = segmentBuffer(seg, track.buffer);
            src.connect(ctx.destination);
            src.start(when, srcStart, durToPlay);
            when += durToPlay;
            sources.push(src);
        }
        acc += segDur;
    }
    return sources;
}

export function stopSources(sources) {
    for (const s of sources) {
        try { s.stop(); } catch { }
    }
}

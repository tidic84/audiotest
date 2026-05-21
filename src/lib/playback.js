// Scheduling Web Audio : on lance toutes les pistes en parallèle à `currentTime + lead`,
// chaque piste joue ses segments dans l'ordre. Pas de re-render React déclenché.

import { segmentBuffer } from "./edl";

export function scheduleTracks(ctx, tracks, leadSeconds = 0.05) {
    const startAt = ctx.currentTime + leadSeconds;
    const sources = [];
    for (const t of tracks) { 
        for (const seg of t.edl) {
            const src = ctx.createBufferSource();
            src.buffer = segmentBuffer(seg, t.buffer);
            src.connect(ctx.destination);
            const dur = seg.srcEnd - seg.srcStart;
            src.start(startAt + seg.vStart, seg.srcStart, dur);
            sources.push(src);
        }
    }
    return sources;
}

export function scheduleTrackFrom(ctx, track, vStart = 0, leadSeconds = 0.05) {
    const startAt = ctx.currentTime + leadSeconds;
    const sources = [];
    for (const seg of track.edl) {
        const segDur = seg.srcEnd - seg.srcStart;
        const segVEnd = seg.vStart + segDur;

        if (segVEnd <= vStart) continue; // déjà passé

        // Combien on saute dans la source (0 si on prend le segment depuis son début)
        const offsetInSeg = Math.max(0, vStart - seg.vStart);
        // Décalage de planification (0 si on est dans le segment, > 0 si on l'attend)
        const playAt = startAt + Math.max(0, seg.vStart - vStart);
        const srcOffset = seg.srcStart + offsetInSeg;
        const durToPlay = seg.srcEnd - srcOffset;

        const src = ctx.createBufferSource();
        src.buffer = segmentBuffer(seg, track.buffer);
        src.connect(ctx.destination);
        src.start(playAt, srcOffset, durToPlay);
        sources.push(src);
    }
    return sources;
}

export function stopSources(sources) {
    for (const s of sources) {
        try { s.stop(); } catch { }
    }
}

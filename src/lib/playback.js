// Scheduling Web Audio : on lance toutes les pistes en parallèle à `currentTime + lead`,
// chaque piste joue ses segments dans l'ordre. Pas de re-render React déclenché.

export function scheduleTracks(ctx, tracks, leadSeconds = 0.05) {
    const startAt = ctx.currentTime + leadSeconds;
    const sources = [];
    for (const t of tracks) {
        let when = startAt;
        for (const seg of t.edl) {
            const src = ctx.createBufferSource();
            src.buffer = t.buffer;
            src.connect(ctx.destination);
            const dur = seg.srcEnd - seg.srcStart;
            src.start(when, seg.srcStart, dur);
            when += dur;
            sources.push(src);
        }
    }
    return sources;
}

export function stopSources(sources) {
    for (const s of sources) {
        try { s.stop(); } catch {}
    }
}

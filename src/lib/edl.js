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

export function makeSegment(vStart, srcStart, srcEnd, buffer = null, bufferTrackId = null) {
    return { id: crypto.randomUUID(), vStart, srcStart, srcEnd, buffer, bufferTrackId };
}

export function makeTrack(buffer, name, id = crypto.randomUUID()) {
    return {
        id,
        name,
        buffer,
        edl: [makeSegment(0, 0, buffer.duration)],
    };
}

// Durée totale de la timeline virtuelle d'une piste = somme des durées des segments de son EDL.
export function virtualDuration(track) {
    if (!track.edl || track.edl.length === 0) return 0;
    return Math.max(
        0,
        ...track.edl.map(seg => seg.vStart + (seg.srcEnd - seg.srcStart))
    );
}

// Buffer effectif pour un segment : son override runtime, sinon celui de la piste.
// On vérifie qu'il s'agit bien d'un AudioBuffer (présence de getChannelData) pour
// éviter de tomber sur un objet résiduel issu d'une sérialisation JSON.
export function segmentBuffer(seg, trackBuffer) {
    const b = seg.buffer;
    return b && typeof b.getChannelData === "function" ? b : trackBuffer;
}

// Peaks pour UN segment uniquement, à dessiner dans son propre canvas.
// Le tableau retourné a exactement `targetLen` bins.
export function computeSegmentPeaks(seg, trackBuffer, targetLen) {
    const peaks = new Float32Array(targetLen);
    const segBuf = segmentBuffer(seg, trackBuffer);
    if (!segBuf || targetLen <= 0) return peaks;
    const ch = segBuf.getChannelData(0);
    const sr = segBuf.sampleRate;
    const s0 = Math.floor(seg.srcStart * sr);
    const s1 = Math.floor(seg.srcEnd * sr);
    const binSize = (s1 - s0) / Math.max(targetLen, 1);
    for (let i = 0; i < targetLen; i++) {
        const a = Math.floor(s0 + i * binSize);
        const b = Math.floor(s0 + (i + 1) * binSize);
        let max = 0;
        for (let j = a; j < b && j < ch.length; j++) {
            const v = Math.abs(ch[j]);
            if (v > max) max = v;
        }
        peaks[i] = max;
    }
    return peaks;
}

// Construit les peaks de la timeline virtuelle à partir du buffer + EDL.
// Chaque segment dessine sa portion à [seg.vStart, seg.vStart + dur] dans le tableau.
// Les bins non couverts restent à 0 (= silence visuel, trous entre clips).
export function computeVirtualPeaks(buffer, edl, targetLen) {
    const peaks = new Float32Array(targetLen);
    if (edl.length === 0) return peaks;

    const totalDur = Math.max(0, ...edl.map(s => s.vStart + (s.srcEnd - s.srcStart)));
    if (totalDur === 0) return peaks;

    for (const seg of edl) {
        const segBuf = segmentBuffer(seg, buffer);
        const ch = segBuf.getChannelData(0);
        const sr = segBuf.sampleRate;
        const segDur = seg.srcEnd - seg.srcStart;
        const b0 = Math.floor((seg.vStart / totalDur) * targetLen);
        const b1 = Math.floor(((seg.vStart + segDur) / totalDur) * targetLen);
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
    }
    return peaks;
}

export function cutRange(edl, vStart, vEnd) {
    if (vEnd <= vStart) return edl;
    const result = [];
    for (const seg of edl) {
        const segVStart = seg.vStart;
        const segDur = seg.srcEnd - seg.srcStart;
        const segVEnd = segVStart + segDur;

        // Hors zone : on garde le segment tel quel
        if (segVEnd <= vStart || segVStart >= vEnd) {
            result.push(seg);
            continue;
        }

        // Partie gauche conservée (le segment commence avant la coupe)
        if (segVStart < vStart) {
            const keepDur = vStart - segVStart;
            result.push(makeSegment(
                segVStart,                  // vStart inchangé
                seg.srcStart,
                seg.srcStart + keepDur,     // srcEnd raccourci
                seg.buffer,
                seg.bufferTrackId,
            ));
        }

        // Partie droite conservée (le segment finit après la coupe)
        if (segVEnd > vEnd) {
            const skipDur = vEnd - segVStart;
            result.push(makeSegment(
                vEnd,                       // vStart = la fin de la zone coupée
                seg.srcStart + skipDur,     // srcStart avance
                seg.srcEnd,                 // srcEnd inchangé
                seg.buffer,
                seg.bufferTrackId,
            ));
        }
    }
    return result;
}

export function extractRange(edl, vStart, vEnd, sourceBuffer = null, sourceTrackId = null) {
    if (vEnd <= vStart) return [];
    const result = [];
    for (const seg of edl) {
        const segVStart = seg.vStart;
        const segDur = seg.srcEnd - seg.srcStart;
        const segVEnd = segVStart + segDur;

        // Pas de chevauchement : on passe
        if (segVEnd <= vStart || segVStart >= vEnd) continue;

        // Combien on rogne à gauche (si le segment dépassait avant vStart)
        const clipLeft = Math.max(0, vStart - segVStart);
        // Combien on rogne à droite (si le segment dépassait après vEnd)
        const clipRight = Math.max(0, segVEnd - vEnd);

        // Position dans le presse-papier : relative à vStart, jamais négative
        const newVStart = Math.max(0, segVStart - vStart);

        result.push(makeSegment(
            newVStart,
            seg.srcStart + clipLeft,
            seg.srcEnd - clipRight,
            seg.buffer || sourceBuffer,
            seg.bufferTrackId || sourceTrackId,
        ));
    }
    return result;
}

// Insère des segments à la position vTime.
// Si le contenu inséré dépasse le début du prochain clip existant, on pousse
// ce prochain clip (et tous ceux qui le suivent) du minimum nécessaire pour
// éviter le chevauchement. Si la place suffit, on ne pousse rien.
// Les clips qui commençaient avant vTime ne sont jamais touchés (un overlap
// avec eux peut subsister si vTime tombe au milieu d'un clip — c'est au caller
// de splitAt d'abord s'il veut l'éviter).
export function insertAt(edl, vTime, newSegments) {
    if (!newSegments?.length) return edl;

    const shifted = newSegments.map((s) =>
        makeSegment(s.vStart + vTime, s.srcStart, s.srcEnd, s.buffer, s.bufferTrackId)
    );
    const insertEnd = Math.max(
        ...shifted.map(s => s.vStart + (s.srcEnd - s.srcStart))
    );

    const nextStart = edl
        .filter(s => s.vStart >= vTime)
        .reduce((min, s) => Math.min(min, s.vStart), Infinity);

    const pushBy = Math.max(0, insertEnd - nextStart);
    return [...makeSpace(edl, vTime, pushBy), ...shifted];
}

// Décale vers la droite tous les segments dont vStart ≥ vTime de `amount` secondes.
// Si amount vaut 0, retourne l'EDL inchangée (pas de nouveau tableau).
export function makeSpace(edl, vTime, amount) {
    if (amount === 0) return edl;
    return edl.map((s) =>
        s.vStart >= vTime
            ? { ...s, vStart: s.vStart + amount }
            : s
    );
}

export function virtualToSource(edl, vTime) {
    for (const seg of edl) {
        const segVEnd = seg.vStart + (seg.srcEnd - seg.srcStart);
        if (vTime >= seg.vStart && vTime < segVEnd) {
            return { seg, srcTime: seg.srcStart + (vTime - seg.vStart) };
        }
    }
    return null; // dans un trou (ou après la fin)
}

export function ensureAbsolutePositions(edl) {
    if (edl.length === 0 || edl[0].vStart !== undefined) return edl;
    let acc = 0;
    return edl.map((seg) => {
        const out = { ...seg, vStart: acc };
        acc += seg.srcEnd - seg.srcStart;
        return out;
    });
}

// Coupe le segment à la position vTime.
export function splitAt(edl, vTime) {
    if (edl.length === 0) return edl;
    const result = [];
    for (const seg of edl) {
        const segVStart = seg.vStart;
        const segDur = seg.srcEnd - seg.srcStart;
        const segVEnd = segVStart + segDur;
        if (segVEnd <= vTime || segVStart >= vTime) {
            result.push(seg);
        } else {
            const splitSrc = seg.srcStart + (vTime - segVStart);
            result.push(makeSegment(segVStart, seg.srcStart, splitSrc, seg.buffer, seg.bufferTrackId));
            result.push(makeSegment(vTime, splitSrc, seg.srcEnd, seg.buffer, seg.bufferTrackId));
        }
    }
    return result;
}

// Drag horizontal d'un clip
export function moveSegment(edl, segId, deltaSec) {
    return edl.map((s) => {
        if (s.id !== segId) return s;
        return { ...s, vStart: Math.max(0, s.vStart + deltaSec) };
    });
}

// Trim des bords d'un clip
export function trimSegment(edl, segId, deltaLeft, deltaRight) {
    return edl.map((s) => {
        if (s.id !== segId) return s;
        const newSrcStart = Math.max(0, s.srcStart + deltaLeft);
        const newVStart = Math.max(0, s.vStart + deltaLeft);
        const newSrcEnd = Math.min(/* buffer.duration */ Infinity, s.srcEnd + deltaRight);
        if (newSrcEnd <= newSrcStart) return s;
        return { ...s, vStart: newVStart, srcStart: newSrcStart, srcEnd: newSrcEnd };
    });
}

export function removeSegment(edl, segId) {
    return edl.filter((s) => s.id !== segId);
}

// Insère un segment à la position vStart absolue.
// Punch-in : tout ce qui chevauche [vStart, vStart + dur] dans la cible est
// coupé via cutRange (partie gauche / droite conservée, milieu remplacé).
export function insertSegmentAt(edl, seg, vStart) {
    const dur = seg.srcEnd - seg.srcStart;
    const cleared = cutRange(edl, vStart, vStart + dur);
    const placed = { ...seg, vStart };
    return [...cleared, placed].sort((a, b) => a.vStart - b.vStart);
}
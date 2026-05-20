// Audio  : audio_content/{CC}-{PP}/{CC}-{PP}_{trackId}.webm   (blob MediaRecorder brut)
// Projet : audio_content/{CC}-{PP}/{CC}-{PP}_project.json

export function projectPaths({ localPath, chapter, paragraph }) {
    const cc = String(chapter).padStart(2, "0");
    const pp = String(paragraph).padStart(2, "0");
    const dir = `audio_content/${cc}-${pp}`;
    return {
        localPath,
        audio: (id) => `${dir}/${cc}-${pp}_${id}.webm`,
        project: `${dir}/${cc}-${pp}_project.json`,
        bytesUrl: (ipath) =>
            `/burrito/ingredient/bytes/${localPath}?ipath=${ipath}`,
        deleteUrl: (ipath) =>
            `/burrito/ingredient/delete/${localPath}?ipath=${ipath}`,
    };
}

export async function loadProject(paths) {
    try {
        const r = await fetch(paths.bytesUrl(paths.project));
        if (!r.ok) return null;
        return await r.json();
    } catch {
        return null;
    }
}

export async function saveProject(paths, state) {
    const fd = new FormData();
    fd.append(
        "file",
        new Blob([JSON.stringify(state)], { type: "application/json" }),
    );
    await fetch(paths.bytesUrl(paths.project), { method: "POST", body: fd });
}

export async function saveAudioBlob(paths, id, blob) {
    const fd = new FormData();
    fd.append("file", blob);
    await fetch(paths.bytesUrl(paths.audio(id)), { method: "POST", body: fd });
}

export async function loadAudioBuffer(ctx, paths, id) {
    try {
        const r = await fetch(paths.bytesUrl(paths.audio(id)));
        if (!r.ok) return null;
        return await ctx.decodeAudioData(await r.arrayBuffer());
    } catch {
        return null;
    }
}

export async function deleteAudioFile(paths, id) {
    await fetch(paths.deleteUrl(paths.audio(id)), { method: "DELETE" });
}

import { useRef, useState } from "react";
import { makeTrack } from "../lib/edl";
import { saveAudioBlob } from "../lib/storageUtil";

// Encapsule MediaRecorder + persistance du blob + ajout d'une piste.
// L'état d'enregistrement et les refs (recorder, chunks) sont internes au hook.

export function useRecorder({ paths, audioCtxRef, setTracks }) {
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecRef = useRef(null);
    const chunksRef = useRef([]);

    const startRecording = async () => {
        if (!paths) return;
        audioCtxRef.current ??= new AudioContext();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (e) => {
            if (e.data.size) chunksRef.current.push(e.data);
        };
        rec.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            const blob = new Blob(chunksRef.current, { type: rec.mimeType });
            const buffer = await audioCtxRef.current.decodeAudioData(
                await blob.arrayBuffer(),
            );
            const id = crypto.randomUUID();
            await saveAudioBlob(paths, id, blob);
            setTracks((prev) => [
                ...prev,
                makeTrack(buffer, `Track - ${prev.length + 1}`, id),
            ]);
        };
        rec.start();
        mediaRecRef.current = rec;
        setIsRecording(true);
    };

    const stopRecording = () => {
        mediaRecRef.current?.stop();
        setIsRecording(false);
    };

    return { isRecording, startRecording, stopRecording };
}

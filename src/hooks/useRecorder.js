import { useRef, useState, useEffect } from "react";
import { makeTrack } from "../lib/edl";
import { saveAudioBlob } from "../lib/storageUtil";

// Encapsule MediaRecorder + persistance du blob + ajout d'une piste.
// Pendant l'enregistrement, sample les peaks via un AnalyserNode pour
// permettre l'affichage de la waveform en temps réel (peaksRef).
// La durée est exposée via `recordingDuration`, mise à jour à basse
// fréquence (5Hz) pour éviter de re-render toutes les pistes à 60Hz.

const SAMPLE_HZ = 30; // peaks par seconde
const DURATION_UPDATE_MS = 200;

export function useRecorder({ paths, audioCtxRef, setTracks }) {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecRef = useRef(null);
    const chunksRef = useRef([]);
    const analyserRef = useRef(null);
    const sourceRef = useRef(null);
    const startedAtRef = useRef(0);
    const peaksRef = useRef([]);
    const rafRef = useRef(null);
    const durationIntervalRef = useRef(null);

    const startRecording = async () => {
        if (!paths) return;
        audioCtxRef.current ??= new AudioContext();
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") await ctx.resume();

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        sourceRef.current = source;
        analyserRef.current = analyser;
        peaksRef.current = [];

        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (e) => {
            if (e.data.size) chunksRef.current.push(e.data);
        };
        rec.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            try { source.disconnect(); } catch { /* déjà déconnecté */ }
            sourceRef.current = null;
            analyserRef.current = null;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
            durationIntervalRef.current = null;
            peaksRef.current = [];
            setRecordingDuration(0);

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
        startedAtRef.current = ctx.currentTime;
        setIsRecording(true);

        // rAF: échantillonnage des peaks à SAMPLE_HZ depuis l'AnalyserNode.
        // On utilise un compteur de slots pour pousser exactement N peaks
        // par seconde, indépendamment de la cadence du rAF (souvent 60Hz).
        const buf = new Float32Array(analyser.fftSize);
        const sampleStep = 1 / SAMPLE_HZ;
        let nextSlot = 0;
        const tick = () => {
            if (!analyserRef.current) return;
            const elapsed = ctx.currentTime - startedAtRef.current;
            while (nextSlot + sampleStep <= elapsed) {
                analyserRef.current.getFloatTimeDomainData(buf);
                let max = 0;
                for (let i = 0; i < buf.length; i++) {
                    const v = Math.abs(buf[i]);
                    if (v > max) max = v;
                }
                peaksRef.current.push(max);
                nextSlot += sampleStep;
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);

        // Update de durée à basse fréquence : suffit pour faire grandir la
        // timeline sans déclencher 60 re-renders/s de toutes les pistes.
        durationIntervalRef.current = setInterval(() => {
            setRecordingDuration(ctx.currentTime - startedAtRef.current);
        }, DURATION_UPDATE_MS);
    };

    const stopRecording = () => {
        mediaRecRef.current?.stop();
        setIsRecording(false);
    };

    useEffect(() => () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    }, []);

    return {
        isRecording,
        startRecording,
        stopRecording,
        recordingDuration,
        peaksRef,
        sampleHz: SAMPLE_HZ,
    };
}

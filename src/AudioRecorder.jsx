import { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DeleteIcon from '@mui/icons-material/Delete';
import RestoreIcon from '@mui/icons-material/Restore';
import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import { useWavesurfer } from '@wavesurfer/react'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import Tooltip from '@mui/material/Tooltip';
import Waveform from './Waveform';

import {
    postJson,
    getJson
} from "pithekos-lib";

const AudioRecorder = ({ audioUrl, setAudioUrl, obs, metadata }) => {
    const [isRecording, setIsRecording] = useState(false);
    const waveformRef = useRef(null);
    const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
    const recordPlugin = useMemo(() => RecordPlugin.create({
        renderRecordedAudio: true,
        scrollingWaveform: false,
        audioBitsPerSecond: 128000,
    }), []);
    const timelinePlugin = useMemo(() => TimelinePlugin.create({
        height: 25,
        insertPosition: 'beforebegin',
        timeInterval: 0.2,
        primaryLabelInterval: 5,
        secondaryLabelInterval: 1,
    })
        , []);
    const plugins = useMemo(() => [regionsPlugin, recordPlugin, timelinePlugin], [regionsPlugin, recordPlugin, timelinePlugin]);
    const [prise, setPrise] = useState("1");
    const [bakExists, setBakExists] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showOtherTracks, setShowOtherTracks] = useState(true);
    const [cursorTime, setCursorTime] = useState(0);
    const [currentTrack, setCurrentTrack] = useState(0);
    const [trackDurations, setTrackDurations] = useState({});
    const [maxDuration, setMaxDuration] = useState(0);
    const [selectedRegion, setSelectedRegion] = useState([]);
    const [copiedRegion, setCopiedRegion] = useState(null);
    const cursorRef = useRef(null);
    const recordingWaveformRef = useRef(null);
    const recordingCanvasRef = useRef(null);
    const [nextPriseNumber, setNextPriseNumber] = useState(null);
    const [otherPrises, setOtherPrises] = useState([]);
    const mediaRecorderRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const chunksRef = useRef([]);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);
    const isRecordingRef = useRef(false);
    const lastCursorTimeRef = useRef(0);
    const [waveformRefs, setWaveformRefs] = useState({});
    const [secondaryIsPlaying, setSecondaryIsPlaying] = useState({});

    // Grille de timeline et snap
    const [gridSeconds, setGridSeconds] = useState(0.1);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const tracksContainerRef = useRef(null);
    const [waveformWidth, setWaveformWidth] = useState(0);

    const getUrl = (segment = "bytes", chapter = obs[0], paragraph = obs[1], newPrise = prise, ext = "mp3") => {
        let chapterString = chapter < 10 ? `0${chapter}` : chapter;
        let paragraphString = paragraph < 10 ? `0${paragraph}` : paragraph;
        return `http://localhost:19119/burrito/ingredient/${segment}/${metadata.local_path}?ipath=audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${newPrise}.${ext}`
    }

    const fileExists = async (newAudioUrl) => {
        const url = `http://localhost:19119/burrito/paths/${metadata.local_path}`
        const ipath = newAudioUrl.split("?ipath=")[1];

        const response = await fetch(url, {
            method: "GET",
        })
        if (response.ok) {
            const data = await response.json();
            if (data.includes(ipath)) {
                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    const listPrises = async (chapter, paragraph) => {
        const url = `http://localhost:19119/burrito/paths/${metadata.local_path}`
        const response = await fetch(url, {
            method: "GET",
        })
        const data = await response.json();
        let chapterString = chapter < 10 ? `0${chapter}` : chapter;
        let paragraphString = paragraph < 10 ? `0${paragraph}` : paragraph;
        return data.filter(item => item.includes(`audio_content/${chapterString}-${paragraphString}`) && !item.includes(".bak"))
    }

    // Attend que le fichier soit présent côté serveur avant de l'utiliser
    const waitForFileByUrl = useCallback(async (urlToCheck, { timeoutMs = 8000, intervalMs = 250 } = {}) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const exists = await fileExists(urlToCheck);
                if (exists) return true;
            } catch (_) {
                // noop
            }
            await new Promise((r) => setTimeout(r, intervalMs));
        }
        return false;
    }, []);

    const audioBufferToWav = (buffer) => {
        const length = buffer.length;
        const arrayBuffer = new ArrayBuffer(44 + length * 2);
        const view = new DataView(arrayBuffer);

        'RIFF'.split('').forEach((char, i) => view.setUint8(i, char.charCodeAt(0)));
        view.setUint32(4, 36 + length * 2, true);
        'WAVEfmt '.split('').forEach((char, i) => view.setUint8(8 + i, char.charCodeAt(0)));
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, buffer.sampleRate, true);
        view.setUint32(28, buffer.sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        'data'.split('').forEach((char, i) => view.setUint8(36 + i, char.charCodeAt(0)));
        view.setUint32(40, length * 2, true);

        const samples = buffer.getChannelData(0);
        let offset = 44;
        for (let i = 0; i < length; i++) {
            view.setInt16(offset, samples[i] * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    };

    // ça insert l'audio B a un endroit dans l'audio A
    const insertAudio = async (A, B, insertTime, startTimeB, endTimeB) => {
        const urlA = getUrl().replace(`_${prise}.mp3`, `_${A}.mp3`);
        const urlB = getUrl().replace(`_${prise}.mp3`, `_${B}.mp3`);

        const audioContext = new AudioContext();

        try {
            const [responseA, responseB] = await Promise.all([
                fetch(urlA), fetch(urlB)
            ]);

            if (responseA.ok && responseB.ok) {
                const [bufferA, bufferB] = await Promise.all([
                    audioContext.decodeAudioData(await (await responseA.blob()).arrayBuffer()),
                    audioContext.decodeAudioData(await (await responseB.blob()).arrayBuffer())
                ]);

                const sampleRate = bufferA.sampleRate;

                // Débyt del'audio A
                const segmentA1 = bufferA.getChannelData(0).slice(
                    0, insertTime * sampleRate
                );
                // Fin de l'audio A
                const segmentA2 = bufferA.getChannelData(0).slice(
                    insertTime * sampleRate, bufferA.getChannelData(0).length
                );

                // Début de l'audio B
                const segmentB = bufferB.getChannelData(0).slice(
                    startTimeB * sampleRate, endTimeB * sampleRate
                );

                const totalSamples = segmentA1.length + segmentB.length + segmentA2.length;
                const newBuffer = audioContext.createBuffer(1, totalSamples, sampleRate);
                const channel = newBuffer.getChannelData(0);

                channel.set(segmentA1, 0);
                channel.set(segmentB, segmentA1.length);
                channel.set(segmentA2, segmentA1.length + segmentB.length);

                const wav = audioBufferToWav(newBuffer);
                const newUrl = URL.createObjectURL(wav);
                const newMaxDuration = (endTimeB - startTimeB) + (bufferA.getChannelData(0).length / sampleRate);
                if (newMaxDuration > maxDuration) {
                    setMaxDuration(newMaxDuration);
                }
                updateMainTrackWidth(newMaxDuration);
                const newJson = [
                    {
                        "track": A.split("_")[0],
                        "start": 0,
                        "end": startTimeB,
                    },
                    {
                        "track": B.split("_")[0],
                        "start": startTimeB,
                        "end": endTimeB,
                    },
                    {
                        "track": A.split("_")[0],
                        "start": endTimeB,
                        "end": wavesurfer.getDuration(),
                    }
                ]
                updateJson(newJson);

                const formData = new FormData();
                formData.append("file", wav);
                const response = await fetch(getUrl("bytes", obs[0], obs[1], 0), {
                    method: "POST",
                    body: formData,
                });
                const data = await response.json();
                // console.log(data);

                return newUrl;
            }
        } catch (error) {
            console.error('Error in insertAudio:', error);
        }
        return null;
    };

    const getOldPriseNumber = useCallback(async () => {
        const url = `http://localhost:19119/burrito/paths/${metadata.local_path}`
        const response = await fetch(url, {
            method: "GET",
        })
        const data = await response.json();
        const chapterString = obs[0] < 10 ? `0${obs[0]}` : obs[0];
        const paragraphString = obs[1] < 10 ? `0${obs[1]}` : obs[1];
        const prises = data.filter(item => item.includes(`audio_content/${chapterString}-${paragraphString}`) && !item.includes(".bak"));
        const priseNumbers = prises.map(prise => prise.split(`${chapterString}-${paragraphString}_`)[1].split("_")[0].replace(".mp3", ""));
        const newPrise = priseNumbers
            .map(prise => parseInt(prise))
            .filter(prise => !isNaN(prise))
            .sort((a, b) => b - a)[0];

        return isNaN(newPrise) ? 0 : newPrise;
    }, [metadata.local_path, obs]);

    const refreshEmptyTrackOnly = useCallback(async () => {
        const next = (await getOldPriseNumber()) + 1;
        setNextPriseNumber(next);

    }, [getOldPriseNumber]);

    const startWaveformAnimation = useCallback(() => {
        if (!recordingCanvasRef.current || !analyserRef.current) return;

        const canvas = recordingCanvasRef.current;
        const canvasCtx = canvas.getContext('2d');
        const analyser = analyserRef.current;

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!isRecordingRef.current) return;

            analyser.getByteTimeDomainData(dataArray);

            canvasCtx.fillStyle = 'rgb(245, 245, 245)';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

            canvasCtx.lineWidth = 2;
            canvasCtx.strokeStyle = 'rgb(255, 107, 107)';
            canvasCtx.beginPath();

            const sliceWidth = canvas.width * 1.0 / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * canvas.height / 2;

                if (i === 0) {
                    canvasCtx.moveTo(x, y);
                } else {
                    canvasCtx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            canvasCtx.lineTo(canvas.width, canvas.height / 2);
            canvasCtx.stroke();

            animationFrameRef.current = requestAnimationFrame(draw);
        };

        draw();
    }, []);

    const startRecording = async () => {
        try {
            // Calculer le numéro de la prochaine prise
            const nextPrise = (await getOldPriseNumber()) + 1;
            setNextPriseNumber(nextPrise);

            // Demander l'accès au microphone
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            // Créer l'analyseur audio pour la visualisation
            const audioContext = new AudioContext();
            const analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);

            analyser.fftSize = 2048;
            analyserRef.current = analyser;

            // Créer le MediaRecorder
            mediaRecorderRef.current = new MediaRecorder(stream);
            chunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorderRef.current.onstop = async () => {
                const recordedBlob = new Blob(chunksRef.current, { type: 'audio/mp3' });

                // Sauvegarder l'enregistrement
                const formData = new FormData();
                formData.append("file", recordedBlob);

                const postUrl = getUrl("bytes", obs[0], obs[1], nextPrise);
                await fetch(postUrl, {
                    method: "POST",
                    body: formData
                });
                // S'assurer que le fichier est bien disponible avant d'ajouter la piste
                const createdUrl = getUrl("bytes", obs[0], obs[1], nextPrise);
                await waitForFileByUrl(createdUrl);

                // Calculer la durée et mettre à jour l'interface
                const audioContext = new AudioContext();
                const audioBuffer = await audioContext.decodeAudioData(await recordedBlob.arrayBuffer());
                const duration = audioBuffer.getChannelData(0).length / audioBuffer.sampleRate;
                if (duration > maxDuration) {
                    setMaxDuration(duration);
                    updateMainTrackWidth(undefined, duration);
                }

                // Nettoyer
                setNextPriseNumber(null);
                chunksRef.current = [];

                checkIfPriseExists();
                refreshEmptyTrackOnly();
                setOtherPrises((prev) => {
                    const nextKey = String(nextPrise);
                    const exists = (prev || []).some((p) => (p.split("_")[0] === nextKey));
                    if (exists) return prev;
                    const updated = [...(prev || []), nextKey];
                    return updated.sort((a, b) => parseInt(a.split("_")[0]) - parseInt(b.split("_")[0]));
                });
            };

            // Démarrer l'enregistrement et la visualisation
            mediaRecorderRef.current.start(250);
            isRecordingRef.current = true;
            setIsRecording(true);

            // Petit délai pour s'assurer que tout est configuré
            setTimeout(() => {
                startWaveformAnimation();
            }, 100);

        } catch (error) {
            console.error('Erreur lors de l\'accès au microphone:', error);
        }
    };

    const stopRecording = async () => {
        try {
            if (mediaRecorderRef.current && isRecording) {
                // Arrêter l'enregistrement
                isRecordingRef.current = false;
                mediaRecorderRef.current.stop();
                setIsRecording(false);

                // Arrêter l'animation
                if (animationFrameRef.current) {
                    cancelAnimationFrame(animationFrameRef.current);
                }

                // Arrêter le stream
                if (mediaStreamRef.current) {
                    mediaStreamRef.current.getTracks().forEach(track => {
                        track.stop();
                    });
                    mediaStreamRef.current = null;
                }

                // Nettoyer le canvas
                if (recordingCanvasRef.current) {
                    const canvas = recordingCanvasRef.current;
                    const canvasCtx = canvas.getContext('2d');
                    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
                }

                analyserRef.current = null;
            }
        } catch (error) {
            console.error('Erreur lors de l\'arrêt de l\'enregistrement:', error);
        }
    };

    const formatTime = (time) => {
        const seconds = Math.floor(time % 60);
        const minutes = Math.floor(time / 60);
        return minutes + ":" + (seconds < 10 ? "0" + seconds : seconds);
    }

    const { wavesurfer, currentTime, isPlaying } = useWavesurfer({
        container: waveformRef,
        height: 100,
        waveColor: 'rgb(34, 173, 197)',
        progressColor: 'rgb(64, 107, 114)',
        url: audioUrl,
        plugins: plugins,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 0,
    })

    useEffect(() => {
        if (!waveformRef.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setWaveformWidth(entry.contentRect.width);
            }
        });
        observer.observe(waveformRef.current);
        // init
        setWaveformWidth(waveformRef.current.clientWidth);
        return () => observer.disconnect();
    }, [waveformRef]);

    const effectiveDuration = useMemo(() => {
        const dur = wavesurfer?.getDuration?.();
        return (maxDuration && maxDuration > 0) ? maxDuration : (dur || 0);
    }, [maxDuration, wavesurfer]);

    const gridPx = useMemo(() => {
        if (!waveformWidth || !gridSeconds) return 0;
        const baseDuration = effectiveDuration || 1;
        return (waveformWidth / baseDuration) * gridSeconds;
    }, [waveformWidth, effectiveDuration, gridSeconds]);

    const majorGridPx = useMemo(() => (gridPx ? gridPx * 5 : 0), [gridPx]);

    const onPlayPause = () => {
        if (!audioUrl) return;
        wavesurfer && wavesurfer.playPause()
    }

    const onDelete = () => {
        setAudioUrl('')

        const deleteUrl = getUrl("delete");
        fetch(deleteUrl, {
            method: "POST",
        }).then(() => {
            // Ne rafraîchir que la piste vide après suppression
            refreshEmptyTrackOnly();
        });
    }

    const onRestore = () => {
        const bakUrl = getUrl("revert");
        fetch(bakUrl, {
            method: "POST",
        }).then(async () => {
            setBakExists(await fileExists(getUrl() + ".bak"))
            setAudioUrl("")
        })
    }

    const updateMainTrackWidth = useCallback((duration, newMaxDuration = maxDuration) => {
        if (!waveformRef.current || !wavesurfer) return;
        if (!duration) duration = wavesurfer.getDuration();
        if (!duration || !newMaxDuration) return;
        wavesurfer.setOptions({
            width: waveformRef.current.clientWidth / newMaxDuration * duration,
        })
    }, [wavesurfer, maxDuration]);

    // Créer les handlers avec useCallback pour éviter les re-créations
    const handleReady = useCallback(() => {
        if (!wavesurfer) return;
        const duration = wavesurfer.getDuration();
        updateMainTrackWidth(duration);
        setTimeout(() => {
            setIsLoading(false);
        }, 100);
    }, [wavesurfer, updateMainTrackWidth]);

    const handleLoading = useCallback(() => {
        setIsLoading(true);
    }, []);

    const snapToGrid = useCallback((time) => {
        if (!gridSeconds || gridSeconds <= 0) return time;
        return Math.round(time / gridSeconds) * gridSeconds;
    }, [gridSeconds]);

    const updateCursorTime = useCallback((time, { force = false } = {}) => {
        const base = (snapEnabled && !force) ? snapToGrid(time) : time;
        const clamped = Math.max(0, Math.min(base, maxDuration || base));
        setCursorTime(clamped);
    }, [snapEnabled, snapToGrid, maxDuration]);

    const handleTimeUpdate = useCallback(() => {
        if (!wavesurfer) return;
        const now = wavesurfer.getCurrentTime();
        // Pendant la lecture, on ne snap pas le curseur pour garder un mouvement fluide
        updateCursorTime(now, { force: true });
    }, [wavesurfer, updateCursorTime]);

    // Snap au clic sur la piste principale
    useEffect(() => {
        if (!wavesurfer) return;
        const handleClick = () => {
            updateCursorTime(wavesurfer.getCurrentTime());
        };
        wavesurfer.on('click', handleClick);
        return () => {
            wavesurfer.off?.('click', handleClick);
        };
    }, [wavesurfer, updateCursorTime]);

    // Gestion des événements WaveSurfer pour la track principale
    useEffect(() => {
        if (!wavesurfer) return;

        wavesurfer.on("ready", handleReady);
        wavesurfer.on("loading", handleLoading);
        wavesurfer.on("timeupdate", handleTimeUpdate);

        // Le hook @wavesurfer/react gère automatiquement le cleanup
    }, [wavesurfer, handleReady, handleLoading, handleTimeUpdate]);

    // Décorrélation des pistes: on ne relaye plus le timeupdate des pistes secondaires

    useEffect(() => {
        regionsPlugin?.enableDragSelection({
            drag: true,
            color: 'rgba(0, 0, 0, 0.2)',
        }, 1);
        regionsPlugin?.on('region-created', handleRegionCreate);
        regionsPlugin?.on('region-updated', handleRegionUpdate);
        regionsPlugin?.on('region-clicked', handleRegionClick);

    }, [wavesurfer]);

    const handleRegionCreate = (region) => {
        if (handleRegionSelect) {
            handleRegionSelect([region, prise, regionsPlugin]);
        }
    };

    const handleRegionUpdate = (region) => {
        if (handleRegionSelect) {
            handleRegionSelect([region, prise, regionsPlugin]);
        }
    };

    const handleRegionClick = (region) => {
        handleRegionSelect([region, prise, regionsPlugin]);
    };


    useEffect(() => {
        const updateAudioUrl = async () => {
            setIsLoading(true);
            const url = getUrl();
            if (await fileExists(url)) {
                setTimeout(async () => {
                    setAudioUrl(url)
                }, audioUrl != "" ? 200 : 0);
            } else {
                setTimeout(() => {
                    setAudioUrl("")
                }, audioUrl != "" ? 200 : 0);
            }
        }
        updateAudioUrl();
    }, [obs, prise, bakExists])

    // Mettre à jour le numéro de la prochaine prise
    useEffect(() => {
        const updateNextPrise = async () => {
            if (!isRecording) {
                const nextPrise = (await getOldPriseNumber()) + 1;
                setNextPriseNumber(nextPrise);
            }
        };
        updateNextPrise();
    }, [obs, isRecording, getOldPriseNumber]);

    useEffect(() => {
        const updateBakExists = async () => {
            setBakExists(await fileExists(getUrl() + ".bak"))
        }
        updateBakExists();


    }, [obs, prise, audioUrl])

    const updateTrackDuration = (trackId, duration) => {
        setTrackDurations(prev => {
            const newDurations = { ...prev, [trackId]: duration };
            const maxDur = Math.max(...Object.values(newDurations));
            setMaxDuration(maxDur);
            return newDurations;
        });
    };

    const handleRegionSelect = (regionData) => {
        const newRegion = regionData?.[0];
        const oldRegion = selectedRegion?.[0];
        // Ne pas supprimer la région si c'est la même (cas d'update/resize sur piste secondaire)
        if (oldRegion && oldRegion !== newRegion) {
            try {
                oldRegion.remove();
            } catch (e) {
                // noop
            }
        }
        setSelectedRegion(regionData);
    };

    const pasteRegion = async (regionData) => {
        if (!copiedRegion) return;
        const start = copiedRegion[0].start;
        const end = copiedRegion[0].end;
        const track = copiedRegion[1];
        const insertTime = cursorTime;

        if (regionData[1] == "0") {
            await cutRegion(regionData);
        }

        const concatenatedUrl = await insertAudio(prise, track, insertTime, start, end);
        setAudioUrl(concatenatedUrl);
        setCopiedRegion(null);
    }

    const copyRegion = async (regionData) => {
        setCopiedRegion(regionData);
    }

    const cutRegion = async (regionData) => {
        const url = getUrl();
        const audioContext = new AudioContext();
        try {
            const response1 = await fetch(url);
            if (response1.ok) {
                const buffer = await audioContext.decodeAudioData(await (await response1.blob()).arrayBuffer());
                const sampleRate = buffer.sampleRate;
                // Débyt del'audio A
                const segmentA1 = buffer.getChannelData(0).slice(
                    0, regionData[0].start * sampleRate
                );
                // Fin de l'audio A
                const segmentA2 = buffer.getChannelData(0).slice(
                    regionData[0].end * sampleRate, buffer.getChannelData(0).length
                );

                const totalSamples = segmentA1.length + segmentA2.length;
                const newBuffer = audioContext.createBuffer(1, totalSamples, sampleRate);
                const channel = newBuffer.getChannelData(0);

                channel.set(segmentA1, 0);
                channel.set(segmentA2, segmentA1.length);

                const wav = audioBufferToWav(newBuffer);
                const newUrl = URL.createObjectURL(wav);
                const newMaxDuration = (regionData[0].end - regionData[0].start) + (buffer.getChannelData(0).length / sampleRate);
                if (newMaxDuration > maxDuration) {
                    setMaxDuration(newMaxDuration);
                }
                updateMainTrackWidth(newMaxDuration);

                const formData = new FormData();
                formData.append("file", wav);
                const response = await fetch(getUrl("bytes", obs[0], obs[1], prise), {
                    method: "POST",
                    body: formData,
                });
                const data = await response.json();
                // console.log(data);
                // 
                setAudioUrl(newUrl);

                return newUrl;
            }
        } catch (error) {
            console.error('Error in cutRegion:', error);
        }
        return null;
    }

    const editAudio = async (oldName, newName) => {
        newName = "test1"
        const chapterString = obs[0] < 10 ? `0${obs[0]}` : obs[0];
        const paragraphString = obs[1] < 10 ? `0${obs[1]}` : obs[1];
        newName = newName.trim().replaceAll("_", "-").replaceAll(" ", "-").replaceAll("/", "-").replaceAll("\\", "-");
        if ( oldName.split("_")[1] == newName) {
            return;
        }
        
        const srcPath = `audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${oldName}.mp3`;
        const targetPath = `audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${oldName.split("_")[0]}_${newName}.mp3`;
        let url = `http://localhost:19119/burrito/ingredient/copy/${metadata.local_path}?src_path=${srcPath}&target_path=${targetPath}&delete_src=true`;
        await fetch(url, {
            method: "POST",
        });
        // Ne rafraîchir que la piste vide après renommage
        refreshEmptyTrackOnly();
        // Mettre à jour localement la liste pour n'impacter que la piste concernée
        const newPriseKey = `${oldName.split("_")[0]}_${newName}`;
        setOtherPrises((prev) => prev.map((p) => (p === oldName ? newPriseKey : p)));
        // Rebasculer les refs si nécessaire
        setWaveformRefs((prev) => {
            const { [oldName]: oldWs, ...rest } = prev || {};
            return oldWs ? { ...rest, [newPriseKey]: oldWs } : prev;
        });
    }

    const deleteAudio = async (priseNumber) => {
        const url = getUrl("delete", obs[0], obs[1], priseNumber);
        await fetch(url, {
            method: "POST",
        });
        // Ne rafraîchir que la piste vide après suppression d'une piste secondaire
        refreshEmptyTrackOnly();
        // Retirer localement uniquement la piste supprimée
        setOtherPrises((prev) => prev.filter((p) => p !== priseNumber));
        setWaveformRefs((prev) => {
            if (!prev) return prev;
            const { [priseNumber]: _removed, ...rest } = prev;
            return rest;
        });
        setSecondaryIsPlaying((prev) => {
            if (!prev) return prev;
            const { [priseNumber]: _removed, ...rest } = prev;
            return rest;
        });
    }

    const playAudio = async (priseNumber) => {
        const targetWavesurfer = waveformRefs[priseNumber];
        if (targetWavesurfer) {
            targetWavesurfer.playPause();
            const isNowPlaying = targetWavesurfer.isPlaying();
            setSecondaryIsPlaying((prev) => ({ ...prev, [priseNumber]: isNowPlaying }));
        } else {
            console.warn(`Waveform pour la prise ${priseNumber} non trouvé`);
        }
    }

    const updateOtherPrises = async () => {
        if (showOtherTracks) {
            const prises = await listPrises(obs[0], obs[1]);

            const chapterString = obs[0] < 10 ? `0${obs[0]}` : obs[0];
            const paragraphString = obs[1] < 10 ? `0${obs[1]}` : obs[1];
            const newPrises = prises.map(prise => prise.split(`/${chapterString}-${paragraphString}_`)[1].replace(".mp3", ""));
            const sortedPrises = newPrises.sort((a, b) => a.split("_")[0] - b.split("_")[0]);
            setOtherPrises(sortedPrises.filter(prise => !prise.includes(".json")));

            setTrackDurations({});
            setMaxDuration(0);
            setSelectedRegion([]);
        } else {
            setOtherPrises([]);
            setTrackDurations({});
            setMaxDuration(0);
            setSelectedRegion([]);
        }
    }

    const checkIfPriseExists = async () => {
        if (showOtherTracks) {
            const url0 = getUrl("bytes", obs[0], obs[1], 0);
            const url1 = getUrl("bytes", obs[0], obs[1], 1);
            const priseExists = await fileExists(url0);
            const prise1Exists = await fileExists(url1);
            if (!prise1Exists) return;
            if (!priseExists) {
                const newFile = await fetch(url1);
                const newFileBlob = await newFile.blob();
                const formData = new FormData();
                formData.append("file", newFileBlob);
                const response = await fetch(url0, {
                    method: "POST",
                    body: formData,
                });
                setAudioUrl(url0);
                setPrise("0");

                setTimeout(async () => {
                    const newJson = [
                        {
                            "track": "1",
                            "start": 0,
                            "end": wavesurfer?.getDuration(),
                        },
                    ]

                    updateJson(newJson);
                }, 100)

            } else {
                setPrise("0");

            }
        }
    }

    const updateJson = async (newJson) => {
        const payload = JSON.stringify({ payload: JSON.stringify(newJson) });
        const response = await postJson(
            getUrl("raw", obs[0], obs[1], prise, "json"),
            payload
        );
    }

    useEffect(() => {
        wavesurfer?.setOptions({
            cursorWidth: showOtherTracks ? 0 : 1,
        })
        setTimeout(() => {
            if (cursorRef.current) {
                cursorRef.current.style.backgroundColor = 'red';
            }
        }, 300)

        checkIfPriseExists();
        updateOtherPrises();
        updateMainTrackWidth(undefined, maxDuration);
    }, [showOtherTracks, obs, prise])

    useEffect(() => {
        const isPlaying = wavesurfer?.isPlaying();
        if (!isPlaying) {
            wavesurfer?.setTime(cursorTime);
        }
    }, [maxDuration, cursorTime])

    useEffect(() => {
        if (!selectedRegion || selectedRegion.length === 0) return;
        const [, selectedPrise] = selectedRegion;
        if (selectedPrise !== "0") return;
        regionsPlugin.getRegions().forEach(region => {
            if (selectedRegion[0] !== region) {
                region.remove();
            }
        });
    }, [selectedRegion, regionsPlugin])

    useEffect(() => {
        const handleKey = (event) => {
            if (selectedRegion[1] == "0") {
                if (event.key === 'Backspace') {
                    cutRegion(selectedRegion);
                    return;
                } else if (event.key === 'Delete') {
                    cutRegion(selectedRegion);
                    return;
                }

            } else {
                if (event.key === 'c' && event.ctrlKey) {
                    copyRegion(selectedRegion);
                    return;
                }
            }
            if (event.key === 'v' && event.ctrlKey) {
                pasteRegion(copiedRegion);
                return;
            } else if (event.key === 'z' && event.ctrlKey) {
                onRestore();
                return;
            } else if (event.key === ' ') {
                onPlayPause();
                return;
            } else if (event.key === 'ArrowLeft') {
                updateCursorTime((cursorTime ?? 0) - gridSeconds);
                return;
            } else if (event.key === 'ArrowRight') {
                updateCursorTime((cursorTime ?? 0) + gridSeconds);
                return;
            } else if (event.key === 'r') {
                return isRecording ? stopRecording() : startRecording();
            }
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    })

    const hasAnyTrack = !!audioUrl || (otherPrises?.length > 0);

    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
            <Stack sx={{ position: 'relative', mt: 5, backgroundColor: "rgb(224, 224, 224)", borderRadius: 1, boxShadow: 1, width: '100%', height: 'auto', overflow: 'visible' }}>

                {/* Barre du haut */}
                <Box sx={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgb(19, 18, 15)', justifyContent: 'space-between', zIndex: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', marginLeft: 2, color: 'white' }}>
                        {/*Timer*/}
                        <Box sx={{ fontSize: 16, fontWeight: 600, minWidth: '60px', textAlign: 'center' }}> {formatTime(currentTime)} </Box>
                        {/*Play/Pause Button*/}
                        <Tooltip title={"Space bar to play/pause"}>
                            <IconButton onClick={onPlayPause} sx={{ color: 'white' }}> {isPlaying ? <PauseIcon /> : <PlayArrowIcon />} </IconButton>
                        </Tooltip>
                        {/*Record Button*/}
                        <Tooltip title={"r to record"}>
                            <IconButton onClick={isRecording ? stopRecording : startRecording} sx={{ color: 'white' }}> {isRecording ? <StopIcon sx={{ color: 'red' }} /> : <MicIcon />} </IconButton>
                        </Tooltip>
                        {/*Delete Button*/}
                        <IconButton onClick={onDelete} sx={{ color: 'white' }}> <DeleteIcon /> </IconButton>
                        {/* Restore Button */}
                        {bakExists && <Tooltip title={"ctrl+z to restore"}>
                            <IconButton onClick={onRestore} sx={{ color: 'white' }}> <RestoreIcon /> </IconButton>
                        </Tooltip>}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'flex-end', marginRight: 2 }}>
                        {/* Boutons d'édition pour les régions sélectionnées */}
                        {selectedRegion.length > 0 && (
                            <Box sx={{ display: 'flex', gap: 1, mr: 2 }}>
                                {copiedRegion && (
                                    <Tooltip title={"ctrl+v to paste"}>
                                        <IconButton
                                            size="small"
                                            onClick={() => pasteRegion(selectedRegion)}
                                            sx={{ backgroundColor: 'rgb(63, 167, 53)', color: 'white', '&:hover': { backgroundColor: 'rgb(57, 126, 60)' } }}
                                        >
                                            <ContentPasteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {selectedRegion[1] != "0" && (
                                    <Tooltip title={"ctrl+c to copy"}>
                                        <IconButton
                                            size="small"
                                            onClick={() => copyRegion(selectedRegion)}
                                            sx={{ backgroundColor: 'rgb(63, 167, 53)', color: 'white', '&:hover': { backgroundColor: 'rgb(57, 126, 60)' } }}
                                        >
                                            <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}
                                {selectedRegion && selectedRegion[1] == "0" && (
                                    <Tooltip title={"suppr to delete"}>
                                        <IconButton
                                            size="small"
                                            onClick={() => cutRegion(selectedRegion)}
                                            sx={{ backgroundColor: 'rgb(168, 85, 85)', color: 'white', '&:hover': { backgroundColor: 'rgb(124, 53, 53)' } }}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                )}

                            </Box>
                        )}

                        {/* Bouton d'affichage pour les autres pistes audio */}
                        <IconButton
                            onClick={() => setShowOtherTracks((prev) => !prev)}
                            sx={{
                                transition: 'transform 0.2s',
                                transform: showOtherTracks ? 'rotate(-90deg)' : 'rotate(0deg)',
                                color: 'white',
                            }}
                            aria-label={showOtherTracks ? "Masquer les autres pistes" : "Afficher les autres pistes"}
                        >
                            <ArrowBackIosIcon />
                        </IconButton>
                    </Box>
                </Box>
                <Divider />

                {/* Conteneur des pistes */}
                <Box ref={tracksContainerRef} sx={{ position: 'relative'}}>

                    {/* Track principale */}
                    <Box sx={{ p: 1, backgroundColor: 'rgb(245, 245, 245)', height: '100%', position: 'relative', zIndex: 1 }}>
                    <Box sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: 'rgb(45, 188, 255)' }}>
                        MAIN TRACK - {prise.split("_")[0]} {prise.split("_")[1] ? `- ${prise.split("_")[1]}` : ""}
                    </Box>
                    {isRecording && !hasAnyTrack ? (
                        <Box sx={{
                            width: '100%',
                            height: '100px',
                            display: 'flex',
                            flexDirection: 'column',
                            backgroundColor: 'rgb(255, 240, 240)',
                            border: '2px solid rgb(255, 107, 107)',
                            borderRadius: 1,
                            overflow: 'hidden',
                            p: 1,
                        }}>
                            <Box sx={{ fontSize: 11, color: 'rgb(255, 107, 107)', mb: 0.5 }}>
                                {`Enregistrement en cours - Prise ${nextPriseNumber}`}
                            </Box>
                            <canvas
                                ref={recordingCanvasRef}
                                width={800}
                                height={80}
                                style={{
                                    width: '100%',
                                    height: '80px',
                                    overflow: 'hidden',
                                }}
                            />
                        </Box>
                    ) : audioUrl ? (
                        <Box sx={{ position: 'relative', width: '100%', height: '100px' }}>
                            {/* Curseur multi track limité à la piste principale */}
                            {showOtherTracks && (
                                <span
                                    ref={cursorRef}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        height: '100%',
                                        width: '1px',
                                        backgroundColor: 'transparent',
                                        zIndex: 3,
                                        pointerEvents: 'none',
                                        left: 0,
                                        transform: `translateX(${waveformRef.current ? ((waveformRef.current.clientWidth / (maxDuration || effectiveDuration || 1)) * (cursorTime || 0)) : 0}px)`,
                                        transition: 'transform 0.1s',
                                    }}
                                />
                            )}
                            {/* Grille uniquement derrière la waveform principale */}
                            {gridPx > 0 && (
                                <Box
                                    aria-hidden
                                    sx={{
                                        position: 'absolute',
                                        inset: 0,
                                        zIndex: 0,
                                        pointerEvents: 'none',
                                        backgroundImage: majorGridPx
                                            ? 'linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(to right, rgba(0,0,0,0.15) 1px, transparent 1px)'
                                            : 'linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px)',
                                        backgroundSize: majorGridPx
                                            ? `${gridPx}px 100%, ${majorGridPx}px 100%`
                                            : `${gridPx}px 100%`,
                                        backgroundRepeat: 'repeat',
                                    }}
                                />
                            )}
                            <div
                                ref={waveformRef}
                                className={`audio-waveform ${isLoading ? 'loading' : 'loaded'}`}
                                style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative', zIndex: 1 }}
                            />
                        </Box>
                    ) : (
                        <Box sx={{
                            width: '100%',
                            height: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgb(250, 250, 250)',
                            border: '1px dashed rgb(200, 200, 200)',
                            borderRadius: 1,
                            color: 'rgb(120, 120, 120)',
                            fontStyle: 'italic',
                            fontSize: 14,
                        }}>
                            Click record to start
                        </Box>
                    )}
                    </Box>

                    {/* Liste des autres pistes audio */}
                    {showOtherTracks && (
                    <Box sx={{ p: 1, backgroundColor: 'rgb(235, 235, 235)', height: '100%', position: 'relative', zIndex: 1 }}>
                        {otherPrises.map((priseNumber, index) => (
                            priseNumber !== "0" && (
                                <Box key={`${obs[0]}-${obs[1]}-${priseNumber}-${index}`} sx={{ mb: -1.2 }} className={`audio-waveform ${isLoading ? 'loading' : 'loaded'}`}>
                                    <Box sx={{ fontSize: 11, color: 'rgb(120, 120, 120)', mb: 0.5 }}>
                                        Track {priseNumber.split("_")[0]} {priseNumber.split("_")[1] ? `- ${priseNumber.split("_")[1]}` : ""}
                                        <IconButton onClick={() => editAudio(priseNumber)} sx={{}}> <EditIcon /> </IconButton>
                                        <IconButton onClick={() => deleteAudio(priseNumber)} sx={{ color: 'rgb(120, 120, 120)' }}> <DeleteIcon /> </IconButton>
                                        <IconButton onClick={() => playAudio(priseNumber)} sx={{ color: 'rgb(120, 120, 120)' }}> {secondaryIsPlaying[priseNumber] ? <PauseIcon /> : <PlayArrowIcon />} </IconButton>
                                    </Box>
                                    <Waveform
                                        priseNumber={priseNumber}
                                        obs={obs}
                                        metadata={metadata}
                                        setCursorTime={updateCursorTime}
                                        cursorTime={cursorTime}
                                        setCurrentTrack={setCurrentTrack}
                                        currentTrack={currentTrack}
                                        maxDuration={maxDuration}
                                        enableRegions={true}
                                        onRegionSelect={handleRegionSelect}
                                        onDurationUpdate={updateTrackDuration}
                                        isMainTrack={false}
                                        mainTrackRef={waveformRef}
                                        setMaxDuration={setMaxDuration}
                                        gridPx={gridPx}
                                        majorGridPx={majorGridPx}
                                        selectedRegion={selectedRegion}
                                        onWavesurferReady={(ws) => {
                                            setWaveformRefs(prev => ({
                                                ...prev, 
                                                [priseNumber]: ws
                                            }));
                                            ws.on('play', () => setSecondaryIsPlaying(prev => ({ ...prev, [priseNumber]: true })));
                                            ws.on('pause', () => setSecondaryIsPlaying(prev => ({ ...prev, [priseNumber]: false })));
                                            ws.on('finish', () => setSecondaryIsPlaying(prev => ({ ...prev, [priseNumber]: false })));
                                        }}
                                    />
                                </Box>
                            )
                        ))}
                        {/* Piste vide / visualisateur en bas: visuel si des pistes existent, sinon message */}
                        {(!isRecording || hasAnyTrack) && (
                            <Box sx={{ mb: 1, mt:4 }} className={`audio-waveform ${isLoading ? 'loading' : 'loaded'}`}>
                                <Box sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    backgroundColor: isRecording && hasAnyTrack ? 'rgb(255, 240, 240)' : 'rgb(245, 245, 245)',
                                    mb: 1,
                                    borderRadius: 1,
                                    position: 'relative',
                                    border: isRecording && hasAnyTrack ? '2px solid rgb(255, 107, 107)' : '1px dashed rgb(200, 200, 200)',
                                    minHeight: '82px'
                                }}>
                                    <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden', p: 1 }}>
                                        <Box sx={{ fontSize: 11, color: isRecording && hasAnyTrack ? 'rgb(255, 107, 107)' : 'rgb(120, 120, 120)', mb: 0.5 }}>
                                            {isRecording && hasAnyTrack
                                                ? `Enregistrement en cours - Prise ${nextPriseNumber}`
                                                : `Piste vide - Prochaine prise ${nextPriseNumber || '...'}`}
                                        </Box>
                                        {isRecording && hasAnyTrack ? (
                                            <canvas
                                                ref={recordingCanvasRef}
                                                width={800}
                                                height={60}
                                                style={{
                                                    width: '100%',
                                                    height: '60px',
                                                    overflow: 'hidden',
                                                }}
                                            />
                                        ) : (
                                            <Box sx={{
                                                height: '60px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: 'rgb(120, 120, 120)',
                                                fontStyle: 'italic',
                                                mb: 1,
                                            }}>
                                                Click the record button to start
                                            </Box>
                                        )}
                                    </Box>
                                </Box>
                            </Box>
                        )}

                        {otherPrises.length === 0 && !isRecording && (
                            <Box sx={{ textAlign: 'center', py: 2, color: 'rgb(120, 120, 120)' }}>
                                Aucune autre piste audio trouvée
                            </Box>
                        )}
                    </Box>
                    )}
                </Box>
            </Stack>
        </Box>
    );
};
export default AudioRecorder;
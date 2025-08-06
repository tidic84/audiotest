import { useRef, useState, useMemo, useEffect } from 'react';
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
    const mediaStream = useRef(null);
    const mediaRecorder = useRef(null);
    const [isRecording, setIsRecording] = useState(false);
    const chunks = useRef([]);
    const waveformRef = useRef(null);
    const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
    const recordPlugin = useMemo(() => RecordPlugin.create(), []);
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
            // console.log(data);
            // console.log(`Data: ${data}, ipath: ${ipath} : ${data.includes(ipath)}`);
            if (data.includes(ipath)) {
                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    // const getFilenameByPrise = async (prise) => {
    //     const chapterString = obs[0] < 10 ? `0${obs[0]}` : obs[0];
    //     const paragraphString = obs[1] < 10 ? `0${obs[1]}` : obs[1];
    //     const url = `http://localhost:19119/burrito/paths/${metadata.local_path}`
    //     const response = await fetch(url, {
    //         method: "GET",
    //     })
    //     const data = await response.json();
    //     console.log(data);
    //     const filename = data.find(item => item.includes(`audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${prise}`));
    //     return filename;
    // }

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

    const getOldPriseNumber = async () => {
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
    }

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(
                { audio: true }
            );
            mediaStream.current = stream;
            mediaRecorder.current = new MediaRecorder(stream);

            mediaRecorder.current.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.current.push(e.data);
                }
            };
            mediaRecorder.current.onstart = async () => {
                setTimeout(() => {
                    setIsRecording(true);
                }, 250);
            };
            mediaRecorder.current.onstop = async () => {
                setIsRecording(false);
                const recordedBlob = new Blob(
                    chunks.current, { type: "audio/mp3" }
                );
                const url = URL.createObjectURL(recordedBlob);
                // setAudioUrl(url);
                chunks.current = [];

                const formData = new FormData();
                formData.append("file", recordedBlob);

                const newPrise = (await getOldPriseNumber()) + 1;
                const postUrl = getUrl("bytes", obs[0], obs[1], newPrise);
                fetch(postUrl, {
                    method: "POST",
                    body: formData
                });
                const audioContext = new AudioContext();
                const audioBuffer = await audioContext.decodeAudioData(await recordedBlob.arrayBuffer());
                const duration = audioBuffer.getChannelData(0).length / audioBuffer.sampleRate;
                if (duration > maxDuration) {
                    setMaxDuration(duration);
                    updateMainTrackWidth(undefined, duration);
                }
                checkIfPriseExists();
                updateOtherPrises();
            };
            mediaRecorder.current.start(250);
        } catch (error) {
            console.error('Error accessing microphone:', error);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
            mediaRecorder.current.stop();

        }
        if (mediaStream.current) {
            mediaStream.current.getTracks().forEach((track) => {
                track.stop();
            });
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

    const onPlayPause = () => {
        if (!audioUrl) return;
        wavesurfer && wavesurfer.playPause()
    }

    const onDelete = () => {
        setAudioUrl('')

        const deleteUrl = getUrl("delete");
        fetch(deleteUrl, {
            method: "POST",
        });
    }

    const onSave = () => {
        // A faire: Save le fichier audio
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

    const updateMainTrackWidth = (duration, newMaxDuration = maxDuration) => {
        if (!duration) duration = wavesurfer?.getDuration();
        wavesurfer?.setOptions({
            width: waveformRef.current.clientWidth / newMaxDuration * duration,
        })
    }



    wavesurfer?.on("ready", () => {
        const duration = wavesurfer?.getDuration();
        // console.log(duration);
        updateMainTrackWidth(duration);
        // if (regionsPlugin.getRegions().length <= 0) {
        //     getJson(getUrl("raw", obs[0], obs[1], prise, "json")).then(data => {
        //         console.log("Data: ", data.json);
        //         console.log("Taille: ", data.json.length);
        //         for (let i = 0; i < data.json.length; i++) {
        //             console.log("data.json[i]: ", data.json[i]);
        //             regionsPlugin.addRegion({
        //                 start: data.json[i].start,
        //                 end: data.json[i].end,
        //                 content: data.json[i].track,
        //                 color: 'rgba(21, 252, 0, 0.1)',
        //                 drag: false,
        //                 resize: false,
        //             })
        //         }
        //     })
        // }
        setTimeout(() => {
            setIsLoading(false);
        }, 100)
    });
    wavesurfer?.on("loading", () => {
        setIsLoading(true);
    });
    wavesurfer?.on("timeupdate", () => {
        setCursorTime(wavesurfer.getCurrentTime());
    });

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

                    // const audioContext = new AudioContext();
                    // const audioBuffer = await audioContext.decodeAudioData(await (await fetch(url)).blob().arrayBuffer());
                    // const duration = audioBuffer.getChannelData(0).length / audioBuffer.sampleRate;
                    // console.log(duration);
                    // if (duration > maxDuration) {
                    //     setMaxDuration(duration);
                    // }

                }, audioUrl != "" ? 200 : 0);
            } else {
                setTimeout(() => {
                    setAudioUrl("")
                }, audioUrl != "" ? 200 : 0);
            }
        }
        updateAudioUrl();
    }, [obs, prise, bakExists])

    useEffect(() => {
        const updateBakExists = async () => {
            setBakExists(await fileExists(getUrl() + ".bak"))
        }
        updateBakExists();


    }, [obs, prise, audioUrl])

    const [otherPrises, setOtherPrises] = useState([]);

    const updateTrackDuration = (trackId, duration) => {
        setTrackDurations(prev => {
            const newDurations = { ...prev, [trackId]: duration };
            const maxDur = Math.max(...Object.values(newDurations));
            setMaxDuration(maxDur);
            return newDurations;
        });
    };

    const handleRegionSelect = (regionData) => {
        // console.log('Région sélectionnée:', regionData);
        const oldRegion = selectedRegion[0];
        // console.log(`oldRegion: ${selectedRegion}`);
        oldRegion?.remove();
        // console.log(`regionData: ${regionData}`);
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
        /// *`POST /ingredient/copy/<repo_path>?src_path=<src_path>&target_path=<target_path>&delete_src`*
        ///
        /// Typically mounted as **`/burrito/copy/<repo_path>?src_path=<src_path>&target_path=<target_path>&delete_src`**
        ///
        /// Copies an ingredient to a new location deleting the source.
        const chapterString = obs[0] < 10 ? `0${obs[0]}` : obs[0];
        const paragraphString = obs[1] < 10 ? `0${obs[1]}` : obs[1];
        newName = newName.trim().replaceAll("_", "-").replaceAll(" ", "-").replaceAll("/", "-").replaceAll("\\", "-");

        const srcPath = `audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${oldName}.mp3`;
        const targetPath = `audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${oldName.split("_")[0]}_${newName}.mp3`;
        let url = `http://localhost:19119/burrito/ingredient/copy/${metadata.local_path}?src_path=${srcPath}&target_path=${targetPath}&delete_src=true`;
        fetch(url, {
            method: "POST",
        });
    }

    const updateOtherPrises = async () => {
        if (showOtherTracks) {
            const prises = await listPrises(obs[0], obs[1]);
            // console.log(prises);

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
            // console.log(`Prise 0: ${priseExists}, Prise 1: ${prise1Exists}`);
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
                            "end": wavesurfer.getDuration(),
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
            cursorRef.current.style.backgroundColor = 'red';
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
        regionsPlugin.getRegions().forEach(region => {
            if (selectedRegion[0] != region) {
                region.remove();
            }
        });
    }, [selectedRegion])

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
                setCursorTime(cursorTime - 0.1);
                return;
            } else if (event.key === 'ArrowRight') {
                if (cursorTime + 0.1 > maxDuration) {
                    setCursorTime(maxDuration);
                    return;
                }
                setCursorTime(cursorTime + 0.1);
                return;
            } else if (event.key === 'r') {
                return isRecording ? stopRecording() : startRecording();
            }
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    })

    return (
        <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
            <Stack sx={{ position: 'relative', mt: 5, backgroundColor: "rgb(224, 224, 224)", borderRadius: 1, boxShadow: 1, width: '100%', height: otherPrises?.length > 0 ? `${otherPrises?.length * 100}px + 150px` : '150px', overflow: 'hidden' }}>

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

                {/* Curseur multi track */}
                {showOtherTracks && (
                    <span
                        ref={cursorRef}
                        style={{
                            position: 'absolute',
                            height: '100%',
                            width: '1px',
                            backgroundColor: 'transparent',
                            zIndex: 3,
                            pointerEvents: 'none',
                            left: 8,
                            transform: `translateX(${waveformRef.current ? waveformRef.current.clientWidth / maxDuration * cursorTime : 0}px)`,
                            transition: 'transform 0.1s',
                        }}
                    />
                )}

                {/* Track principale */}
                <Box sx={{ p: 1, backgroundColor: 'rgb(245, 245, 245)', height: '100%' }}>
                    <Box sx={{ fontSize: 12, fontWeight: 600, mb: 1, color: 'rgb(45, 188, 255)' }}>
                        MAIN TRACK - {prise.split("_")[0]} {prise.split("_")[1] ? `- ${prise.split("_")[1]}` : ""}
                    </Box>
                    <div
                        ref={waveformRef}
                        className={`audio-waveform ${isLoading ? 'loading' : 'loaded'}`}
                        style={{ width: '100%', height: '100px', marginBottom: '', overflow: 'hidden' }}
                    />
                </Box>

                {/* Liste des autres pistes audio */}
                {showOtherTracks && (
                    <Box sx={{ p: 1, backgroundColor: 'rgb(235, 235, 235)', height: '100%' }}>
                        {otherPrises.map((priseNumber, index) => (
                            priseNumber !== "0" && (
                                <Box key={`${obs[0]}-${obs[1]}-${priseNumber}-${index}`} sx={{ mb:-1.2 }} className={`audio-waveform ${isLoading ? 'loading' : 'loaded'}`}>
                                    {/* <Box sx={{ fontSize: 11, color: 'rgb(120, 120, 120)', mb: 0.5 }}>
                                        Track {priseNumber.split("_")[0]} {priseNumber.split("_")[1] ? `- ${priseNumber.split("_")[1]}` : ""}
                                        <IconButton onClick={() => editAudio(priseNumber)} sx={{}}> <EditIcon /> </IconButton>
                                    </Box> */}
                                    <Waveform
                                        priseNumber={priseNumber}
                                        obs={obs}
                                        metadata={metadata}
                                        setCursorTime={setCursorTime}
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
                                        selectedRegion={selectedRegion}
                                    />
                                </Box>
                            )
                        ))}
                        {otherPrises.length === 0 && (
                            <Box sx={{ textAlign: 'center', py: 2, color: 'rgb(120, 120, 120)' }}>
                                Aucune autre piste audio trouvée
                            </Box>
                        )}
                    </Box>
                )}
            </Stack>
        </Box>
    );
};
export default AudioRecorder;
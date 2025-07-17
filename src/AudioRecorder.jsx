import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import { Box, IconButton, Stack, Divider } from '@mui/material';
import { useWavesurfer } from '@wavesurfer/react'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'


const AudioRecorder = ({ audioUrl, setAudioUrl }) => {
    const mediaStream = useRef(null);
    const mediaRecorder = useRef(null);
    const [isRecording, setIsRecording] = useState(false);
    const chunks = useRef([]);
    const waveformRef = useRef(null);
    const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
    const recordPlugin = useMemo(() => RecordPlugin.create(), []);
    const plugins = useMemo(() => [regionsPlugin, recordPlugin], [regionsPlugin, recordPlugin]);

    
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
            mediaRecorder.current.onstop = () => {
                setIsRecording(false);
                const recordedBlob = new Blob(
                    chunks.current, { type: "audio/mp3" }
                );
                const url = URL.createObjectURL(recordedBlob);

                setAudioUrl(url);
                chunks.current = [];
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
        waveColor: 'rgb(102, 102, 102)',
        progressColor: 'rgb(27, 27, 27)',
        url: audioUrl,
        plugins: plugins,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
    })

    const onPlayPause = () => {
        wavesurfer && wavesurfer.playPause()
    }

    const onDelete = () => {
        // A faire: Peut etre delete le fichier audio
        setAudioUrl('')
    }

    const onSave = () => {
        // A faire: Save le fichier audio
    }

    const addRegion = (start, end, content = "") => {
        regionsPlugin.addRegion({
            content: content,
            start: start,
            end: end,
          });
    }

    useEffect(() => {
        regionsPlugin.getRegions().forEach((region) => {
            console.log(`${region.start} - ${region.end}`);
        });
    });


    return (
        <Stack sx={{ display: '', alignItems: '', justifyContent: '', backgroundColor: "rgb(224, 224, 224)", borderRadius: 1, boxShadow: 1, width: '100%', height: '150px' }}>

            {/* Barre du haut */}
            <Box sx={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgb(206, 204, 204)'}}>
                {/*Timer*/}
                <Box sx={{ fontSize: 16, fontWeight: 600, marginLeft: 2, minWidth: '60px', textAlign: 'center'}}> {formatTime(currentTime)} </Box>
                {/*Play/Pause Button*/}
                <IconButton onClick={onPlayPause}> {isPlaying ? <PauseIcon /> : <PlayArrowIcon />} </IconButton>
                {/*Record Button*/}
                <IconButton onClick={isRecording ? stopRecording : startRecording}> {isRecording ? <StopIcon /> : <MicIcon />} </IconButton>
                {/*Save Button*/}
                <IconButton onClick={onSave}> <SaveIcon /> </IconButton>
                {/*Delete Button*/}
                <IconButton onClick={onDelete}> <DeleteIcon /> </IconButton>
                {/*Add Region Button*/}
                <IconButton onClick={() => addRegion(currentTime, currentTime + 2)}> <EditIcon /> </IconButton>
            </Box>
            <Divider />
            {/* Progress Bar */}
            <Box sx={{ display: '', alignItems: '' }}>
                <div ref={waveformRef} style={{ width: '100%', height: '70px', marginBottom: '' }} />
            </Box>

        </Stack>

    );
};
export default AudioRecorder;
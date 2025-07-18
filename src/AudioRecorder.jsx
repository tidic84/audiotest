import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import { Box, IconButton, Stack, Divider, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import { useWavesurfer } from '@wavesurfer/react'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'


const AudioRecorder = ({ audioUrl, setAudioUrl }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [availableDevices, setAvailableDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState('');
    const [recordingTime, setRecordingTime] = useState(0);
    const waveformRef = useRef(null);
    
    const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
    
    const recordPlugin = useMemo(() => RecordPlugin.create({
        renderRecordedAudio: false,
        scrollingWaveform: false,
        continuousWaveform: true,
        continuousWaveformDuration: 30,
    }), []);
    
    const plugins = useMemo(() => [regionsPlugin, recordPlugin], [regionsPlugin, recordPlugin]);

    // Configuration pour l'enregistrement et la lecture
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
    });

    // Initialiser les événements du plugin Record
    useEffect(() => {
        if (!recordPlugin) return;

        // Gestionnaire pour la fin d'enregistrement
        const handleRecordEnd = (blob) => {
            const recordedUrl = URL.createObjectURL(blob);
            setAudioUrl(recordedUrl);
            setIsRecording(false);
            setIsPaused(false);
            setRecordingTime(0);
        };

        // Gestionnaire pour le progrès d'enregistrement
        const handleRecordProgress = (time) => {
            setRecordingTime(time);
        };

        recordPlugin.on('record-end', handleRecordEnd);
        recordPlugin.on('record-progress', handleRecordProgress);

        return () => {
            recordPlugin.off('record-end', handleRecordEnd);
            recordPlugin.off('record-progress', handleRecordProgress);
        };
    }, [recordPlugin, setAudioUrl]);

    // Charger les périphériques audio disponibles
    useEffect(() => {
        const loadDevices = async () => {
            try {
                const devices = await RecordPlugin.getAvailableAudioDevices();
                setAvailableDevices(devices);
                if (devices.length > 0 && !selectedDevice) {
                    setSelectedDevice(devices[0].deviceId);
                }
            } catch (error) {
                console.error('Erreur lors du chargement des périphériques audio:', error);
            }
        };

        loadDevices();
    }, [selectedDevice]);

    const startRecording = async () => {
        try {
            if (!recordPlugin) return;
            
            const deviceId = selectedDevice || (availableDevices[0]?.deviceId);
            await recordPlugin.startRecording({ deviceId });
            setIsRecording(true);
            setIsPaused(false);
        } catch (error) {
            console.error('Erreur lors du démarrage de l\'enregistrement:', error);
        }
    };

    const stopRecording = () => {
        if (recordPlugin && (recordPlugin.isRecording() || recordPlugin.isPaused())) {
            recordPlugin.stopRecording();
        }
    };

    const pauseRecording = () => {
        if (!recordPlugin) return;
        
        if (recordPlugin.isPaused()) {
            recordPlugin.resumeRecording();
            setIsPaused(false);
        } else {
            recordPlugin.pauseRecording();
            setIsPaused(true);
        }
    };

    const formatTime = (timeInMs) => {
        const time = Math.floor(timeInMs / 1000); // Convertir de millisecondes en secondes
        const seconds = Math.floor(time % 60);
        const minutes = Math.floor(time / 60);
        return minutes + ":" + (seconds < 10 ? "0" + seconds : seconds);
    };

    const onPlayPause = () => {
        wavesurfer && wavesurfer.playPause()
    }

    const onDelete = () => {
        setAudioUrl('')
    }

    const onSave = () => {
        // TODO: Implémenter la sauvegarde du fichier audio
        if (audioUrl) {
            const link = document.createElement('a');
            link.href = audioUrl;
            link.download = 'enregistrement.webm';
            link.click();
        }
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

    const handleDeviceChange = (event) => {
        setSelectedDevice(event.target.value);
    };

    return (
        <Stack sx={{ 
            display: 'flex', 
            alignItems: 'stretch', 
            justifyContent: 'flex-start', 
            backgroundColor: "rgb(224, 224, 224)", 
            borderRadius: 1, 
            boxShadow: 1, 
            width: '100%', 
            height: 'auto',
            minHeight: '180px'
        }}>

            {/* Barre du haut */}
            <Box sx={{ display: 'flex', alignItems: 'center', backgroundColor: 'rgb(206, 204, 204)', padding: 1}}>
                {/*Timer*/}
                <Box sx={{ fontSize: 16, fontWeight: 600, marginLeft: 2, minWidth: '60px', textAlign: 'center'}}> 
                    {isRecording ? formatTime(recordingTime) : formatTime(currentTime * 1000)} 
                </Box>
                
                {/*Play/Pause Button*/}
                <IconButton onClick={onPlayPause} disabled={isRecording}> 
                    {isPlaying ? <PauseIcon /> : <PlayArrowIcon />} 
                </IconButton>
                
                {/*Record Button*/}
                <IconButton onClick={isRecording ? stopRecording : startRecording}> 
                    {isRecording ? <StopIcon sx={{ color: 'red' }} /> : <MicIcon />} 
                </IconButton>
                
                {/*Pause Recording Button*/}
                {isRecording && (
                    <IconButton onClick={pauseRecording}> 
                        <PauseIcon sx={{ color: isPaused ? 'orange' : 'default' }} /> 
                    </IconButton>
                )}
                
                {/*Save Button*/}
                <IconButton onClick={onSave} disabled={!audioUrl}> 
                    <SaveIcon /> 
                </IconButton>
                
                {/*Delete Button*/}
                <IconButton onClick={onDelete}> 
                    <DeleteIcon /> 
                </IconButton>
                
                {/*Add Region Button*/}
                <IconButton onClick={() => addRegion(currentTime, currentTime + 2)} disabled={isRecording}> 
                    <EditIcon /> 
                </IconButton>
            </Box>
            
            {/* Sélection du microphone */}
            <Box sx={{ padding: 1, backgroundColor: 'rgb(206, 204, 204)', borderTop: '1px solid #ccc' }}>
                <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Microphone</InputLabel>
                    <Select
                        value={selectedDevice}
                        onChange={handleDeviceChange}
                        label="Microphone"
                        disabled={isRecording}
                    >
                        {availableDevices.map((device) => (
                            <MenuItem key={device.deviceId} value={device.deviceId}>
                                {device.label || `Microphone ${device.deviceId.slice(0, 8)}...`}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
            
            <Divider />
            
            {/* Forme d'onde */}
            <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
                <div ref={waveformRef} style={{ width: '100%', height: '70px' }} />
            </Box>

        </Stack>
    );
};

export default AudioRecorder;
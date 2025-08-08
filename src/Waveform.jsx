import { useRef, useMemo, useEffect, useState } from 'react';
import { useWavesurfer } from '@wavesurfer/react'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

const Waveform = ({
    priseNumber,
    obs,
    metadata,
    setCursorTime,
    cursorTime,
    currentTrack,
    setCurrentTrack,
    maxDuration,
    enableRegions = false,
    onRegionSelect = null,
    isMainTrack = false,
    onDurationUpdate = null,
    mainTrackRef = null,
    selectedRegion = null,
    onWavesurferReady = null,
}) => {
    const waveformContainerRef = useRef(null);
    const waveformRef = useRef(null);
    const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
    const timelinePlugin = useMemo(() => TimelinePlugin.create({
        height: 100,
        insertPosition: 'beforebegin',
        timeInterval: 0.2,
        primaryLabelInterval: 5,
        secondaryLabelInterval: 1,
        style: {
          fontSize: '0px',
          color: '#2D5B88',
        },
      })
      , []);
    const plugins = useMemo(() => [regionsPlugin], [regionsPlugin]);
    const [actualDuration, setActualDuration] = useState(0);
    const [fileExists, setFileExists] = useState(false);
    const [audioUrl, setAudioUrl] = useState(null);

    const checkFileExists = async (audioUrl) => {
        const url = `http://localhost:19119/burrito/paths/${metadata.local_path}`
        const ipath = audioUrl.split("?ipath=")[1];
        try {
            const response = await fetch(url, {
                method: "GET",
            })
            if (response.ok) {
                const data = await response.json();
                return data.includes(ipath);
            } else {
                return false;
            }
        } catch (error) {
            console.warn(`Error checking file existence for ${audioUrl}:`, error);
            return false;
        }
    }

    useEffect(() => {


        const checkAndSetUrl = async () => {
            const url = getUrl();
            const exists = await checkFileExists(url);
            setFileExists(exists);
            if (exists) {
                setAudioUrl(url);
            } else {
                setAudioUrl(null);
            }
        };
        checkAndSetUrl();
    }, [priseNumber, obs, metadata]);

    const getUrl = (segment = "bytes", chapter = obs[0], paragraph = obs[1], prise = priseNumber) => {
        let chapterString = chapter < 10 ? `0${chapter}` : chapter;
        let paragraphString = paragraph < 10 ? `0${paragraph}` : paragraph;
        let url = `http://localhost:19119/burrito/ingredient/${segment}/${metadata.local_path}?ipath=audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${prise}.mp3`
        return url
    }

    const waveformConfig = {
        container: waveformRef,
        height: 80,
        waveColor: 'rgb(34, 173, 197)',
        progressColor: 'rgb(64, 107, 114)',
        url: audioUrl,
        plugins: plugins,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 0,
    };

    const { wavesurfer, currentTime, isPlaying } = useWavesurfer(waveformConfig);

    useEffect(() => {
        if (!wavesurfer) return;

        const handleReady = () => {
            const duration = wavesurfer.getDuration();

            if (onDurationUpdate) {
                onDurationUpdate(priseNumber, duration);
            }

            if (onWavesurferReady) {
                onWavesurferReady(wavesurfer);
            }
        };

        const handleClick = () => {
            setCursorTime(wavesurfer.getCurrentTime());
        };

        const handleInteraction = () => {
            setCurrentTrack(priseNumber);
        };

        if (enableRegions) {
            const handleRegionCreate = (region) => {
                if (onRegionSelect) {
                    onRegionSelect([region, priseNumber, regionsPlugin]);
                }
            };

            const handleRegionClick = (region) => {
                    onRegionSelect([region, priseNumber, regionsPlugin]);
            };

            regionsPlugin?.on('region-created', handleRegionCreate);
            regionsPlugin?.on('region-clicked', handleRegionClick);
        }

        wavesurfer?.on('ready', handleReady);
        wavesurfer?.on('click', handleClick);
        wavesurfer?.on('interaction', handleInteraction);

    }, [wavesurfer, enableRegions, onRegionSelect, maxDuration, priseNumber, setCursorTime, setCurrentTrack, onDurationUpdate]);

    useEffect(() => {
        regionsPlugin?.enableDragSelection({
            drag: true,
            color: 'rgba(0, 0, 0, 0.2)',
        }, 1);
    }, []);

    const updateActualDuration = () => {
        const duration = wavesurfer?.getDuration();
        if (maxDuration && maxDuration >= duration) {
            let newDuration = mainTrackRef.current.clientWidth / maxDuration * duration;
            setActualDuration(newDuration);
        }
    }

    useEffect(() => {
        updateActualDuration();
    }, [maxDuration, mainTrackRef]);

    useEffect(() => {
        regionsPlugin.getRegions().forEach(region => { 
            if(selectedRegion[0] != region) {
                region.remove();
            }
        });
    }, [selectedRegion])

    useEffect(() => {
        if (wavesurfer && cursorTime !== undefined) {
            const clampedTime = Math.min(cursorTime, actualDuration);
            wavesurfer?.setTime(clampedTime);
        }
    }, [cursorTime, wavesurfer, actualDuration]);

    const onPlayPause = () => {
        wavesurfer && wavesurfer?.playPause();
    };

    const formatTime = (time) => {
        const seconds = Math.floor(time % 60);
        const minutes = Math.floor(time / 60);
        return minutes + ":" + (seconds < 10 ? "0" + seconds : seconds);
    };

    return (
        <Box
            ref={waveformContainerRef}
            sx={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: currentTrack == priseNumber ? 'rgb(255, 255, 255)' : 'rgb(255, 255, 255)',
                mb: 1,
                borderRadius: 1,
                position: 'relative',
                border: isMainTrack ? '2px solid rgb(255, 69, 0)' : '1px solid rgb(200, 200, 200)',
            }}>
            <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {fileExists ? (
                <div
                    ref={waveformRef}
                    style={{
                        width: actualDuration,
                        height: isMainTrack ? '100px' : '80px',
                        overflow: 'hidden',
                    }}
                />) : (
                    <Box sx={{ width: actualDuration, height: isMainTrack ? '100px' : '80px', overflow: 'hidden' }}>
                        <p>File does not exist</p>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default Waveform;
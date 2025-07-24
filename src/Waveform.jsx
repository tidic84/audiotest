import { useRef, useMemo, useEffect, useState } from 'react';
import { useWavesurfer } from '@wavesurfer/react'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js'
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
}) => {
    const waveformContainerRef = useRef(null);
    const waveformRef = useRef(null);
    const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
    const plugins = useMemo(() => [regionsPlugin,], [regionsPlugin]);
    const [actualDuration, setActualDuration] = useState(0);

    const getUrl = (segment = "bytes", chapter = obs[0], paragraph = obs[1], prise = priseNumber) => {
        let chapterString = chapter < 10 ? `0${chapter}` : chapter;
        let paragraphString = paragraph < 10 ? `0${paragraph}` : paragraph;
        return `http://localhost:19119/burrito/ingredient/${segment}/${metadata.local_path}?ipath=audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${prise}.mp3`
    }

    const waveformConfig = {
        container: waveformRef,
        height: isMainTrack ? 80 : 60,
        waveColor: 'rgb(34, 173, 197)',
        progressColor: 'rgb(64, 107, 114)',
        url: getUrl(),
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

            if (maxDuration && duration < maxDuration) {
                const ratio = duration / maxDuration;
                console.log(`Track ${priseNumber}: ${duration}s/${maxDuration}s (${(ratio * 100).toFixed(1)}%)`);
            }

            if (onDurationUpdate) {
                onDurationUpdate(priseNumber, duration);
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

            const handleRegionUpdate = (region) => {
                if (onRegionSelect) {
                    onRegionSelect([region, priseNumber, regionsPlugin]);
                }
            };

            const handleRegionClick = (region) => {
                    onRegionSelect([region, priseNumber, regionsPlugin]);
            };

            regionsPlugin?.on('region-created', handleRegionCreate);
            regionsPlugin?.on('region-updated', handleRegionUpdate);
            regionsPlugin?.on('region-clicked', handleRegionClick);
            // return () => {
                // regionsPlugin?.off('region-created', handleRegionCreate);
                // regionsPlugin?.off('region-updated', handleRegionUpdate);
            // };
        }

        wavesurfer?.on('ready', handleReady);
        wavesurfer?.on('click', handleClick);
        wavesurfer?.on('interaction', handleInteraction);

        // return () => {
            // wavesurfer?.off('ready', handleReady);
        //     wavesurfer?.off('click', handleClick);
            // wavesurfer?.off('interaction', handleInteraction);
        // };
    }, [wavesurfer, enableRegions, onRegionSelect, maxDuration, priseNumber, setCursorTime, setCurrentTrack, onDurationUpdate]);

    useEffect(() => {
        regionsPlugin?.enableDragSelection({
            drag: true,
            color: 'rgba(0, 0, 0, 0.3)',
        }, 1);
    }, []);

    const updateActualDuration = () => {
        const duration = wavesurfer?.getDuration();
        if (maxDuration && maxDuration >= duration) {
            let newDuration = mainTrackRef.current.clientWidth / maxDuration * duration;
            console.log(`${mainTrackRef.current.clientWidth} / ${maxDuration} * ${duration} = ${newDuration}`)
            setActualDuration(newDuration - 20);
        }
    }

    useEffect(() => {
        updateActualDuration();
    }, [maxDuration, mainTrackRef]);

    useEffect(() => {
        regionsPlugin.getRegions().forEach(region => { 
            if(selectedRegion[0] != region) {
            region.setOptions({ color: 'rgba(0, 0, 0, 0.1)' }) 
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

    const getDurationIndicator = () => {
        if (!maxDuration || !actualDuration) return null;
        // return (
        //     <Box sx={{ position: 'absolute', top: 0, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', color: 'white', px: 1, py: 0.5, borderRadius: 1, fontSize: '0.75rem', zIndex: 1 }}>
        //         {formatTime(actualDuration)}
        //     </Box>
        // )

        // return (
        //     <Box 
        //         sx={{ 
        //             position: 'absolute', 
        //             top: 0, 
        //             right: 8, 
        //             backgroundColor: 'rgba(0,0,0,0.6)', 
        //             color: 'white', 
        //             px: 1, 
        //             py: 0.5, 
        //             borderRadius: 1, 
        //             fontSize: '0.75rem',
        //             zIndex: 1
        //         }}
        //     >
        //         {formatTime(actualDuration)} ({percentage.toFixed(0)}%)
        //     </Box>
        // );
    };

    return (
        <Box
            ref={waveformContainerRef}
            sx={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: currentTrack == priseNumber ? 'rgb(255, 239, 239)' : 'rgb(255, 255, 255)',
                mb: 1,
                borderRadius: 1,
                position: 'relative',
                border: isMainTrack ? '2px solid rgb(255, 69, 0)' : '1px solid rgb(200, 200, 200)',
            }}>
            <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <div
                    ref={waveformRef}
                    style={{
                        width: actualDuration,
                        height: isMainTrack ? '80px' : '60px',
                        overflow: 'hidden',
                    }}
                />
                {getDurationIndicator()}
            </Box>

            {/* Boutons de contrôle pour la track principale */}
            {/* {isMainTrack && (
                <Box sx={{ px: 1 }}>
                    <IconButton size="small" onClick={onPlayPause}>
                        {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                    </IconButton>
                </Box>
            )} */}
        </Box>
    );
};

export default Waveform;
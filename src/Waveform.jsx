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
    gridPx,
    majorGridPx,
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
    const [cacheBust, setCacheBust] = useState(Date.now());
    const [actualDuration, setActualDuration] = useState(0);
    const [fileExists, setFileExists] = useState(false);
    const [audioUrl, setAudioUrl] = useState(null);

  const checkFileExists = async (audioUrl) => {
      try {
          const resp = await fetch(audioUrl, { method: 'GET', cache: 'no-store' });
          return resp.ok;
      } catch (error) {
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
              return true;
          } else {
              setAudioUrl(null);
              return false;
          }
      };
      // Essai initial
      let cancelled = false;
      let attempts = 0;
      const maxAttempts = 30; // ~9s si interval 300ms
      const intervalMs = 300;

      const tryLoad = async () => {
          const ok = await checkAndSetUrl();
          if (cancelled) return;
          if (ok) return; // trouvé
          attempts += 1;
          if (attempts < maxAttempts) {
              setCacheBust(Date.now());
              setTimeout(tryLoad, intervalMs);
          }
      };

      tryLoad();
      return () => { cancelled = true };
    }, [priseNumber, obs, metadata]);

    const getUrl = (segment = "bytes", chapter = obs[0], paragraph = obs[1], prise = priseNumber) => {
        let chapterString = chapter < 10 ? `0${chapter}` : chapter;
        let paragraphString = paragraph < 10 ? `0${paragraph}` : paragraph;
        let url = `http://localhost:19119/burrito/ingredient/${segment}/${metadata.local_path}?ipath=audio_content/${chapterString}-${paragraphString}/${chapterString}-${paragraphString}_${prise}.mp3&_v=${cacheBust}`
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
        cursorWidth: isMainTrack ? 0 : 1,
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
            const time = wavesurfer.getCurrentTime();
            const snapped = Math.round(time / 0.1) * 0.1;
            // Pour les pistes secondaires: ne pas toucher au curseur global, juste caler localement
            wavesurfer.setTime(snapped);
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
                if (onRegionSelect) {
                    onRegionSelect([region, priseNumber, regionsPlugin]);
                }
            };

            const handleRegionUpdate = (region) => {
                if (onRegionSelect) {
                    onRegionSelect([region, priseNumber, regionsPlugin]);
                }
            };

            regionsPlugin?.on('region-created', handleRegionCreate);
            regionsPlugin?.on('region-clicked', handleRegionClick);
            regionsPlugin?.on('region-updated', handleRegionUpdate);
        }

        wavesurfer?.on('ready', handleReady);
        wavesurfer?.on('click', handleClick);
        wavesurfer?.on('interaction', handleInteraction);

    }, [wavesurfer, enableRegions, onRegionSelect, maxDuration, priseNumber, setCursorTime, setCurrentTrack, onDurationUpdate]);

    useEffect(() => {
        if (!enableRegions || !regionsPlugin || !wavesurfer) return;
        try {
            regionsPlugin.enableDragSelection({
                drag: true,
                color: 'rgba(0, 0, 0, 0.2)'
            });
        } catch (e) {
            // noop
        }
    }, [enableRegions, regionsPlugin, wavesurfer]);

    const updateActualDuration = () => {
        const duration = wavesurfer?.getDuration();
        if (maxDuration && duration && maxDuration >= duration) {
            const mainWidth = mainTrackRef?.current?.clientWidth || 0;
            const newDuration = mainWidth ? (mainWidth / maxDuration) * duration : 0;
            setActualDuration(newDuration);
            return;
        }
        // Fallback: occuper la largeur de la piste principale tant que maxDuration n'est pas calculé
        const fallbackWidth = mainTrackRef?.current?.clientWidth;
        if (fallbackWidth) {
            setActualDuration(fallbackWidth);
        }
    }

    useEffect(() => {
        updateActualDuration();
    }, [maxDuration, mainTrackRef]);

    useEffect(() => {
        if (!selectedRegion || selectedRegion.length === 0) return;
        const [, selectedPrise] = selectedRegion;
        // Si la sélection vient de cette piste, on garde uniquement la région sélectionnée
        if (selectedPrise === priseNumber) {
            regionsPlugin.getRegions().forEach(region => {
                if (selectedRegion[0] !== region) {
                    region.remove();
                }
            });
            return;
        }
        // Si la sélection vient de la piste principale, on supprime toutes les régions de cette piste secondaire
        if (selectedPrise === "0") {
            regionsPlugin.getRegions().forEach(region => {
                region.remove();
            });
        }
    }, [selectedRegion, regionsPlugin, priseNumber])

    // Décorrélation temporelle: on ne force plus le setTime des pistes secondaires depuis le curseur global

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
                <Box sx={{ position: 'relative', width: actualDuration || (mainTrackRef?.current?.clientWidth || '100%'), height: isMainTrack ? '100px' : '80px', overflow: 'hidden' }}>
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
                        style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden',
                            position: 'relative',
                            zIndex: 1,
                        }}
                    />
                </Box>) : (
                    <Box sx={{ width: actualDuration, height: isMainTrack ? '100px' : '80px', overflow: 'hidden' }}>
                        <p>File does not exist</p>
                    </Box>
                )}
            </Box>
        </Box>
    );
};

export default Waveform;
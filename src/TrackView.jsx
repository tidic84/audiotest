import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import TextField from "@mui/material/TextField";

import Clip from "./trackview/Clip";
import TimelineAxis from "./trackview/TimelineAxis";
import Playhead from "./trackview/Playhead";
import SelectionOverlay from "./trackview/SelectionOverlay";

const DRAG_THRESHOLD = 3;
const LANE_HEIGHT = 80;
// Doit rester aligné avec la `margin` interact.js resizable (10 par défaut).
// Sert à savoir si un pointerdown au bord du clip relève du resize (et non
// d'une sélection de région intra-clip).
const CLIP_RESIZE_MARGIN = 10;

export default function TrackView({
    track,
    projectDuration,
    isSelected,
    onSeek,
    onDelete,
    playheadTime,
    regionSelection,
    onRegionChange,
    onRename,
    onClipMove,
    onClipMoveAcrossTracks,
    onClipTrim,
    clipSelection,
    onClipSelect,
    onClearClipSelection,
    getSnapCandidates,
    snapEnabled,
    snapStep,
}) {
    const laneRef = useRef(null);
    const [laneWidth, setLaneWidth] = useState(0);
    const pxPerSec = projectDuration > 0 ? laneWidth / projectDuration : 0;

    useEffect(() => {
        const el = laneRef.current;
        if (!el) return;
        setLaneWidth(el.clientWidth);
        const ro = new ResizeObserver(([entry]) => {
            setLaneWidth(entry.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Sélection en cours de construction (drag souris sur la lane).
    // Quand le drag se termine, on commit via onRegionChange et on remet à null.
    const [dragSel, setDragSel] = useState(null);
    const dragStateRef = useRef(null);

    const xToTime = (clientX) => {
        if (pxPerSec <= 0) return 0;
        const rect = laneRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        return Math.max(0, Math.min(projectDuration, x / pxPerSec));
    };

    const onLanePointerDown = (e) => {
        if (e.button !== 0) return;
        // Si le pointerdown vient du header d'un clip, ne rien armer côté lane :
        // le header gère sa propre logique (clic = sélection, drag = move via interactjs)
        // et a déjà stoppé la propagation. Garde-fou si jamais le stopPropagation
        // n'a pas eu lieu.
        if (e.target.closest("[data-clip-header]")) return;

        const clipEl = e.target.closest("[data-clip-id]");
        // Si le pointerdown est dans la zone de resize (bord gauche/droit du
        // clip), interact.js gère le resize → on n'arme rien côté lane sinon
        // une région se dessinerait par-dessus le resize.
        if (clipEl) {
            const rect = clipEl.getBoundingClientRect();
            if (
                e.clientX < rect.left + CLIP_RESIZE_MARGIN ||
                e.clientX > rect.right - CLIP_RESIZE_MARGIN
            ) {
                return;
            }
        }
        const clipSeg = clipEl
            ? track.edl.find((s) => s.id === clipEl.dataset.clipId)
            : null;
        const t = xToTime(e.clientX);
        dragStateRef.current = {
            startTime: t,
            startX: e.clientX,
            dragged: false,
            clipSeg, // segment ciblé si le drag commence dans le body d'un clip
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    // Clamp [start,end] aux bornes d'un segment (drag intra-clip).
    const clampToClip = (start, end, clipSeg) => {
        if (!clipSeg) return { start, end };
        const vStart = clipSeg.vStart;
        const vEnd = vStart + (clipSeg.srcEnd - clipSeg.srcStart);
        return {
            start: Math.max(vStart, start),
            end: Math.min(vEnd, end),
        };
    };

    const onLanePointerMove = (e) => {
        const st = dragStateRef.current;
        if (!st) return;
        if (!st.dragged && Math.abs(e.clientX - st.startX) <= DRAG_THRESHOLD) return;
        st.dragged = true;
        const t = xToTime(e.clientX);
        const raw = {
            start: Math.min(st.startTime, t),
            end: Math.max(st.startTime, t),
        };
        setDragSel(clampToClip(raw.start, raw.end, st.clipSeg));
    };

    const onLanePointerUp = (e) => {
        const st = dragStateRef.current;
        dragStateRef.current = null;
        if (!st) return;

        if (!st.dragged) {
            // Clic simple (body d'un clip ou fond de la lane) → playhead.
            onSeek?.(track.id, st.startTime);
            onRegionChange?.(null);
            return;
        }

        const t = xToTime(e.clientX);
        const raw = {
            start: Math.min(st.startTime, t),
            end: Math.max(st.startTime, t),
        };
        const { start, end } = clampToClip(raw.start, raw.end, st.clipSeg);
        setDragSel(null);
        // Si le clamp a tout réduit (drag minuscule au bord du clip), on ne
        // commit pas une région vide.
        if (end <= start) {
            onRegionChange?.(null);
            return;
        }
        onRegionChange?.({
            trackId: track.id,
            start,
            end,
        });
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") {
                setDragSel(null);
                if (regionSelection?.trackId === track.id) {
                    onRegionChange?.(null);
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [regionSelection, track.id, onRegionChange]);

    // Visible = drag local OU sélection committée pour cette piste
    const visibleSelection =
        dragSel ??
        (regionSelection?.trackId === track.id
            ? { start: regionSelection.start, end: regionSelection.end }
            : null);

    // Rename
    const [isRenaming, setIsRenaming] = useState(false);
    const [draftName, setDraftName] = useState(track.name);

    return (
        <Box
            sx={{
                // borderBottom: "1px solid #777",
                borderTop: "1px solid #777",
            }}
        >
            <Stack direction="row" alignItems="stretch" spacing={1}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                        ref={laneRef}
                        data-lane-id={track.id}
                        onPointerDown={onLanePointerDown}
                        onPointerMove={onLanePointerMove}
                        onPointerUp={onLanePointerUp}
                        sx={{
                            position: "relative",
                            width: "100%",
                            height: LANE_HEIGHT,
                            background: isSelected ? "#e9e9e9" : "#fafafa",
                            overflow: "visible",
                            touchAction: "none",
                            userSelect: "none",
                            cursor: "crosshair",
                        }}
                    >
                        {pxPerSec > 0 && (
                            <TimelineAxis
                                projectDuration={projectDuration}
                                pxPerSec={pxPerSec}
                            />
                        )}
                        {pxPerSec > 0 &&
                            track.edl.map((seg) => {
                                const isClipSelected = !!clipSelection?.some(
                                    (c) => c.trackId === track.id && c.segId === seg.id,
                                );
                                return (
                                    <Clip
                                        key={seg.id}
                                        segment={seg}
                                        trackId={track.id}
                                        trackBuffer={track.buffer}
                                        pxPerSec={pxPerSec}
                                        isSelected={isClipSelected}
                                        onMove={onClipMove}
                                        onMoveAcrossTracks={onClipMoveAcrossTracks}
                                        onClipTrim={onClipTrim}
                                        onSelect={onClipSelect}
                                        getSnapCandidates={getSnapCandidates}
                                        snapEnabled={snapEnabled}
                                        snapStep={snapStep}
                                    />
                                );
                            })}
                        {visibleSelection && (
                            <SelectionOverlay
                                start={visibleSelection.start}
                                end={visibleSelection.end}
                                pxPerSec={pxPerSec}
                            />
                        )}
                        {playheadTime != null && (
                            <Playhead time={playheadTime} pxPerSec={pxPerSec} />
                        )}
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                    sx={{ alignSelf: "stretch", borderColor: "transparent"}}
                />

                <Stack
                    spacing={0}
                    paddingRight={7}
                    paddingLeft={0}
                    alignItems="left"
                    margin={0}
                    top={0}
                >
                    <Box
                        minWidth={60}
                        maxWidth={60}
                        display="flex"
                        justifyContent="left"
                        alignItems="center"
                        sx={{ position: "relative", overflow: "visible", marginTop:1 }}
                    >
                        {isRenaming ? (
                            <TextField
                                size="small"
                                value={draftName}
                                autoFocus
                                onChange={(e) => setDraftName(e.target.value)}
                                onBlur={() => {
                                    onRename?.(track.id, draftName.trim() || track.name);
                                    setIsRenaming(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        onRename?.(track.id, draftName.trim() || track.name);
                                        setIsRenaming(false);
                                    } else if (e.key === "Escape") {
                                        setDraftName(track.name);
                                        setIsRenaming(false);
                                    }
                                }}
                                sx={{
                                    position: "absolute",
                                    top: "50%",
                                    left: "50%",
                                    transform: "translate(-50%, -50%)",
                                    width: 200,
                                    zIndex: 3,
                                    backgroundColor: "background.paper",
                                }}
                            />
                        ) : (
                            track.name
                        )}
                    </Box>
                    <Stack direction="row" margin={-0.7}>
                        <IconButton
                            size="small"
                            onClick={() => {
                                setDraftName(track.name);
                                setIsRenaming(true);
                            }}
                            title="Rename track"
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={onDelete} title="Delete track">
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Stack>
                </Stack>
            </Stack>
        </Box>
    );
}

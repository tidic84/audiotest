import Box from "@mui/material/Box";
import ClipWaveform from "./ClipWaveform";

import { useRef, useEffect } from "react";
import interact from "interactjs";

// Un clip = un bloc visuel positionné en absolu sur la lane.
// left/width sont calculés depuis (seg.vStart, durée) et pxPerSec.
const INSET_X = 1;
const INSET_Y = 2;
const HEADER_HEIGHT = 12;

export default function Clip({ segment, trackId, trackBuffer, pxPerSec, isSelected, onMove, onMoveAcrossTracks, onClipTrim, onSelect }) {
    const dur = segment.srcEnd - segment.srcStart;
    const left = segment.vStart * pxPerSec + INSET_X;
    const width = Math.max(0, dur * pxPerSec - INSET_X * 2);

    // Interact.js pour le draggable
    const ref = useRef(null);
    const dragDxRef = useRef(0);
    // Rect au début du resize. e.deltaRect d'interact.js est INCRÉMENTAL
    // (delta depuis le previous event), pas cumulatif. À end(), il vaut donc
    // ~0. On capture le rect initial pour calculer le total via (e.rect - startRect).
    const resizeStartRectRef = useRef(null);
    // Handle impératif vers ClipWaveform : permet de translater le canvas
    // (qui contient la waveform du buffer ENTIER) pendant le resize, sans
    // re-render React → animation 60fps sans tremblement.
    const waveformRef = useRef(null);

    const dragDyRef = useRef(0);
    const hoveredTrackIdRef = useRef(trackId);

    // Suppression du clic (sélection) si un drag interact.js a réellement eu lieu.
    // interact.js intercepte la propagation après le seuil, mais on garde un
    // garde-fou explicite via cette ref consultée dans onHeaderClick.
    const draggedRef = useRef(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        interact(el).draggable({
            // Le drag-move ne s'arme qu'à partir du header. Un drag sur le corps
            // bubble vers la lane pour devenir une sélection de région intra-clip.
            allowFrom: "[data-clip-header]",
            listeners: {
                start() {
                    draggedRef.current = true;
                    el.classList.add("dragging");
                    // Élève le clip au-dessus des autres pendant le drag pour qu'il
                    // passe visuellement par-dessus les autres lanes.
                    el.style.zIndex = "10";
                    el.style.pointerEvents = "none"; // pour que elementFromPoint voie la lane sous le clip
                },
                move(e) {
                    dragDxRef.current += e.dx;
                    dragDyRef.current += e.dy;

                    // Hit-test : trouve la lane sous le pointeur.
                    const under = document.elementFromPoint(e.client.x, e.client.y);
                    const laneEl = under?.closest("[data-lane-id]");
                    const overTrackId = laneEl?.dataset.laneId ?? hoveredTrackIdRef.current;
                    const sameTrack = overTrackId === trackId;
                    hoveredTrackIdRef.current = overTrackId;

                    // Pas de clamp : on autorise l'overlap visuel. Au drop, la cible
                    // (même piste ou non) fait un punch-in via insertSegmentAt.
                    el.style.transform = `translate(${dragDxRef.current}px, ${dragDyRef.current}px)`;

                    // Highlight de la lane cible (sauf si c'est la source).
                    document.querySelectorAll("[data-lane-id].drop-target")
                        .forEach((n) => n.classList.remove("drop-target"));
                    if (!sameTrack && laneEl) {
                        laneEl.classList.add("drop-target");
                    }
                },
                end() {
                    const dstTrackId = hoveredTrackIdRef.current;
                    const deltaSec = pxPerSec > 0 ? dragDxRef.current / pxPerSec : 0;

                    // Reset visuel.
                    el.style.transform = "";
                    el.style.zIndex = "";
                    el.style.pointerEvents = "";
                    el.classList.remove("dragging");
                    document.querySelectorAll("[data-lane-id].drop-target")
                        .forEach((n) => n.classList.remove("drop-target"));
                    dragDxRef.current = 0;
                    dragDyRef.current = 0;
                    hoveredTrackIdRef.current = trackId;

                    if (Math.abs(deltaSec) < 0.001 && dstTrackId === trackId) return;
                    // Position absolue dans la piste cible. Vrai pour same-track et
                    // cross-track : le drop "remplace" la zone d'arrivée (punch-in).
                    const newVStart = Math.max(0, segment.vStart + deltaSec);
                    if (dstTrackId === trackId) {
                        onMove?.(trackId, segment.id, newVStart);
                    } else {
                        onMoveAcrossTracks?.(trackId, dstTrackId, segment.id, newVStart);
                    }
                },
            },
        });
        interact(el).resizable({
            edges: { left: true, right: true, top: false, bottom: false },
            listeners: {
                start(e) {
                    resizeStartRectRef.current = { left: e.rect.left, right: e.rect.right };
                },
                move(e) {
                    const start = resizeStartRectRef.current;
                    if (!start || pxPerSec <= 0) return;
                    const dxLeft = e.rect.left - start.left;
                    el.style.transform = `translateX(${dxLeft}px)`;
                    el.style.width = `${e.rect.width}px`;
                    // Translate la waveform pour que la portion visible
                    // corresponde à [srcStart + dxLeft/pxPerSec, srcEnd + dxRight/pxPerSec].
                    // Seul srcStart influe sur la translation ; srcEnd est
                    // implicitement géré par le crop (overflow:hidden).
                    const newSrcStartPx =
                        segment.srcStart * pxPerSec + dxLeft;
                    waveformRef.current?.setSrcStartPx(newSrcStartPx);
                },
                end(e) {
                    const start = resizeStartRectRef.current;
                    el.style.transform = "";
                    el.style.width = "";
                    resizeStartRectRef.current = null;
                    if (!start || pxPerSec <= 0) return;
                    const deltaLeft = (e.rect.left - start.left) / pxPerSec;
                    const deltaRight = (e.rect.right - start.right) / pxPerSec;
                    if (Math.abs(deltaLeft) > 0.001 || Math.abs(deltaRight) > 0.001) {
                        onClipTrim?.(trackId, segment.id, deltaLeft, deltaRight);
                    }
                    // La waveform sera repositionnée par React au prochain
                    // render via la prop left de ClipWaveform.
                },
            },
        });
        return () => interact(el).unset();
    }, [pxPerSec, onMove, onMoveAcrossTracks, onClipTrim, trackId, segment.id]);

    const onHeaderClick = (e) => {
        // Si un drag interact.js a eu lieu, on n'enclenche pas la sélection.
        // Pas de stopPropagation : interact.js (attaché au parent) doit pouvoir
        // recevoir le pointerdown. La lane ignore déjà les pointerdown issus
        // du header via [data-clip-header].
        if (draggedRef.current) {
            draggedRef.current = false;
            return;
        }
        onSelect?.(trackId, segment.id, {
            ctrlKey: e.ctrlKey || e.metaKey,
            shiftKey: e.shiftKey,
        });
    };

    return (
        <Box
            ref={ref}
            data-clip-id={segment.id}
            sx={{
                position: "absolute",
                left: `${left}px`,
                width: `${width}px`,
                top: INSET_Y,
                bottom: INSET_Y,
                border: isSelected
                    ? "1.5px solid #1565c0"
                    : "1px solid rgb(21, 119, 137)",
                borderRadius: "5px",
                background: isSelected
                    ? "rgba(34, 173, 197, 0.32)"
                    : "rgba(34, 173, 197, 0.22)",
                boxShadow: isSelected
                    ? "0 0 0 1px #1565c0, 0 2px 4px rgba(0, 0, 0, 0.22)"
                    : "0 1px 2px rgba(0, 0, 0, 0.18)",
                overflow: "hidden",
                transition: "box-shadow 120ms ease, background 120ms ease",
                display: "flex",
                flexDirection: "column",
                "&:hover": {
                    boxShadow:
                        "0 0 0 1px rgba(34, 173, 197, 0.7), 0 1px 2px rgba(0, 0, 0, 0.22)",
                    background: "rgba(34, 173, 197, 0.28)",
                },
            }}
        >
            <Box
                data-clip-header={segment.id}
                onClick={onHeaderClick}
                sx={{
                    height: HEADER_HEIGHT,
                    background: isSelected
                        ? "linear-gradient(180deg, rgba(21,119,137,0.95), rgba(21,119,137,0.75))"
                        : "linear-gradient(180deg, rgba(21,119,137,0.85), rgba(21,119,137,0.55))",
                    borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
                    flexShrink: 0,
                    cursor: "grab",
                    "&:active": { cursor: "grabbing" },
                }}
            />
            <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
                <ClipWaveform
                    ref={waveformRef}
                    segment={segment}
                    trackBuffer={trackBuffer}
                    pxPerSec={pxPerSec}
                />
            </Box>
        </Box>
    );
}

import React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Toolbar } from './components/Toolbar';
import { ProjectsPanel } from './components/ProjectsPanel';
import { ZoomControls } from './components/ZoomControls';
import { InfoModal } from './components/InfoModal';
import { Rulers } from './components/Rulers';
import { PlusIcon, FolderIcon, InfoIcon } from './components/icons';
import type { DrawOptions, Project, Tool, Stroke, ImageTransform, DrawingTool, CanvasImage } from './types';
import { getStrokeBounds, getBounds, doRectsIntersect, isPointInTransformedRect, isPointErased, rotatePoint, isPointOnStroke, scalePoint, getTransformedImageBounds } from './utils/geometry';

const APP_STORAGE_KEY = 'whiteboard-app-data-v2';
const LEGACY_STORAGE_KEY_V1 = 'whiteboard-app-data';
const LEGACY_STORAGE_KEY_V0 = 'whiteboard-drawing';

type Action = 'none' | 'drawing' | 'panning' | 'selecting' | 'dragging' | 'resizing-image' | 'rotating-image' | 'rotating-strokes' | 'resizing-strokes';

const HANDLE_SIZE = 10;
const ROTATION_HANDLE_OFFSET = 25;
const RULER_SIZE = 30;

const getHandles = (transform: ImageTransform, zoom: number) => {
    const { width, height } = transform;
    const rotHandleOffset = ROTATION_HANDLE_OFFSET / zoom;
    return {
        tl: { x: -width / 2, y: -height / 2 },
        tr: { x: width / 2, y: -height / 2 },
        bl: { x: -width / 2, y: height / 2 },
        br: { x: width / 2, y: height / 2 },
        rot: { x: 0, y: -height / 2 - rotHandleOffset },
    };
};

const getHandleAtPoint = (point: {x: number, y: number}, transform: ImageTransform, zoom: number): string | null => {
    const { x, y, rotation } = transform;
    const handles = getHandles(transform, zoom);
    const handleSize = HANDLE_SIZE / zoom;

    // Translate and rotate the point to the image's local coordinate system
    const translatedX = point.x - x;
    const translatedY = point.y - y;
    const sin = Math.sin(-rotation);
    const cos = Math.cos(-rotation);
    const localX = translatedX * cos - translatedY * sin;
    const localY = translatedX * sin + translatedY * cos;

    for (const [name, pos] of Object.entries(handles)) {
        if (
            localX >= pos.x - handleSize / 2 &&
            localX <= pos.x + handleSize / 2 &&
            localY >= pos.y - handleSize / 2 &&
            localY <= pos.y + handleSize / 2
        ) {
            return name;
        }
    }
    return null;
};


const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  
  const actionRef = useRef<Action>('none');
  const panStartRef = useRef({ x: 0, y: 0 });
  const currentStrokeRef = useRef<Stroke | null>(null);
  const selectionStartRef = useRef<{x:number, y:number} | null>(null);
  const transformStartRef = useRef<{
    startPoint: {x: number, y: number};
    initialTransform?: ImageTransform;
    selectionCenter?: {x: number, y: number};
    initialBounds?: { x: number; y: number; width: number; height: number; };
    handle?: string;
    imageId?: string;
    strokeIds?: Set<string>;
    imageIds?: Set<string>;
  } | null>(null);
  const lastStrokeProperties = useRef<Map<string, { points: Stroke['points'], lineWidth: number }>>(new Map());
  const lastImageProperties = useRef<Map<string, ImageTransform>>(new Map());
 
  const animationFrameId = useRef<number | undefined>(undefined);
  const lastCoords = useRef<{x: number, y: number} | undefined>(undefined);


  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  
  const [isPanning, setIsPanning] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<Set<string>>(new Set());
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [previewStroke, setPreviewStroke] = useState<Stroke | null>(null);
  const [previewStrokes, setPreviewStrokes] = useState<Stroke[] | null>(null);
  const [previewImageTransforms, setPreviewImageTransforms] = useState<Map<string, ImageTransform> | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<'selection-box' | 'rotation-handle' | 'resize-handle' | 'stroke' | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null);

  const [drawOptions, setDrawOptions] = useState<DrawOptions>({
    color: '#000000',
    lineWidth: 5,
    tool: 'pen',
  });

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bgImageElements, setBgImageElements] = useState<Map<string, HTMLImageElement>>(new Map());
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [isGridVisible, setIsGridVisible] = useState(true);

  // Undo/Redo State
  const [history, setHistory] = useState<{ strokes: Stroke[]; images: CanvasImage[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const currentProject = useMemo(() => projects.find(p => p.id === currentProjectId), [projects, currentProjectId]);
  const hasSelection = useMemo(() => selectedStrokeIds.size > 0 || selectedImageIds.size > 0, [selectedStrokeIds, selectedImageIds]);

  const resetView = useCallback(() => {
    const centerX = viewport.width / 2;
    const centerY = viewport.height / 2;

    // Find what point on the canvas is currently at the center of the viewport
    const canvasPointX = (centerX - pan.x) / zoom;
    const canvasPointY = (centerY - pan.y) / zoom;

    // Calculate the new pan coordinates to keep that point at the center with zoom = 1
    const newPanX = centerX - canvasPointX;
    const newPanY = centerY - canvasPointY;

    setZoom(1);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan, viewport]);

  // Load background image elements when project changes
  useEffect(() => {
    const projectImages = currentProject?.images || [];
    const projectImageIds = new Set(projectImages.map(p => p.id));

    // Images that are in state but not in the current project (e.g., deleted)
    const elementsToRemove = [...bgImageElements.keys()].filter(id => !projectImageIds.has(id));

    // Images that are in the project but not yet loaded into state
    const imagesToLoad = projectImages.filter(info => !bgImageElements.has(info.id));

    // If there's nothing to add or remove, we're done.
    if (imagesToLoad.length === 0 && elementsToRemove.length === 0) {
      return;
    }

    if (imagesToLoad.length > 0) {
        let loadedCount = 0;
        const newlyLoaded = new Map<string, HTMLImageElement>();
        
        imagesToLoad.forEach(imageInfo => {
            const image = new Image();
            image.onload = () => {
                newlyLoaded.set(imageInfo.id, image);
                loadedCount++;

                if (loadedCount === imagesToLoad.length) {
                    // All new images are loaded. Update state once.
                    setBgImageElements(prev => {
                        const newMap = new Map(prev);
                        // Add new images
                        newlyLoaded.forEach((img, id) => newMap.set(id, img));
                        // Remove old images
                        elementsToRemove.forEach(id => newMap.delete(id));
                        return newMap;
                    });
                }
            };
            image.onerror = () => {
                console.error(`Failed to load image: ${imageInfo.id}`);
                loadedCount++; // Still count it to not block the batch update
                if (loadedCount === imagesToLoad.length) {
                    setBgImageElements(prev => {
                        const newMap = new Map(prev);
                        newlyLoaded.forEach((img, id) => newMap.set(id, img));
                        elementsToRemove.forEach(id => newMap.delete(id));
                        return newMap;
                    });
                }
            };
            image.src = imageInfo.dataUrl;
        });

    } else { // No new images to load, just remove old ones
        setBgImageElements(prev => {
            const newMap = new Map(prev);
            elementsToRemove.forEach(id => newMap.delete(id));
            return newMap;
        });
    }
  }, [currentProject?.images]);

  const recordNewHistoryState = useCallback((newStrokes: Stroke[], newImages: CanvasImage[]) => {
    setHistory(prevHistory => {
        const newHistory = prevHistory.slice(0, historyIndex + 1);
        newHistory.push({ strokes: newStrokes, images: newImages });
        return newHistory;
    });
    setHistoryIndex(prevIndex => prevIndex + 1);
  }, [historyIndex]);

  const applyErasure = useCallback((eraserStroke: Stroke, currentStrokes: Stroke[]) => {
    const strokesToDelete = new Set<string>();
    const strokesToAdd: Stroke[] = [];
    const eraserBounds = getStrokeBounds(eraserStroke);

    if (!eraserBounds) return { strokesToDelete, strokesToAdd };

    for (const stroke of currentStrokes) {
        if (stroke.tool === 'eraser') continue;

        const strokeBounds = getStrokeBounds(stroke);
        if (!strokeBounds || !doRectsIntersect(eraserBounds, strokeBounds)) {
            continue;
        }
        
        const pointRadius = stroke.lineWidth / 2;
        
        // --- Unified Erasure Logic ---
        // 1. Convert all stroke types into a series of line segments.
        let segments: { p1: { x: number; y: number }; p2: { x: number; y: number } }[] = [];
        
        switch (stroke.tool) {
            case 'pen':
                if (stroke.points.length < 2) continue;
                for (let i = 0; i < stroke.points.length - 1; i++) {
                    segments.push({ p1: stroke.points[i], p2: stroke.points[i+1] });
                }
                break;
            case 'line':
            case 'dashed-line':
                if (stroke.points.length < 2) continue;
                segments.push({ p1: stroke.points[0], p2: stroke.points[1] });
                break;
            case 'rectangle': {
                if (stroke.points.length < 2) continue;
                const [start, end] = stroke.points;
                const p1 = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
                const p3 = { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) };
                const p2 = { x: p3.x, y: p1.y };
                const p4 = { x: p1.x, y: p3.y };
                segments.push({ p1: p1, p2: p2 }, { p1: p2, p2: p3 }, { p1: p3, p2: p4 }, { p1: p4, p2: p1 });
                break;
            }
            case 'triangle': {
                if (stroke.points.length < 2) continue;
                const [start, end] = stroke.points;
                const minX = Math.min(start.x, end.x);
                const minY = Math.min(start.y, end.y);
                const maxX = Math.max(start.x, end.x);
                const maxY = Math.max(start.y, end.y);

                const p1 = { x: (minX + maxX) / 2, y: minY }; // Top
                const p2 = { x: maxX, y: maxY }; // Bottom right
                const p3 = { x: minX, y: maxY }; // Bottom left

                segments.push({ p1: p1, p2: p2 }, { p1: p2, p2: p3 }, { p1: p3, p2: p1 });
                break;
            }
            case 'circle': {
                if (stroke.points.length < 2) continue;
                const [center, edge] = stroke.points;
                const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
                // More segments for better accuracy on larger circles
                const numSegments = Math.max(30, Math.ceil(radius / 3)); 
                for (let i = 0; i < numSegments; i++) {
                    const angle1 = (i / numSegments) * 2 * Math.PI;
                    const angle2 = ((i + 1) / numSegments) * 2 * Math.PI;
                    const p1 = { x: center.x + radius * Math.cos(angle1), y: center.y + radius * Math.sin(angle1) };
                    const p2 = { x: center.x + radius * Math.cos(angle2), y: center.y + radius * Math.sin(angle2) };
                    segments.push({p1, p2});
                }
                break;
            }
        }

        if (segments.length === 0) continue;

        // 2. Fragment the segments based on the eraser path.
        let madeCut = false;
        const newFragments: { x: number; y: number }[][] = [];
        const interpolationStep = 1; // Use 1 for maximum accuracy to match the preview

        // For pen strokes, we must connect fragments that belong to the original continuous line.
        if (stroke.tool === 'pen') {
            const points = stroke.points;
            let currentFragment: { x: number; y: number }[] = [];
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = i + 1 < points.length ? points[i + 1] : null;

                const isP1Erased = isPointErased(p1, eraserStroke, pointRadius);
                let isSegmentErased = false;

                if (p2) {
                    const segmentLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    const numSteps = Math.max(1, Math.ceil(segmentLength / interpolationStep));
                    if (numSteps > 1) {
                         for (let step = 1; step < numSteps; step++) {
                            const t = step / numSteps;
                            const interpolatedPoint = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
                            if (isPointErased(interpolatedPoint, eraserStroke, pointRadius)) {
                                isSegmentErased = true;
                                break;
                            }
                        }
                    }
                }

                if (!isP1Erased) currentFragment.push(p1);
                
                if (isP1Erased || isSegmentErased) {
                    madeCut = true;
                    if (currentFragment.length > 1) newFragments.push(currentFragment);
                    currentFragment = [];
                }
            }
            if (currentFragment.length > 1) newFragments.push(currentFragment);
        } else { // Handle shapes (and lines) as independent segments
            for (const seg of segments) {
                let currentFragment: { x: number; y: number }[] = [];
                const segmentLength = Math.hypot(seg.p2.x - seg.p1.x, seg.p2.y - seg.p1.y);
                const numSteps = Math.max(1, Math.ceil(segmentLength / interpolationStep));

                for (let i = 0; i <= numSteps; i++) {
                    const t = i / numSteps;
                    const point = { x: seg.p1.x + (seg.p2.x - seg.p1.x) * t, y: seg.p1.y + (seg.p2.y - seg.p1.y) * t };
                    
                    if (!isPointErased(point, eraserStroke, pointRadius)) {
                       currentFragment.push(point);
                    } else {
                       if (currentFragment.length > 1) newFragments.push(currentFragment);
                       currentFragment = [];
                    }
                }
                if (currentFragment.length > 1) newFragments.push(currentFragment);
            }

            const originalPerimeter = segments.reduce((acc, seg) => acc + Math.hypot(seg.p2.x-seg.p1.x, seg.p2.y-seg.p1.y), 0);
            const newPerimeter = newFragments.reduce((acc, frag) => {
                let fragLength = 0;
                for(let i = 1; i < frag.length; i++) {
                    fragLength += Math.hypot(frag[i].x - frag[i-1].x, frag[i].y - frag[i-1].y);
                }
                return acc + fragLength;
            }, 0);
            if (Math.abs(originalPerimeter - newPerimeter) > 1) madeCut = true;
        }

        // 3. If a cut was made, replace the old stroke with the new fragments.
        if (madeCut) {
            strokesToDelete.add(stroke.id);
            newFragments.forEach(fragPoints => {
                strokesToAdd.push({
                    ...stroke,
                    // Convert all resulting fragments to 'pen' strokes for simplicity and correct rendering.
                    tool: 'pen',
                    id: `stroke_${crypto.randomUUID()}`,
                    points: fragPoints,
                });
            });
        }
    }
    return { strokesToDelete, strokesToAdd };
  }, []);

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke) => {
      // Eraser strokes are no longer drawn directly. They are used to modify other strokes.
      if (stroke.tool === 'eraser') return;
      
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
  
      switch (stroke.tool) {
          case 'pen':
              ctx.beginPath();
              if (stroke.points.length > 0) {
                  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                  for (let i = 1; i < stroke.points.length; i++) {
                      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
                  }
              }
              ctx.stroke();
              break;
          case 'rectangle': {
              const [start, end] = stroke.points;
              if (start && end) {
                  ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
              }
              break;
          }
          case 'circle': {
              const [center, edge] = stroke.points;
              if (center && edge) {
                  const radius = Math.sqrt(Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2));
                  ctx.beginPath();
                  ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI);
                  ctx.stroke();
              }
              break;
          }
          case 'line': {
              const [start, end] = stroke.points;
              if (start && end) {
                  ctx.beginPath();
                  ctx.moveTo(start.x, start.y);
                  ctx.lineTo(end.x, end.y);
                  ctx.stroke();
              }
              break;
          }
          case 'dashed-line': {
              const [start, end] = stroke.points;
              if (start && end) {
                  ctx.setLineDash([stroke.lineWidth * 2, stroke.lineWidth * 1.5]);
                  ctx.beginPath();
                  ctx.moveTo(start.x, start.y);
                  ctx.lineTo(end.x, end.y);
                  ctx.stroke();
                  ctx.setLineDash([]);
              }
              break;
          }
          case 'triangle': {
              const [start, end] = stroke.points;
              if (start && end) {
                  const minX = Math.min(start.x, end.x);
                  const minY = Math.min(start.y, end.y);
                  const maxX = Math.max(start.x, end.x);
                  const maxY = Math.max(start.y, end.y);

                  const p1 = { x: (minX + maxX) / 2, y: minY }; // Top point
                  const p2 = { x: maxX, y: maxY }; // Bottom right
                  const p3 = { x: minX, y: maxY }; // Bottom left

                  ctx.beginPath();
                  ctx.moveTo(p1.x, p1.y);
                  ctx.lineTo(p2.x, p2.y);
                  ctx.lineTo(p3.x, p3.y);
                  ctx.closePath();
                  ctx.stroke();
              }
              break;
          }
      }
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.save();
    
    // Determine grid spacing based on zoom
    let baseGridSize = 100;
    while (baseGridSize * zoom < 50) {
        baseGridSize *= 2;
    }
    while (baseGridSize * zoom > 150) {
        baseGridSize /= 2;
    }

    const majorGridSize = baseGridSize;
    const minorGridSize = majorGridSize / 5;

    // Visible canvas area in world coordinates
    const viewLeft = -pan.x / zoom;
    const viewTop = -pan.y / zoom;
    const viewRight = (viewport.width - pan.x) / zoom;
    const viewBottom = (viewport.height - pan.y) / zoom;
    
    ctx.lineWidth = 1 / zoom;

    // Draw minor grid lines
    ctx.strokeStyle = '#e0e0e0';
    
    const startXMinor = Math.floor(viewLeft / minorGridSize) * minorGridSize;
    for (let x = startXMinor; x < viewRight; x += minorGridSize) {
        if (Math.round(x) % majorGridSize !== 0) {
            ctx.beginPath();
            ctx.moveTo(x, viewTop);
            ctx.lineTo(x, viewBottom);
            ctx.stroke();
        }
    }
    const startYMinor = Math.floor(viewTop / minorGridSize) * minorGridSize;
    for (let y = startYMinor; y < viewBottom; y += minorGridSize) {
        if (Math.round(y) % majorGridSize !== 0) {
            ctx.beginPath();
            ctx.moveTo(viewLeft, y);
            ctx.lineTo(viewRight, y);
            ctx.stroke();
        }
    }

    // Draw major grid lines
    ctx.strokeStyle = '#cccccc';
    const startXMajor = Math.floor(viewLeft / majorGridSize) * majorGridSize;
    for (let x = startXMajor; x < viewRight; x += majorGridSize) {
         if (x !== 0) {
            ctx.beginPath();
            ctx.moveTo(x, viewTop);
            ctx.lineTo(x, viewBottom);
            ctx.stroke();
         }
    }
    const startYMajor = Math.floor(viewTop / majorGridSize) * majorGridSize;
    for (let y = startYMajor; y < viewBottom; y += majorGridSize) {
        if (y !== 0) {
            ctx.beginPath();
            ctx.moveTo(viewLeft, y);
            ctx.lineTo(viewRight, y);
            ctx.stroke();
        }
    }
    
    // Draw axes (X and Y)
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 2 / zoom;

    // Y-axis (x=0)
    ctx.beginPath();
    ctx.moveTo(0, viewTop);
    ctx.lineTo(0, viewBottom);
    ctx.stroke();

    // X-axis (y=0)
    ctx.beginPath();
    ctx.moveTo(viewLeft, 0);
    ctx.lineTo(viewRight, 0);
    ctx.stroke();

    ctx.restore();
  }, [pan, zoom, viewport]);

  // Redraw canvas whenever strokes, selection, or view transforms change
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (!canvas || !context) return;

    const dpr = window.devicePixelRatio || 1;
    
    context.save();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    
    context.translate(pan.x, pan.y);
    context.scale(zoom, zoom);

    if (isGridVisible) {
      drawGrid(context);
    }
    
    // Draw background images
    currentProject?.images?.forEach(imageInfo => {
      const imgElement = bgImageElements.get(imageInfo.id);
      if (!imgElement) return;

      const transformToUse = previewImageTransforms?.get(imageInfo.id) || imageInfo.transform;

      const { x, y, width, height, rotation } = transformToUse;
      context.save();
      context.translate(x, y);
      context.rotate(rotation);
      context.drawImage(imgElement, -width / 2, -height / 2, width, height);
      context.restore();
    });

    const strokesToDraw = currentProject?.strokes || [];
    
    // Draw non-selected strokes
    strokesToDraw.forEach(stroke => {
        if (!selectedStrokeIds.has(stroke.id)) {
            drawStroke(context, stroke);
        }
    });

    // Draw transformed preview strokes or the original selected strokes
    const finalSelectedStrokes = previewStrokes 
        ? previewStrokes 
        : strokesToDraw.filter(s => selectedStrokeIds.has(s.id));

    finalSelectedStrokes.forEach(stroke => {
        drawStroke(context, stroke);
    });
    
    // Draw preview shape for new pen/shapes
    if(previewStroke && previewStroke.tool !== 'eraser') {
        drawStroke(context, previewStroke);
    }
    
    // For real-time eraser preview
    if (actionRef.current === 'drawing' && previewStroke?.tool === 'eraser' && previewStroke.points.length > 0) {
        context.globalCompositeOperation = 'destination-out';
        drawStroke(context, { ...previewStroke, tool: 'pen' }); // Draw eraser path
        context.globalCompositeOperation = 'source-over';
    }
    
    // --- Draw UI elements (selection boxes, handles) on top ---

    const allSelectedStrokes = previewStrokes ?? currentProject?.strokes.filter(s => selectedStrokeIds.has(s.id)) ?? [];
    const allSelectedImages = currentProject?.images.filter(i => selectedImageIds.has(i.id)) ?? [];

    const allStrokesBounds = getBounds(allSelectedStrokes);
    
    const allImageBounds = allSelectedImages.reduce((acc, img) => {
        const transform = previewImageTransforms?.get(img.id) ?? img.transform;
        const bounds = getTransformedImageBounds(transform);
        if (!acc) return bounds;
        const minX = Math.min(acc.x, bounds.x);
        const minY = Math.min(acc.y, bounds.y);
        const maxX = Math.max(acc.x + acc.width, bounds.x + bounds.width);
        const maxY = Math.max(acc.y + acc.height, bounds.y + bounds.height);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, null as ReturnType<typeof getTransformedImageBounds> | null);


    const combinedBounds = [allStrokesBounds, allImageBounds].reduce((acc, bounds) => {
        if (!bounds) return acc;
        if (!acc) return bounds;
        const minX = Math.min(acc.x, bounds.x);
        const minY = Math.min(acc.y, bounds.y);
        const maxX = Math.max(acc.x + acc.width, bounds.x + bounds.width);
        const maxY = Math.max(acc.y + acc.height, bounds.y + bounds.height);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, null as ReturnType<typeof getBounds> | null);

    // Draw selection rect for drag-selection
    if (selectionRect) {
      context.strokeStyle = 'rgba(0, 100, 255, 0.8)';
      context.lineWidth = 1 / zoom;
      context.setLineDash([4 / zoom, 2 / zoom]);
      context.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
      context.setLineDash([]);
    }
    // Draw selection box for selected items
    else if (hasSelection && combinedBounds) {
        const padding = 5 / zoom;
        context.strokeStyle = 'rgba(0, 100, 255, 0.9)';
        context.lineWidth = 2 / zoom;
        context.strokeRect(combinedBounds.x - padding, combinedBounds.y - padding, combinedBounds.width + 2 * padding, combinedBounds.height + 2 * padding);
        
        // --- Conditionally render handles ---
        const isSingleImageSelection = selectedImageIds.size === 1 && selectedStrokeIds.size === 0;
        const isOnlyStrokesSelection = selectedStrokeIds.size > 0 && selectedImageIds.size === 0;

        // Draw image resize/rotate handles
        if (isSingleImageSelection) {
            const imageId = selectedImageIds.values().next().value;
            const imageInfo = allSelectedImages.find(i => i.id === imageId);
            if (imageInfo) {
                const transformToUse = previewImageTransforms?.get(imageId) ?? imageInfo.transform;
                const { x, y, width, height, rotation } = transformToUse;
                context.save();
                context.translate(x, y);
                context.rotate(rotation);
                
                const handles = getHandles(transformToUse, zoom);
                const handleSize = HANDLE_SIZE / zoom;
                const halfHandle = handleSize / 2;
                context.fillStyle = 'rgba(0, 100, 255, 0.9)';
                
                context.beginPath();
                context.moveTo(0, -height / 2);
                context.lineTo(handles.rot.x, handles.rot.y);
                context.stroke();

                Object.values(handles).forEach(pos => {
                    context.fillRect(pos.x - halfHandle, pos.y - halfHandle, handleSize, handleSize);
                });
                
                context.restore();
            }
        }
        // Draw stroke resize/rotate handles
        else if (isOnlyStrokesSelection && allStrokesBounds) {
            context.save();
            const handleSize = HANDLE_SIZE / zoom;
            const halfHandle = handleSize / 2;
            context.fillStyle = 'rgba(0, 100, 255, 0.9)';

            const corners = {
              tl: { x: allStrokesBounds.x - padding, y: allStrokesBounds.y - padding },
              tr: { x: allStrokesBounds.x + allStrokesBounds.width + padding, y: allStrokesBounds.y - padding },
              bl: { x: allStrokesBounds.x - padding, y: allStrokesBounds.y + allStrokesBounds.height + padding },
              br: { x: allStrokesBounds.x + allStrokesBounds.width + padding, y: allStrokesBounds.y + allStrokesBounds.height + padding },
            };
            Object.values(corners).forEach(corner => {
                context.fillRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
            });
            
            const finalCenter = { x: allStrokesBounds.x + allStrokesBounds.width / 2, y: allStrokesBounds.y + allStrokesBounds.height / 2 };
            const handleRadius = HANDLE_SIZE / 2 / zoom;
            const rotHandleY = allStrokesBounds.y - padding - ROTATION_HANDLE_OFFSET / zoom;
            
            context.beginPath();
            context.moveTo(finalCenter.x, allStrokesBounds.y - padding);
            context.lineTo(finalCenter.x, rotHandleY + handleRadius);
            context.stroke();
            
            context.beginPath();
            context.arc(finalCenter.x, rotHandleY, handleRadius, 0, 2 * Math.PI);
            context.fill();

            context.restore();
        }
    }
    
    context.restore();
  }, [currentProject, zoom, pan, selectionRect, selectedStrokeIds, selectedImageIds, bgImageElements, previewStroke, previewStrokes, viewport, previewImageTransforms, hasSelection, drawStroke, drawGrid, isGridVisible]);

  // Save all projects to localStorage whenever they change
  useEffect(() => {
    if (projects.length > 0 && currentProjectId) {
      localStorage.removeItem(LEGACY_STORAGE_KEY_V1);
      localStorage.removeItem(LEGACY_STORAGE_KEY_V0);
      
      try {
        const appData = JSON.stringify({ projects, currentProjectId });
        localStorage.setItem(APP_STORAGE_KEY, appData);
      } catch (error) {
        console.error("Failed to save to localStorage, data might be too large.", error);
        // Optionally, notify the user that saving failed.
      }
    }
  }, [projects, currentProjectId]);

  const resetHistory = (strokes: Stroke[], images: CanvasImage[]) => {
    setHistory([{ strokes, images }]);
    setHistoryIndex(0);
  };
  
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const context = canvas.getContext('2d')!;
    contextRef.current = context;
    const container = canvas.parentElement;

    if (!container) return;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;

        // Check if size is different to prevent infinite loops in some browsers.
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            
            // Updating the viewport state will trigger the drawing useEffect,
            // which will handle redrawing and setting the canvas transform.
            setViewport({ width, height });
        }
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Initialize canvas and load data on first render
  useEffect(() => {
    const savedData = localStorage.getItem(APP_STORAGE_KEY);
    if (savedData) {
      try {
        const { projects: savedProjects, currentProjectId } = JSON.parse(savedData);
        
        // Migration logic for projects from single image to multi-image format
        const migratedProjects = savedProjects.map((p: any) => {
          if (p.images) return p; // Already in new format
          const newProject: Project = { ...p, images: [] };
          if (p.dataUrl && p.imageTransform) {
            newProject.images.push({
              id: `img_${p.id}_${Date.now()}`,
              dataUrl: p.dataUrl,
              transform: p.imageTransform,
            });
          }
          delete (newProject as any).dataUrl;
          delete (newProject as any).imageTransform;
          return newProject;
        });

        setProjects(migratedProjects);
        setCurrentProjectId(currentProjectId);
        const currentProject = migratedProjects.find((p: Project) => p.id === currentProjectId);
        if (currentProject) {
          resetHistory(currentProject.strokes, currentProject.images);
        }
      } catch (error) {
        console.error("Failed to parse saved data from localStorage.", error);
        // If parsing fails, start with a fresh project to avoid a broken state.
        const newId = crypto.randomUUID();
        const newProject: Project = { id: newId, name: 'Drawing 1', strokes: [], images: [] };
        setProjects([newProject]);
        setCurrentProjectId(newId);
        resetHistory([], []);
      }
    } else {
      // Logic for migrating from very old versions or creating a new project
      const v1Data = localStorage.getItem(LEGACY_STORAGE_KEY_V1);
      if (v1Data) {
        const { projects: oldProjects, currentProjectId: oldId } = JSON.parse(v1Data);
        const migratedProjects = oldProjects.map((p: any) => ({
          id: p.id,
          name: p.name,
          strokes: [],
          images: [] // Drop legacy background to simplify migration
        }));
        setProjects(migratedProjects);
        setCurrentProjectId(oldId);
        resetHistory([], []);
      } else {
        const newId = crypto.randomUUID();
        const newProject: Project = { id: newId, name: 'Drawing 1', strokes: [], images: [] };
        setProjects([newProject]);
        setCurrentProjectId(newId);
        resetHistory([], []);
      }
    }
    
    // Set initial view to center
    const initialWidth = window.innerWidth - RULER_SIZE;
    const initialHeight = window.innerHeight - RULER_SIZE;
    setPan({ x: initialWidth / 2, y: initialHeight / 2 });
  }, []);
  
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const { strokes: newStrokes, images: newImages } = history[newIndex];
      setHistoryIndex(newIndex);
      setProjects(prevProjects =>
          prevProjects.map(p =>
            p.id === currentProjectId ? { ...p, strokes: newStrokes, images: newImages } : p
          )
      );
      setSelectedStrokeIds(new Set());
      setSelectedImageIds(new Set());
    }
  }, [history, historyIndex, currentProjectId]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const { strokes: newStrokes, images: newImages } = history[newIndex];
      setHistoryIndex(newIndex);
      setProjects(prevProjects =>
          prevProjects.map(p =>
            p.id === currentProjectId ? { ...p, strokes: newStrokes, images: newImages } : p
          )
      );
      setSelectedStrokeIds(new Set());
      setSelectedImageIds(new Set());
    }
  }, [history, historyIndex, currentProjectId]);

  const handleDeleteSelection = useCallback(() => {
    if (!currentProject || !hasSelection) return;

    const newStrokes = currentProject.strokes.filter(s => !selectedStrokeIds.has(s.id));
    const newImages = currentProject.images.filter(i => !selectedImageIds.has(i.id));
    
    const strokesChanged = newStrokes.length !== currentProject.strokes.length;
    const imagesChanged = newImages.length !== currentProject.images.length;

    if (strokesChanged || imagesChanged) {
        setProjects(prevProjects =>
            prevProjects.map(p =>
                p.id === currentProjectId ? { ...p, strokes: newStrokes, images: newImages } : p
            )
        );

        recordNewHistoryState(newStrokes, newImages);
        
        setSelectedStrokeIds(new Set());
        setSelectedImageIds(new Set());
    }
  }, [currentProject, currentProjectId, hasSelection, selectedStrokeIds, selectedImageIds, recordNewHistoryState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return;
        }

        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') { e.preventDefault(); handleUndo(); } 
            else if (e.key === 'y') { e.preventDefault(); handleRedo(); }
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection) {
            e.preventDefault();
            handleDeleteSelection();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleDeleteSelection, hasSelection]);

  const getCoordinates = useCallback((event: MouseEvent | TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    // Inverse the view transform to get world coordinates
    const worldX = (screenX - pan.x) / zoom;
    const worldY = (screenY - pan.y) / zoom;
    
    return { x: worldX, y: worldY };
  }, [zoom, pan]);

  const drawingAnimationLoop = useCallback(() => {
    if (actionRef.current !== 'drawing' || !currentStrokeRef.current || !lastCoords.current) {
        animationFrameId.current = undefined;
        return;
    }
    
    const coords = lastCoords.current;
    const tool = currentStrokeRef.current.tool as DrawingTool;

    let updatedStroke: Stroke | null = null;
    if (tool === 'pen' || tool === 'eraser') {
        const currentPoints = currentStrokeRef.current.points;
        const lastPoint = currentPoints[currentPoints.length - 1];
        if(lastPoint.x !== coords.x || lastPoint.y !== coords.y) {
            updatedStroke = { ...currentStrokeRef.current, points: [...currentPoints, coords] };
        }
    } else {
        const startPoint = currentStrokeRef.current.points[0];
        updatedStroke = { ...currentStrokeRef.current, points: [startPoint, coords] };
    }

    if (updatedStroke) {
        currentStrokeRef.current = updatedStroke;
        setPreviewStroke(updatedStroke);
    }

    animationFrameId.current = requestAnimationFrame(drawingAnimationLoop);
  }, []);

  const calculateTransformedStrokes = useCallback((
    currentCoords: { x: number, y: number },
    startState: typeof transformStartRef.current,
    currentAction: Action
  ): Stroke[] => {
      if (!startState || !currentProject) return [];

      const { startPoint, selectionCenter, initialBounds, handle, strokeIds } = startState;
      let dx = 0, dy = 0, rotation = 0, scale = 1;
      let anchor: { x: number; y: number; } | undefined = undefined;

      switch (currentAction) {
          case 'dragging':
              dx = currentCoords.x - startPoint.x;
              dy = currentCoords.y - startPoint.y;
              break;
          case 'rotating-strokes':
              if (selectionCenter) {
                  const angleStart = Math.atan2(startPoint.y - selectionCenter.y, startPoint.x - selectionCenter.x);
                  const angleCurrent = Math.atan2(currentCoords.y - selectionCenter.y, currentCoords.x - selectionCenter.x);
                  rotation = angleCurrent - angleStart;
              }
              break;
          case 'resizing-strokes':
              if (initialBounds && handle) {
                  anchor = {
                      x: handle.includes('l') ? initialBounds.x + initialBounds.width : initialBounds.x,
                      y: handle.includes('t') ? initialBounds.y + initialBounds.height : initialBounds.y
                  };
                  const initialDist = Math.hypot(startPoint.x - anchor.x, startPoint.y - anchor.y);
                  if (initialDist > 0) {
                      const currentDist = Math.hypot(currentCoords.x - anchor.x, currentCoords.y - anchor.y);
                      scale = Math.max(0.01, currentDist / initialDist);
                  }
              }
              break;
      }

      if (dx === 0 && dy === 0 && rotation === 0 && scale === 1) {
          return currentProject.strokes.filter(s => strokeIds?.has(s.id));
      }

      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      
      const newStrokes: Stroke[] = [];
      if (!strokeIds) { return []; }
      for(const id of strokeIds) {
        const originalStroke = currentProject?.strokes.find(s => s.id === id);
        const originalProperties = lastStrokeProperties.current.get(id);
        if (!originalStroke || !originalProperties) continue;

        const { points: originalPoints, lineWidth: originalLineWidth } = originalProperties;

        const newPoints = originalPoints.map(p => {
            let x = p.x;
            let y = p.y;
            if (scale !== 1 && anchor) {
                x = anchor.x + (x - anchor.x) * scale;
                y = anchor.y + (y - anchor.y) * scale;
            }
            if (rotation !== 0 && selectionCenter) {
                const tx = x - selectionCenter.x;
                const ty = y - selectionCenter.y;
                x = tx * cos - ty * sin + selectionCenter.x;
                y = tx * sin + ty * cos + selectionCenter.y;
            }
            x += dx;
            y += dy;
            return { x, y };
        });

        const newStroke = { 
            ...originalStroke, 
            points: newPoints,
            lineWidth: currentAction === 'resizing-strokes' ? originalLineWidth * scale : originalLineWidth
        };

        if (currentAction === 'rotating-strokes' && newStroke.tool === 'rectangle' && newStroke.points.length === 2) {
            const [start, end] = originalPoints;
            const p1 = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) };
            const p3 = { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) };
            const p2 = { x: p3.x, y: p1.y };
            const p4 = { x: p1.x, y: p3.y };
            const corners = [p1, p2, p3, p4];
            const transformedCorners = corners.map(p => {
                let x = p.x;
                let y = p.y;
                const tx = x - selectionCenter.x;
                const ty = y - selectionCenter.y;
                x = tx * cos - ty * sin + selectionCenter.x;
                y = tx * sin + ty * cos + selectionCenter.y;
                x += dx;
                y += dy;
                return { x, y };
            });
            transformedCorners.push(transformedCorners[0]);
            newStroke.tool = 'pen';
            newStroke.points = transformedCorners;
        }

        newStrokes.push(newStroke);
      }
      return newStrokes;
  }, [currentProject]);
  
  const transformAnimationLoop = useCallback(() => {
    if (!transformStartRef.current || !lastCoords.current) {
        animationFrameId.current = undefined;
        return;
    }

    const coords = lastCoords.current;
    const currentAction = actionRef.current;
    const { startPoint, initialTransform, handle, imageId, imageIds } = transformStartRef.current;
    
    // Unified Dragging
    if (currentAction === 'dragging') {
        const dx = coords.x - startPoint.x;
        const dy = coords.y - startPoint.y;

        // Drag strokes
        const transformedStrokes = calculateTransformedStrokes(coords, transformStartRef.current, currentAction);
        setPreviewStrokes(transformedStrokes);
        
        // Drag images
        const newImageTransforms = new Map<string, ImageTransform>();
        if (imageIds) {
            for (const id of imageIds) {
                const initial = lastImageProperties.current.get(id);
                if (initial) {
                    newImageTransforms.set(id, { ...initial, x: initial.x + dx, y: initial.y + dy });
                }
            }
        }
        setPreviewImageTransforms(newImageTransforms);

    } else if (currentAction === 'rotating-strokes' || currentAction === 'resizing-strokes') {
        const transformedStrokes = calculateTransformedStrokes(coords, transformStartRef.current, currentAction);
        setPreviewStrokes(transformedStrokes);
    } else {
        // Image-specific transformations (resize/rotate on single image)
        switch (actionRef.current) {
            case 'rotating-image': {
                if (!initialTransform || !imageId) break;
                const { x, y } = initialTransform;
                const angleStart = Math.atan2(startPoint.y - y, startPoint.x - x);
                const angleCurrent = Math.atan2(coords.y - y, coords.x - x);
                const angleDelta = angleCurrent - angleStart;
                setPreviewImageTransforms(new Map([[imageId, { ...initialTransform, rotation: initialTransform.rotation + angleDelta }]]));
                break;
            }
            case 'resizing-image': {
                if (!initialTransform || !handle || !imageId) break;
                const { width, height, rotation } = initialTransform;
                
                const dx = coords.x - startPoint.x;
                const dy = coords.y - startPoint.y;

                const sin = Math.sin(-rotation);
                const cos = Math.cos(-rotation);
                const localDx = dx * cos - dy * sin;
                const localDy = dx * sin + dy * cos;
                
                let newWidth = width;
                let newHeight = height;
                const aspectRatio = width / height;

                switch (handle) {
                    case 'tr': newWidth = width + localDx; newHeight = height - localDy; break;
                    case 'tl': newWidth = width - localDx; newHeight = height - localDy; break;
                    case 'br': newWidth = width + localDx; newHeight = height + localDy; break;
                    case 'bl': newWidth = width - localDx; newHeight = height + localDy; break;
                }

                if (['tr', 'tl', 'br', 'bl'].includes(handle)) {
                    const widthChange = newWidth - width;
                    const heightChange = newHeight - height;
                    if (Math.abs(widthChange) > Math.abs(heightChange)) {
                        newHeight = newWidth / aspectRatio;
                    } else {
                        newWidth = newHeight * aspectRatio;
                    }
                }
                
                newWidth = Math.max(20, newWidth);
                newHeight = Math.max(20, newHeight);

                const dWidth = newWidth - width;
                const dHeight = newHeight - height;
                
                let dxCenter = 0;
                let dyCenter = 0;
                if (handle.includes('l')) { dxCenter -= dWidth / 2; }
                if (handle.includes('r')) { dxCenter += dWidth / 2; }
                if (handle.includes('t')) { dyCenter -= dHeight / 2; }
                if (handle.includes('b')) { dyCenter += dHeight / 2; }

                const sinR = Math.sin(rotation);
                const cosR = Math.cos(rotation);
                const worldDxCenter = dxCenter * cosR - dyCenter * sinR;
                const worldDyCenter = dxCenter * sinR + dyCenter * cosR;

                setPreviewImageTransforms(new Map([[imageId, {
                    ...initialTransform,
                    x: initialTransform.x + worldDxCenter,
                    y: initialTransform.y + worldDyCenter,
                    width: newWidth,
                    height: newHeight,
                  }]]));
                break;
            }
        }
    }
    animationFrameId.current = requestAnimationFrame(transformAnimationLoop);
  }, [calculateTransformedStrokes]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const coords = getCoordinates(e.nativeEvent);
    if (!coords || !currentProject) return;

    if (e.button === 1 || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || drawOptions.tool === 'hand') {
      actionRef.current = 'panning';
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      setIsPanning(true);
      return;
    }
    
    if (drawOptions.tool === 'selection' && currentProject) {
        // --- 1. Check for handle clicks on single selections ---
        const isSingleImageSelected = selectedImageIds.size === 1 && selectedStrokeIds.size === 0;
        const isOnlyStrokesSelected = selectedStrokeIds.size > 0 && selectedImageIds.size === 0;

        if (isSingleImageSelected) {
            const imageId = selectedImageIds.values().next().value;
            const selectedImageInfo = currentProject.images.find(img => img.id === imageId);
            if (selectedImageInfo) {
                const handle = getHandleAtPoint(coords, selectedImageInfo.transform, zoom);
                if (handle) {
                    actionRef.current = handle === 'rot' ? 'rotating-image' : 'resizing-image';
                    transformStartRef.current = { startPoint: coords, initialTransform: { ...selectedImageInfo.transform }, handle, imageId };
                    lastCoords.current = coords;
                    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
                    setPreviewImageTransforms(new Map([[imageId, selectedImageInfo.transform]]));
                    animationFrameId.current = requestAnimationFrame(transformAnimationLoop);
                    return;
                }
            }
        }
        
        if (isOnlyStrokesSelected) {
            const selectedStrokes = currentProject.strokes.filter(s => selectedStrokeIds.has(s.id));
            const bounds = getBounds(selectedStrokes);
            if (bounds) {
                const padding = 5 / zoom;
                const handleSize = HANDLE_SIZE / zoom;
                const halfHandle = handleSize / 2;
                const corners = { tl: { x: bounds.x - padding, y: bounds.y - padding }, tr: { x: bounds.x + bounds.width + padding, y: bounds.y - padding }, bl: { x: bounds.x - padding, y: bounds.y + bounds.height + padding }, br: { x: bounds.x + bounds.width + padding, y: bounds.y + bounds.height + padding } };
                let cornerClicked: string | null = null;
                for (const [name, pos] of Object.entries(corners)) {
                    if (coords.x >= pos.x - halfHandle && coords.x <= pos.x + halfHandle && coords.y >= pos.y - halfHandle && coords.y <= pos.y + halfHandle) {
                        cornerClicked = name;
                        break;
                    }
                }
                if (cornerClicked) { actionRef.current = 'resizing-strokes'; transformStartRef.current = { startPoint: coords, handle: cornerClicked, initialBounds: bounds, strokeIds: selectedStrokeIds }; } 
                else {
                    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
                    const rotHandleRadius = HANDLE_SIZE / zoom;
                    const rotHandleY = bounds.y - padding - ROTATION_HANDLE_OFFSET / zoom;
                    const distToRotHandle = Math.hypot(coords.x - center.x, coords.y - rotHandleY);
                    if (distToRotHandle <= rotHandleRadius) { actionRef.current = 'rotating-strokes'; transformStartRef.current = { startPoint: coords, selectionCenter: center, strokeIds: selectedStrokeIds }; }
                }
                if (actionRef.current === 'resizing-strokes' || actionRef.current === 'rotating-strokes') {
                    lastStrokeProperties.current = new Map(selectedStrokes.map(s => [s.id, { points: s.points, lineWidth: s.lineWidth }]));
                    setPreviewStrokes(selectedStrokes);
                    lastCoords.current = coords;
                    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
                    animationFrameId.current = requestAnimationFrame(transformAnimationLoop);
                    return;
                }
            }
        }
        
        // --- NEW: Check for click inside existing selection box to initiate drag ---
        if (hasSelection) {
            const allSelectedStrokes = currentProject.strokes.filter(s => selectedStrokeIds.has(s.id));
            const allSelectedImages = currentProject.images.filter(i => selectedImageIds.has(i.id));

            const allStrokesBounds = getBounds(allSelectedStrokes);
            const allImageBounds = allSelectedImages.reduce((acc, img) => {
                const bounds = getTransformedImageBounds(img.transform);
                if (!acc) return bounds;
                const minX = Math.min(acc.x, bounds.x);
                const minY = Math.min(acc.y, bounds.y);
                const maxX = Math.max(acc.x + acc.width, bounds.x + bounds.width);
                const maxY = Math.max(acc.y + acc.height, bounds.y + bounds.height);
                return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            }, null as ReturnType<typeof getTransformedImageBounds> | null);

            const combinedBounds = [allStrokesBounds, allImageBounds].reduce((acc, bounds) => {
                if (!bounds) return acc;
                if (!acc) return bounds;
                const minX = Math.min(acc.x, bounds.x);
                const minY = Math.min(acc.y, bounds.y);
                const maxX = Math.max(acc.x + acc.width, bounds.x + bounds.width);
                const maxY = Math.max(acc.y + acc.height, bounds.y + bounds.height);
                return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            }, null as ReturnType<typeof getBounds> | null);
            
            if (combinedBounds) {
                const padding = 5 / zoom;
                const paddedBounds = {
                    x: combinedBounds.x - padding,
                    y: combinedBounds.y - padding,
                    width: combinedBounds.width + 2 * padding,
                    height: combinedBounds.height + 2 * padding
                };

                if (
                    coords.x >= paddedBounds.x &&
                    coords.x <= paddedBounds.x + paddedBounds.width &&
                    coords.y >= paddedBounds.y &&
                    coords.y <= paddedBounds.y + paddedBounds.height
                ) {
                    actionRef.current = 'dragging';
                    transformStartRef.current = { startPoint: coords, strokeIds: selectedStrokeIds, imageIds: selectedImageIds };
                    
                    lastStrokeProperties.current = new Map(allSelectedStrokes.map(s => [s.id, { points: s.points, lineWidth: s.lineWidth }]));
                    lastImageProperties.current = new Map(allSelectedImages.map(i => [i.id, i.transform]));

                    setPreviewStrokes(allSelectedStrokes);
                    setPreviewImageTransforms(new Map(allSelectedImages.map(i => [i.id, i.transform])));

                    lastCoords.current = coords;
                    if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
                    animationFrameId.current = requestAnimationFrame(transformAnimationLoop);
                    return;
                }
            }
        }


        // --- 2. Check for clicks on entities for selection or dragging ---
        let topClickedImage: CanvasImage | null = null;
        for (let i = currentProject.images.length - 1; i >= 0; i--) {
            const imageInfo = currentProject.images[i];
            if (isPointInTransformedRect(coords, imageInfo.transform)) {
                topClickedImage = imageInfo;
                break;
            }
        }

        let topClickedStroke: Stroke | null = null;
        if (!topClickedImage) {
            for (let i = currentProject.strokes.length - 1; i >= 0; i--) {
                const stroke = currentProject.strokes[i];
                if (isPointOnStroke(coords, stroke, 5 / zoom)) {
                    topClickedStroke = stroke;
                    break;
                }
            }
        }
        
        const isMultiSelect = e.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
        const clickedItem = topClickedImage || topClickedStroke;

        if (clickedItem) {
            const isImage = !!topClickedImage;
            const clickedId = clickedItem.id;
            const isAlreadySelected = isImage ? selectedImageIds.has(clickedId) : selectedStrokeIds.has(clickedId);
            
            actionRef.current = 'dragging';

            let finalSelectedStrokeIds: Set<string>;
            let finalSelectedImageIds: Set<string>;
            
            // Determine the next selection state based on the click
            if (!isMultiSelect) {
                // Not a multi-select click.
                // If the item wasn't selected, or if it was part of a larger selection,
                // the new selection becomes just this item.
                if (!isAlreadySelected || selectedStrokeIds.size + selectedImageIds.size > 1) {
                    finalSelectedStrokeIds = isImage ? new Set() : new Set([clickedId]);
                    finalSelectedImageIds = isImage ? new Set([clickedId]) : new Set();
                } else {
                    // Item was already the only thing selected, so the selection doesn't change.
                    finalSelectedStrokeIds = new Set(selectedStrokeIds);
                    finalSelectedImageIds = new Set(selectedImageIds);
                }
            } else {
                // Multi-select click. Modify the existing selection.
                finalSelectedStrokeIds = new Set(selectedStrokeIds);
                finalSelectedImageIds = new Set(selectedImageIds);
                if (isImage) {
                    if (isAlreadySelected) finalSelectedImageIds.delete(clickedId);
                    else finalSelectedImageIds.add(clickedId);
                } else {
                    if (isAlreadySelected) finalSelectedStrokeIds.delete(clickedId);
                    else finalSelectedStrokeIds.add(clickedId);
                }
            }
            
            transformStartRef.current = { startPoint: coords, strokeIds: finalSelectedStrokeIds, imageIds: finalSelectedImageIds };

            // Schedule the state update for React
            setSelectedStrokeIds(finalSelectedStrokeIds);
            setSelectedImageIds(finalSelectedImageIds);

            // Immediately use the calculated next state to set up the drag operation, avoiding stale state.
            const strokesToDrag = currentProject.strokes.filter(s => finalSelectedStrokeIds.has(s.id));
            const imagesToDrag = currentProject.images.filter(i => finalSelectedImageIds.has(i.id));

            lastStrokeProperties.current = new Map(strokesToDrag.map(s => [s.id, { points: s.points, lineWidth: s.lineWidth }]));
            lastImageProperties.current = new Map(imagesToDrag.map(i => [i.id, i.transform]));

            setPreviewStrokes(strokesToDrag);
            setPreviewImageTransforms(new Map(imagesToDrag.map(i => [i.id, i.transform])));

            // Start the animation loop for dragging/transforming
            lastCoords.current = coords;
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
            animationFrameId.current = requestAnimationFrame(transformAnimationLoop);

        } else { // Clicked on blank canvas
            actionRef.current = 'selecting';
            selectionStartRef.current = coords;
            if (!isMultiSelect) {
                setSelectedImageIds(new Set());
                setSelectedStrokeIds(new Set());
            }
        }
        return;
    }

    // --- 3. Handle drawing ---
    switch (drawOptions.tool) {
      case 'pen':
      case 'eraser':
      case 'rectangle':
      case 'circle':
      case 'line':
      case 'triangle':
      case 'dashed-line':
        actionRef.current = 'drawing';
        setSelectedStrokeIds(new Set());
        setSelectedImageIds(new Set());
        const newStroke: Stroke = {
            id: crypto.randomUUID(),
            tool: drawOptions.tool,
            color: drawOptions.color,
            lineWidth: drawOptions.lineWidth,
            points: drawOptions.tool === 'pen' || drawOptions.tool === 'eraser' ? [coords] : [coords, coords],
        }
        currentStrokeRef.current = newStroke;
        setPreviewStroke(newStroke);
        lastCoords.current = coords;
        if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = requestAnimationFrame(drawingAnimationLoop);
        break;
    }
  }, [pan, drawOptions, getCoordinates, currentProject, selectedStrokeIds, selectedImageIds, zoom, drawingAnimationLoop, transformAnimationLoop, currentProjectId, hasSelection]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const coords = getCoordinates(e.nativeEvent);
    if (!coords) return;
    
    lastCoords.current = coords;

    if (actionRef.current === 'none' && drawOptions.tool === 'selection' && selectedStrokeIds.size > 0 && currentProject) {
        let newHover: 'rotation-handle' | 'resize-handle' | null = null;
        let newHoverHandle: string | null = null;
        const selectedStrokes = previewStrokes 
            ? previewStrokes
            : currentProject.strokes.filter(s => selectedStrokeIds.has(s.id));
        
        const bounds = getBounds(selectedStrokes);
        if (bounds) {
            const padding = 5 / zoom;
            const handleSize = HANDLE_SIZE / zoom;
            const halfHandle = handleSize / 2;
            const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
            const rotHandleRadius = HANDLE_SIZE / zoom;
            const rotHandleY = bounds.y - padding - ROTATION_HANDLE_OFFSET / zoom;
            
            const distToRotHandle = Math.hypot(coords.x - center.x, coords.y - rotHandleY);
            if (distToRotHandle <= rotHandleRadius) {
                newHover = 'rotation-handle';
            } else {
                 const corners = {
                  tl: { x: bounds.x - padding, y: bounds.y - padding },
                  tr: { x: bounds.x + bounds.width + padding, y: bounds.y - padding },
                  bl: { x: bounds.x - padding, y: bounds.y + bounds.height + padding },
                  br: { x: bounds.x + bounds.width + padding, y: bounds.y + bounds.height + padding },
                };
                 for (const [name, pos] of Object.entries(corners)) {
                    if (coords.x >= pos.x - halfHandle && coords.x <= pos.x + halfHandle &&
                        coords.y >= pos.y - halfHandle && coords.y <= pos.y + halfHandle) {
                        newHover = 'resize-handle';
                        newHoverHandle = name;
                        break;
                    }
                }
            }
        }
        setHoveredEntity(newHover);
        setHoveredHandle(newHoverHandle);
    } else if (actionRef.current === 'none') {
        setHoveredEntity(null);
        setHoveredHandle(null);
    }
    
    if (['none', 'drawing', 'resizing-image', 'rotating-image', 'dragging', 'rotating-strokes', 'resizing-strokes'].includes(actionRef.current)) {
      return;
    }

    switch (actionRef.current) {
      case 'panning':
        setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
        break;
      case 'selecting':
        if(selectionStartRef.current) {
            const { x, y } = selectionStartRef.current;
            setSelectionRect({
              x: Math.min(x, coords.x),
              y: Math.min(y, coords.y),
              width: Math.abs(x - coords.x),
              height: Math.abs(y - coords.y),
            });
        }
        break;
    }
  }, [getCoordinates, drawOptions.tool, currentProject, selectedStrokeIds, zoom, previewStrokes]);
    
  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = undefined;
    }
    
    const currentAction = actionRef.current;
    actionRef.current = 'none';

    switch (currentAction) {
      case 'panning':
        setIsPanning(false);
        break;
      case 'drawing':
        if (currentProject && currentStrokeRef.current) {
            const finishedStroke = currentStrokeRef.current;
            const currentHistoryState = history[historyIndex] || { strokes: [], images: [] };

            if (finishedStroke.tool === 'eraser') {
                if (finishedStroke.points.length > 1) {
                    const { strokesToDelete, strokesToAdd } = applyErasure(finishedStroke, currentHistoryState.strokes);
                    if (strokesToDelete.size > 0 || strokesToAdd.length > 0) {
                        const newStrokes = currentHistoryState.strokes
                            .filter(s => !strokesToDelete.has(s.id))
                            .concat(strokesToAdd);
                        
                        recordNewHistoryState(newStrokes, currentHistoryState.images);
                        setProjects(prevProjects =>
                            prevProjects.map(p =>
                                p.id === currentProjectId ? { ...p, strokes: newStrokes } : p
                            )
                        );
                    }
                }
            } else { // Pen or Shape
                let strokeToAdd: Stroke | null = null;
                if (finishedStroke.tool === 'pen') {
                    if (finishedStroke.points.length > 1) {
                        strokeToAdd = finishedStroke;
                    }
                } else { // It's a shape
                    const [start, end] = finishedStroke.points;
                    const distance = Math.hypot(end.x - start.x, end.y - start.y);
                    if (distance > 2) {
                        strokeToAdd = finishedStroke;
                    }
                }

                if (strokeToAdd) {
                    const newStrokes = [...currentHistoryState.strokes, strokeToAdd];
                    recordNewHistoryState(newStrokes, currentHistoryState.images);
                    setProjects(prevProjects =>
                        prevProjects.map(p =>
                            p.id === currentProjectId ? { ...p, strokes: newStrokes } : p
                        )
                    );
                }
            }
        }
        setPreviewStroke(null);
        currentStrokeRef.current = null;
        break;
      case 'selecting':
        if (selectionRect && currentProject) {
            const strokesInRect = currentProject.strokes.filter(stroke => {
                 if (stroke.tool === 'eraser') return false;
                const strokeBounds = getStrokeBounds(stroke);
                return strokeBounds && doRectsIntersect(selectionRect, strokeBounds)
            }).map(s => s.id);

            const imagesInRect = currentProject.images.filter(image => {
                const imageBounds = getTransformedImageBounds(image.transform);
                return doRectsIntersect(selectionRect, imageBounds);
            }).map(i => i.id);
            
            const isMultiSelect = e.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
            if (isMultiSelect) {
                setSelectedStrokeIds(prev => new Set([...prev, ...strokesInRect]));
                setSelectedImageIds(prev => new Set([...prev, ...imagesInRect]));
            } else {
                setSelectedStrokeIds(new Set(strokesInRect));
                setSelectedImageIds(new Set(imagesInRect));
            }
        }
        selectionStartRef.current = null;
        setSelectionRect(null);
        break;
      case 'dragging':
      case 'rotating-strokes':
      case 'resizing-strokes': {
        const finalCoords = lastCoords.current;
        const startState = transformStartRef.current;
        
        if (currentProject && finalCoords && startState) {
            // Finalize strokes
            const finalStrokes = calculateTransformedStrokes(finalCoords, startState, currentAction);
            const finalStrokesById = new Map(finalStrokes.map(s => [s.id, s]));
            const updatedStrokes = currentProject.strokes.map(s => finalStrokesById.get(s.id) || s);

            // Finalize images (only for dragging)
            let updatedImages = currentProject.images;
            if (currentAction === 'dragging') {
                const dx = finalCoords.x - startState.startPoint.x;
                const dy = finalCoords.y - startState.startPoint.y;
                updatedImages = currentProject.images.map(img => {
                    if (startState.imageIds?.has(img.id)) {
                        const initial = lastImageProperties.current.get(img.id);
                        if (initial) {
                            return { ...img, transform: { ...initial, x: initial.x + dx, y: initial.y + dy } };
                        }
                    }
                    return img;
                });
            }

            setProjects(prev => prev.map(p => p.id === currentProjectId ? { ...p, strokes: updatedStrokes, images: updatedImages } : p));
            recordNewHistoryState(updatedStrokes, updatedImages);
        }
        setPreviewStrokes(null);
        setPreviewImageTransforms(null);
        transformStartRef.current = null;
        break;
      }
      case 'resizing-image':
      case 'rotating-image': {
        const finalCoords = lastCoords.current;
        const startState = transformStartRef.current;
        
        if (currentProject && finalCoords && startState && startState.initialTransform && startState.imageId) {
            const { startPoint, initialTransform, handle, imageId } = startState;
            let finalTransform = { ...initialTransform };
            
            switch (currentAction) {
                case 'rotating-image': {
                    const { x, y } = initialTransform;
                    const angleStart = Math.atan2(startPoint.y - y, startPoint.x - x);
                    const angleCurrent = Math.atan2(finalCoords.y - y, finalCoords.x - x);
                    const angleDelta = angleCurrent - angleStart;
                    finalTransform.rotation += angleDelta;
                    break;
                }
                case 'resizing-image': {
                    const { width, height, rotation } = initialTransform;
                    const dx = finalCoords.x - startPoint.x;
                    const dy = finalCoords.y - startPoint.y;
                    const sin = Math.sin(-rotation);
                    const cos = Math.cos(-rotation);
                    const localDx = dx * cos - dy * sin;
                    const localDy = dx * sin + dy * cos;
                    let newWidth = width, newHeight = height;
                    const aspectRatio = width / height;

                    switch (handle) {
                        case 'tr': newWidth = width + localDx; newHeight = height - localDy; break;
                        case 'tl': newWidth = width - localDx; newHeight = height - localDy; break;
                        case 'br': newWidth = width + localDx; newHeight = height + localDy; break;
                        case 'bl': newWidth = width - localDx; newHeight = height + localDy; break;
                    }

                    if (handle && ['tr', 'tl', 'br', 'bl'].includes(handle)) {
                        if (Math.abs(newWidth - width) > Math.abs(newHeight - height)) newHeight = newWidth / aspectRatio;
                        else newWidth = newHeight * aspectRatio;
                    }
                    
                    newWidth = Math.max(20, newWidth); newHeight = Math.max(20, newHeight);
                    const dWidth = newWidth - width; const dHeight = newHeight - height;
                    let dxCenter = 0, dyCenter = 0;
                    if (handle?.includes('l')) dxCenter -= dWidth / 2;
                    if (handle?.includes('r')) dxCenter += dWidth / 2;
                    if (handle?.includes('t')) dyCenter -= dHeight / 2;
                    if (handle?.includes('b')) dyCenter += dHeight / 2;

                    const sinR = Math.sin(rotation); const cosR = Math.cos(rotation);
                    const worldDxCenter = dxCenter * cosR - dyCenter * sinR;
                    const worldDyCenter = dxCenter * sinR + dyCenter * cosR;

                    finalTransform.x += worldDxCenter;
                    finalTransform.y += worldDyCenter;
                    finalTransform.width = newWidth;
                    finalTransform.height = newHeight;
                    break;
                }
            }

            const finalImages = currentProject.images.map(img => img.id === imageId ? { ...img, transform: finalTransform } : img);

            setProjects(prev => prev.map(p =>
                p.id === currentProjectId ? { ...p, images: finalImages } : p
            ));

            recordNewHistoryState(currentProject.strokes, finalImages);
        }
        setPreviewImageTransforms(null);
        transformStartRef.current = null;
        break;
      }
    }
  }, [currentProject, selectionRect, history, historyIndex, currentProjectId, applyErasure, recordNewHistoryState, calculateTransformedStrokes]);
  
  const handleMouseLeave = useCallback(() => {
     if(actionRef.current !== 'none' && actionRef.current !== 'panning') {
        handleMouseUp(new MouseEvent('mouseup') as any);
     }
     if(actionRef.current === 'panning') {
       setIsPanning(false);
       actionRef.current = 'none';
     }
  }, [handleMouseUp]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const scaleAmount = -e.deltaY * 0.001;
    const newZoom = Math.max(0.1, Math.min(10, zoom * (1 + scaleAmount)));
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    setPan({
      x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
      y: mouseY - (mouseY - pan.y) * (newZoom / zoom)
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  const clearCanvas = useCallback(() => {
    if (!currentProject) return;
    if (window.confirm('Are you sure you want to clear the canvas? This cannot be undone.')) {
        recordNewHistoryState([], []);
        setProjects(prevProjects =>
            prevProjects.map(p =>
                p.id === currentProjectId ? { ...p, strokes: [], images: [] } : p
            )
        );
        setSelectedStrokeIds(new Set());
        setSelectedImageIds(new Set());
    }
  }, [currentProject, currentProjectId, recordNewHistoryState]);

  const handleDelete = useCallback(() => {
    if (hasSelection) {
        handleDeleteSelection();
    } else {
        clearCanvas();
    }
  }, [hasSelection, handleDeleteSelection, clearCanvas]);

  const handleImageUpload = useCallback((files: File[]) => {
    if (!files.length || !currentProject) return;
    
    const MAX_IMAGE_DIMENSION = 1920; // Define max dimension for resizing.
    const newImages: CanvasImage[] = [];
    let loadedCount = 0;

    const processFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            if (!event.target?.result) return;
            const dataUrl = event.target.result as string;
            
            const image = new Image();
            image.onload = () => {
                let finalDataUrl = dataUrl;
                let imageToProcessWidth = image.width;
                let imageToProcessHeight = image.height;

                // Resize image if it's too large
                if (image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION) {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    if (!ctx) { // Fallback if context creation fails
                        console.error("Could not get canvas context for image resizing.");
                    } else {
                        if (image.width > image.height) {
                            canvas.width = MAX_IMAGE_DIMENSION;
                            canvas.height = (image.height / image.width) * MAX_IMAGE_DIMENSION;
                        } else {
                            canvas.height = MAX_IMAGE_DIMENSION;
                            canvas.width = (image.width / image.height) * MAX_IMAGE_DIMENSION;
                        }
                        
                        imageToProcessWidth = canvas.width;
                        imageToProcessHeight = canvas.height;

                        ctx.drawImage(image, 0, 0, imageToProcessWidth, imageToProcessHeight);
                        // Use JPEG for better compression of photos, with a quality of 90%
                        finalDataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    }
                }

                const viewportWidth = viewport.width;
                const viewportHeight = viewport.height;
                const imageAspectRatio = imageToProcessWidth / imageToProcessHeight;
                const viewportAspectRatio = viewportWidth / viewportHeight;
                let renderWidth, renderHeight;

                if (imageAspectRatio > viewportAspectRatio) {
                    renderWidth = viewportWidth * 0.8;
                    renderHeight = renderWidth / imageAspectRatio;
                } else {
                    renderHeight = viewportHeight * 0.8;
                    renderWidth = renderHeight * imageAspectRatio;
                }
                
                const screenCenterX = viewportWidth / 2;
                const screenCenterY = viewportHeight / 2;
                const canvasCenterX = (screenCenterX - pan.x) / zoom;
                const canvasCenterY = (screenCenterY - pan.y) / zoom;

                const initialTransform: ImageTransform = {
                    x: canvasCenterX,
                    y: canvasCenterY,
                    width: renderWidth / zoom,
                    height: renderHeight / zoom,
                    rotation: 0
                };

                const newImage: CanvasImage = {
                    id: `img_${crypto.randomUUID()}`,
                    dataUrl: finalDataUrl,
                    transform: initialTransform,
                };

                newImages.push(newImage);
                loadedCount++;
                
                if (loadedCount === files.length) {
                    const currentStrokes = currentProject.strokes;
                    const finalImages = [...(currentProject.images || []), ...newImages];
                    
                    setProjects(prevProjects => prevProjects.map(p => 
                        p.id === currentProjectId ? { 
                            ...p, 
                            images: finalImages,
                        } : p
                    ));
                    recordNewHistoryState(currentStrokes, finalImages);
                    setSelectedImageIds(new Set(newImages.map(img => img.id)));
                    setSelectedStrokeIds(new Set());
                }
            };
            image.src = dataUrl;
        };
        reader.readAsDataURL(file);
    };
    
    files.forEach(processFile);
  }, [currentProject, currentProjectId, pan, zoom, recordNewHistoryState, viewport]);

  const handleExportSelection = useCallback(() => {
    if (!hasSelection || !currentProject) return;

    const allSelectedStrokes = currentProject.strokes.filter(s => selectedStrokeIds.has(s.id));
    const allSelectedImages = currentProject.images.filter(i => selectedImageIds.has(i.id));

    const allStrokesBounds = getBounds(allSelectedStrokes);
    const allImageBounds = allSelectedImages.reduce((acc, img) => {
        const bounds = getTransformedImageBounds(img.transform);
        if (!acc) return bounds;
        const minX = Math.min(acc.x, bounds.x);
        const minY = Math.min(acc.y, bounds.y);
        const maxX = Math.max(acc.x + acc.width, bounds.x + bounds.width);
        const maxY = Math.max(acc.y + acc.height, bounds.y + bounds.height);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, null as ReturnType<typeof getTransformedImageBounds> | null);

    const exportRegion = [allStrokesBounds, allImageBounds].reduce((acc, bounds) => {
        if (!bounds) return acc;
        if (!acc) return bounds;
        const minX = Math.min(acc.x, bounds.x);
        const minY = Math.min(acc.y, bounds.y);
        const maxX = Math.max(acc.x + acc.width, bounds.x + bounds.width);
        const maxY = Math.max(acc.y + acc.height, bounds.y + bounds.height);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }, null as ReturnType<typeof getBounds> | null);

    if (!exportRegion) return;
    
    // Find all project items that intersect with the export region
    const strokesToExport = currentProject.strokes.filter(stroke => {
        const strokeBounds = getStrokeBounds(stroke);
        return stroke.tool !== 'eraser' && strokeBounds && doRectsIntersect(exportRegion, strokeBounds);
    });

    const imagesToExport = currentProject.images.filter(image => {
        const imageBounds = getTransformedImageBounds(image.transform);
        return doRectsIntersect(exportRegion, imageBounds);
    });

    const PADDING = 0;
    const exportCanvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1; 
    
    exportCanvas.width = (exportRegion.width + PADDING * 2) * dpr;
    exportCanvas.height = (exportRegion.height + PADDING * 2) * dpr;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;
    
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, exportCanvas.width / dpr, exportCanvas.height / dpr);

    ctx.translate(-exportRegion.x + PADDING, -exportRegion.y + PADDING);

    // Draw images
    imagesToExport.forEach(imageInfo => {
        const imgElement = bgImageElements.get(imageInfo.id);
        if (!imgElement) return;

        const { x, y, width, height, rotation } = imageInfo.transform;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.drawImage(imgElement, -width / 2, -height / 2, width, height);
        ctx.restore();
    });

    // Draw strokes
    strokesToExport.forEach(stroke => {
        drawStroke(ctx, stroke);
    });

    const dataUrl = exportCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `whiteboard-selection.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

}, [hasSelection, currentProject, selectedStrokeIds, selectedImageIds, bgImageElements, drawStroke]);

  const handleNewProject = () => {
    const newId = crypto.randomUUID();
    const newProject: Project = { id: newId, name: `Drawing ${projects.length + 1}`, strokes: [], images: [] };
    setProjects(prev => [...prev, newProject]);
    setCurrentProjectId(newId);
    setIsPanelOpen(false);
    setSelectedStrokeIds(new Set());
    setSelectedImageIds(new Set());
    resetHistory([], []);
  };

  const handleSelectProject = (id: string) => {
    if (id === currentProjectId) return;
    const project = projects.find(p => p.id === id);
    if (project) {
        setCurrentProjectId(id);
        resetHistory(project.strokes, project.images);
    }
    setIsPanelOpen(false);
    resetView();
    setSelectedStrokeIds(new Set());
    setSelectedImageIds(new Set());
  };

  const handleDeleteProject = (idToDelete: string) => {
     setProjects(prevProjects => {
      const remainingProjects = prevProjects.filter(p => p.id !== idToDelete);
      
      if (currentProjectId === idToDelete) {
        if (remainingProjects.length > 0) {
          const newCurrentProject = remainingProjects[0];
          setCurrentProjectId(newCurrentProject.id);
          resetHistory(newCurrentProject.strokes, newCurrentProject.images);
        } else {
          const newId = crypto.randomUUID();
          const newProject: Project = { id: newId, name: 'Drawing 1', strokes: [], images: [] };
          setCurrentProjectId(newId);
          resetHistory([], []);
          return [newProject];
        }
      }
      return remainingProjects;
    });
  };
  
  const handleRenameProject = (id: string, newName: string) => {
    setProjects(prevProjects =>
      prevProjects.map(p =>
        p.id === id ? { ...p, name: newName.trim() } : p
      )
    );
  };
  
  const cursor = useMemo(() => {
    if (isPanning) return 'grabbing';
    if (actionRef.current === 'dragging') return 'grabbing';

    switch (drawOptions.tool) {
        case 'pen': 
        case 'rectangle':
        case 'circle':
        case 'line':
        case 'triangle':
        case 'dashed-line':
            return 'crosshair';
        case 'eraser': 
            const size = Math.max(2, drawOptions.lineWidth * zoom);
            const half = size / 2;
            const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${half}" cy="${half}" r="${half - 1}" fill="rgba(255,255,255,0.8)" stroke="black" stroke-width="1"/></svg>`;
            return `url(data:image/svg+xml;base64,${btoa(svg)}) ${half} ${half}, auto`;
        case 'selection':
             if (actionRef.current === 'rotating-strokes') return 'grabbing';
             if (hoveredEntity === 'rotation-handle') return 'grab';
             if (hoveredEntity === 'resize-handle') {
                if (hoveredHandle === 'tl' || hoveredHandle === 'br') return 'nwse-resize';
                if (hoveredHandle === 'tr' || hoveredHandle === 'bl') return 'nesw-resize';
             }
             if (actionRef.current.startsWith('dragging')) return 'grabbing';
             if (actionRef.current === 'resizing-image') return 'move';
            return 'default';
        case 'hand':
            return 'grab';
        default: return 'default';
    }
  }, [drawOptions.tool, drawOptions.lineWidth, isPanning, zoom, hoveredEntity, hoveredHandle]);

  return (
    <div 
      className="w-full h-full bg-gray-200 overflow-hidden select-none relative"
    >
       <header 
        className="fixed top-11 left-11 z-20 flex items-center gap-2"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleNewProject}
          className="p-3 bg-white/80 backdrop-blur-sm shadow-lg rounded-full text-gray-700 hover:bg-blue-100 hover:text-blue-600 active:bg-blue-200 transition-colors"
          title="New Project"
        >
          <PlusIcon className="w-6 h-6" />
        </button>
        <button
          onClick={() => setIsPanelOpen(true)}
          className="p-3 bg-white/80 backdrop-blur-sm shadow-lg rounded-full text-gray-700 hover:bg-blue-100 hover:text-blue-600 active:bg-blue-200 transition-colors"
          title="My Drawings"
        >
          <FolderIcon className="w-6 h-6" />
        </button>
      </header>

      <div 
        className="fixed top-11 right-5 z-20"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setIsInfoModalOpen(true)}
          className="p-3 bg-white/80 backdrop-blur-sm shadow-lg rounded-full text-gray-700 hover:bg-blue-100 hover:text-blue-600 active:bg-blue-200 transition-colors"
          title="Information"
        >
          <InfoIcon className="w-6 h-6" />
        </button>
      </div>

      <ProjectsPanel
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        projects={projects}
        currentProjectId={currentProjectId}
        onSelectProject={handleSelectProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
      />

      <InfoModal 
        isOpen={isInfoModalOpen}
        onClose={() => setIsInfoModalOpen(false)}
      />

      <Toolbar 
        drawOptions={drawOptions} 
        setDrawOptions={setDrawOptions}
        onDelete={handleDelete}
        hasSelection={hasSelection}
        onImageUpload={handleImageUpload}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onExport={handleExportSelection}
      />

      <ZoomControls
        zoom={zoom}
        onZoomIn={() => setZoom(z => Math.min(10, z + 0.1))}
        onZoomOut={() => setZoom(z => Math.max(0.1, z - 0.1))}
        onReset={resetView}
        isGridVisible={isGridVisible}
        onToggleGrid={() => setIsGridVisible(v => !v)}
      />
      
      <Rulers pan={pan} zoom={zoom} rulerSize={RULER_SIZE} />
      
      <div 
        className="absolute"
        style={{ 
          top: RULER_SIZE, 
          left: RULER_SIZE,
          width: `calc(100% - ${RULER_SIZE}px)`,
          height: `calc(100% - ${RULER_SIZE}px)`,
          cursor,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      >
        <canvas 
          ref={canvasRef}
          className="absolute top-0 left-0"
        />
      </div>
    </div>
  );
};

export default App;
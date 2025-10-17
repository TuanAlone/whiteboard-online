import React, { useRef, useEffect } from 'react';

interface RulersProps {
  pan: { x: number; y: number };
  zoom: number;
  rulerSize: number;
}

const RULER_BG = '#f8f9fa';
const RULER_LINE_COLOR = '#ced4da';
const RULER_TEXT_COLOR = '#495057';

export const Rulers: React.FC<RulersProps> = ({ pan, zoom, rulerSize }) => {
  const horizontalRulerRef = useRef<HTMLCanvasElement>(null);
  const verticalRulerRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const hRuler = horizontalRulerRef.current;
    const vRuler = verticalRulerRef.current;
    if (!hRuler || !vRuler) return;

    const hCtx = hRuler.getContext('2d');
    const vCtx = vRuler.getContext('2d');
    if (!hCtx || !vCtx) return;

    const dpr = window.devicePixelRatio || 1;

    // --- Resize Canvases ---
    const hRect = hRuler.getBoundingClientRect();
    hRuler.width = hRect.width * dpr;
    hRuler.height = hRect.height * dpr;
    hCtx.scale(dpr, dpr);

    const vRect = vRuler.getBoundingClientRect();
    vRuler.width = vRect.width * dpr;
    vRuler.height = vRect.height * dpr;
    vCtx.scale(dpr, dpr);

    // --- Drawing Logic ---
    let baseGridSize = 100;
    while (baseGridSize * zoom < 50) baseGridSize *= 2;
    while (baseGridSize * zoom > 150) baseGridSize /= 2;
    const majorGridSize = baseGridSize;
    const minorGridSize = majorGridSize / 5;
    
    // --- Draw Horizontal Ruler ---
    hCtx.fillStyle = RULER_BG;
    hCtx.fillRect(0, 0, hRuler.width / dpr, hRuler.height / dpr);
    hCtx.strokeStyle = RULER_LINE_COLOR;
    hCtx.fillStyle = RULER_TEXT_COLOR;
    hCtx.font = '10px sans-serif';
    hCtx.textAlign = 'left';
    hCtx.textBaseline = 'middle';

    const viewLeft = -pan.x / zoom;
    const viewRight = (hRuler.width / dpr - pan.x) / zoom;
    
    const drawTick = (ctx: CanvasRenderingContext2D, worldX: number, length: number) => {
      const screenX = worldX * zoom + pan.x;
      ctx.beginPath();
      ctx.moveTo(screenX, rulerSize - length);
      ctx.lineTo(screenX, rulerSize);
      ctx.stroke();
    };

    hCtx.lineWidth = 0.5;
    const startXMinor = Math.floor(viewLeft / minorGridSize) * minorGridSize;
    for (let x = startXMinor; x < viewRight; x += minorGridSize) {
      if (Math.round(x) % majorGridSize !== 0) {
        drawTick(hCtx, x, 5);
      }
    }
    
    hCtx.lineWidth = 1;
    const startXMajor = Math.floor(viewLeft / majorGridSize) * majorGridSize;
    for (let x = startXMajor; x < viewRight; x += majorGridSize) {
      drawTick(hCtx, x, 10);
      const screenX = x * zoom + pan.x;
      hCtx.fillText(String(Math.round(x)), screenX + 3, rulerSize / 2 - 1);
    }


    // --- Draw Vertical Ruler ---
    vCtx.fillStyle = RULER_BG;
    vCtx.fillRect(0, 0, vRuler.width / dpr, vRuler.height / dpr);
    vCtx.strokeStyle = RULER_LINE_COLOR;
    vCtx.fillStyle = RULER_TEXT_COLOR;
    vCtx.font = '10px sans-serif';
    vCtx.textAlign = 'left';
    vCtx.textBaseline = 'middle';
    
    const viewTop = -pan.y / zoom;
    const viewBottom = (vRuler.height / dpr - pan.y) / zoom;

    const drawVertTick = (ctx: CanvasRenderingContext2D, worldY: number, length: number) => {
      const screenY = worldY * zoom + pan.y;
      ctx.beginPath();
      ctx.moveTo(rulerSize - length, screenY);
      ctx.lineTo(rulerSize, screenY);
      ctx.stroke();
    };

    vCtx.lineWidth = 0.5;
    const startYMinor = Math.floor(viewTop / minorGridSize) * minorGridSize;
    for (let y = startYMinor; y < viewBottom; y += minorGridSize) {
      if (Math.round(y) % majorGridSize !== 0) {
        drawVertTick(vCtx, y, 5);
      }
    }

    vCtx.lineWidth = 1;
    const startYMajor = Math.floor(viewTop / majorGridSize) * majorGridSize;
    for (let y = startYMajor; y < viewBottom; y += majorGridSize) {
        drawVertTick(vCtx, y, 10);
        const screenY = y * zoom + pan.y;
        vCtx.fillText(String(Math.round(y)), 3, screenY + 3);
    }

  }, [pan, zoom, rulerSize]);


  return (
    <div className="fixed inset-0 pointer-events-none z-[9]">
      <canvas
        ref={horizontalRulerRef}
        style={{ position: 'absolute', top: 0, left: `${rulerSize}px`, width: `calc(100% - ${rulerSize}px)`, height: `${rulerSize}px` }}
      />
      <canvas
        ref={verticalRulerRef}
        style={{ position: 'absolute', top: `${rulerSize}px`, left: 0, width: `${rulerSize}px`, height: `calc(100% - ${rulerSize}px)` }}
      />
      <div 
        className="bg-[#f8f9fa] border-r border-b border-[#ced4da]"
        style={{ position: 'absolute', top: 0, left: 0, width: `${rulerSize}px`, height: `${rulerSize}px` }}
      />
    </div>
  );
};

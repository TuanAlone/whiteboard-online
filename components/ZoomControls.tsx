import React from 'react';
import { ZoomInIcon, ZoomOutIcon, ViewfinderIcon, GridIcon } from './icons';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  isGridVisible: boolean;
  onToggleGrid: () => void;
}

export const ZoomControls: React.FC<ZoomControlsProps> = ({ zoom, onZoomIn, onZoomOut, onReset, isGridVisible, onToggleGrid }) => {
  return (
    <div 
      className="fixed bottom-20 right-5 z-10 bg-white/80 backdrop-blur-sm shadow-xl rounded-full p-2 flex flex-col items-center space-y-2 border border-gray-200"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <button
        onClick={onZoomIn}
        className="p-2 rounded-full text-gray-600 hover:bg-blue-100 hover:text-blue-600 active:bg-blue-200 transition-colors"
        title="Zoom In"
      >
        <ZoomInIcon className="w-5 h-5" />
      </button>
      <span className="text-xs font-bold w-10 text-center text-gray-700 select-none">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={onZoomOut}
        className="p-2 rounded-full text-gray-600 hover:bg-blue-100 hover:text-blue-600 active:bg-blue-200 transition-colors"
        title="Zoom Out"
      >
        <ZoomOutIcon className="w-5 h-5" />
      </button>
       <div className="w-full h-[1px] bg-gray-200 my-1"></div>
       <button
        onClick={onToggleGrid}
        className={`p-2 rounded-full transition-colors ${
            isGridVisible 
            ? 'bg-blue-100 text-blue-600' 
            : 'text-gray-600 hover:bg-blue-100 hover:text-blue-600'
        }`}
        title="Toggle Grid"
      >
        <GridIcon className="w-5 h-5" />
      </button>
      <button
        onClick={onReset}
        className="p-2 rounded-full text-gray-600 hover:bg-blue-100 hover:text-blue-600 active:bg-blue-200 transition-colors"
        title="Reset Zoom"
      >
        <ViewfinderIcon className="w-5 h-5" />
      </button>
    </div>
  );
};
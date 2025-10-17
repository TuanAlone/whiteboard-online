import React, { useRef, useState, useEffect } from 'react';
import type { DrawOptions } from '../types';
import { TrashIcon, PencilIcon, EraserIcon, ImageIcon, SelectionIcon, UndoIcon, RedoIcon, HandIcon, LineIcon, RectangleIcon, CircleIcon, ExportIcon, TriangleIcon, DashedLineIcon } from './icons';

interface ToolbarProps {
  drawOptions: DrawOptions;
  setDrawOptions: React.Dispatch<React.SetStateAction<DrawOptions>>;
  onDelete: () => void;
  hasSelection: boolean;
  onImageUpload: (files: File[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onExport: () => void;
}

const Divider: React.FC = () => <div className="w-px h-6 bg-gray-300"></div>;

export const Toolbar: React.FC<ToolbarProps> = ({ 
  drawOptions, 
  setDrawOptions, 
  onDelete,
  hasSelection,
  onImageUpload,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onExport,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isShapeMenuOpen, setIsShapeMenuOpen] = useState(false);
  const shapeContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (shapeContainerRef.current && !shapeContainerRef.current.contains(event.target as Node)) {
            setIsShapeMenuOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDrawOptions(prev => ({ ...prev, color: e.target.value }));
  };

  const handleLineWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDrawOptions(prev => ({ ...prev, lineWidth: parseInt(e.target.value, 10) }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImageUpload(Array.from(e.target.files));
      e.target.value = ''; // Reset input to allow uploading the same file again
    }
  };

  const isShapeToolActive = ['line', 'rectangle', 'circle', 'triangle', 'dashed-line'].includes(drawOptions.tool);
  const ActiveShapeIcon = 
      drawOptions.tool === 'line' ? LineIcon :
      drawOptions.tool === 'dashed-line' ? DashedLineIcon :
      drawOptions.tool === 'rectangle' ? RectangleIcon :
      drawOptions.tool === 'circle' ? CircleIcon :
      drawOptions.tool === 'triangle' ? TriangleIcon :
      RectangleIcon; // Default icon when a shape tool is not active but the menu is opened

  return (
    <div
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-10 bg-white/80 backdrop-blur-sm shadow-xl rounded-full p-2 flex items-center gap-2 border border-gray-200"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Tool Selection */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setDrawOptions(prev => ({ ...prev, tool: 'pen' }))}
          className={`p-2 rounded-full transition-colors ${
            drawOptions.tool === 'pen'
              ? 'bg-blue-100 text-blue-600'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
          title="Pen"
        >
          <PencilIcon className="w-5 h-5" />
        </button>
        
        {/* Shapes Menu */}
        <div ref={shapeContainerRef} className="relative flex items-center justify-center">
            {isShapeMenuOpen && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm shadow-lg rounded-lg p-1 flex items-center gap-1">
                    <button onClick={() => { setDrawOptions(prev => ({...prev, tool: 'line'})); setIsShapeMenuOpen(false); }} title="Line" className={`p-2 rounded-full transition-colors ${drawOptions.tool === 'line' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}>
                        <LineIcon className="w-5 h-5" />
                    </button>
                     <button onClick={() => { setDrawOptions(prev => ({...prev, tool: 'dashed-line'})); setIsShapeMenuOpen(false); }} title="Dashed Line" className={`p-2 rounded-full transition-colors ${drawOptions.tool === 'dashed-line' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}>
                        <DashedLineIcon className="w-5 h-5" />
                    </button>
                    <button onClick={() => { setDrawOptions(prev => ({...prev, tool: 'rectangle'})); setIsShapeMenuOpen(false); }} title="Rectangle" className={`p-2 rounded-full transition-colors ${drawOptions.tool === 'rectangle' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}>
                        <RectangleIcon className="w-5 h-5" />
                    </button>
                    <button onClick={() => { setDrawOptions(prev => ({...prev, tool: 'circle'})); setIsShapeMenuOpen(false); }} title="Circle" className={`p-2 rounded-full transition-colors ${drawOptions.tool === 'circle' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}>
                        <CircleIcon className="w-5 h-5" />
                    </button>
                    <button onClick={() => { setDrawOptions(prev => ({...prev, tool: 'triangle'})); setIsShapeMenuOpen(false); }} title="Triangle" className={`p-2 rounded-full transition-colors ${drawOptions.tool === 'triangle' ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}>
                        <TriangleIcon className="w-5 h-5" />
                    </button>
                </div>
            )}
            <button
                onClick={() => setIsShapeMenuOpen(prev => !prev)}
                className={`p-2 rounded-full transition-colors ${isShapeToolActive ? 'bg-blue-100 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
                title="Shapes"
            >
                <ActiveShapeIcon className="w-5 h-5" />
            </button>
        </div>

        <button
          onClick={() => setDrawOptions(prev => ({ ...prev, tool: 'eraser' }))}
          className={`p-2 rounded-full transition-colors ${
            drawOptions.tool === 'eraser'
              ? 'bg-blue-100 text-blue-600'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
          title="Eraser"
        >
          <EraserIcon className="w-5 h-5" />
        </button>
        <button
          onClick={() => setDrawOptions(prev => ({ ...prev, tool: 'selection' }))}
          className={`p-2 rounded-full transition-colors ${
            drawOptions.tool === 'selection'
              ? 'bg-blue-100 text-blue-600'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
          title="Select"
        >
          <SelectionIcon className="w-5 h-5" />
        </button>
        <button
          onClick={() => setDrawOptions(prev => ({ ...prev, tool: 'hand' }))}
          className={`p-2 rounded-full transition-colors ${
            drawOptions.tool === 'hand'
              ? 'bg-blue-100 text-blue-600'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
          title="Pan"
        >
          <HandIcon className="w-5 h-5" />
        </button>
      </div>

      <Divider />

      {/* Tool Options */}
      <div className="flex items-center gap-4">
        <div 
            className={`relative w-9 h-9 rounded-full overflow-hidden border-2 border-gray-300 hover:border-blue-500 transition-all ${
                drawOptions.tool === 'eraser' || drawOptions.tool === 'selection' || drawOptions.tool === 'hand'
                 ? 'opacity-30 pointer-events-none' : ''
            }`}
            title="Select color"
        >
          <input
            type="color"
            value={drawOptions.color}
            onChange={handleColorChange}
            className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
            disabled={drawOptions.tool === 'eraser' || drawOptions.tool === 'selection' || drawOptions.tool === 'hand'}
          />
          <div 
            className="w-full h-full" 
            style={{ backgroundColor: drawOptions.color }}
          />
        </div>
        
        <div className={`flex items-center space-x-2 ${
            ['selection', 'hand'].includes(drawOptions.tool) ? 'opacity-30 pointer-events-none' : ''
        }`}>
          <input
            type="range"
            min="1"
            max="50"
            value={drawOptions.lineWidth}
            onChange={handleLineWidthChange}
            className="w-24 md:w-32 cursor-pointer accent-blue-500"
            title="Adjust brush size"
            disabled={['selection', 'hand'].includes(drawOptions.tool)}
          />
          <span className="text-sm font-semibold w-6 text-center text-gray-700">{drawOptions.lineWidth}</span>
        </div>
      </div>

      <Divider />

      {/* History */}
      <div className="flex items-center gap-1">
        <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`p-2 rounded-full text-gray-600 transition-colors ${!canUndo ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 active:bg-gray-200'}`}
            title="Undo (Ctrl+Z)"
        >
            <UndoIcon className="w-5 h-5" />
        </button>
        <button
            onClick={onRedo}
            disabled={!canRedo}
            className={`p-2 rounded-full text-gray-600 transition-colors ${!canRedo ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 active:bg-gray-200'}`}
            title="Redo (Ctrl+Y)"
        >
            <RedoIcon className="w-5 h-5" />
        </button>
      </div>

      <Divider />

      {/* Actions */}
      <div className="flex items-center gap-1">
        <input 
          type="file" 
          accept="image/*"
          ref={fileInputRef} 
          onChange={handleFileChange}
          className="hidden"
          multiple
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-full text-gray-600 hover:bg-gray-100 active:bg-gray-200 transition-colors"
          title="Add Image as Background"
        >
          <ImageIcon className="w-5 h-5" />
        </button>
        <button
          onClick={onExport}
          disabled={!hasSelection}
          className={`p-2 rounded-full text-gray-600 transition-colors ${!hasSelection ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 active:bg-gray-200'}`}
          title="Export selection as PNG"
        >
          <ExportIcon className="w-5 h-5" />
        </button>
        <button
          onClick={onDelete}
          className="p-2 rounded-full text-gray-600 hover:bg-red-100 hover:text-red-600 active:bg-red-200 transition-colors"
          title={hasSelection ? "Delete Selection (Del)" : "Clear canvas"}
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
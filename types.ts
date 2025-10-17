export type DrawingTool = 'pen' | 'eraser' | 'rectangle' | 'circle' | 'line' | 'triangle' | 'dashed-line';
export type Tool = DrawingTool | 'selection' | 'hand';

export interface DrawOptions {
  color: string;
  lineWidth: number;
  tool: Tool;
}

export interface Stroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  tool: DrawingTool;
}

export interface ImageTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // in radians
}

export interface CanvasImage {
  id: string;
  dataUrl: string;
  transform: ImageTransform;
}

export interface Project {
  id: string;
  name: string;
  strokes: Stroke[];
  images: CanvasImage[];
}
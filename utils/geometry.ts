import type { Stroke, ImageTransform } from '../types';

type Rect = { x: number; y: number; width: number; height: number; };

export const getStrokeBounds = (stroke: Stroke): Rect | null => {
  if (stroke.points.length === 0) return null;

  if (stroke.tool === 'rectangle' || stroke.tool === 'line' || stroke.tool === 'triangle' || stroke.tool === 'dashed-line') {
    if (stroke.points.length < 2) return null;
    const [start, end] = stroke.points;
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxX = Math.max(start.x, end.x);
    const maxY = Math.max(start.y, end.y);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  if (stroke.tool === 'circle') {
    if (stroke.points.length < 2) return null;
    const [center, edge] = stroke.points;
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    return {
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
  }

  // Default for pen/eraser
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  stroke.points.forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

export const getBounds = (strokes: Stroke[]): Rect | null => {
  if (strokes.length === 0) return null;
  
  const bounds = strokes.reduce((acc, stroke) => {
    const strokeBounds = getStrokeBounds(stroke);
    if (!strokeBounds) return acc;
    if (!acc) return strokeBounds;

    const minX = Math.min(acc.x, strokeBounds.x);
    const minY = Math.min(acc.y, strokeBounds.y);
    const maxX = Math.max(acc.x + acc.width, strokeBounds.x + strokeBounds.width);
    const maxY = Math.max(acc.y + acc.height, strokeBounds.y + strokeBounds.height);
    
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, null as Rect | null);

  return bounds;
};


export const doRectsIntersect = (r1: Rect, r2: Rect): boolean => {
  return !(r2.x > r1.x + r1.width || 
           r2.x + r2.width < r1.x || 
           r2.y > r1.y + r1.height ||
           r2.y + r2.height < r1.y);
};

/**
 * Calculates the squared distance from a point to a line segment.
 * @param p The point.
 * @param a The start point of the segment.
 * @param b The end point of the segment.
 */
function pDistanceToSegmentSquared(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const l2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  if (l2 === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projection = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  };
  return (p.x - projection.x) ** 2 + (p.y - projection.y) ** 2;
}


/**
 * Checks if a point is inside a transformed (rotated and translated) rectangle.
 * @param point The point to check.
 * @param transform The transformation of the rectangle.
 * @returns True if the point is inside, false otherwise.
 */
export const isPointInTransformedRect = (point: {x: number, y: number}, transform: ImageTransform): boolean => {
    const { x, y, width, height, rotation } = transform;
    
    // Translate point to be relative to the rectangle's center
    const translatedX = point.x - x;
    const translatedY = point.y - y;

    // Rotate the point in the opposite direction of the rectangle's rotation
    const sin = Math.sin(-rotation);
    const cos = Math.cos(-rotation);
    const rotatedX = translatedX * cos - translatedY * sin;
    const rotatedY = translatedX * sin + translatedY * cos;

    // Check if the rotated point is within the un-rotated rectangle's bounds
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    return rotatedX >= -halfWidth && rotatedX <= halfWidth &&
           rotatedY >= -halfHeight && rotatedY <= halfHeight;
}

/**
 * Checks if a circular area on a stroke path is erased by an eraser stroke.
 * This function models both the eraser and the point being checked as circles
 * and checks for intersection between the point's circle and the eraser's
 * swept path (a series of capsules).
 * @param point The center point of the area being checked on the target stroke.
 * @param eraserStroke The eraser stroke.
 * @param pointRadius The radius of the area being checked (i.e., target stroke's lineWidth / 2).
 * @returns True if the area should be considered erased.
 */
export const isPointErased = (
  point: { x: number; y: number },
  eraserStroke: Stroke,
  pointRadius: number = 0
): boolean => {
    // The total distance required for an intersection is the sum of the two radii.
    const totalRadius = eraserStroke.lineWidth / 2 + pointRadius;
    const totalRadiusSq = totalRadius * totalRadius;

    // Handle a single-point eraser stroke (a simple circle).
    if (eraserStroke.points.length === 1) {
        const p = eraserStroke.points[0];
        const distSq = (point.x - p.x)**2 + (point.y - p.y)**2;
        return distSq < totalRadiusSq;
    }

    // Check the squared distance from the point's center to each segment of the eraser's path.
    // If this distance is less than the squared sum of radii, they intersect.
    for (let i = 0; i < eraserStroke.points.length - 1; i++) {
        const segmentStart = eraserStroke.points[i];
        const segmentEnd = eraserStroke.points[i+1];
        // Fix: Corrected typo from `segmentend` to `segmentEnd`.
        if (pDistanceToSegmentSquared(point, segmentStart, segmentEnd) < totalRadiusSq) {
            return true;
        }
    }

    return false;
};

export const rotatePoint = (
    point: { x: number; y: number },
    center: { x: number; y: number },
    angle: number
): { x: number; y: number } => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const translatedX = point.x - center.x;
    const translatedY = point.y - center.y;
    const rotatedX = translatedX * cos - translatedY * sin;
    const rotatedY = translatedX * sin + translatedY * cos;
    return {
        x: rotatedX + center.x,
        y: rotatedY + center.y,
    };
};

export const getTransformedImageBounds = (transform: ImageTransform): Rect => {
    const { x, y, width, height, rotation } = transform;
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    const corners = [
        { x: -halfWidth, y: -halfHeight }, // tl
        { x: halfWidth, y: -halfHeight },  // tr
        { x: halfWidth, y: halfHeight },   // br
        { x: -halfWidth, y: halfHeight },  // bl
    ];

    const worldCorners = corners.map(corner => {
        const rotated = rotatePoint(corner, { x: 0, y: 0 }, rotation);
        return { x: rotated.x + x, y: rotated.y + y };
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    worldCorners.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    });

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};


export const scalePoint = (
    point: { x: number; y: number },
    origin: { x: number; y: number },
    scale: number
): { x: number; y: number } => {
    const translatedX = point.x - origin.x;
    const translatedY = point.y - origin.y;
    const scaledX = translatedX * scale;
    const scaledY = translatedY * scale;
    return {
        x: scaledX + origin.x,
        y: scaledY + origin.y,
    };
};

export const isPointOnStroke = (
  point: { x: number; y: number },
  stroke: Stroke,
  tolerance: number
): boolean => {
    const toleranceSq = tolerance * tolerance;
    const pointRadius = stroke.lineWidth / 2;
    const totalRadius = tolerance + pointRadius;
    const totalRadiusSq = totalRadius * totalRadius;

    switch (stroke.tool) {
        case 'pen':
        case 'line':
        case 'dashed-line':
            for (let i = 0; i < stroke.points.length - 1; i++) {
                if (pDistanceToSegmentSquared(point, stroke.points[i], stroke.points[i + 1]) < totalRadiusSq) {
                    return true;
                }
            }
            break;
        case 'rectangle': {
            const [start, end] = stroke.points;
            const p1 = { x: start.x, y: start.y };
            const p2 = { x: end.x, y: start.y };
            const p3 = { x: end.x, y: end.y };
            const p4 = { x: start.x, y: end.y };
            if (pDistanceToSegmentSquared(point, p1, p2) < totalRadiusSq) return true;
            if (pDistanceToSegmentSquared(point, p2, p3) < totalRadiusSq) return true;
            if (pDistanceToSegmentSquared(point, p3, p4) < totalRadiusSq) return true;
            if (pDistanceToSegmentSquared(point, p4, p1) < totalRadiusSq) return true;
            break;
        }
        case 'triangle': {
            const [start, end] = stroke.points;
            const minX = Math.min(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxX = Math.max(start.x, end.x);
            const maxY = Math.max(start.y, end.y);
            
            const p1 = { x: (minX + maxX) / 2, y: minY }; // Top
            const p2 = { x: maxX, y: maxY }; // Bottom right
            const p3 = { x: minX, y: maxY }; // Bottom left

            if (pDistanceToSegmentSquared(point, p1, p2) < totalRadiusSq) return true;
            if (pDistanceToSegmentSquared(point, p2, p3) < totalRadiusSq) return true;
            if (pDistanceToSegmentSquared(point, p3, p1) < totalRadiusSq) return true;
            break;
        }
        case 'circle': {
            const [center, edge] = stroke.points;
            const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
            const distToCenterSq = (point.x - center.x)**2 + (point.y - center.y)**2;
            // Check if point is within the annulus (ring) of the circle's line
            if (Math.abs(Math.sqrt(distToCenterSq) - radius) < totalRadius) {
              return true;
            }
            break;
        }
    }
    return false;
};
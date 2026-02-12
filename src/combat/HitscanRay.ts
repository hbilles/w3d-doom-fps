/**
 * Pure 2D geometry: ray vs. line-segment intersection.
 * Used by both combat (hitscan) and AI systems.
 *
 * All calculations are in the XZ plane (Y-up world, Doom-style no vertical aim).
 */

export interface RayHit {
  /** Distance from ray origin to hit point. */
  distance: number;
  /** Hit point X (world). */
  x: number;
  /** Hit point Z (world). */
  z: number;
  /** Wall normal X at hit point. */
  normalX: number;
  /** Wall normal Z at hit point. */
  normalZ: number;
}

/**
 * Cast a 2D ray from (ox, oz) in direction (dx, dz) against the
 * line segment (v1 -> v2). Returns the hit info or null if no intersection.
 *
 * @param ox   Ray origin X
 * @param oz   Ray origin Z
 * @param dx   Ray direction X (need not be normalized)
 * @param dz   Ray direction Z (need not be normalized)
 * @param v1   Segment start [x, z]
 * @param v2   Segment end [x, z]
 * @param maxDist  Maximum ray distance (default Infinity)
 */
export function rayVsSegment(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  v1: [number, number],
  v2: [number, number],
  maxDist: number = Infinity,
): RayHit | null {
  const sx = v2[0] - v1[0];
  const sz = v2[1] - v1[1];

  const denom = dx * sz - dz * sx;

  // Parallel — no intersection
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((v1[0] - ox) * sz - (v1[1] - oz) * sx) / denom;
  const u = ((v1[0] - ox) * dz - (v1[1] - oz) * dx) / denom;

  // t must be positive (ray goes forward), u must be in [0, 1] (on segment)
  if (t < 0 || u < 0 || u > 1) return null;

  // Compute actual distance (t is in terms of direction vector length)
  const dirLen = Math.sqrt(dx * dx + dz * dz);
  const distance = t * dirLen;

  if (distance > maxDist) return null;

  const hitX = ox + t * dx;
  const hitZ = oz + t * dz;

  // Wall normal: perpendicular to segment, pointing toward the ray origin side
  const segLen = Math.sqrt(sx * sx + sz * sz);
  let nx = sz / segLen;
  let nz = -sx / segLen;

  // Make sure normal points toward the ray origin
  const toOriginX = ox - v1[0];
  const toOriginZ = oz - v1[1];
  if (nx * toOriginX + nz * toOriginZ < 0) {
    nx = -nx;
    nz = -nz;
  }

  return { distance, x: hitX, z: hitZ, normalX: nx, normalZ: nz };
}

/**
 * Cast a ray against all provided line segments and return the closest hit.
 */
export function raycastAll(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  segments: Array<{ v1: [number, number]; v2: [number, number] }>,
  maxDist: number = Infinity,
): RayHit | null {
  let closest: RayHit | null = null;

  for (const seg of segments) {
    const hit = rayVsSegment(ox, oz, dx, dz, seg.v1, seg.v2, maxDist);
    if (hit && (!closest || hit.distance < closest.distance)) {
      closest = hit;
    }
  }

  return closest;
}

// Adapter: kjøretid mellom to punkter.
// Uten ekte karttjeneste: luftlinje × 1,4 ÷ 70 km/t + 5 min, rundet opp. Vises alltid som «ca.».
// En ekte tjeneste (f.eks. OSRM eller Google Distance Matrix) kan kobles på her uten endringer ellers.
import { haversineKm } from '../domain/geo';

export interface LatLng { lat: number; lng: number }

const cache = new Map<string, number>();

export function getDriveTime(a: LatLng, b: LatLng): number {
  if (a.lat === b.lat && a.lng === b.lng) return 0;
  const key = `${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const km = haversineKm(a, b) * 1.4;
  const min = Math.ceil((km / 70) * 60 + 5);
  cache.set(key, min);
  return min;
}

export function getDriveKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1.4;
}

export const DRIVE_TIME_IS_ESTIMATE = true;

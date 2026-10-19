// Adapter: adresse → koordinater.
// Prototypen bruker innebygd tabell over steder og postnumre i Sør-Norge (kilde «ca.»).
// Finnes ikke stedet, returneres null og brukeren plasserer pinnen selv.
import type { Coords } from '../domain/types';
import { placeByName, placeByPostcode } from '../domain/geo';

export interface GeocodeResult { coords: Coords | null; matched: string | null; confidence: 'middels' | 'lav' }

export function geocode(address: { street: string; postcode: string; place: string }): GeocodeResult {
  const byPost = placeByPostcode(address.postcode);
  const byName = placeByName(address.place);
  const p = byPost ?? byName;
  if (!p) return { coords: null, matched: null, confidence: 'lav' };
  // Liten deterministisk spredning per gateadresse, så anlegg i samme sted ikke ligger oppå hverandre.
  let h = 0;
  for (const ch of address.street) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dLat = ((h % 1000) / 1000 - 0.5) * 0.02;
  const dLng = (((h >> 10) % 1000) / 1000 - 0.5) * 0.04;
  const agree = !byPost || !byName || byPost === byName;
  return {
    coords: { lat: p.lat + dLat, lng: p.lng + dLng, source: 'ca' },
    matched: p.name,
    confidence: agree ? 'middels' : 'lav',
  };
}

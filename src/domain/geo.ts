// Innebygd stedstabell for Sør-Norge: brukes av geocode-adapteren, til områder og som kartreferanse.

export interface Place {
  name: string;
  lat: number;
  lng: number;
  post: [number, number][]; // postnummerintervaller
  area: string;
  label?: boolean; // vises som referanse på kartet
}

export const PLACES: Place[] = [
  { name: 'Hokksund', lat: 59.770, lng: 9.910, post: [[3300, 3303]], area: 'Drammen og omegn', label: true },
  { name: 'Drammen', lat: 59.744, lng: 10.204, post: [[3001, 3049]], area: 'Drammen og omegn', label: true },
  { name: 'Mjøndalen', lat: 59.749, lng: 10.018, post: [[3050, 3059]], area: 'Drammen og omegn' },
  { name: 'Svelvik', lat: 59.612, lng: 10.408, post: [[3060, 3069]], area: 'Drammen og omegn' },
  { name: 'Sande', lat: 59.588, lng: 10.207, post: [[3070, 3079]], area: 'Drammen og omegn' },
  { name: 'Lier', lat: 59.785, lng: 10.243, post: [[3400, 3431]], area: 'Drammen og omegn' },
  { name: 'Tofte', lat: 59.545, lng: 10.560, post: [[3480, 3491]], area: 'Drammen og omegn' },
  { name: 'Vikersund', lat: 59.970, lng: 10.030, post: [[3370, 3379]], area: 'Midt-Buskerud' },
  { name: 'Åmot', lat: 59.890, lng: 9.910, post: [[3340, 3349]], area: 'Midt-Buskerud' },
  { name: 'Kongsberg', lat: 59.665, lng: 9.646, post: [[3600, 3619]], area: 'Kongsberg og Numedal', label: true },
  { name: 'Flesberg', lat: 59.850, lng: 9.450, post: [[3620, 3629]], area: 'Kongsberg og Numedal' },
  { name: 'Hønefoss', lat: 60.168, lng: 10.256, post: [[3500, 3519]], area: 'Ringerike', label: true },
  { name: 'Jevnaker', lat: 60.240, lng: 10.380, post: [[3520, 3529]], area: 'Ringerike' },
  { name: 'Asker', lat: 59.833, lng: 10.435, post: [[1370, 1397]], area: 'Asker og Bærum', label: true },
  { name: 'Sandvika', lat: 59.890, lng: 10.524, post: [[1300, 1369]], area: 'Asker og Bærum' },
  { name: 'Oslo', lat: 59.913, lng: 10.752, post: [[150, 1299]], area: 'Oslo', label: true },
  { name: 'Lillestrøm', lat: 59.956, lng: 11.050, post: [[2000, 2019]], area: 'Romerike', label: true },
  { name: 'Sørumsand', lat: 59.985, lng: 11.250, post: [[1920, 1929]], area: 'Romerike' },
  { name: 'Jessheim', lat: 60.142, lng: 11.175, post: [[2050, 2069]], area: 'Romerike' },
  { name: 'Eidsvoll', lat: 60.330, lng: 11.260, post: [[2080, 2093]], area: 'Romerike' },
  { name: 'Ski', lat: 59.719, lng: 10.836, post: [[1400, 1409]], area: 'Follo', label: true },
  { name: 'Ås', lat: 59.665, lng: 10.790, post: [[1430, 1439]], area: 'Follo' },
  { name: 'Drøbak', lat: 59.663, lng: 10.630, post: [[1440, 1459]], area: 'Follo' },
  { name: 'Moss', lat: 59.434, lng: 10.658, post: [[1500, 1599]], area: 'Moss og Rygge', label: true },
  { name: 'Askim', lat: 59.583, lng: 11.162, post: [[1800, 1819]], area: 'Indre Østfold', label: true },
  { name: 'Spydeberg', lat: 59.615, lng: 11.080, post: [[1820, 1829]], area: 'Indre Østfold' },
  { name: 'Mysen', lat: 59.567, lng: 11.326, post: [[1850, 1859]], area: 'Indre Østfold', label: true },
  { name: 'Rakkestad', lat: 59.427, lng: 11.345, post: [[1890, 1899]], area: 'Indre Østfold' },
  { name: 'Sarpsborg', lat: 59.284, lng: 11.109, post: [[1700, 1749]], area: 'Nedre Østfold', label: true },
  { name: 'Fredrikstad', lat: 59.218, lng: 10.930, post: [[1600, 1699]], area: 'Nedre Østfold', label: true },
  { name: 'Halden', lat: 59.124, lng: 11.387, post: [[1750, 1799]], area: 'Nedre Østfold', label: true },
  { name: 'Holmestrand', lat: 59.489, lng: 10.317, post: [[3080, 3089]], area: 'Vestfold' },
  { name: 'Hof', lat: 59.550, lng: 10.080, post: [[3090, 3099]], area: 'Vestfold' },
  { name: 'Horten', lat: 59.417, lng: 10.483, post: [[3180, 3199]], area: 'Vestfold' },
  { name: 'Tønsberg', lat: 59.267, lng: 10.408, post: [[3100, 3179]], area: 'Vestfold', label: true },
  { name: 'Sandefjord', lat: 59.131, lng: 10.217, post: [[3200, 3249]], area: 'Vestfold', label: true },
  { name: 'Larvik', lat: 59.053, lng: 10.027, post: [[3250, 3299]], area: 'Vestfold', label: true },
  { name: 'Skien', lat: 59.209, lng: 9.609, post: [[3700, 3749]], area: 'Grenland', label: true },
  { name: 'Porsgrunn', lat: 59.140, lng: 9.656, post: [[3900, 3949]], area: 'Grenland' },
  { name: 'Kragerø', lat: 58.869, lng: 9.410, post: [[3770, 3779]], area: 'Grenland' },
  { name: 'Bø', lat: 59.410, lng: 9.070, post: [[3800, 3809]], area: 'Øst-Telemark' },
  { name: 'Notodden', lat: 59.559, lng: 9.258, post: [[3670, 3679]], area: 'Øst-Telemark', label: true },
  { name: 'Rjukan', lat: 59.879, lng: 8.594, post: [[3660, 3665]], area: 'Øst-Telemark' },
  { name: 'Nesbyen', lat: 60.570, lng: 9.100, post: [[3540, 3549]], area: 'Hallingdal' },
  { name: 'Gol', lat: 60.700, lng: 8.940, post: [[3550, 3559]], area: 'Hallingdal', label: true },
  { name: 'Geilo', lat: 60.534, lng: 8.206, post: [[3580, 3589]], area: 'Hallingdal' },
  { name: 'Hamar', lat: 60.794, lng: 11.068, post: [[2300, 2329]], area: 'Hedmarken', label: true },
  { name: 'Gjøvik', lat: 60.795, lng: 10.692, post: [[2800, 2829]], area: 'Toten og Gjøvik' },
  { name: 'Kongsvinger', lat: 60.190, lng: 12.000, post: [[2200, 2229]], area: 'Glåmdal' },
];

export function placeByPostcode(postcode: string | null | undefined): Place | null {
  const n = Number(postcode);
  if (!postcode || !Number.isFinite(n)) return null;
  return PLACES.find((p) => p.post.some(([a, b]) => n >= a && n <= b)) ?? null;
}

export function placeByName(name: string | null | undefined): Place | null {
  if (!name) return null;
  const k = name.trim().toLowerCase();
  return PLACES.find((p) => p.name.toLowerCase() === k) ?? null;
}

export function areaFor(place: string, postcode: string): string {
  return placeByName(place)?.area ?? placeByPostcode(postcode)?.area ?? 'Øvrige';
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Kompassretning fra a til b i grader (0 = nord). */
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

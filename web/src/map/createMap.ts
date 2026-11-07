import { Map as MapLibreMap, type Map } from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(maplibreWorkerUrl);

const TOMTOM_STYLE = 'https://api.tomtom.com/style/1/style/25.2.3-*?map=basic_main&key=';
const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const readyMaps = new WeakSet<Map>();
// Same breakpoint as the phone layout in style.css, where the map sits between the form and the results.
const PHONE_LAYOUT = window.matchMedia('(max-width: 680px)');

export function isPhoneLayout(): boolean {
  return PHONE_LAYOUT.matches;
}

export function createMap(container: HTMLElement): Map {
  const key = import.meta.env.VITE_TOMTOM_API_KEY as string | undefined;
  const map = new MapLibreMap({
    container,
    style: key ? `${TOMTOM_STYLE}${encodeURIComponent(key)}` : FALLBACK_STYLE,
    center: [77.638, 12.935],
    zoom: 11,
    attributionControl: {},
    maxZoom: 19,
  });
  // Recolour the provider's basemap, keeping its labels, sources and attribution.
  // Route and POI layers are added later and retain their own high-contrast colours.
  map.on('style.load', () => {
    for (const layer of map.getStyle().layers ?? []) {
      const id = layer.id.toLowerCase();
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#101923');
      if (layer.type === 'fill') {
        const color = /water/.test(id) ? '#0b2636' : /park|grass|wood|forest|landcover/.test(id) ? '#172d2b' : /building/.test(id) ? '#24323e' : '#16212b';
        map.setPaintProperty(layer.id, 'fill-color', color);
      }
      if (layer.type === 'line') {
        const color = /water/.test(id) ? '#214357' : /boundary|border/.test(id) ? '#53616e' : /motorway|trunk|primary/.test(id) ? '#716956' : '#354452';
        map.setPaintProperty(layer.id, 'line-color', color);
      }
      if (layer.type === 'symbol' && layer.layout?.['text-field']) {
        map.setPaintProperty(layer.id, 'text-color', '#b9c8d1');
        map.setPaintProperty(layer.id, 'text-halo-color', '#101923');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.2);
      }
    }
  });
  map.once('load', () => readyMaps.add(map));

  if (key) {
    // An error before the style JSON parses means the TomTom style itself failed (bad key, quota, outage).
    let styleParsed = false;
    map.once('style.load', () => { styleParsed = true; });
    const fallBack = (): void => {
      map.off('error', fallBack);
      if (!styleParsed) map.setStyle(FALLBACK_STYLE);
    };
    map.on('error', fallBack);
  }
  return map;
}

export function whenMapReady(map: Map, callback: () => void): void {
  if (readyMaps.has(map)) callback();
  else map.once('load', callback);
}

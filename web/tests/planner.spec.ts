import { test, expect, type Page } from '@playwright/test';

const emptyFeatures = { type: 'FeatureCollection', features: [] };
const routes = [1, 2].map((rank) => ({
  routeId: `route-${rank}`, rank, rankScore: 80 - rank,
  geometry: { type: 'LineString', coordinates: [[77.6, 12.9], [77.61 + rank * .001, 12.91], [77.62, 12.92]] },
  durationSeconds: rank === 1 ? 1200 : 900, distanceMeters: 3000 + rank * 500,
  trafficDelaySeconds: 60, trafficSemantics: 'night_active_corridor',
  estimatedArrivalTime: '2026-11-08T21:30:00+05:30', nightActivityScore: 74, streetLightingScore: 62,
  streetLampCount: 12, lampsPerKm: 4, streetLamps: emptyFeatures, poiFeatures: emptyFeatures,
  incidentsAlongRoute: [], navigationSteps: [], preferenceScore: 0, preferenceMatches: ['Well-lit streets'],
  nightActivityBreakdown: { components: { policePresence: 50 }, evidenceCoverage: 60, missingSignals: [] },
  activitySummary: { shops: { open: 2, unknown: 1 }, hospitals: { open: 1 } },
  policeCount: 1, residentialCoveragePercent: 30, explanation: null, missingSignals: [],
}));
const response = { routes, parsedPreferences: {}, safetyClaims: false, limitations: ['Lighting data is incomplete.', 'Not crime data.'], dataLimitations: [] };
const pageErrors = new WeakMap<Page, string[]>();

async function fillTrip(page: Page) {
  await page.getByLabel('FROM', { exact: true }).fill('Bellandur');
  await page.getByLabel('TO', { exact: true }).fill('Marathahalli');
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  // Deterministic provider fixtures: tests never consume map/routing quotas or real GPS.
  await page.route('https://**/*', async (route) => {
    if (route.request().url().includes('tiles.openfreemap.org/styles/liberty') || route.request().url().includes('api.tomtom.com/style')) {
      await route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#fff' } }] } });
    } else await route.abort();
  });
  await page.route('**/api/places/search?**', (route) => route.fulfill({ json: { results: [] } }));
  await page.route('**/api/routes/analyze', (route) => route.fulfill({ json: response }));
  // Expose the actual map only in the test-served module, never in production.
  await page.route('**/src/map/createMap.ts*', async (route) => {
    const source = await route.fetch();
    await route.fulfill({ response: source, body: (await source.text()).replace('return map;', 'globalThis.__testMap = map; return map;') });
  });
  await page.goto('/');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'No uncaught application errors').toEqual([]);
});

test('night branding, honest research, accessible dialog and responsive layout', async ({ page }, testInfo) => {
  await expect(page).toHaveTitle(/City After Dark: Route Planner/);
  await expect(page.getByRole('link', { name: 'City After Dark: Route Planner home' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/safe route|lumaroute/i);
  await page.getByRole('button', { name: 'Why City After Dark?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('October 2020');
  await expect(page.getByRole('dialog')).toContainText('18%');
  await expect(page.getByRole('link', { name: 'Read the original survey' })).toHaveAttribute('href', /yougov.com\/articles\/32860/);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('planner.png'), fullPage: true });
});

test('preference shortcuts append without duplication; swapping keeps chosen coordinates', async ({ page }) => {
  await page.route('**/api/places/search?**', (route) => route.fulfill({ json: { results: [{ label: 'Bellandur', address: 'Bengaluru', lat: 12.9, lon: 77.6 }] } }));
  await page.getByLabel('FROM', { exact: true }).fill('Bella');
  await page.locator('#start-suggestions [role="option"]').first().click();
  await page.getByLabel('TO', { exact: true }).fill('Marathahalli');
  await page.getByRole('button', { name: '+ Mapped lighting', exact: true }).click();
  await page.getByRole('button', { name: '+ Mapped lighting', exact: true }).click();
  await expect(page.locator('#preferences')).toHaveValue('Prefer well-lit streets');
  await expect(page.locator('.place-suggestions.visible')).toHaveCount(0);
  await page.getByRole('button', { name: /Swap start/ }).click();
  await expect(page.locator('#start')).toHaveValue('Marathahalli');
  await expect(page.locator('#destination')).toHaveValue('Bellandur');
  const request = page.waitForRequest('**/api/routes/analyze');
  await page.getByRole('button', { name: 'Compare routes', exact: true }).click();
  const payload = (await request).postDataJSON();
  expect(payload.start).toBe('Marathahalli');
  expect(payload.destination).toEqual({ lat: 12.9, lon: 77.6 });
  await expect(page.getByRole('heading', { name: '2 routes to consider' })).toBeVisible();
});

for (const hour of ['10:00', '21:00']) {
  test(`routes preserve ${hour} local departure, modes and route count`, async ({ page }) => {
    await fillTrip(page);
    await page.locator('#departure').fill(`2026-11-08T${hour}`);
    await page.locator('#mode').selectOption(hour === '10:00' ? 'bicycle' : 'pedestrian');
    await page.locator('#route-count').selectOption('4');
    const request = page.waitForRequest('**/api/routes/analyze');
    await page.getByRole('button', { name: 'Compare routes', exact: true }).click();
    const payload = (await request).postDataJSON();
    expect(payload.maxRoutes).toBe(4);
    expect(payload.mode).toBe(hour === '10:00' ? 'bicycle' : 'pedestrian');
    const localHour = await page.evaluate((iso) => new Date(iso).getHours(), payload.departureTime);
    expect(localHour).toBe(Number(hour.slice(0, 2)));
    await expect(page.getByRole('button', { name: 'Select route 1' })).toContainText('+5 min vs quickest');
    await page.getByRole('button', { name: 'Select route 2' }).click();
    await expect(page.getByRole('button', { name: 'Select route 2' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByText('What’s known, what’s missing').click();
    await expect(page.locator('.data-note')).toContainText('Lighting data is incomplete.');
  });
}

test('leave now, map picking and lamp toggle remain usable', async ({ page }) => {
  await page.locator('#departure').fill('2020-01-01T01:00');
  await page.getByRole('button', { name: /Leave now/ }).click();
  const age = await page.locator('#departure').evaluate((input: HTMLInputElement) => Date.now() - new Date(input.value).getTime());
  expect(age).toBeGreaterThanOrEqual(0);
  expect(age).toBeLessThan(65000);
  await page.locator('#pick-start').click();
  await expect(page.locator('#map-pick-banner')).toBeVisible();
  await page.locator('.maplibregl-canvas').click({ position: { x: 160, y: 170 } });
  await expect(page.locator('#start')).toHaveValue(/\d+\.\d+, \d+\.\d+/);
  await page.locator('#lamp-toggle').click();
  await expect(page.locator('#lamp-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('mapped lamps are discoverable without scrolling and render real returned points', async ({ page }, testInfo) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const toggle = page.locator('#lamp-toggle');
  await expect(toggle).toBeInViewport();
  await toggle.click();
  await expect(page.locator('#lamp-status')).toContainText('Compare routes');
  const streetLamps = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [77.611, 12.91] } },
  ] };
  await page.route('**/api/routes/analyze', (route) => route.fulfill({ json: { ...response, routes: [{ ...routes[0], streetLamps }] } }));
  await fillTrip(page);
  await page.locator('#submit-button').click();
  await expect(page.locator('#lamp-status')).toContainText('Showing mapped lamps');
  await expect.poll(() => page.evaluate(() => (window as any).__testMap?.getLayoutProperty('lamps-circles', 'visibility'))).toBe('visible');
  expect(await page.evaluate(async () => (await (window as any).__testMap.getSource('lamps').getData()).features.length)).toBe(1);
  await toggle.click();
  await expect.poll(() => page.evaluate(() => (window as any).__testMap.getLayoutProperty('lamps-circles', 'visibility'))).toBe('none');
  await toggle.click();
  await page.screenshot({ path: testInfo.outputPath('mapped-lamps.png'), fullPage: true });
});

test('mapped lamps explain empty data instead of suggesting unlit streets', async ({ page }) => {
  await page.locator('#lamp-toggle').click();
  await fillTrip(page);
  await page.locator('#submit-button').click();
  await expect(page.locator('#lamp-status')).toContainText('No mapped lamp points were returned');
  await expect(page.locator('#lamp-status')).toContainText('does not mean the streets are unlit');
});

test('blank addresses are rejected without sending a route request', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/routes/analyze')) requests++; });
  await page.locator('#start').fill('   ');
  await page.locator('#destination').fill('Marathahalli');
  await page.locator('#submit-button').click();
  await expect(page.locator('#map-error')).toContainText('Spaces alone are not an address');
  await expect(page.locator('#start')).toBeFocused();
  expect(requests).toBe(0);
  await expect(page.locator('#submit-button')).toBeEnabled();
});

test('provider errors are readable and allow retry; empty results do not replace a valid trip', async ({ page }) => {
  await fillTrip(page);
  await page.route('**/api/routes/analyze', (route) => route.fulfill({ status: 503, json: { detail: 'Routing provider temporarily unavailable' } }));
  await page.getByRole('button', { name: 'Compare routes', exact: true }).click();
  await expect(page.locator('#map-error')).toContainText('Routing provider temporarily unavailable');
  await expect(page.locator('#submit-button')).toBeEnabled();
  await page.route('**/api/routes/analyze', (route) => route.fulfill({ json: response }));
  await page.locator('#submit-button').click();
  await expect(page.getByRole('heading', { name: '2 routes to consider' })).toBeVisible();
  await page.route('**/api/routes/analyze', (route) => route.fulfill({ json: { ...response, routes: [] } }));
  await page.locator('#submit-button').click();
  await expect(page.locator('#map-error')).toContainText('No routes were returned');
  await expect(page.getByRole('button', { name: 'Select route 1' })).toBeVisible();
});

test('trip summary copies selected route, with a manual fallback', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copied = text; } } });
  });
  await fillTrip(page);
  await page.locator('#submit-button').click();
  await page.getByRole('button', { name: 'Select route 2' }).click();
  await page.getByRole('button', { name: 'Copy trip summary' }).click();
  await expect(page.locator('#map-error')).toContainText('Trip summary copied');
  const copied = await page.evaluate(() => (window as any).__copied);
  expect(copied).toContain('Route 2');
  expect(copied).toContain('Bellandur → Marathahalli');
  expect(copied).toContain('not live tracking');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('Denied'); } } }); });
  await page.getByRole('button', { name: 'Copy trip summary' }).click();
  await expect(page.getByRole('textbox', { name: 'Trip summary to copy' })).toHaveValue(/Route 2/);
});

test('GPS watches stop on permission error and route changes', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__cleared = [];
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition: (success: Function, error: Function) => { (window as any).__gpsError = error; (window as any).__gpsSuccess = success; return 42; },
      clearWatch: (id: number) => { (window as any).__cleared.push(id); },
    } });
  });
  await fillTrip(page);
  await page.locator('#submit-button').click();
  await page.getByRole('button', { name: 'Start navigation', exact: true }).click();
  await page.evaluate(() => (window as any).__gpsError({ code: 1, PERMISSION_DENIED: 1 }));
  expect(await page.evaluate(() => (window as any).__cleared)).toEqual([42]);
  await expect(page.locator('#map-error')).toContainText('Location permission denied');
  await page.getByRole('button', { name: 'Start navigation', exact: true }).click();
  await page.evaluate(() => (window as any).__gpsSuccess({ coords: { latitude: 12.91, longitude: 77.61, accuracy: 10, heading: null } }));
  await expect(page.locator('#navigation-distance')).not.toHaveText('—');
  await page.getByRole('button', { name: 'Select route 2' }).click();
  expect(await page.evaluate(() => (window as any).__cleared)).toEqual([42, 42]);
  await expect(page.getByRole('button', { name: 'Start navigation', exact: true })).toBeEnabled();
});

test('navigation waits for a slow map and discards GPS updates after stopping', async ({ page }) => {
  let releaseStyle!: () => void;
  const styleGate = new Promise<void>((resolve) => { releaseStyle = resolve; });
  await page.route('https://tiles.openfreemap.org/styles/liberty', async (route) => {
    await styleGate;
    await route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#101923' } }] } });
  });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      (window as any).__gpsCallbacks = [];
      (window as any).__cleared = [];
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        watchPosition: (success: Function) => (window as any).__gpsCallbacks.push(success),
        clearWatch: (id: number) => (window as any).__cleared.push(id),
      } });
    });
    await fillTrip(page);
    await page.locator('#submit-button').click();
    await page.getByRole('button', { name: 'Start navigation', exact: true }).click();
    await page.evaluate(() => (window as any).__gpsCallbacks[0]({ coords: { latitude: 12.91, longitude: 77.61, accuracy: 10, heading: null } }));
    await expect(page.locator('#navigation-status')).toContainText('Waiting for GPS');
    await page.getByRole('button', { name: 'Stop navigation', exact: true }).click();
    releaseStyle();
    await expect.poll(() => page.evaluate(() => !!(window as any).__testMap.getLayer('route-lines'))).toBe(true);
    expect(await page.evaluate(() => !!(window as any).__testMap.getLayer('navigation-remaining-line'))).toBe(false);
    await page.getByRole('button', { name: 'Start navigation', exact: true }).click();
    await page.evaluate(() => (window as any).__gpsCallbacks[0]({ coords: { latitude: 12.91, longitude: 77.61, accuracy: 10, heading: null } }));
    expect(await page.evaluate(() => !!(window as any).__testMap.getLayer('navigation-remaining-line'))).toBe(false);
    await page.evaluate(() => (window as any).__gpsCallbacks[1]({ coords: { latitude: 12.91, longitude: 77.61, accuracy: 10, heading: null } }));
    await expect(page.locator('#navigation-distance')).not.toHaveText('—');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    expect(await page.evaluate(() => (window as any).__cleared)).toEqual([1, 2]);
    await expect(page.getByRole('button', { name: 'Start navigation', exact: true })).toBeEnabled();
  } finally { releaseStyle(); }
});

test('missing mapped signals show unknown instead of invented scores', async ({ page }) => {
  await page.route('**/api/routes/analyze', (route) => route.fulfill({ json: { ...response, routes: [{ ...routes[0], missingSignals: ['streetLighting', 'shops'], nightActivityBreakdown: { components: {}, evidenceCoverage: 0 } }] } }));
  await fillTrip(page);
  await page.locator('#submit-button').click();
  await expect(page.locator('.route-card')).toContainText('Not enough mapped activity data');
  await expect(page.locator('.route-card')).toContainText('mapped street lights');
  await expect(page.locator('.metrics .metric').first()).toContainText('—');
});

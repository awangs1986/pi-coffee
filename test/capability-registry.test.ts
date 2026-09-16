import { expect, it } from 'vitest';
import { registerCapabilityManifest, capabilityManifestRegistrations } from '../src/capabilities/registry.js';
it('discovers registrations across distinct Pi extension API objects sharing an event bus', () => {
 const listeners = new Map<string, Function[]>();
 const events = { on: (key: string, fn: Function) => { listeners.set(key, [...(listeners.get(key) ?? []), fn]); return () => {}; }, emit: (key: string, data: unknown) => { for (const f of listeners.get(key) ?? []) f(data); } };
 const web = { events: { ...events } }, harness = { events: { ...events } };
 registerCapabilityManifest(web, { manifest: { id: 'web', kind: 'pi-extension', origin: 'suite', title: 'Web', summary: 'Search', keywords: [], tools: [], supportedHarness: ['simple'], permissionSummary: '', runnerConformance: 'passed' } });
 expect(capabilityManifestRegistrations(harness).map(x => x.manifest.id)).toEqual(['web']);
 expect(capabilityManifestRegistrations(web)).toHaveLength(1);
});

import type { CapabilityManifest, CapabilityReadiness } from "./catalog.js";
import type { CapabilitySettingsStore, TrustState } from "./settings.js";

export interface CapabilityRegistration {
  manifest: CapabilityManifest;
  initialTrust?: TrustState;
  readiness?: CapabilityReadiness;
  /**
   * Local suite code may ship with an in-repository conformance test. External
   * packages and user manifests must still be confirmed by the Host.
   */
  conformanceSource?: "local" | "host";
}

const registrations = new WeakMap<object, CapabilityRegistration[]>();
const queryEvent = "pi-coffee:capability-catalog:query:v1";
const listening = new WeakSet<object>();
function eventsOf(pi: object): { on: (key: string, handler: (payload: any) => void) => unknown; emit: (key: string, payload: unknown) => void } | undefined {
  return (pi as any).events;
}

/** Register a manifest at an extension factory seam without executing it. */
export function registerCapabilityManifest(pi: object, registration: CapabilityRegistration): void {
  const list = registrations.get(pi) ?? [];
  const existing = list.findIndex((item) => item.manifest.id === registration.manifest.id);
  if (existing >= 0) list[existing] = registration;
  else list.push(registration);
  registrations.set(pi, list);
  const events = eventsOf(pi);
  if (events && !listening.has(pi)) {
    listening.add(pi);
    events.on(queryEvent, (payload) => {
      if (payload && Array.isArray(payload.registrations)) payload.registrations.push(...(registrations.get(pi) ?? []));
    });
  }
}

export function capabilityManifestRegistrations(pi: object): CapabilityRegistration[] {
  const query = { registrations: [...(registrations.get(pi) ?? [])] };
  eventsOf(pi)?.emit(queryEvent, query);
  // Each loaded extension has a distinct API object; the public bus spans their seam.
  const unique = new Map(query.registrations.map(item => [item.manifest.id, item]));
  return [...unique.values()].map((registration) => ({
    ...registration,
    manifest: {
      ...registration.manifest,
      keywords: [...registration.manifest.keywords],
      tools: registration.manifest.tools.map((tool) => ({ ...tool })),
      supportedHarness: [...registration.manifest.supportedHarness],
    },
    ...(registration.readiness === undefined ? {} : {
      readiness: {
        ...registration.readiness,
        missing: [...registration.readiness.missing],
        nextSteps: [...registration.readiness.nextSteps],
      },
    }),
    ...(registration.conformanceSource === undefined ? {} : { conformanceSource: registration.conformanceSource }),
  }));
}

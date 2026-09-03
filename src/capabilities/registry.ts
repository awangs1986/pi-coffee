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

/** Register a manifest at an extension factory seam without executing it. */
export function registerCapabilityManifest(pi: object, registration: CapabilityRegistration): void {
  const list = registrations.get(pi) ?? [];
  const existing = list.findIndex((item) => item.manifest.id === registration.manifest.id);
  if (existing >= 0) list[existing] = registration;
  else list.push(registration);
  registrations.set(pi, list);
}

export function capabilityManifestRegistrations(pi: object): CapabilityRegistration[] {
  return (registrations.get(pi) ?? []).map((registration) => ({
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

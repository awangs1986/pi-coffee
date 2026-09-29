// Test-only network seam: Pi and pi-web-access both replace global fetch at startup.
// Wrap each replacement so the official Serper provider reaches the local fixture.
function withFixture(fetchImpl) {
  const wrapped = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    return fetchImpl(
      url === "https://google.serper.dev/search" && process.env.PI_COFFEE_SERPER_FIXTURE_URL
        ? process.env.PI_COFFEE_SERPER_FIXTURE_URL
        : input,
      init,
    );
  };
  if (fetchImpl.__piWebAccessProxyFetch) wrapped.__piWebAccessProxyFetch = true;
  return wrapped;
}
let currentFetch = withFixture(globalThis.fetch);
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  get() { return currentFetch; },
  set(value) { currentFetch = withFixture(value); },
});

// Inspect a completed provider stream independently of its HTTP status.
export function inspectProviderSse(raw) {
  let finish, usage, error;
  for (const line of String(raw).split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') continue;
    let frame;
    try { frame = JSON.parse(payload); } catch { continue; }
    if (frame.error) {
      const kind = String(frame.error.type ?? 'provider_error');
      const message = String(frame.error.message ?? 'unknown error');
      error = `${kind}: ${message}`;
    }
    if (frame.usage) usage = frame.usage;
    for (const choice of frame.choices ?? [])
      if (choice.finish_reason) finish = choice.finish_reason;
  }
  if (!error && !finish) error = 'incomplete provider stream: missing finish reason';
  return { finish, usage, error };
}

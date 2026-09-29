import { expect, it } from 'vitest';
import { inspectProviderSse } from '../scripts/inspect-provider-sse.mjs';

it('recognizes a provider error frame inside an HTTP 200 stream', () => {
  const raw = [
    'data: {"choices":[{"delta":{"content":"","role":"assistant"},"finish_reason":null}]}',
    'data: {"error":{"message":"incomplete model content","type":"upstream_error"}}',
    'data: [DONE]',
  ].join('\n\n');
  expect(inspectProviderSse(raw)).toEqual({
    finish: undefined, usage: undefined,
    error: 'upstream_error: incomplete model content',
  });
});

it('keeps a finished response separate from a truncated stream', () => {
  const done = 'data: {"choices":[{"finish_reason":"stop"}],"usage":{"total_tokens":4}}\n\ndata: [DONE]';
  expect(inspectProviderSse(done)).toEqual({finish:'stop',usage:{total_tokens:4},error:undefined});
  expect(inspectProviderSse('data: {"choices":[{"delta":{"content":"x"}}]}'))
    .toEqual({finish:undefined,usage:undefined,
      error:'incomplete provider stream: missing finish reason'});
});

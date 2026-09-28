import { expect, it } from 'vitest';
import { resolvePiExtensions } from '../src/pi-extensions.js';

it('leaves subagent installation and loading to native Pi packages', () => {
  expect(resolvePiExtensions({}).filter(path => /[\\/]subagents[\\/]|[\\/]pi-subagents[\\/]/.test(path))).toEqual([]);
});

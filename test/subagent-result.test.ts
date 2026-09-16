import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { boundSubagentResult } from '../src/subagents/result-artifact.js';

describe('bounded parent subagent ingress', () => {
 it('seals Unicode output and huge details before returning a short index with run identity', () => {
  const root = mkdtempSync(join(tmpdir(),'child-result-'));
  try {
   const result = boundSubagentResult('结论'.repeat(20000), { runId:'run-1', results:['HIDDEN_DETAIL'.repeat(2000)] }, root);
   expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
   expect(result.details.runId).toBe('run-1');
   expect(JSON.stringify(result)).not.toContain('HIDDEN_DETAIL');
   const path = result.details.artifactPath as string;
   expect(readFileSync(path,'utf8')).toContain('HIDDEN_DETAIL');
   expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally { rmSync(root,{recursive:true,force:true}); }
 });
 it('fails closed if evidence cannot be written', () => {
  const root = mkdtempSync(join(tmpdir(),'child-result-')); const path=join(root,'file');writeFileSync(path,'x');
  try {
   const result=boundSubagentResult('PRIVATE_OUTPUT'.repeat(1000),undefined,path);
   expect(result.details.isError).toBe(true);expect(JSON.stringify(result)).not.toContain('PRIVATE_OUTPUT');
  } finally { rmSync(root,{recursive:true,force:true}); }
 });
});

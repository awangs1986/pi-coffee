import { describe, expect, it } from 'vitest';
import { scoreConflictProcedure } from '../scripts/score-conflict-procedure.mjs';

const markers = ['CONFLICT-A-0000', 'CONFLICT-B-0000'];
const alternatives = ['flutist', 'politician'];
const boundary = Array.from({ length: 4 }, (_, i) => ({type:'compaction',id:`c${i}`}));
const call = (id:string,name:string,args:Record<string,unknown>) =>
  ({type:'message',message:{role:'assistant',content:[{type:'toolCall',id,name,arguments:args}]}});
const result = (id:string,body:unknown,isError=false) =>
  ({type:'message',message:{role:'toolResult',toolCallId:id,isError,
    content:[{type:'text',text:JSON.stringify(body)}]}});
const chain = (letter:string,marker:string,alternative:string) => {
  const anchor = `session/${letter}/hash`;
  return [
    call(`s${letter}`,'handoff_evidence_search',{query:marker}),
    result(`s${letter}`,{matches:[{role:'user',anchor}]}),
    call(`r${letter}`,'handoff_evidence_read',{anchor}),
    result(`r${letter}`,{role:'user',anchor,integrity:'verified',
      text:`${marker}: the occupation is ${alternative}`}),
  ];
};
const write = call('w','write',{path:'answer.json',content:JSON.stringify({
  status:'uncertain',alternatives,
})});
const written = result('w',{ok:true});

describe('ConflictQA-derived conversation procedure', () => {
  it('requires both conflicting original user sources before the answer write', () => {
    const score = scoreConflictProcedure([
      ...boundary,...chain('a',markers[0],alternatives[0]),
      ...chain('b',markers[1],alternatives[1]),write,written,
    ],markers,alternatives);
    expect(score.valid).toBe(true);
  });

  it('rejects writing after only the first source, even if the second is read later', () => {
    const score = scoreConflictProcedure([
      ...boundary,...chain('a',markers[0],alternatives[0]),write,written,
      ...chain('b',markers[1],alternatives[1]),
    ],markers,alternatives);
    expect(score.valid).toBe(false);
    expect(score.recovered).toEqual([true,false]);
  });

  it('rejects an unverified second source', () => {
    const second = chain('b',markers[1],alternatives[1]);
    second[3] = result('rb',{role:'user',anchor:'session/b/hash',
      integrity:'unverified',text:`${markers[1]}: politician`});
    const score = scoreConflictProcedure([
      ...boundary,...chain('a',markers[0],alternatives[0]),
      ...second,write,written,
    ],markers,alternatives);
    expect(score.valid).toBe(false);
  });

  it('accepts overlapping verified ranges of one searched original before writing', () => {
    const anchor = 'session/a/hash';
    const original = 'preamble CONFLICT-A-0000: the occupation is flutist';
    const score = scoreConflictProcedure([
      ...boundary,
      call('sa','handoff_evidence_search',{query:markers[0]}),
      result('sa',{matches:[{role:'user',anchor}]}),
      call('ra0','handoff_evidence_read',{anchor}),
      result('ra0',{role:'user',anchor,integrity:'verified',start:0,end:20,
        text:original.slice(0,20)}),
      call('ra1','handoff_evidence_read',{anchor,start:18,limit:80}),
      result('ra1',{role:'user',anchor,integrity:'verified',start:18,end:original.length,
        text:original.slice(18)}),
      ...chain('b',markers[1],alternatives[1]),write,written,
    ],markers,alternatives);
    expect(score.recovered).toEqual([true,true]);
    expect(score.valid).toBe(true);
  });

  it('scores fifth-turn recovery without crediting evidence from the earlier turn', () => {
    const earlierUsers = Array.from({length:4}, (_, i) =>
      ({type:'message',message:{role:'user',content:[{type:'text',text:`Turn ${i + 1}`}]}}));
    const fifthUser = {type:'message',message:{role:'user',content:[
      {type:'text',text:'Recover both original sources again.'}]}};
    const earlierOnly = scoreConflictProcedure([
      ...earlierUsers,...boundary,...chain('a',markers[0],alternatives[0]),
      ...chain('b',markers[1],alternatives[1]),write,written,
      fifthUser,
      call('w2','write',{path:'diagnostic-answer.json',content:'{}'}),result('w2',{ok:true}),
    ],markers,alternatives,{startAfter:'fifth-user',answerPath:'diagnostic-answer.json'});
    expect(earlierOnly.valid).toBe(false);
    expect(earlierOnly.recovered).toEqual([false,false]);

    const fresh = scoreConflictProcedure([
      ...earlierUsers,...boundary,...chain('a',markers[0],alternatives[0]),
      ...chain('b',markers[1],alternatives[1]),write,written,
      fifthUser,...chain('c',markers[0],alternatives[0]),
      ...chain('d',markers[1],alternatives[1]),
      call('w2','write',{path:'diagnostic-answer.json',content:'{}'}),result('w2',{ok:true}),
    ],markers,alternatives,{startAfter:'fifth-user',answerPath:'diagnostic-answer.json'});
    expect(fresh.valid).toBe(true);
  });
});

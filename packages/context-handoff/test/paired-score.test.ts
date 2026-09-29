import { describe, expect, it } from 'vitest';
import { scoreTrace } from '../scripts/score-evaluation.mjs';

const marker = 'IDENTIFIER_42';
const expected = {identifier:marker};
const entry = (toolCall: any, result?: any) => [
  {type:'message',message:{role:'assistant',content:[{type:'toolCall',...toolCall}]}},
  ...(result ? [{type:'message',message:{role:'toolResult',...result}}] : []),
];

describe('paired live evaluator', () => {
  it('recognizes split search and read calls after the fourth boundary', () => {
    const entries:any[] = [
      ...Array.from({length:4},(_,i)=>({type:'message',message:{role:'user',content:[{type:'text',text:`turn ${i}`} ]}})),
      ...Array.from({length:4},(_,i)=>({type:'compaction',id:`c${i}`})),
      ...entry({id:'s',name:'handoff_evidence_search',arguments:{query:marker}},
        {toolCallId:'s',toolName:'handoff_evidence_search',isError:false,content:[]}),
      ...entry({id:'r',name:'handoff_evidence_read',arguments:{anchor:'session/source/hash'}},
        {toolCallId:'r',toolName:'handoff_evidence_read',isError:false,content:[]}),
    ];
    const score = scoreTrace({entries,requests:[],events:[],answer:expected,expected,
      boundary:4,requiredSearch:marker,arm:'native',sessionId:'s',actualSessionId:'s'});
    expect(score.procedure).toMatchObject({searchAfter:1,readAfter:1,readAfterSearch:true});
    expect(score.firstFailureStage).toBe('none');
    expect(score.pass).toBe(true);
  });

  it('still requires read to follow search and keeps pre-boundary calls ineligible', () => {
    const entries:any[] = [
      ...entry({id:'early',name:'handoff_evidence_search',arguments:{query:marker}}),
      ...Array.from({length:4},(_,i)=>({type:'message',message:{role:'user',content:[{type:'text',text:`turn ${i}`} ]}})),
      ...Array.from({length:4},(_,i)=>({type:'compaction',id:`c${i}`})),
      ...entry({id:'r',name:'handoff_evidence_read',arguments:{anchor:'session/source/hash'}}),
    ];
    const score = scoreTrace({entries,requests:[],events:[],answer:expected,expected,
      boundary:4,requiredSearch:marker,arm:'native',sessionId:'s',actualSessionId:'s'});
    expect(score.procedure).toMatchObject({searchAfter:0,readAfter:1,readAfterSearch:false});
    expect(score.firstFailureStage).toBe('continuation');
    expect(score.pass).toBe(false);
  });
});

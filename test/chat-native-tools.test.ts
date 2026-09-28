import { expect, it } from 'vitest';
import { chatPayload } from '../src/harness/chat-payload.js';

it('removes late native delegation schemas across provider formats without changing history', () => {
  const messages=[{role:'user',content:'subagents_enable is a tool name'}];
  const payload={messages,tools:[
    {type:'function',function:{name:'subagents_enable'}},
    {name:'subagent'},
    {type:'function',function:{name:'read'}},
    {functionDeclarations:[{name:'bg_wait'},{name:'web_search'}]},
  ],config:{tools:[{functionDeclarations:[{name:'subagent_supervisor'},{name:'write'}]}]}};
  expect(chatPayload(payload)).toEqual({messages,tools:[
    {type:'function',function:{name:'read'}},
    {functionDeclarations:[{name:'web_search'}]},
  ],config:{tools:[{functionDeclarations:[{name:'write'}]}]}});
  expect(payload.tools).toHaveLength(4);
});

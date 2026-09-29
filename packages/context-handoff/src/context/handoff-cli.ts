import { resolveHandoffEvidence } from './handoff.js';
const [packetId,anchorId,offset='0',length='4096']=process.argv.slice(2);
try {
  if(!packetId || !anchorId || !process.env.PI_COFFEE_ROOT_SESSION || !process.env.PI_COFFEE_DATA_ROOT)throw new Error('Usage: handoff-cli <packet-id> <anchor-id> [offset] [length]; requires Conversation environment');
  const evidence=await resolveHandoffEvidence({conversationId:process.env.PI_COFFEE_ROOT_SESSION,dataRoot:process.env.PI_COFFEE_DATA_ROOT,workspace:process.cwd(),packetId,anchorId,offset:Number(offset),length:Number(length)});
  console.log(JSON.stringify(evidence));
}catch(error){console.error(error instanceof Error ? error.message : 'Evidence recovery failed');process.exitCode=1;}

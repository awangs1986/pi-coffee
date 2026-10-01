import type {ExtensionAPI,ExtensionContext} from '@earendil-works/pi-coding-agent';
const ENTRY='coffee-context-window';
type Preset='272k'|'maximum';
/** Opt-in Host control. Native automatic compaction continues to own history. */
export function registerContextWindow(pi:ExtensionAPI):void {
 if(process.env.PI_COFFEE_CONTEXT_CONTROL!=='1')return;
 let preset:Preset='272k',applying=false;
 async function apply(ctx:ExtensionContext){
  if(applying||!ctx.model)return;
  const original=ctx.modelRegistry.find(ctx.model.provider,ctx.model.id)??ctx.model;
  const limit=Math.min(preset==='272k'?272000:500000,original.contextWindow);
  if(ctx.model.contextWindow===limit)return;
  applying=true;
  try{if(!await pi.setModel({...ctx.model,contextWindow:limit}))throw new Error('Cannot apply context window without native model authentication');}
  finally{applying=false;}
 }
 async function restore(_event:unknown,ctx:ExtensionContext){
  const state=ctx.sessionManager.getBranch().filter(e=>e.type==='custom'&&e.customType===ENTRY).at(-1);
  const saved=state?.type==='custom'?(state.data as {preset?:string})?.preset:undefined;
  preset=saved==='maximum'?'maximum':'272k';await apply(ctx);
 }
 pi.on('session_start',restore);pi.on('session_tree',restore);
 pi.on('model_select',async(_event,ctx)=>apply(ctx));
 pi.registerCommand('coffee-context-window',{description:'Host context window control',handler:async(args,ctx)=>{
  if(!ctx.isIdle())throw new Error('Wait for the current turn to finish before changing context');
  const value=args.trim();if(value!=='272k'&&value!=='maximum')throw new Error('Expected 272k or maximum');
  const previous=preset;preset=value;
  try{await apply(ctx);pi.appendEntry(ENTRY,{version:1,preset});}catch(error){preset=previous;throw error;}
 }});
}

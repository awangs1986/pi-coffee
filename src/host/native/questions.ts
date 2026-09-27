import {randomUUID} from 'node:crypto';
import type {UiResponse} from '../../shared/protocol.js';

/** Native question groups stay in their Adapter; the Host sees one correlated dialog at a time. */
export class NativeQuestions {
 private pending=new Map<string,{questions:any[];answers:Record<string,string>;index:number;done:(answers:Record<string,string>,cancelled:boolean)=>void}>();
 constructor(private emit:(event:unknown)=>void){}
 ask(questions:any[],done:(answers:Record<string,string>,cancelled:boolean)=>void){
  if(!questions.length){done({},false);return;}
  this.show({questions,answers:{},index:0,done});
 }
 private show(group:{questions:any[];answers:Record<string,string>;index:number;done:(answers:Record<string,string>,cancelled:boolean)=>void}){
  const q=group.questions[group.index],id=randomUUID();this.pending.set(id,group);
  this.emit({type:'native_request',id,method:'input',title:q.question,message:(q.options??[]).map((o:any)=>`${o.label}: ${o.description??''}`).join('\n'),secret:Boolean(q.isSecret),placeholder:q.multiSelect?'Separate multiple choices with commas':'Type an answer or option label'});
 }
 answer(response:UiResponse){
  const group=this.pending.get(response.id);if(!group)return false;
  if(!response.cancelled && typeof response.value!=='string')throw new Error('Answer text is required');
  this.pending.delete(response.id);
  if(response.cancelled){group.done(group.answers,true);return true;}
  const q=group.questions[group.index];group.answers[q.id??q.question]=response.value!;
  if(++group.index===group.questions.length)group.done(group.answers,false);else this.show(group);
  return true;
 }
 clear(){this.pending.clear();}
}

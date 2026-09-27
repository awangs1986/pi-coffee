// Browser management only. Source fetching, native discovery and file changes belong to Host.
export function initSkills({context,onOpen,onClose,notify}) {
 const $=selector=>document.querySelector(selector),page=$('#skills-page');
 let epoch=0,busy=false,available=false;
 const make=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;};
 const scope=()=>({engine:$('#skills-engine').value,scope:$('#skills-scope').value,...($('#skills-scope').value==='project'?{conversationId:context().id}:{})});
 const request=async value=>{
  const response=await fetch('/api/skills',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  const data=await response.json();if(!response.ok)throw new Error(response.status===404?'此 VM 尚未启用 Skills 管理，请先更新 Host。':data.error||'Skill 操作失败');return data;
 };
 function controls(){
  const task=context(),project=task.kind==='project'&&task.id&&task.engine===$('#skills-engine').value;
  $('#skills-scope').querySelector('option[value="project"]').disabled=!project;
  if(!project)$('#skills-scope').value='user';
  for(const node of page.querySelectorAll('input,select,button'))if(node.id!=='skills-close')node.disabled=busy;
  $('#skills-install').disabled=busy||!available;$('#skills-reload').disabled=busy||!available||!task.id||task.engine!==$('#skills-engine').value;
 }
 function status(message,error=false){$('#skills-status').textContent=message;$('#skills-status').classList.toggle('error',error);}
 function close(){++epoch;page.classList.add('hidden');$('#app').classList.remove('skills-open');onClose?.();}
 function resetDetail(){$('#skill-detail').classList.add('hidden');$('#skill-content').textContent='';}
 async function refresh(){
  const current=++epoch;controls();resetDetail();available=false;$('#skills-list').replaceChildren();status('正在读取 VM Skills…');controls();
  try{
   const data=await request({action:'list',...scope()});if(current!==epoch)return;
   if(!Array.isArray(data.skills))throw new Error('VM 返回了无效的 Skill 列表');
   available=true;$('#skills-directory').textContent=data.directory;render(data.skills);
   status((data.warnings||[]).join(' · ')||'已读取 VM 中的 Skills。');
  }catch(error){if(current===epoch){available=false;status(error.message,true);}}
  finally{if(current===epoch)controls();}
 }
 async function action(kind,item){
  if(busy)return;const current=epoch,target=scope();busy=true;controls();
  try{
   const data=await request({action:kind,...target,...(item?{id:item.id}:{})});if(current!==epoch)return;
   if(kind==='detail'){
    $('#skill-detail').classList.remove('hidden');$('#skill-detail-title').textContent=item.name;$('#skill-content').textContent=data.content;$('#skill-detail').scrollIntoView?.({block:'nearest'});
   }else{await refresh();if(!page.classList.contains('hidden'))status('已保存。新启动的 Agent 会读取变更；当前任务空闲时可点击“重新加载当前任务”。');}
  }catch(error){if(current===epoch)status(error.message,true);else notify(error.message);}
  finally{busy=false;controls();}
 }
 function render(skills){
  const list=$('#skills-list');list.replaceChildren();
  if(!skills.length){list.append(make('p','skills-empty','此范围还没有 Skill。可从 Git 仓库安装。'));return;}
  for(const item of skills){
   const row=make('article','skill-card',''),head=make('div','skill-card-head','');
   head.append(make('h2','',item.name),make('span','skill-state',item.managed?(item.enabled?'已启用':'已停用'):'VM 已有 · 只读'));
   row.append(head,make('p','skill-description',item.description),make('p','skill-path',item.path));
   if(item.repoUrl)row.append(make('p','skill-source',`${item.repoUrl} · ${item.ref} · ${item.revision?.slice(0,12)||'—'}`));
   if(item.modified||item.problem)row.append(make('p','skills-error',item.problem||'检测到本地修改，请先在 VM 处理，管理器不会覆盖。'));
   const actions=make('div','skill-actions','');
   for(const [kind,label] of [['detail','查看'],...(item.managed?[['update','更新'],[item.enabled?'disable':'enable',item.enabled?'停用':'启用']]:[])]){
    const button=make('button','btn small',label);button.type='button';button.dataset.skillAction=kind;button.addEventListener('click',()=>action(kind,item));actions.append(button);
   }row.append(actions);list.append(row);
  }
 }
 async function open(){
  onOpen();$('#skills-engine').value=context().engine||'pi';$('#skills-scope').value='user';page.classList.remove('hidden');$('#app').classList.add('skills-open');await refresh();$('#skills-engine').focus();
 }
 $('#skills-btn').addEventListener('click',open);$('#skills-close').addEventListener('click',()=>{close();$('#brand-menu-btn').focus();});
 for(const id of ['skills-engine','skills-scope'])$('#'+id).addEventListener('change',refresh);
 $('#skills-refresh').addEventListener('click',refresh);
 $('#skill-detail-close').addEventListener('click',resetDetail);
 $('#skills-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!available)return;const current=epoch,target=scope();busy=true;controls();status('正在从 Git 安装到 VM…');
  try{
   await request({action:'install',...target,repoUrl:$('#skill-url').value.trim(),ref:$('#skill-ref').value.trim()||'HEAD',subdir:$('#skill-subdir').value.trim()||'.'});
   if(current!==epoch){notify('Skill 安装已完成。');return;}
   $('#skills-form').reset();await refresh();status('安装完成。下次启动 Agent 时生效；也可重新加载空闲的当前任务。');
  }catch(error){if(current===epoch)status(error.message,true);else notify(error.message);}
  finally{busy=false;controls();}
 });
 $('#skills-reload').addEventListener('click',async()=>{
  if(busy)return;const current=epoch;busy=true;controls();status('正在检查当前任务是否空闲…');
  try{await request({action:'reload',...scope(),conversationId:context().id});if(current===epoch)status('已请求重新加载，历史记录保留；正在运行或有后台工作的任务不会被停止。');}
  catch(error){if(current===epoch)status(error.message,true);}finally{busy=false;controls();}
 });
 return {close,isOpen:()=>!page.classList.contains('hidden')};
}

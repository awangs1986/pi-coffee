// View-only rendering of Host-supplied patches; never reads or changes a checkout.
import { el } from './render.js';
import { highlight, normalizeLang } from './highlight.js';

function patchRows(patch) {
  const rows=[];
  let oldLine=0,newLine=0,inHunk=false;
  for(const line of patch.split('\n')) {
    const hunk=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if(hunk){oldLine=Number(hunk[1]);newLine=Number(hunk[2]);inHunk=true;rows.push({kind:'hunk',text:line});continue;}
    if(!inHunk)continue;
    if(line.startsWith('+'))rows.push({kind:'add',newLine:newLine++,text:line.slice(1)});
    else if(line.startsWith('-'))rows.push({kind:'del',oldLine:oldLine++,text:line.slice(1)});
    else if(line.startsWith(' '))rows.push({kind:'context',oldLine:oldLine++,newLine:newLine++,text:line.slice(1)});
    else if(line.startsWith('\\'))rows.push({kind:'hunk',text:line});
  }
  return rows;
}

export function renderReviewFile(file,patch,layout='unified') {
  const section=el('details','review-file');section.open=true;
  const summary=el('summary','review-file-head');
  const name=el('code','review-file-name',file.path);name.title=file.path;
  const counts=el('span','review-file-counts');
  counts.append(el('span','wt-add','+'+(file.additions ?? 0)),el('span','wt-del','−'+(file.deletions ?? 0)));
  summary.append(name,counts);section.append(summary);
  const rows=patchRows(patch);
  if(!rows.length){section.append(el('p','workspace-empty','该文件没有可显示的文本 Diff（可能为二进制、重命名或内容超限）。'));return section;}
  const scroll=el('div','review-file-scroll'),table=el('table','review-code');table.dataset.layout=layout;table.setAttribute('aria-label',file.path+' Diff');
  const body=el('tbody','');table.append(body);scroll.append(table);section.append(scroll);
  const language=normalizeLang(file.path.split('.').pop());
  const number=(n,kind='')=>el('td','review-line-number '+kind,n===undefined?'':String(n));
  const content=(row,kind='')=>{const cell=el('td','review-code-cell '+kind),code=el('code','');if(row)code.innerHTML=highlight(row.text,language);cell.append(code);return cell;};
  function meta(row){const tr=el('tr','review-hunk'),td=el('td','',row.text);td.colSpan=4;tr.append(td);body.append(tr);}
  if(layout==='split') {
    let removed=[],added=[];
    const pair=(left,right)=>{const tr=el('tr','');tr.append(number(left?.oldLine,left?.kind),content(left,left?.kind),number(right?.newLine,right?.kind),content(right,right?.kind));body.append(tr);};
    const flush=()=>{for(let i=0;i<Math.max(removed.length,added.length);i++)pair(removed[i],added[i]);removed=[];added=[];};
    for(const row of rows){if(row.kind==='del')removed.push(row);else if(row.kind==='add')added.push(row);else{flush();if(row.kind==='hunk')meta(row);else pair(row,row);}}
    flush();
  } else {
    for(const row of rows){if(row.kind==='hunk'){meta(row);continue;}const tr=el('tr',row.kind);tr.append(number(row.oldLine),number(row.newLine),el('td','review-sign',row.kind==='add'?'+':row.kind==='del'?'−':''),content(row));body.append(tr);}
  }
  return section;
}

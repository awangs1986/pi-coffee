import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const plugins=JSON.parse(await readFile(new URL('../plugins.json',import.meta.url),'utf8'));
const action=process.argv[2];
if(!['install','build','check'].includes(action))throw new Error('Use install, build or check');
for(const [name,path] of Object.entries(plugins)){
 console.log(`${name}: ${action}`);
 execFileSync('npm',action==='install'?['ci']:['run',action],{cwd:resolve(root,path),stdio:'inherit'});
}

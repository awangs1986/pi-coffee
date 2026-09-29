import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(process.argv[2] ?? resolve(root,'artifacts'));
const paths=JSON.parse(await readFile(new URL('../plugins.json',import.meta.url),'utf8'));
await mkdir(output,{recursive:true});
const plugins=[];
for(const [id,path] of Object.entries(paths)){
 const cwd=resolve(root,path),manifest=JSON.parse(await readFile(resolve(cwd,'package.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version))throw new Error(`${id} requires an independent semantic version`);
 const [packed]=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',output],{cwd,encoding:'utf8'}));
 // Only built, self-contained artifacts are publishable; npm install never compiles these.
 for(const extension of manifest.pi.extensions){
  if(!packed.files.some(f=>f.path===extension.replace(/^\.\//,'')))throw new Error(`${id}: missing ${extension}; run npm run build`);
 }
 const bytes=await readFile(resolve(output,packed.filename));
 plugins.push({id,name:manifest.name,version:manifest.version,path,tag:`${id}/v${manifest.version}`,file:packed.filename,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),sha256:createHash('sha256').update(bytes).digest('hex')});
}
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
await writeFile(resolve(output,'releases.json'),JSON.stringify({repository:'https://github.com/awangs1986/pi-coffee',sourceCommit,plugins},null,2)+'\n');
await writeFile(resolve(output,'SHA256SUMS'),plugins.map(p=>`${p.sha256}  ${p.file}`).join('\n')+'\n');
console.log(JSON.stringify({sourceCommit,plugins},null,2));

import {readFileSync,writeFileSync,readdirSync,mkdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
const root=resolve(import.meta.dirname,'..'),files=[];
for(const f of ['package.json','package-lock.json','vite.config.js'])files.push(resolve(root,f));
function walk(dir){for(const name of readdirSync(dir)){if(name.startsWith('.')||['node_modules','dist','data','evidence'].includes(name))continue;const file=resolve(dir,name);if(statSync(file).isDirectory())walk(file);else files.push(file);}}
for(const dir of ['web','server','shared','public']){try{walk(resolve(root,dir));}catch{}}
const manifest=JSON.parse(readFileSync(resolve(root,'docs/visuals/manifest.json'),'utf8'));
for(const frame of manifest.frames)files.push(resolve(root,'docs/visuals',frame.file));
for(const f of ['docs/product/solution.md','docs/product/style-guide.md','docs/visuals/manifest.json'])files.push(resolve(root,f));
const result={at:new Date().toISOString(),runId:'FRONTLINE-CHATS-V3-20261023',ownershipEpoch:5,files:files.sort().map(file=>({path:relative(root,file).replaceAll('\\','/'),bytes:statSync(file).size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}))};
mkdirSync(resolve(root,'qa/evidence'),{recursive:true});const out=resolve(root,'qa/evidence',process.argv[2]||'snapshot.json');writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({artifact:out,files:result.files.length}));

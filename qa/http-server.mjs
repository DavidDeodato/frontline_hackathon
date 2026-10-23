import {createApp} from '../server/index.mjs';
import {createProvider} from '../server/provider.mjs';
import {resolve} from 'node:path';
const databasePath=resolve(process.argv[2]);
if(!databasePath.startsWith(resolve(import.meta.dirname,'evidence')+'/')&&!databasePath.startsWith(resolve(import.meta.dirname,'evidence')+'\\'))throw new Error('QA database must stay in qa/evidence');
const app=createApp({databasePath,provider:createProvider({apiKey:'',model:''})});
app.server.listen(0,'127.0.0.1',()=>process.send?.({type:'ready',port:app.server.address().port,pid:process.pid,mode:'fixture'}));
let closing=false;
async function close(){if(closing)return;closing=true;await app.close();process.exit(0);}
process.on('message',message=>{if(message?.type==='close')close().catch(()=>process.exit(1));});
process.on('SIGTERM',()=>close().catch(()=>process.exit(1)));

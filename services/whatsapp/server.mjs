import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import makeWASocket, {useMultiFileAuthState, DisconnectReason} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import {eligible, answer} from './logic.mjs';

const dir = process.env.AUTH_DIR || path.resolve('../../.local/whatsapp/auth');
fs.mkdirSync(dir, {recursive:true});
const admin = process.env.ADMIN_TOKEN;
if (!admin || admin.length < 24 || !process.env.OPENAI_API_KEY) throw new Error('ADMIN_TOKEN >=24 chars and OPENAI_API_KEY required');
const ledgerFile = path.join(dir, '../ledger.json');
let ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile,'utf8')) : {ids:[], calls:0, replies:0, failures:0};
const persist = () => {fs.writeFileSync(ledgerFile+'.tmp',JSON.stringify(ledger),{mode:0o600});fs.renameSync(ledgerFile+'.tmp',ledgerFile);};
let status = 'connecting', qr = null, socket, attempts=0, queue=Promise.resolve();
const started = Date.now();
const log = event => console.log(JSON.stringify({at:new Date().toISOString(),event}));
function authorized(req) {
  if(process.env.HOST==='127.0.0.1' && ['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return true;
  const token = (req.headers.authorization || '').replace(/^Bearer /,'');
  return token.length === admin.length && crypto.timingSafeEqual(Buffer.from(token),Buffer.from(admin));
}
const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frontline · WhatsApp</title><style>body{font:17px system-ui;background:#0d1512;color:#e9f9ef;max-width:580px;margin:7vh auto;padding:24px}img{width:300px;max-width:100%;background:white;border-radius:16px}h1{font-size:36px}p{line-height:1.6}button,input{padding:12px;border-radius:8px;margin:4px}#state{color:#70dfa4}small{color:#adbdb4}</style><h1>Conecte seu assistente.</h1><p>WhatsApp → Aparelhos conectados → Conectar aparelho.</p><div id="login"><input id="key" type="password" placeholder="Chave do painel"><button onclick="setKey()">Entrar</button></div><p id="state">Aguardando acesso</p><img id="qr" hidden><p>Após conectar, envie de <b>outro número</b>:<br><code>!bot preciso praticar atendimento a um cliente irritado</code></p><small>Somente mensagens individuais com !bot. Texto; sem grupos ou histórico. Limite de 30 chamadas neste teste.</small><pre id="counts"></pre><script>let token=location.hash.slice(1)||sessionStorage.getItem('waAdmin')||'';history.replaceState(null,'',location.pathname);function setKey(){token=document.getElementById('key').value;sessionStorage.setItem('waAdmin',token);poll()}async function poll(){if(!token)return;try{const r=await fetch('/admin/status',{headers:{Authorization:'Bearer '+token}});if(!r.ok){document.getElementById('state').textContent='Acesso não autorizado';return}const s=await r.json();document.getElementById('login').hidden=true;document.getElementById('state').textContent=s.status;document.getElementById('qr').hidden=!s.qr;if(s.qr)document.getElementById('qr').src=s.qr;document.getElementById('counts').textContent=JSON.stringify(s.metrics,null,2)}catch{document.getElementById('state').textContent='Reconectando painel...'}}poll();setInterval(poll,2500)</script>`;
http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.url==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,connected:status==='connected'}));}
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(process.env.HOST==='127.0.0.1' ? page.replace("let token=location.hash", "let token='local'||location.hash") : page);}
  if(req.url==='/admin/status' && authorized(req)){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({status,qr:qr ? await QRCode.toDataURL(qr):null,metrics:{calls:ledger.calls,replies:ledger.replies,failures:ledger.failures}}));}
  res.statusCode=401;res.end('Unauthorized');
}).listen(Number(process.env.PORT||8780),process.env.HOST||'0.0.0.0',()=>log('http_ready'));

async function connect(){
  const {state,saveCreds}=await useMultiFileAuthState(dir);
  socket=makeWASocket({auth:state,logger:pino({level:'silent'}),syncFullHistory:false,shouldSyncHistoryMessage:()=>false,markOnlineOnConnect:false});
  socket.ev.on('creds.update',saveCreds);
  socket.ev.on('connection.update',u=>{
    if(u.qr){qr=u.qr;status='scan_qr';log('qr_ready');}
    if(u.connection==='open'){qr=null;status='connected';attempts=0;log('whatsapp_connected');}
    if(u.connection==='close'){
      qr=null;
      const code=u.lastDisconnect?.error?.output?.statusCode;
      status=code===DisconnectReason.loggedOut?'logged_out':'reconnecting';log('whatsapp_'+status);
      if(status!=='logged_out' && attempts++<12)setTimeout(()=>connect().catch(()=>{status='connection_error';log(status)}),Math.min(30000,2000*attempts));
    }
  });
  socket.ev.on('messages.upsert',({messages,type})=>{
    for(const m of messages){
      const item=eligible(m,type);
      if(!item || Number(m.messageTimestamp)*1000<started-10000 || ledger.ids.includes(m.key.id))continue;
      ledger.ids.push(m.key.id);ledger.ids=ledger.ids.slice(-1000);persist();
      queue=queue.then(async()=>{
        if(ledger.calls>=Number(process.env.MAX_CALLS||30))return;
        ledger.calls++;persist();log('request_received');
        try{const text=await answer(item.text);log('model_answered');await socket.sendMessage(item.jid,{text:'🤖 '+text});ledger.replies++;persist();log('reply_sent');}
        catch(e){ledger.failures++;persist();log(/^openai_/.test(e.message)?e.message:'reply_failed');}
      }).catch(()=>log('queue_failed'));
    }
  });
}
connect().catch(()=>{status='connection_error';log(status)});

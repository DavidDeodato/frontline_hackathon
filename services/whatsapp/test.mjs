import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible} from './logic.mjs';
const m=()=>({key:{id:'fixture',remoteJid:'synthetic@s.whatsapp.net',fromMe:false},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:'!bot olá'}});
test('accept direct opt-in',()=>assert.equal(eligible(m(),'notify').text,'olá'));
test('ignore own replies',()=>{const x=m();x.key.fromMe=true;assert.equal(eligible(x,'notify'),null)});
test('ignore groups',()=>{const x=m();x.key.remoteJid='fixture@g.us';assert.equal(eligible(x,'notify'),null)});
test('ignore history',()=>assert.equal(eligible(m(),'append'),null));
test('ignore ordinary chat',()=>{const x=m();x.message.conversation='oi';assert.equal(eligible(x,'notify'),null)});
test('ignore stale message',()=>{const x=m();x.messageTimestamp-=600;assert.equal(eligible(x,'notify'),null)});
import {prepareTraining} from './logic.mjs';
test('handoff preserva contexto e codifica query',()=>{const t='cliente & prazo? # amanhã';const r=prepareTraining(t);assert.equal(decodeURIComponent(r.url.split('brief=')[1]),t);assert.equal(r.brief,t)});
test('handoff limita contexto',()=>assert.throws(()=>prepareTraining('a'.repeat(3000)),/brief_length_invalid/));

test('reject empty brief',()=>assert.throws(()=>prepareTraining(' '),/brief_length_invalid/));

export function eligible(m, type, now = Date.now()) {
  const jid = m.key?.remoteJid || '';
  const text = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
  const timestamp = Number(m.messageTimestamp || 0) * 1000;
  if (type !== 'notify' || !jid.match(/@(s.whatsapp.net|lid)$/) || m.key?.fromMe || now - timestamp > 120000 || !text.startsWith('!bot ')) return null;
  return { jid, text: text.slice(5).trim().slice(0, 4000) };
}
export async function answer(text) {
  if (!text.trim() || text.length > 2000) return 'Envie ap�s !bot um relato fict�cio de 1 a 2000 caracteres. N�o inclu� seu texto em um link porque ele est� vazio ou ultrapassa esse limite.';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(45000),
    headers: {'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: 'Você é o assistente Frontline, plataforma de prática de atendimento profissional. Transforme o relato em um briefing curto para um exercício fictício: dificuldade, objetivo de prática, fatos conhecidos e lacunas. Não invente políticas, estoque, prazos ou autorização. Não reproduza dados pessoais; sugira anonimizar. Não alegue criar treino, sessão ou vincular conta. Diga que o usuário revisará o contexto na plataforma antes de gerar o treino. Responda em português em até 120 palavras, sem URLs; o sistema adicionará o link correto.', input: text, max_output_tokens: 500, store: false})
  });
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const body = await response.json();
  const output = body.output?.flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
  if (!output) throw new Error('openai_empty_output');
  return output + '\n\nRevisar contexto no Frontline (nenhum treino criado ainda):\n' + prepareTraining(text).url;
}

export function prepareTraining(text) {
  const brief = String(text).trim();
  if (!brief || brief.length > 2000) throw new Error('brief_length_invalid');
  return {brief, created: false, url: 'https://frontline-production-4f55.up.railway.app/#/library?brief=' + encodeURIComponent(brief)};
}

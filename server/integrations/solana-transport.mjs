import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { IntegrationError, requireCondition as ensure } from './errors.mjs';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
  const b = Buffer.from(bytes); let n = b.length ? BigInt(`0x${b.toString('hex')}`) : 0n, out = '';
  while (n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of b) { if (byte !== 0) break; out = '1' + out; }
  return out;
}
export function base58Decode(value, expectedSize) {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= 100, 422, 'INVALID_BASE58', 'Identificador de transação inválido.');
  let n = 0n;
  for (const char of value) { const digit = ALPHABET.indexOf(char); ensure(digit >= 0, 422, 'INVALID_BASE58', 'Identificador de transação inválido.'); n = n * 58n + BigInt(digit); }
  const hex = n === 0n ? '' : n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0');
  const leading = value.match(/^1*/)[0].length, result = Buffer.concat([Buffer.alloc(leading), Buffer.from(hex, 'hex')]);
  if (expectedSize !== undefined) ensure(result.length === expectedSize, 422, 'INVALID_BASE58_SIZE', 'Tamanho de identificador inválido.');
  return result;
}
function compact(value) {
  ensure(Number.isInteger(value) && value >= 0 && value <= 65535, 422, 'INVALID_LENGTH', 'Tamanho inválido.');
  const bytes = []; do { let part = value & 0x7f; value >>>= 7; if (value) part |= 0x80; bytes.push(part); } while (value);
  return Buffer.from(bytes);
}
function signerFrom(secretKey) {
  ensure(secretKey instanceof Uint8Array && [32, 64].includes(secretKey.length), 503, 'SIGNER_REQUIRED', 'Configure uma chave de teste Devnet no servidor.');
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(secretKey).subarray(0, 32)]), type: 'pkcs8', format: 'der' });
  const publicKey = createPublicKey(privateKey), bytes = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  if (secretKey.length === 64) ensure(Buffer.from(secretKey).subarray(32).equals(bytes), 503, 'INVALID_SIGNER', 'A chave Devnet está inconsistente.');
  return { privateKey, publicKey, bytes, address: base58Encode(bytes) };
}

export function createSignedMemoTransaction({ secretKey, blockhash, memo }) {
  ensure(typeof memo === 'string' && Buffer.byteLength(memo, 'utf8') <= 400, 422, 'MEMO_TOO_LARGE', 'O registro de integridade excede o limite permitido.');
  const signer = signerFrom(secretKey), data = Buffer.from(memo, 'utf8');
  // Legacy message: one writable signer/payer, one read-only unsigned Memo program.
  const message = Buffer.concat([Buffer.from([1, 0, 1]), compact(2), signer.bytes, base58Decode(MEMO_PROGRAM, 32), base58Decode(blockhash, 32), compact(1), Buffer.from([1]), compact(1), Buffer.from([0]), compact(data.length), data]);
  const signature = sign(null, message, signer.privateKey);
  ensure(verify(null, message, signer.publicKey, signature), 500, 'SIGNATURE_FAILED', 'Falha ao conferir a assinatura local.');
  const rawTransaction = Buffer.concat([compact(1), signature, message]);
  ensure(rawTransaction.length <= 1232, 422, 'TRANSACTION_TOO_LARGE', 'Transação excede o limite da rede.');
  return { rawTransaction: rawTransaction.toString('base64'), message: message.toString('base64'), signature: base58Encode(signature), signer: signer.address };
}

/** Fixed Devnet endpoint, no retries, no network/key loading during import/construction. */
export function createSolanaDevnetTransport({ secretKey, fetchImpl = fetch, allowSend = false, maxFeeLamports = 10000, timeoutMs = 12000 } = {}) {
  ensure(Number.isInteger(maxFeeLamports) && maxFeeLamports > 0 && maxFeeLamports <= 10000, 500, 'INVALID_FEE_LIMIT', 'Teto da taxa de teste inválido.');
  ensure(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, 500, 'INVALID_TIMEOUT', 'Prazo RPC inválido.');
  let sequence = 0;
  const preparedTransactions = new WeakSet();
  async function rpc(method, params = []) {
    try {
      const response = await fetchImpl(DEVNET_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      ensure(response.ok, 503, response.status === 429 ? 'RPC_RATE_LIMIT' : 'RPC_UNAVAILABLE', 'A rede de teste está indisponível.');
      const json = await response.json();
      ensure(!json.error && Object.hasOwn(json, 'result'), 503, 'RPC_REJECTED', 'A rede de teste recusou a operação.');
      return json.result;
    } catch (error) { if (error instanceof IntegrationError) throw error; throw new IntegrationError(503, 'RPC_UNAVAILABLE', 'Não foi possível confirmar a operação na rede de teste.'); }
  }
  async function assertNetwork() { ensure(await rpc('getGenesisHash') === DEVNET_GENESIS, 503, 'WRONG_NETWORK', 'A rede não é a Solana Devnet esperada.'); }
  return {
    mode: 'solana-devnet',
    async prepare({ memo }) {
      ensure(allowSend === true, 403, 'ANCHOR_NOT_AUTHORIZED', 'A ancoragem externa não está autorizada.');
      await assertNetwork();
      const latest = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const tx = createSignedMemoTransaction({ secretKey, blockhash: latest?.value?.blockhash, memo });
      const fee = await rpc('getFeeForMessage', [tx.message, { commitment: 'confirmed' }]);
      ensure(Number.isInteger(fee?.value) && fee.value >= 0 && fee.value <= maxFeeLamports, 503, 'FEE_LIMIT', 'A taxa de teste excede o teto permitido.');
      const balance = await rpc('getBalance', [tx.signer, { commitment: 'confirmed' }]);
      ensure(Number.isInteger(balance?.value) && balance.value >= fee.value, 503, 'INSUFFICIENT_TEST_BALANCE', 'Saldo de teste insuficiente para a taxa.');
      const simulation = await rpc('simulateTransaction', [tx.rawTransaction, { encoding: 'base64', sigVerify: true, replaceRecentBlockhash: false, commitment: 'confirmed' }]);
      ensure(simulation?.value && simulation.value.err === null, 503, 'SIMULATION_FAILED', 'A transação de teste não passou na simulação.');
      const prepared = Object.freeze({ ...tx, feeLamports: fee.value, lastValidBlockHeight: latest.value.lastValidBlockHeight });
      preparedTransactions.add(prepared);
      return prepared;
    },
    async submit(prepared) {
      ensure(allowSend === true, 403, 'ANCHOR_NOT_AUTHORIZED', 'A ancoragem externa não está autorizada.');
      ensure(preparedTransactions.has(prepared), 403, 'UNTRUSTED_TRANSACTION', 'A transação precisa ser preparada e conferida pelo mesmo adapter.');
      preparedTransactions.delete(prepared);
      await assertNetwork();
      const signature = await rpc('sendTransaction', [prepared.rawTransaction, { encoding: 'base64', skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed' }]);
      ensure(signature === prepared.signature, 503, 'SIGNATURE_MISMATCH', 'A rede retornou uma assinatura diferente. Reconcilie o registro antes de tentar novamente.');
      return { signature };
    },
    async inspect({ signature, signer, memo }) {
      base58Decode(signature, 64); base58Decode(signer, 32); await assertNetwork();
      const statuses = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]), status = statuses?.value?.[0];
      if (status?.err) return { status: 'failed', reason: 'TRANSACTION_FAILED' };
      if (!status || !['confirmed', 'finalized'].includes(status.confirmationStatus)) return { status: 'pending' };
      const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
      if (!tx) return { status: 'pending' };
      if (tx.meta?.err) return { status: 'failed', reason: 'TRANSACTION_FAILED' };
      const keys = tx.transaction?.message?.accountKeys || [], instructions = tx.transaction?.message?.instructions || [];
      ensure(tx.transaction?.signatures?.[0] === signature && keys.some(key => key.signer === true && key.pubkey === signer), 503, 'RECEIPT_MISMATCH', 'O recibo não pertence ao signatário esperado.');
      ensure(instructions.length === 1 && instructions[0].programId === MEMO_PROGRAM && instructions[0].parsed === memo, 503, 'RECEIPT_MISMATCH', 'O conteúdo ancorado não corresponde ao registro esperado.');
      ensure(Number.isInteger(tx.slot) && tx.slot >= 0, 503, 'RECEIPT_MISMATCH', 'O recibo não possui bloco válido.');
      return { status: 'confirmed', slot: tx.slot, confirmationStatus: status.confirmationStatus, signature, signer, memo, network: 'solana-devnet' };
    }
  };
}

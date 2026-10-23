export { IntegrationError } from './errors.mjs';
export { createSessionExport, verifySessionExport, canonicalJSON, EXPORT_SCHEMA, CANONICALIZATION } from './export.mjs';
export { createIntegrationStore } from './store.mjs';
export { createWhatsAppAdapter, signBridgePayload, verifyBridgePayload } from './whatsapp.mjs';
export { createDevnetAdapter } from './devnet.mjs';
export { createSolanaDevnetTransport } from './solana-transport.mjs';

export function integrationCapabilities() {
  return {
    contractVersion: 'frontline.integrations/1',
    whatsapp: { available: false, status: 'unlinked', mode: 'disabled', reason: 'ACCOUNT_AND_BRIDGE_REQUIRED', message: 'O vínculo requer uma conta autenticada e uma ponte WhatsApp verificada.' },
    export: { available: true, format: 'frontline.export/1', verification: 'local_sha256' },
    devnet: { available: false, status: 'not_requested', mode: 'disabled', reason: 'EXTERNAL_EXECUTION_NOT_AUTHORIZED', message: 'Ancoragem externa ainda não habilitada. A revisão pode ser exportada e conferida localmente.' }
  };
}

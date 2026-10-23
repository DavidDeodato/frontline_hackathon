export class IntegrationError extends Error {
  constructor(status, code, message) { super(message); this.name = 'IntegrationError'; Object.assign(this, { status, code }); }
}
export function requireCondition(value, status, code, message) {
  if (!value) throw new IntegrationError(status, code, message);
}

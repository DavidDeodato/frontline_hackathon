# Accounts

Local account authentication uses the exercise store's existing SQLite connection. The additive migration is idempotent. No email verification, password reset, OAuth or external delivery is implemented.

`createAccounts({db, secureCookies=false, now=Date.now})` exports:

- `resolve(cookie)`: `{user,owner}` or `null` if no account cookie. Invalid, expired or ambiguous account cookies throw `401 ACCOUNT_SESSION_INVALID`; never catch this to restore an old visitor identity.
- `register({name,email,password},guestOwner?,{cookie,rateKey}?)`: creates a user and session. Visitor ownership is claimed atomically across scenarios, drafts, versions, command receipts, sessions and `help_conversations` when present.
- `login({email,password},{cookie,rateKey}?)`: verifies credentials and rotates the current session. Does not claim visitor data.
- `logout(cookie)`: revokes the current session and expires both account and visitor cookies. Malformed cookies can be cleared through this explicit recovery operation.

Registration/login return internal `{user,owner,setCookies}`. Only `accountEnvelope(result)` is public JSON: `{authenticated,user:null|{id,name,email}}`. Tokens belong solely in `Set-Cookie`, never logs, browser storage or JSON. Session tokens have 256 random bits and only their SHA-256 digests are stored. Expiry is seven days. Cookies use HttpOnly, SameSite=Lax, Path=/ and Secure when configured for HTTPS.

Passwords use asynchronous Node scrypt, a random 16-byte salt, a 64-byte derived key and timing-safe comparison. Parameters N=32768, r=8, p=3, maxmem=64MiB use a [documented OWASP minimum configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt) and the [Node 24 crypto API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback). No normalization or truncation of a submitted password occurs. Login errors for unknown users and incorrect passwords share the same response and KDF work.

Rate limits are stored in SQLite for 15-minute windows: login 5 attempts per normalized email and 20 per server-provided client key; registration 3 per email and 5 per client. Do not use an untrusted forwarded header as the client key. HTTPS deployment, distributed rate limiting and recovery/verification flows are separate integration work.

## HTTP integration

`createAccountHttpHandler({accounts,store,readBody})` returns `async handle(req,res,url)` → `{handled,output?}`. It sets cookie/Retry-After headers but leaves status and JSON serialization to `createApp`.

1. Keep the application's origin check and JSON/body limits.
2. Call the account handler **before** `store.identity` so login/logout can recover from stale cookies without adopting a visitor history.
3. For all remaining owner-scoped routes, use `accounts.resolve(cookie) || store.identity(cookie)`. Do not swallow an invalid account session error.
4. Revalidate identity/ownership immediately before post-await writes. A concurrent signup migrates and removes the old guest; an in-flight create must not persist a new orphan under that deleted guest owner. Coordinate this fence in the core store, which owns those writes.
5. Clear frontend account-dependent caches when identity changes. Only refresh the library after a confirmed auth action.

The handler accepts GET `/api/account` and POST `/api/account/register`, `/api/account/login`, `/api/account/logout`. Request bodies are capped at 8192 bytes. Accounts are not inserted until password derivation completes; the synchronous insert/claim/session transaction either commits fully or rolls back.

Tests use only synthetic identities and isolated SQLite databases: `node --test tests/accounts*.test.mjs`. Core tests exercise database close/reopen and a real Node process replacement with a persisted account session. Adapter tests use offline request/response doubles. They do not establish browser behavior, HTTP server integration or deployment acceptance.

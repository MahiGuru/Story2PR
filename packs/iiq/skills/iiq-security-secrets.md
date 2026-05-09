---
name: iiq-security-secrets
description: Credential and secret handling patterns for IIQ. Loaded via pipeline.iiq.skills.yaml § extra_triggers when a task touches code handling passwords, tokens, session IDs, or API keys. Complements always-on iiq-security-standards.mdc with specific patterns for storage, transmission, logging redaction, and secret lifecycle.
---

# IIQ Security — Secrets Handling

Loaded when a task handles credentials, tokens, session IDs, or API keys.

## Triggering paths / keywords

This skill is added (via `extra_triggers`) when a task's text or file contents include:
- `password`, `credential`, `token`, `apiKey`, `api_key`, `secret`, `sessionId`, `authToken`, `bearer`
- Files under `**/credentials/**`, `**/secrets/**`

## Storage rules

### Passwords

- **At rest:** hashed with `BCrypt` (minimum cost factor 12 on current hardware). NEVER plaintext, NEVER reversible encryption for user passwords.
- **Comparison:** `BCrypt.checkpw(submittedPassword, storedHash)`.
- **Transmission:** HTTPS only (enforced at load balancer). Never in URL query strings, never in GET request bodies that might be logged.

### API tokens / service credentials

- **At rest:** encrypted with project-provided `EncryptionService.encrypt()` (symmetric key from `iiq.properties`). Never plaintext even in DB.
- **In memory:** wipe char[] / byte[] after use if possible. Don't hold tokens as `String` longer than necessary (String is immutable, can't be wiped).

### Session IDs

- **Generation:** `SecureRandom` with minimum 128 bits of entropy — NOT `Random`, NOT `Math.random()`.
- **Storage:** server-side session store keyed by opaque ID. Never store user identity / rights in the cookie itself.
- **Rotation:** regenerate on login, privilege escalation, logout.

## Logging redaction

### Never log raw

```java
// ❌ Plaintext password in logs
log.info("Login attempt: user=" + username + " password=" + password);

// ❌ Session token visible
log.debug("Received request with session: " + sessionToken);

// ❌ API key in error
log.error("API call failed with key " + apiKey + ": " + e.getMessage());
```

### Always redact

```java
// ✅ Redact to constant
log.info("Login attempt: user=" + username + " password=REDACTED");

// ✅ Use utility
log.debug("Received request with session: " + LogUtil.redact(sessionToken));

// ✅ Identify by hash prefix (for correlation without exposing)
log.error("API call failed for key=" + hashPrefix(apiKey, 8) + ": " + e.getMessage());
```

### Exception messages

Exception messages propagated to users MUST NOT echo back secrets:

```java
// ❌ Leaks the submitted password
throw new ValidationException("Password '" + submitted + "' does not meet complexity requirements");

// ✅ Generic
throw new ValidationException("Password does not meet complexity requirements");
```

## Transmission rules

- **HTTPS only** for any endpoint that receives or returns credentials.
- **Authorization header** for bearer tokens, never query string. Query strings land in access logs, referrer headers, and browser history.
- **No storage in localStorage/sessionStorage** in the browser — use httpOnly + Secure cookies for session IDs. Tokens held client-side for API calls go in memory (Angular service state), never persisted.
- **CORS** — authenticated endpoints MUST NOT include `Access-Control-Allow-Origin: *`; specify the exact origin list.

## Configuration files

- `iiq.properties` / environment variables for real secrets.
- `messages.properties` for UI strings ONLY — NEVER secrets, tokens, URLs containing tokens.
- Example config files (`*.example.properties`) MUST use placeholder values: `REPLACE_ME`, `your-token-here`. Real credentials NEVER commit to example files.
- `.env` files MUST be in `.gitignore`.

## Credential lifecycle

- **Rotation:** implement a rotation path for any long-lived credential. Document in the LLD if a new credential type is introduced.
- **Revocation:** deleting a user MUST invalidate all their active sessions AND API tokens.
- **Expiry:** bearer tokens SHOULD have a finite lifetime (e.g. 1 hour) + refresh flow. Session cookies SHOULD expire on browser close OR after configurable idle timeout.

## Third-party libraries / MCP tokens

When adding code that calls a third-party API with a token:
1. The token comes from `iiq.properties` or env — NEVER hardcoded
2. The token value is redacted in any log output
3. The HTTP client is configured to NOT log the `Authorization` header
4. The token is scoped to minimum necessary permissions

## Anti-patterns (Review flags as P0)

```java
// ❌ Plaintext password in code
private static final String ADMIN_PASSWORD = "admin123";

// ❌ Reversible encryption for user passwords
String encrypted = Base64.encode(password.getBytes());   // trivially reversible

// ❌ Token in URL
httpClient.get("https://api.example.com/resource?token=" + apiToken);

// ❌ Logging the full request
log.debug("Request: " + requestAsString);   // may include Authorization header

// ❌ Comparing passwords with String.equals()
if (storedHash.equals(submittedPasswordPlaintext)) { ... }
// ↑ first: not constant-time. second: storedHash shouldn't equal plaintext anyway.
```

## Cross-references

- Always-on rules: `iiq-security-standards.mdc`
- Auth patterns: `iiq-security-auth.md`
- Base Java patterns: `iiq-java-standards.md`

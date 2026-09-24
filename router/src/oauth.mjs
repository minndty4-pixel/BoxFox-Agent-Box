import http from 'node:http';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { assert, safeError, RouterError } from './errors.mjs';

function generatePkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function callbackHtml(message, autoClose = true) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BoxFox Authentication</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; text-align: center; max-width: 420px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5); }
    h2 { margin-top: 0; color: #38bdf8; font-size: 1.25rem; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
    .status { margin-top: 1rem; font-size: 0.8rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h2>BoxFox Authentication</h2>
    <p>${message}</p>
    <div class="status">${autoClose ? 'This window will close automatically...' : 'You can close this tab and return to BoxFox.'}</div>
  </div>
  <script>
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const payload = {
        type: 'oauth_callback',
        code: code || hashParams.get('code'),
        state: state || hashParams.get('state'),
        fullUrl: window.location.href,
      };
      if (window.opener) {
        window.opener.postMessage(payload, '*');
      }
      if (window.BroadcastChannel) {
        const bc = new BroadcastChannel('oauth_callback');
        bc.postMessage(payload);
        bc.close();
      }
    } catch (e) {}
    ${autoClose ? 'setTimeout(() => { try { window.close(); } catch(e){} }, 1500);' : ''}
  </script>
</body>
</html>`;
}

export class OAuthManager {
  constructor({ service, port = 51121, callbackPath = '/oauth-callback', attemptMs = 300000 } = {}) {
    this.service = service;
    this.port = port;
    this.callbackPath = callbackPath;
    this.attemptMs = attemptMs;
    this.attempts = new Map();
    this.server = null;
    this.codexServer = null;
    this.timer = setInterval(() => {
      for (const a of this.attempts.values()) {
        if (['pending', 'exchanging'].includes(a.status) && Date.now() >= a.expires) {
          a.status = 'expired';
          a.controller.abort(new DOMException('Expired', 'TimeoutError'));
        }
        if (Date.now() > a.expires + 300000) this.attempts.delete(a.id);
      }
    }, 1000);
    this.timer.unref();
  }

  projection(a) {
    return {
      id: a.id,
      connectionId: a.connectionId,
      providerId: a.providerId,
      flowType: a.flowType || 'authorization_code',
      status: a.status,
      authorizationUrl: a.authorizationUrl,
      userCode: a.userCode || null,
      verificationUri: a.verificationUri || null,
      expiresAt: new Date(a.expires).toISOString(),
      error: a.error,
    };
  }

  get(id) {
    const a = this.attempts.get(id);
    assert(a, 'Authorization attempt not found.', 'NOT_FOUND', 404);
    return this.projection(a);
  }

  cancel(id) {
    const a = this.attempts.get(id);
    assert(a, 'Authorization attempt not found.', 'NOT_FOUND', 404);
    if (['pending', 'exchanging'].includes(a.status)) {
      a.status = 'cancelled';
      a.controller.abort(new DOMException('Cancelled', 'AbortError'));
    }
    return this.projection(a);
  }

  async listen() {
    if (!this.server?.listening) {
      if (this.listening) await this.listening;
      else {
        this.server = http.createServer((req, res) => {
          this.handleHttpCallback(req, res).catch(() => {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(callbackHtml('Authorization could not be completed. Return to BoxFox.', false));
            }
          });
        });
        this.listening = new Promise((resolve, reject) => {
          this.server.once('error', () => reject(new RouterError('CALLBACK_PORT', 'OAuth callback port 51121 is occupied.', 409)));
          this.server.listen(this.port, '127.0.0.1', resolve);
        }).finally(() => { this.listening = null; });
        await this.listening;
      }
    }

    // Try starting Codex fixed port 1455 listener (best effort)
    if (!this.codexServer?.listening) {
      try {
        const srv = http.createServer((req, res) => {
          this.handleHttpCallback(req, res).catch(() => {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(callbackHtml('Authorization could not be completed. Return to BoxFox.', false));
            }
          });
        });
        await new Promise((resolve, reject) => {
          srv.once('error', reject);
          srv.listen(1455, '127.0.0.1', () => {
            this.codexServer = srv;
            resolve();
          });
        });
      } catch {
        // Port 1455 occupied, manual paste callback URL still works
        this.codexServer = null;
      }
    }
  }

  async start(connectionId) {
    const c = this.service.connection(connectionId);
    const adapter = this.service.providers[c.providerId];
    assert(adapter, 'Provider adapter not found.');

    // If device code flow
    if (adapter.oauthConfig?.flowType === 'device_code' || typeof adapter.startDeviceFlow === 'function') {
      return this.startDeviceFlow(connectionId);
    }

    assert(typeof adapter.buildAuthUrl === 'function' && typeof adapter.exchangeCode === 'function', 'This provider does not use account OAuth.');

    for (const a of this.attempts.values()) {
      if (a.connectionId === connectionId && ['pending', 'exchanging'].includes(a.status)) {
        this.cancel(a.id);
      }
    }

    await this.listen();

    let redirectUri;
    if (c.providerId === 'codex') {
      redirectUri = 'http://localhost:1455/auth/callback';
    } else {
      const actualPort = this.server?.address()?.port || this.port;
      redirectUri = `http://localhost:${actualPort}${this.callbackPath}`;
    }

    const state = randomBytes(32).toString('base64url');
    const pkce = generatePkce();
    const a = {
      id: randomUUID(),
      connectionId,
      providerId: c.providerId,
      revision: c.revision,
      state,
      redirectUri,
      codeVerifier: pkce.verifier,
      status: 'pending',
      expires: Date.now() + this.attemptMs,
      error: null,
      controller: new AbortController(),
    };

    a.authorizationUrl = adapter.buildAuthUrl({
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
    });

    this.attempts.set(a.id, a);
    return this.projection(a);
  }

  async startDeviceFlow(connectionId) {
    const c = this.service.connection(connectionId);
    const adapter = this.service.providers[c.providerId];
    assert(adapter && typeof adapter.startDeviceFlow === 'function', 'Device flow not supported for this provider.');

    for (const a of this.attempts.values()) {
      if (a.connectionId === connectionId && ['pending', 'exchanging'].includes(a.status)) {
        this.cancel(a.id);
      }
    }

    const deviceData = await adapter.startDeviceFlow();
    const a = {
      id: randomUUID(),
      connectionId,
      providerId: c.providerId,
      revision: c.revision,
      flowType: 'device_code',
      userCode: deviceData.userCode,
      verificationUri: deviceData.verificationUri,
      deviceCode: deviceData.deviceCode,
      status: 'pending',
      expires: Date.now() + (deviceData.expiresIn || 900) * 1000,
      error: null,
      controller: new AbortController(),
      authorizationUrl: deviceData.verificationUri,
    };
    this.attempts.set(a.id, a);

    // Run polling in background
    (async () => {
      try {
        const credentials = await adapter.pollDeviceToken({
          deviceCode: deviceData.deviceCode,
          signal: a.controller.signal,
        });
        if (a.status !== 'pending') return;
        a.status = 'exchanging';
        const conn = this.service.connection(a.connectionId);
        this.service.cancelConnection(conn.id);
        // Khoá đầu của ring là đích ghi; connection chưa có ring thì ghi vào dòng
        // của chính nó (xem `credentialRowId`).
        this.service.saveCredential(conn, credentials);
        conn.credentialPresent = true;
        conn.authState = 'ready';
        conn.enabled = true;
        conn.revision++;
        conn.models = [];
        conn.discoveryState = 'pending';
        conn.inferenceState = 'unknown';
        conn.error = null;
        if (credentials.email) conn.email = credentials.email;
        if (credentials.accountLabel) conn.accountLabel = credentials.accountLabel;
        this.service.store.put('connection', conn);
        try {
          await this.service.discover(conn.id, AbortSignal.any([a.controller.signal, AbortSignal.timeout(60000)]));
        } catch (error) {
          a.error = safeError(error).message;
        }
        a.status = 'completed';
      } catch (err) {
        if (a.status === 'pending' || a.status === 'exchanging') {
          a.status = 'failed';
          a.error = safeError(err).message;
        }
      }
    })();

    return this.projection(a);
  }

  async completeExchange(a, code) {
    if (a.status !== 'pending' && a.status !== 'exchanging') {
      throw new RouterError('STALE_RESULT', `Authorization attempt is in ${a.status} state.`, 409);
    }
    a.status = 'exchanging';
    const adapter = this.service.providers[a.providerId] || this.service.providers.antigravity;
    assert(adapter, `No adapter found for provider ${a.providerId}.`);

    const credentials = await adapter.exchangeCode({
      code,
      redirectUri: a.redirectUri,
      codeVerifier: a.codeVerifier,
      signal: a.controller.signal,
    });

    assert(a.status === 'exchanging' && Date.now() < a.expires, 'Authorization attempt cancelled or expired.', 'STALE_RESULT', 409);
    const c = this.service.connection(a.connectionId);
    assert(c.revision === a.revision, 'Account changed during authorization. Start again.', 'STALE_RESULT', 409);

    this.service.cancelConnection(c.id);
    this.service.saveCredential(c, credentials);
    c.credentialPresent = true;
    c.authState = 'ready';
    c.enabled = true;
    c.revision++;
    c.models = [];
    c.discoveryState = 'pending';
    c.inferenceState = 'unknown';
    c.error = null;
    if (credentials.email) {
      c.email = credentials.email;
      c.accountLabel = credentials.accountLabel || credentials.email;
    } else if (credentials.accountLabel) {
      c.accountLabel = credentials.accountLabel;
    }
    this.service.store.put('connection', c);

    try {
      await this.service.discover(c.id, AbortSignal.any([a.controller.signal, AbortSignal.timeout(60000)]));
    } catch (error) {
      a.error = safeError(error).message;
    }

    a.status = 'completed';
    return c;
  }

  async manualCallback(attemptId, callbackInput) {
    const a = this.attempts.get(attemptId);
    assert(a, 'Authorization attempt not found.', 'NOT_FOUND', 404);
    assert(['pending', 'exchanging'].includes(a.status), `Authorization is already ${a.status}.`, 'INVALID_STATE', 400);

    let code = (callbackInput || '').trim();
    if (!code) throw new RouterError('AUTH', 'Authorization code or callback URL is required.', 400);

    if (code.startsWith('http://') || code.startsWith('https://')) {
      try {
        const parsed = new URL(code);
        const urlCode = parsed.searchParams.get('code');
        const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
        const extractedCode = urlCode || hashParams.get('code');
        if (extractedCode) code = extractedCode;
      } catch { /* continue with raw */ }
    }

    try {
      await this.completeExchange(a, code);
      return this.projection(a);
    } catch (error) {
      a.status = 'failed';
      a.error = safeError(error).message;
      throw error;
    }
  }

  async handleHttpCallback(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const url = new URL(req.url, 'http://localhost');
    const validPaths = [this.callbackPath, '/auth/callback', '/callback'];
    if (req.method !== 'GET' || !validPaths.includes(url.pathname)) {
      res.writeHead(404);
      res.end(callbackHtml('Callback path not found.', false));
      return;
    }

    const state = url.searchParams.get('state') || '';
    const stateBytes = Buffer.from(state);

    // Find attempt by state, or if single pending attempt matches provider
    let a = [...this.attempts.values()].find(att =>
      att.status === 'pending' && att.state && stateBytes.length === Buffer.byteLength(att.state) && timingSafeEqual(stateBytes, Buffer.from(att.state))
    );

    if (!a || Date.now() >= a.expires) {
      res.writeHead(400);
      res.end(callbackHtml('Invalid, expired, or already-used authorization state. Return to BoxFox.', false));
      return;
    }

    try {
      assert(!url.searchParams.has('error'), 'Account authorization was declined.', 'AUTH', 401);
      const code = url.searchParams.get('code');
      assert(code && code.length <= 4096, 'Authorization code missing.', 'AUTH', 401);

      await this.completeExchange(a, code);
      res.writeHead(200);
      res.end(callbackHtml('Account authorization completed successfully!'));
    } catch (error) {
      if (a.status === 'exchanging') a.status = 'failed';
      a.error = safeError(error).message;
      res.writeHead(400);
      res.end(callbackHtml(`Authorization failed: ${safeError(error).message}`, false));
    }
  }

  async close() {
    clearInterval(this.timer);
    for (const a of this.attempts.values()) a.controller.abort();
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
    if (this.codexServer) {
      this.codexServer.closeAllConnections();
      await new Promise(resolve => this.codexServer.close(resolve));
    }
  }
}

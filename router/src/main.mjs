import { fileURLToPath } from 'node:url';
import { RouterStore } from './store.mjs';
import { ProviderService } from './service.mjs';
import { RouterEngine } from './engine.mjs';
import { OAuthManager } from './oauth.mjs';
import { createRouterServer } from './server.mjs';
import { createSafeFetch } from './network.mjs';
import { createProviders } from './providers/index.mjs';
import { ModelSyncScheduler } from './model-sync.mjs';

const production = process.argv.includes('--production');
const port = Number(process.env.BOXFOX_ROUTER_PORT || (production ? 3100 : 3101));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid router port.');
const store = new RouterStore();
const service = new ProviderService({ store, providers: createProviders({ fetchImpl: createSafeFetch() }) });
const engine = new RouterEngine({ service });
const oauth = new OAuthManager({ service, port: Number(process.env.BOXFOX_OAUTH_PORT || 51121) });
const modelSync = new ModelSyncScheduler({ service, intervalMs: Number(process.env.BOXFOX_MODEL_SYNC_MS || 6 * 60 * 60 * 1000) });
const server = createRouterServer({ service, engine, oauth, frontendDir: production ? fileURLToPath(new URL('../../frontend/dist', import.meta.url)) : null, allowedOrigins: ['http://localhost:3100', 'http://127.0.0.1:3100', ...(production ? [`http://localhost:${port}`, `http://127.0.0.1:${port}`] : [])], allowedHosts: [`localhost:${port}`, `127.0.0.1:${port}`, 'localhost:3100', '127.0.0.1:3100'] });
server.on('error', async error => { console.error(`BoxFox Router startup failed (${error.code || 'ERROR'}). Check port ${port} and host storage permissions.`); await oauth.close(); store.close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { modelSync.start(); console.log(`BoxFox Router ready: http://localhost:${port}/api/router/health`); });
let closing = false;
async function shutdown() { if (closing) return; closing = true; modelSync.stop(); for (const request of service.active.values()) request.controller.abort(); server.closeAllConnections(); await new Promise(r => server.close(r)); await oauth.close(); store.close(); }
process.on('SIGINT', () => shutdown()); process.on('SIGTERM', () => shutdown());

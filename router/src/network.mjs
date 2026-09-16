import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib';
import { RouterError, assert } from './errors.mjs';

export function forbiddenAddress(address) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (mapped.includes('.')) return forbiddenAddress(mapped);
    const pieces = mapped.split(':');
    if (pieces.length === 2) {
      const bytes = pieces.flatMap(p => { const n = parseInt(p, 16); return [n >> 8, n & 255]; });
      return forbiddenAddress(bytes.join('.'));
    }
  }
  if (isIP(ip) === 4) return ip.startsWith('0.') || ip.startsWith('169.254.') || ip === '100.100.100.200' || Number(ip.split('.')[0]) >= 224;
  if (isIP(ip) === 6) return ip === '::' || ip === 'fd00:ec2::254' || /^fe[89ab]/.test(ip) || /^ff/.test(ip);
  return false;
}
export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new RouterError('INVALID_ENDPOINT', 'Enter a valid HTTP or HTTPS base URL.'); }
  assert(['https:', 'http:'].includes(url.protocol), 'Only HTTP and HTTPS endpoints are supported.');
  assert(!url.username && !url.password && !url.hash, 'Endpoint cannot contain credentials or fragments.');
  assert(!url.search, 'Put authentication in the key field, not the endpoint query.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  assert(!forbiddenAddress(host) && !/^(metadata|metadata\.google\.internal)$/.test(host), 'Endpoint cannot target metadata, link-local or unspecified addresses.');
  return url.toString().replace(/\/$/, '');
}

// Resolve once, validate ALL DNS answers, then pin the selected address to the
// socket. TLS still checks the original hostname. Redirects never change target.
export function createSafeFetch({ resolver = lookup } = {}) {
  return async function safeFetch(input, init = {}) {
    const url = new URL(String(input));
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Invalid provider endpoint.');
    assert(!/^(metadata|metadata\.google\.internal)$/.test(hostname), 'Metadata endpoint is blocked.');
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname, { all: true });
    assert(addresses.length && addresses.every(a => !forbiddenAddress(a.address)), 'DNS resolved to a blocked address.', 'INVALID_ENDPOINT');
    init.signal?.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const headers = Object.fromEntries(new Headers(init.headers));
      headers['accept-encoding'] = 'identity';
      const request = (url.protocol === 'https:' ? https : http).request(url, {
        method: init.method || 'GET', headers,
        lookup: (_hostname, options, cb) => options.all ? cb(null, [addresses[0]]) : cb(null, addresses[0].address, addresses[0].family),
      });
      let responseStream;
      const abort = () => { request.destroy(init.signal.reason); responseStream?.destroy(init.signal.reason); };
      init.signal?.addEventListener('abort', abort, { once: true });
      request.on('error', reject);
      request.on('response', res => {
        responseStream = res;
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          init.signal?.removeEventListener('abort', abort);
          reject(new RouterError('REDIRECT_BLOCKED', 'Provider redirected the request. Configure its final endpoint instead.', 502));
          return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
        const encoding = res.headers['content-encoding'];
        const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
        const body = decoder ? res.pipe(decoder) : res;
        if (decoder) { res.on('error', e => decoder.destroy(e)); responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length'); }
        body.on('close', () => init.signal?.removeEventListener('abort', abort));
        body.on('error', () => {});
        resolve(new Response([204, 205, 304].includes(res.statusCode) || init.method === 'HEAD' ? null : Readable.toWeb(body), { status: res.statusCode, headers: responseHeaders }));
      });
      if (init.body != null) request.write(typeof init.body === 'string' || Buffer.isBuffer(init.body) ? init.body : String(init.body));
      request.end();
    });
  };
}

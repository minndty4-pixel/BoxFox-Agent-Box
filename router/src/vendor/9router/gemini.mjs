// Adapted from 9router open-sse/translator/formats/gemini.js (MIT).
// Source hash and license are recorded in router/port-manifest.json and router/LICENSES/9router-MIT.txt.

export const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  'minLength', 'maxLength', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems',
  'format', 'multipleOf', 'uniqueItems', 'contains', 'unevaluatedProperties', 'unevaluatedItems',
  'contentSchema', 'prefixItems', 'additionalItems', 'default', 'examples', '$schema', '$defs',
  'definitions', '$comment', 'deprecated', 'readOnly', 'writeOnly', 'additionalProperties',
  'propertyNames', 'patternProperties', 'enumDescriptions', 'anyOf', 'oneOf', 'allOf', 'not',
  'dependencies', 'dependentSchemas', 'dependentRequired', 'title', 'optional', 'if', 'then', 'else',
  'contentMediaType', 'contentEncoding', 'cornerRadius', 'fillColor', 'fontFamily', 'fontSize',
  'fontWeight', 'gap', 'padding', 'strokeColor', 'strokeThickness', 'textColor',
];

export function tryParseJSON(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function extractTextContent(content, separator = '') {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join(separator);
}

export function convertOpenAIContentToParts(content) {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      if (part.text) parts.push({ text: part.text });
    } else if (part.type === 'image_url' && part.image_url?.url) {
      const url = part.image_url.url;
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        });
      } else {
        parts.push({
          fileData: {
            fileUri: url,
            mimeType: 'image/jpeg',
          },
        });
      }
    }
  }
  return parts;
}

function walk(value, visitor) {
  if (!value || typeof value !== 'object') return;
  visitor(value);
  // Properties are user-defined field names, not schema keywords.
  for (const child of Object.values(value.properties || {})) walk(child, visitor);
  if (value.items) walk(value.items, visitor);
  for (const key of ['allOf', 'anyOf', 'oneOf']) for (const child of value[key] || []) walk(child, visitor);
}

function convertConstToEnum(schema) {
  walk(schema, node => {
    if (!Array.isArray(node) && node.const !== undefined && !node.enum) node.enum = [node.const];
    delete node.const;
  });
}

function convertEnumValuesToStrings(schema) {
  walk(schema, node => {
    if (!Array.isArray(node) && Array.isArray(node.enum)) {
      node.enum = node.enum.map(value => String(value));
      if (!node.type) node.type = 'string';
    }
  });
}

function mergeAllOf(schema) {
  walk(schema, node => {
    if (Array.isArray(node) || !Array.isArray(node.allOf)) return;
    const properties = { ...(node.properties || {}) };
    const required = new Set(node.required || []);
    for (const item of node.allOf) {
      if (item?.properties) Object.assign(properties, item.properties);
      for (const name of item?.required || []) required.add(name);
    }
    delete node.allOf;
    if (Object.keys(properties).length) node.properties = properties;
    if (required.size) node.required = [...required];
  });
}

function chooseSchema(items) {
  const candidates = (items || []).filter(item => item && item.type !== 'null');
  return candidates.sort((a, b) => Number(Boolean(b.properties || b.type === 'object')) * 3 + Number(Boolean(b.items || b.type === 'array')) * 2 - (Number(Boolean(a.properties || a.type === 'object')) * 3 + Number(Boolean(a.items || a.type === 'array')) * 2))[0] || null;
}

function flattenAlternatives(schema) {
  walk(schema, node => {
    if (Array.isArray(node)) return;
    for (const key of ['anyOf', 'oneOf']) {
      if (!Array.isArray(node[key]) || node[key].length === 0) continue;
      const chosen = chooseSchema(node[key]);
      delete node[key];
      if (chosen) Object.assign(node, chosen);
    }
    if (Array.isArray(node.type)) node.type = node.type.find(type => type !== 'null') || 'string';
    if (node.properties && !node.type) node.type = 'object';
    if (node.type === 'array' && !node.items) node.items = { type: 'string' };
  });
}

function stripUnsupported(schema) {
  walk(schema, node => {
    if (Array.isArray(node)) return;
    if (node.const !== undefined && !node.enum) node.enum = [node.const];
    for (const key of Object.keys(node)) {
      if (UNSUPPORTED_SCHEMA_CONSTRAINTS.includes(key) || key.startsWith('x-')) delete node[key];
    }
  });
}

function cleanRequired(schema) {
  walk(schema, node => {
    if (Array.isArray(node)) return;
    if (Array.isArray(node.required) && node.properties) {
      node.required = node.required.filter(name => Object.prototype.hasOwnProperty.call(node.properties, name));
      if (!node.required.length) delete node.required;
    }
    if (node.type === 'object' && (!node.properties || Object.keys(node.properties).length === 0)) {
      node.properties = { reason: { type: 'string', description: 'Brief explanation' } };
      node.required = ['reason'];
    }
  });
}

export function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const cleaned = structuredClone(schema);
  function resolveRefs(node, seen = new Set()) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const reference = node.$ref;
      if (!reference.startsWith('#/') || seen.has(reference)) throw new TypeError('Only non-cyclic local schema references are supported.');
      const target = reference.slice(2).split('/').reduce((n, key) => n?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], cleaned);
      if (!target) throw new TypeError('Schema reference cannot be resolved.');
      const copy = structuredClone(target); resolveRefs(copy, new Set([...seen, reference])); delete node.$ref; Object.assign(node, copy);
    }
    for (const child of Object.values(node.properties || {})) resolveRefs(child, seen);
    if (node.items) resolveRefs(node.items, seen);
    for (const key of ['allOf', 'anyOf', 'oneOf']) for (const child of node[key] || []) resolveRefs(child, seen);
  }
  resolveRefs(cleaned);
  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);
  mergeAllOf(cleaned);
  flattenAlternatives(cleaned);
  stripUnsupported(cleaned);
  cleanRequired(cleaned);
  return cleaned;
}

export function normalizeGeminiContents(contents) {
  const out = [];
  for (const content of contents || []) {
    if (!content?.role || !Array.isArray(content.parts)) continue;
    const parts = content.parts.filter(part => part && Object.keys(part).length > 0);
    if (!parts.length) continue;
    const last = out.at(-1);
    if (last?.role === content.role) last.parts.push(...parts);
    else out.push({ ...content, parts: [...parts] });
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', parts: [{ text: '...' }] });
  return out;
}

export function sanitizeGeminiFunctionName(name) {
  if (!name) return '_unknown';
  let sanitized = String(name).replace(/[^a-zA-Z0-9_.:\-]/g, '_');
  if (!/^[a-zA-Z_]/.test(sanitized)) sanitized = `_${sanitized}`;
  return sanitized.slice(0, 64);
}

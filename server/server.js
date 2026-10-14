require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const rootDir = path.join(__dirname, '..');
const MAX_IMPORT_PAGES = 10;
const wooCategoryRequirements = {
  Electronics: ['model', 'storage', 'color'],
  Fashion: ['size', 'color', 'material'],
  Home: ['material', 'color', 'dimensions'],
  Accessories: ['material', 'color']
};

app.use(express.json({ limit: '2mb' }));
app.use(express.static(rootDir));

function getWooConfig() {
  const storeUrl = process.env.WOOCOMMERCE_URL;
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!storeUrl && !consumerKey && !consumerSecret) return null;
  if (!storeUrl || !consumerKey || !consumerSecret) {
    throw new Error('Configure WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, and WOOCOMMERCE_CONSUMER_SECRET together on the server.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(storeUrl);
  } catch {
    throw new Error('WOOCOMMERCE_URL must be a valid HTTPS URL.');
  }

  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== 'https:' && !(isLocal && parsedUrl.protocol === 'http:')) {
    throw new Error('WooCommerce credentials may only be sent to an HTTPS store (HTTP is allowed for localhost testing).');
  }

  return {
    baseUrl: `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, '')}/wp-json/wc/v3`,
    storeUrl: parsedUrl.origin,
    consumerKey,
    consumerSecret
  };
}

function getWooMode() {
  try {
    return getWooConfig() ? { mode: 'live', configured: true, storeUrl: new URL(process.env.WOOCOMMERCE_URL).origin } : {
      mode: 'demo',
      configured: false,
      storeUrl: null
    };
  } catch (error) {
    return { mode: 'configuration-error', configured: false, storeUrl: null, message: error.message };
  }
}

function getWooMessage(response, body) {
  if (response.status === 401 || response.status === 403) {
    return 'WooCommerce rejected the credentials or the API key lacks the required permissions.';
  }
  if (response.status === 429) return 'WooCommerce rate limit reached. Wait briefly, then retry.';
  if (response.status >= 500) return `WooCommerce returned server error ${response.status}.`;
  if (body && typeof body.message === 'string') return body.message.slice(0, 500);
  return `WooCommerce request failed with HTTP ${response.status}.`;
}

function normalizeWooTimestamp(value) {
  if (!value) return null;
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
}

async function wooRequest(config, endpoint, { method = 'GET', body } = {}) {
  const url = new URL(`${config.baseUrl}${endpoint}`);
  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      lastError = error;
      if (method === 'GET' && attempt < 2 && (error.name === 'TimeoutError' || error.name === 'TypeError')) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      throw new Error(error.name === 'TimeoutError' ? 'WooCommerce request timed out.' : 'Could not reach the WooCommerce store.');
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (response.status === 429 && attempt < 2) {
      const retryAfter = Math.min(Number(response.headers.get('retry-after')) || 1, 5);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (!response.ok) {
      const error = new Error(getWooMessage(response, data));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  throw lastError || new Error('WooCommerce request failed.');
}

function validateWooProduct(product, customAttributes = []) {
  if (!product || typeof product !== 'object') return 'A product record is required.';
  const required = ['name', 'sku', 'description', 'category', 'brand', ...(wooCategoryRequirements[product.category] || [])];
  const missing = required.filter((field) =>
    !String(field === 'name' || field === 'sku' || field === 'description' || field === 'category' || field === 'brand'
      ? product[field] || ''
      : product.attributes?.[field] || '').trim()
  );
  if (!Number.isFinite(Number(product.price)) || Number(product.price) <= 0) missing.push('price');

  for (const attribute of customAttributes) {
    if (attribute?.required && attribute.category === product.category &&
      !String(product.attributes?.[attribute.name] || '').trim()) {
      missing.push(attribute.name);
    }
  }
  if (missing.length) return `Complete required product information before syncing: ${[...new Set(missing)].join(', ')}.`;

  for (const attribute of customAttributes) {
    if (attribute?.category !== product.category || !Array.isArray(attribute.values) || !attribute.values.length) continue;
    const value = String(product.attributes?.[attribute.name] || '').trim();
    if (value && !attribute.values.some((allowed) => String(allowed).toLowerCase() === value.toLowerCase())) {
      return `${attribute.name} must be one of: ${attribute.values.join(', ')}.`;
    }
  }
  if (product.salePrice != null && product.salePrice !== '' &&
      (!Number.isFinite(Number(product.salePrice)) || Number(product.salePrice) < 0 || Number(product.salePrice) >= Number(product.price))) {
    return 'Sale price must be a valid amount lower than the regular price.';
  }
  if (!Array.isArray(product.images)) return 'Product images must be a list of image URLs.';
  for (const image of product.images) {
    try {
      const url = new URL(image);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('invalid');
    } catch {
      return `Invalid product image URL: ${image}`;
    }
  }
  return null;
}

function toWooProduct(product, categoryId) {
  const wooProduct = {
    name: product.name,
    type: 'simple',
    sku: product.sku,
    description: product.description,
    regular_price: String(Number(product.price)),
    status: product.status === 'Published' ? 'publish' : 'draft',
    categories: categoryId ? [{ id: categoryId }] : [],
    images: (product.images || []).map((src) => ({ src })),
    attributes: Object.entries(product.attributes || {})
      .filter(([name, value]) => name && String(value || '').trim())
      .map(([name, value]) => ({ name, options: [String(value)], visible: true, variation: false })),
    meta_data: [{ key: 'smartpim_brand', value: product.brand }]
  };
  if (product.salePrice != null && product.salePrice !== '') {
    wooProduct.sale_price = String(Number(product.salePrice));
  }
  return wooProduct;
}

async function resolveWooCategory(config, categoryName) {
  if (!categoryName) return null;
  const found = await wooRequest(config, `/products/categories?search=${encodeURIComponent(categoryName)}&per_page=100`);
  if (!Array.isArray(found)) throw new Error('WooCommerce returned an invalid category lookup response.');
  const match = found.find((category) => category.name.toLowerCase() === categoryName.toLowerCase());
  if (match) return match.id;
  const created = await wooRequest(config, '/products/categories', {
    method: 'POST',
    body: { name: categoryName }
  });
  if (!created?.id) throw new Error(`WooCommerce did not return an ID for category "${categoryName}".`);
  return created.id;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'SmartPIM', integrations: { woocommerce: getWooMode(), ai: process.env.AI_API_KEY ? 'live' : 'demo' } });
});

app.get('/api/woocommerce/status', (req, res) => {
  const status = getWooMode();
  res.status(status.mode === 'configuration-error' ? 500 : 200).json(status);
});

app.post('/api/woocommerce/test', async (req, res) => {
  let config;
  try {
    config = getWooConfig();
  } catch (error) {
    return res.status(500).json({ success: false, connected: false, mode: 'configuration-error', message: error.message });
  }
  if (!config) {
    return res.status(503).json({
      success: false,
      connected: false,
      mode: 'demo',
      message: 'Demo mode: configure WooCommerce URL and API credentials in the server environment to test a live connection.'
    });
  }

  try {
    await wooRequest(config, '/products?per_page=1');
    return res.json({ success: true, connected: true, mode: 'live', storeUrl: config.storeUrl, message: 'WooCommerce API connection verified.' });
  } catch (error) {
    return res.status(error.status || 502).json({ success: false, connected: false, mode: 'live', message: error.message });
  }
});

app.get('/api/woocommerce/products', async (req, res) => {
  let config;
  try {
    config = getWooConfig();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  if (!config) return res.status(503).json({ success: false, mode: 'demo', message: 'WooCommerce is not configured on the server.' });

  try {
    const products = [];
    for (let page = 1; page <= MAX_IMPORT_PAGES; page += 1) {
      const batch = await wooRequest(config, `/products?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('WooCommerce returned an invalid product list.');
      products.push(...batch);
      if (batch.length < 100) break;
    }
    if (products.length === MAX_IMPORT_PAGES * 100) {
      return res.status(413).json({ success: false, message: 'Import is limited to 1,000 products per request. Refine the store catalogue before retrying.' });
    }
    return res.json({ success: true, mode: 'live', products });
  } catch (error) {
    return res.status(error.status || 502).json({ success: false, mode: 'live', message: error.message });
  }
});

app.post('/api/woocommerce/sync', async (req, res) => {
  let config;
  try {
    config = getWooConfig();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  if (!config) return res.status(503).json({ success: false, mode: 'demo', message: 'WooCommerce is not configured on the server.' });

  const { product, attributes = [], lastSyncedAt = null, force = false } = req.body || {};
  const validationError = validateWooProduct(product, attributes);
  if (validationError) return res.status(400).json({ success: false, message: validationError });

  try {
    const matches = await wooRequest(config, `/products?sku=${encodeURIComponent(product.sku)}&per_page=1`);
    if (!Array.isArray(matches)) throw new Error('WooCommerce returned an invalid SKU lookup response.');
    const matchingProduct = matches[0];
    if (matchingProduct) {
      const modifiedAt = normalizeWooTimestamp(matchingProduct.date_modified_gmt || matchingProduct.date_modified);
      const baseline = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
      const remoteTime = modifiedAt ? Date.parse(modifiedAt) : NaN;
      if (!force && (!Number.isFinite(remoteTime) || !Number.isFinite(baseline) || remoteTime > baseline)) {
        return res.status(409).json({
          success: false,
          code: 'remote_conflict',
          operation: 'update',
          remoteModifiedAt: modifiedAt,
          message: 'The WooCommerce product has changed since the last confirmed sync, or its modification time cannot be verified. Review/import the WooCommerce version, or explicitly confirm that SmartPIM should overwrite it.'
        });
      }
      const categoryId = await resolveWooCategory(config, product.category);
      const updated = await wooRequest(config, `/products/${matchingProduct.id}`, { method: 'PUT', body: toWooProduct(product, categoryId) });
      return res.json({ success: true, mode: 'live', operation: 'updated', product: updated, syncedAt: new Date().toISOString() });
    }

    const categoryId = await resolveWooCategory(config, product.category);
    const created = await wooRequest(config, '/products', { method: 'POST', body: toWooProduct(product, categoryId) });
    return res.status(201).json({ success: true, mode: 'live', operation: 'created', product: created, syncedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(error.status || 502).json({ success: false, mode: 'live', message: error.message });
  }
});

app.post('/api/ai/generate-description', async (req, res) => {
  const { name, category, brand, attributes = {}, tone = 'Professional' } = req.body || {};
  if (!String(name || '').trim() || !String(category || '').trim()) {
    return res.status(400).json({ success: false, message: 'Product name and category are required to generate a description.' });
  }

  const facts = { name, category, brand: brand || '', attributes };
  if (!process.env.AI_API_KEY) {
    const details = Object.entries(attributes || {}).filter(([, value]) => String(value || '').trim());
    const factualDetails = details.length ? ` Product details provided: ${details.map(([key, value]) => `${key}: ${value}`).join(', ')}.` : '';
    return res.json({
      success: true,
      mode: 'demo',
      description: `${name} is a ${category} product${brand ? ` from ${brand}` : ''}.${factualDetails} Add verified product specifications before publishing.`
    });
  }

  const baseUrl = (process.env.AI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'Write polished ecommerce copy using only the supplied product facts. Do not infer or invent features, materials, performance, benefits, certifications, or specifications. If facts are sparse, keep the copy short and neutral.' },
          { role: 'user', content: `Tone: ${tone}\nVerified product facts: ${JSON.stringify(facts)}` }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'AI provider rejected the configured API key.' :
        response.status === 429 ? 'AI provider rate limit reached. Retry in a moment.' :
          `AI provider request failed with HTTP ${response.status}.`;
      return res.status(response.status === 429 ? 429 : 502).json({ success: false, mode: 'live', message });
    }
    const description = data?.choices?.[0]?.message?.content?.trim();
    if (!description) return res.status(502).json({ success: false, mode: 'live', message: 'AI provider returned no description.' });
    return res.json({ success: true, mode: 'live', description });
  } catch (error) {
    return res.status(502).json({
      success: false,
      mode: 'live',
      message: error.name === 'TimeoutError' ? 'AI provider request timed out.' : 'Could not reach the configured AI provider.'
    });
  }
});

app.post('/api/ai/suggest-attributes', async (req, res) => {
  const { product, missingFields = [] } = req.body || {};
  if (!product || typeof product !== 'object' || !Array.isArray(missingFields)) {
    return res.status(400).json({ success: false, message: 'A product and missing-field list are required.' });
  }
  if (!process.env.AI_API_KEY) {
    return res.json({
      success: true,
      mode: 'demo',
      suggestions: [],
      message: 'Demo mode: no AI suggestions are generated. Enter verified attribute values manually.'
    });
  }

  const sourceFacts = [
    product.name,
    product.category,
    product.brand,
    product.description,
    ...Object.values(product.attributes || {})
  ].filter(Boolean).join(' | ');
  const baseUrl = (process.env.AI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Return JSON only in the shape {"suggestions":[{"field":"...","value":"...","evidence":"..."}]}. Suggest only values that are exact text already present in the supplied product facts. Evidence must be an exact substring supporting the value. Do not infer or invent product specifications. Return an empty list when no exact supported value exists.'
          },
          { role: 'user', content: JSON.stringify({ missingFields, sourceFacts }) }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? 'AI provider rejected the configured API key.' :
        response.status === 429 ? 'AI provider rate limit reached. Retry in a moment.' :
          `AI provider request failed with HTTP ${response.status}.`;
      return res.status(response.status === 429 ? 429 : 502).json({ success: false, mode: 'live', message });
    }

    let parsed;
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    } catch {
      return res.status(502).json({ success: false, mode: 'live', message: 'AI provider returned an invalid suggestion format.' });
    }
    const safeSuggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter((suggestion) => {
        const field = String(suggestion.field || '');
        const value = String(suggestion.value || '').trim();
        const evidence = String(suggestion.evidence || '').trim();
        return missingFields.includes(field) &&
          value && evidence &&
          sourceFacts.toLowerCase().includes(evidence.toLowerCase()) &&
          evidence.toLowerCase().includes(value.toLowerCase());
      })
      .map(({ field, value, evidence }) => ({ field, value, evidence }))
      .slice(0, 10);
    return res.json({ success: true, mode: 'live', suggestions: safeSuggestions });
  } catch (error) {
    return res.status(502).json({
      success: false,
      mode: 'live',
      message: error.name === 'TimeoutError' ? 'AI provider request timed out.' : 'Could not reach the configured AI provider.'
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SmartPIM running on http://localhost:${PORT}`);
  });
}

module.exports = app;

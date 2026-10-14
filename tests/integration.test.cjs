const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const app = require('../server/server.js');

let appServer;
let wooServer;
let appUrl;
let wooUrl;
let products = [];
let categories = [];
let nextProductId = 100;
let nextCategoryId = 20;
const originalEnv = {
  url: process.env.WOOCOMMERCE_URL,
  key: process.env.WOOCOMMERCE_CONSUMER_KEY,
  secret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  aiKey: process.env.AI_API_KEY
};

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

function respond(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}

before(async () => {
  wooServer = http.createServer(async (request, response) => {
    const url = new URL(request.url, wooUrl);
    if (!request.headers.authorization?.startsWith('Basic ')) return respond(response, 401, { message: 'Missing basic auth' });
    if (url.pathname.endsWith('/products/categories') && request.method === 'GET') {
      const search = url.searchParams.get('search')?.toLowerCase() || '';
      return respond(response, 200, categories.filter((item) => item.name.toLowerCase().includes(search)));
    }
    if (url.pathname.endsWith('/products/categories') && request.method === 'POST') {
      const body = await readJson(request);
      const category = { id: nextCategoryId++, name: body.name };
      categories.push(category);
      return respond(response, 201, category);
    }
    if (url.pathname.endsWith('/products') && request.method === 'GET') {
      const sku = url.searchParams.get('sku');
      return respond(response, 200, sku
        ? products.filter((item) => item.sku === sku)
        : products.slice(0, Number(url.searchParams.get('per_page') || 100)));
    }
    if (url.pathname.endsWith('/products') && request.method === 'POST') {
      const body = await readJson(request);
      const product = { id: nextProductId++, ...body, date_modified_gmt: new Date().toISOString() };
      products.push(product);
      return respond(response, 201, product);
    }
    const productId = Number(url.pathname.split('/').pop());
    if (url.pathname.includes('/products/') && request.method === 'PUT') {
      const body = await readJson(request);
      const index = products.findIndex((item) => item.id === productId);
      if (index < 0) return respond(response, 404, { message: 'Not found' });
      products[index] = { ...products[index], ...body, id: productId, date_modified_gmt: new Date().toISOString() };
      return respond(response, 200, products[index]);
    }
    return respond(response, 404, { message: 'Unknown route' });
  });

  const wooPort = await listen(wooServer);
  wooUrl = `http://127.0.0.1:${wooPort}`;
  process.env.WOOCOMMERCE_URL = wooUrl;
  process.env.WOOCOMMERCE_CONSUMER_KEY = 'test-consumer-key';
  process.env.WOOCOMMERCE_CONSUMER_SECRET = 'test-consumer-secret';
  delete process.env.AI_API_KEY;
  await new Promise((resolve) => {
    appServer = app.listen(0, '127.0.0.1', () => {
      appUrl = `http://127.0.0.1:${appServer.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await Promise.all([close(appServer), close(wooServer)]);
  for (const [name, value] of Object.entries({
    WOOCOMMERCE_URL: originalEnv.url,
    WOOCOMMERCE_CONSUMER_KEY: originalEnv.key,
    WOOCOMMERCE_CONSUMER_SECRET: originalEnv.secret,
    AI_API_KEY: originalEnv.aiKey
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function api(path, options) {
  const response = await fetch(`${appUrl}${path}`, options);
  return { response, body: await response.json() };
}

const testProduct = {
  id: 'pim-1',
  name: 'Test mug',
  sku: 'MUG-45000',
  category: 'Accessories',
  brand: 'Test brand',
  description: 'A product description with verified details.',
  price: 45000,
  salePrice: 42000,
  status: 'Published',
  images: ['https://example.test/mug.jpg'],
  attributes: { color: 'Navy', material: 'Steel', Finish: 'Matte' }
};
const attributeDefinitions = [{ name: 'Finish', category: 'Accessories', required: true, values: ['Matte', 'Gloss'] }];

test('WooCommerce test uses backend credentials and does not return them', async () => {
  const { response, body } = await api('/api/woocommerce/test', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(body.connected, true);
  assert.equal(body.mode, 'live');
  assert.equal(JSON.stringify(body).includes('test-consumer-secret'), false);
});

test('sync creates by SKU and updates the existing product on repeat', async () => {
  const created = await api('/api/woocommerce/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: testProduct, attributes: attributeDefinitions })
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.operation, 'created');
  assert.equal(created.body.product.regular_price, '45000');
  assert.equal(created.body.product.sale_price, '42000');
  assert.equal(created.body.product.categories[0].id, 20);
  assert.equal(created.body.product.meta_data[0].value, 'Test brand');

  const updated = await api('/api/woocommerce/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product: { ...testProduct, name: 'Updated test mug' },
      attributes: attributeDefinitions,
      lastSyncedAt: created.body.syncedAt
    })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.operation, 'updated');
  assert.equal(updated.body.product.name, 'Updated test mug');
  assert.equal(products.length, 1);
});

test('sync requires confirmation when WooCommerce changed after the last sync', async () => {
  const response = await api('/api/woocommerce/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: testProduct, attributes: attributeDefinitions, lastSyncedAt: '2000-01-01T00:00:00.000Z' })
  });
  assert.equal(response.response.status, 409);
  assert.equal(response.body.code, 'remote_conflict');
});

test('sync rejects incomplete category and custom required attributes', async () => {
  const response = await api('/api/woocommerce/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product: { ...testProduct, attributes: { color: 'Navy', material: 'Steel' } },
      attributes: attributeDefinitions
    })
  });
  assert.equal(response.response.status, 400);
  assert.match(response.body.message, /Finish/);
});

test('import returns WooCommerce products and demo AI output stays fact-bound', async () => {
  const imported = await api('/api/woocommerce/products');
  assert.equal(imported.response.status, 200);
  assert.equal(imported.body.products.length, 1);

  const ai = await api('/api/ai/generate-description', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test mug', category: 'Accessories', brand: 'Test brand', attributes: { material: 'Steel' } })
  });
  assert.equal(ai.response.status, 200);
  assert.equal(ai.body.mode, 'demo');
  assert.match(ai.body.description, /material: Steel/);
  assert.doesNotMatch(ai.body.description, /leak-proof|dishwasher safe/i);
});

test('partially configured WooCommerce credentials are reported as a configuration error', async () => {
  delete process.env.WOOCOMMERCE_CONSUMER_SECRET;
  const { response, body } = await api('/api/woocommerce/test', { method: 'POST' });
  assert.equal(response.status, 500);
  assert.equal(body.connected, false);
  assert.equal(body.mode, 'configuration-error');
});

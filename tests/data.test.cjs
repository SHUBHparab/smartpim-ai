const assert = require('node:assert/strict');
const { test } = require('node:test');

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};

test('empty state is persisted and price formatting uses INR without conversion', async () => {
  const data = await import('../js/data.js');
  const state = data.getState();
  assert.deepEqual(state.products, []);
  assert.equal(data.formatCurrency(45000), '₹45,000.00');
  assert.deepEqual(JSON.parse(storage.get(data.STORAGE_KEY)).products, []);
});

test('required custom fields and allowed values are used for completeness and validation', async () => {
  const data = await import('../js/data.js');
  const definitions = [{ id: 'finish', name: 'Finish', category: 'Accessories', required: true, values: ['Matte', 'Gloss'] }];
  const product = {
    name: 'Test product',
    sku: 'TEST-001',
    description: 'A verified product description with enough content.',
    category: 'Accessories',
    brand: 'Example',
    price: 45000,
    salePrice: 44000,
    attributes: { color: 'Navy', material: 'Steel', Finish: 'Matte' },
    images: []
  };
  assert.equal(data.calculateCompleteness(product, definitions), 100);
  assert.deepEqual(data.validateProduct(product, definitions), []);
  assert.match(data.validateProduct({ ...product, attributes: { ...product.attributes, Finish: 'Chrome' } }, definitions).join(' '), /Finish must be one of/);
  assert.match(data.validateProduct({ ...product, salePrice: 45000 }, definitions).join(' '), /Sale price/);
});

test('saved browser state excludes integration credentials', async () => {
  const data = await import('../js/data.js');
  data.saveState({
    products: [],
    attributes: [],
    integration: {
      status: 'Not connected',
      consumerKey: 'must-not-persist',
      consumerSecret: 'must-not-persist'
    },
    syncLogs: [],
    activityLogs: []
  });
  const serialized = storage.get(data.STORAGE_KEY);
  assert.equal(serialized.includes('must-not-persist'), false);
  assert.equal(serialized.includes('consumerSecret'), false);
});

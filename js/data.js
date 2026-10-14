export const STORAGE_KEY = 'smartpim_state_v1';

export const categoryRules = {
  Electronics: ['brand', 'model', 'storage', 'color', 'price'],
  Fashion: ['brand', 'size', 'color', 'material', 'price'],
  Home: ['brand', 'material', 'color', 'dimensions', 'price'],
  Accessories: ['brand', 'material', 'color', 'price'],
};

const LEGACY_DEMO_PRODUCT_IDS = ['prod-1001', 'prod-1002', 'prod-1003', 'prod-1004', 'prod-1005', 'prod-1006', 'prod-1007', 'prod-1008'];
const LEGACY_DEMO_PRODUCT_NAMES = [
  'Aster X9 SmartPhone',
  'Nexa Pro Laptop',
  'Harbor Knit Set',
  'Halo Table Lamp',
  'Summit Travel Backpack',
  'Velora Smart Watch',
  'Terra Ceramic Bowl Set',
  'Orchid Leather Tote'
];

function hasLegacyDemoData(state) {
  if (!state) return false;
  const products = Array.isArray(state.products) ? state.products : [];
  const ids = products.map((product) => product.id).filter(Boolean);
  const names = products.map((product) => product.name).filter(Boolean);
  const hasLegacyIds = ids.some((id) => LEGACY_DEMO_PRODUCT_IDS.includes(id));
  const hasLegacyNames = names.some((name) => LEGACY_DEMO_PRODUCT_NAMES.includes(name));
  return hasLegacyIds || hasLegacyNames;
}

export function getDefaultState() {
  return {
    products: [],
    attributes: [],
    integration: {
      status: 'Not connected',
      lastSync: null,
      mode: 'demo',
      logs: []
    },
    syncLogs: [],
    activityLogs: []
  };
}

export function enrichProduct(product = {}, attributes = []) {
  const baseProduct = {
    ...product,
    attributes: product.attributes || {},
    images: product.images || [],
    price: Number(product.price || 0),
    salePrice: product.salePrice ? Number(product.salePrice) : null,
    completeness: product.completeness || calculateCompleteness(product, attributes),
    syncStatus: product.syncStatus || 'Queued',
    status: product.status || 'Draft'
  };
  baseProduct.completeness = calculateCompleteness(baseProduct, attributes);
  return baseProduct;
}

export function seedState() {
  const defaultState = getDefaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultState));
  return defaultState;
}

export function getState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const emptyState = getDefaultState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyState));
      return emptyState;
    }

    const parsed = JSON.parse(saved);
    const attributes = Array.isArray(parsed.attributes) ? parsed.attributes : [];
    const normalized = {
      ...getDefaultState(),
      ...parsed,
      products: Array.isArray(parsed.products) ? parsed.products.map((product) => enrichProduct(product, attributes)) : [],
      attributes,
      integration: {
        status: parsed.integration?.status || 'Not connected',
        lastSync: parsed.integration?.lastSync || null,
        mode: parsed.integration?.mode || 'demo',
        logs: Array.isArray(parsed.integration?.logs) ? parsed.integration.logs : []
      },
      syncLogs: Array.isArray(parsed.syncLogs) ? parsed.syncLogs : [],
      activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : []
    };

    if (parsed.integration?.consumerKey || parsed.integration?.consumerSecret) {
      saveState(normalized);
    }

    if (hasLegacyDemoData(normalized)) {
      const cleaned = getDefaultState();
      cleaned.products = [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      return cleaned;
    }

    return normalized;
  } catch (error) {
    const emptyState = getDefaultState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyState));
    return emptyState;
  }
}

export function saveState(state) {
  const safeState = {
    ...state,
    integration: {
      status: state.integration?.status || 'Not connected',
      lastSync: state.integration?.lastSync || null,
      mode: state.integration?.mode || 'demo',
      logs: Array.isArray(state.integration?.logs) ? state.integration.logs : []
    }
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
}

function getRequiredFields(product = {}, attributes = []) {
  const categoryKey = product.category || 'Electronics';
  return [...new Set([
    'name',
    'sku',
    'description',
    'brand',
    'category',
    'price',
    ...(categoryRules[categoryKey] || []),
    ...attributes
      .filter((attribute) => attribute.required && attribute.category === categoryKey)
      .map((attribute) => attribute.name)
  ])];
}

export function calculateCompleteness(product = {}, attributes = []) {
  const requiredFields = getRequiredFields(product, attributes);
  let filled = 0;

  requiredFields.forEach((field) => {
    const value = product[field];
    if (field === 'price') {
      if (Number(value) > 0) filled += 1;
      return;
    }

    if (field === 'name' || field === 'sku' || field === 'description' || field === 'category' || field === 'brand') {
      if (String(value || '').trim()) filled += 1;
      return;
    }

    if (product.attributes && product.attributes[field]) {
      if (String(product.attributes[field]).trim()) filled += 1;
    } else if (value && String(value).trim()) {
      filled += 1;
    }
  });

  const total = requiredFields.length || 1;
  const percent = Math.round((filled / total) * 100);
  return Math.max(0, Math.min(100, percent));
}

export function getMissingFields(product = {}, attributes = []) {
  return getRequiredFields(product, attributes).filter((field) => {
    if (field === 'price') return Number(product.price || 0) <= 0;
    if (field === 'name' || field === 'sku' || field === 'description' || field === 'category' || field === 'brand') {
      return !String(product[field] || '').trim();
    }
    return !(product.attributes && product.attributes[field] && String(product.attributes[field]).trim()) && !(product[field] && String(product[field]).trim());
  });
}

export function validateProduct(product = {}, attributes = []) {
  const errors = [];
  const missingFields = getMissingFields(product, attributes);
  if (missingFields.length) errors.push(`Complete required fields: ${missingFields.join(', ')}.`);

  if (!Number.isFinite(Number(product.price)) || Number(product.price) <= 0) {
    errors.push('Regular price must be a number greater than zero.');
  }
  if (product.salePrice != null && product.salePrice !== '' &&
      (!Number.isFinite(Number(product.salePrice)) || Number(product.salePrice) < 0 || Number(product.salePrice) >= Number(product.price))) {
    errors.push('Sale price must be a valid amount lower than the regular price.');
  }

  for (const definition of attributes) {
    if (definition.category !== product.category || !Array.isArray(definition.values) || !definition.values.length) continue;
    const value = String(product.attributes?.[definition.name] || '').trim();
    if (value && !definition.values.some((allowed) => allowed.toLowerCase() === value.toLowerCase())) {
      errors.push(`${definition.name} must be one of: ${definition.values.join(', ')}.`);
    }
  }

  for (const image of product.images || []) {
    try {
      const url = new URL(image);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('invalid');
    } catch {
      errors.push(`Image URL is invalid: ${image}`);
    }
  }
  return errors;
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

export function getStatusLabel(product) {
  if (product.status === 'Published') return 'Published';
  if (product.status === 'Ready to Publish') return 'Ready to Publish';
  if (product.completeness >= 90) return 'Ready to Publish';
  return 'Draft';
}

export function appendActivity(state, message, type = 'system') {
  state.activityLogs = [
    { id: `activity-${Date.now()}`, message, timestamp: new Date().toISOString(), type },
    ...state.activityLogs
  ].slice(0, 12);
}

export function appendSyncLog(state, message, level = 'info') {
  state.syncLogs = [
    { id: `sync-${Date.now()}`, message, timestamp: new Date().toISOString(), status: level },
    ...state.syncLogs
  ].slice(0, 12);
}

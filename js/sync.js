import {
  getState,
  saveState,
  appendActivity,
  appendSyncLog,
  calculateCompleteness,
  validateProduct
} from './data.js';

const syncSummaryGrid = document.querySelector('#sync-summary-grid');
const fieldMappingList = document.querySelector('#field-mapping-list');
const progressBar = document.querySelector('#sync-progress-bar');
const progressLabel = document.querySelector('#sync-progress-label');
const syncLogList = document.querySelector('#sync-log-list');
const retrySyncBtn = document.querySelector('#retry-sync-btn');
const syncSelectedBtn = document.querySelector('#sync-selected-btn');
const syncProductSelect = document.querySelector('#sync-product-select');
const syncStatusMessage = document.querySelector('#sync-status-message');
const woocommerceStatus = document.querySelector('#woocommerce-status');
const testConnectionBtn = document.querySelector('#test-connection-btn');
const importProductsBtn = document.querySelector('#import-products-btn');
const refreshStatusBtn = document.querySelector('#save-settings-btn');

function renderSyncSummary() {
  const state = getState();
  const products = state.products || [];
  const total = products.length;
  const success = products.filter((product) => product.syncStatus === 'Synced').length;
  const failed = products.filter((product) => product.syncStatus === 'Failed' || product.syncStatus === 'Needs Review').length;
  const queued = products.filter((product) => product.syncStatus === 'Queued').length;
  const progress = total ? Math.round((success / total) * 100) : 0;
  const cards = [
    { label: 'Queued', value: queued },
    { label: 'Synced', value: success },
    { label: 'Failed', value: failed },
    { label: 'Manual Review', value: products.filter((product) => product.completeness < 80).length }
  ];

  syncSummaryGrid.innerHTML = cards
    .map((card) => `
      <div class="metric-card">
        <div class="metric-head">
          <span class="label">${card.label}</span>
          <span class="icon-pill">⇄</span>
        </div>
        <div class="value">${card.value}</div>
        <div class="delta">${card.label === 'Synced' ? `${progress}% synced` : 'Status updated'}</div>
      </div>
    `)
    .join('');
  progressBar.style.width = `${progress}%`;
  progressLabel.textContent = `${progress}% complete`;
}

function renderProductOptions() {
  const previous = new Set([...syncProductSelect.selectedOptions].map((option) => option.value));
  const products = getState().products || [];
  syncProductSelect.replaceChildren();
  products.forEach((product) => {
    const option = new Option(`${product.name} (${product.sku})`, product.id);
    option.selected = previous.has(product.id);
    syncProductSelect.add(option);
  });
}

function renderFieldMapping() {
  const mapping = [
    ['PIM Product Name', 'WooCommerce Product Name'],
    ['PIM SKU', 'WooCommerce SKU'],
    ['PIM Description', 'WooCommerce Description'],
    ['PIM Regular and Sale Price', 'WooCommerce Regular and Sale Price'],
    ['PIM Category', 'WooCommerce Categories'],
    ['PIM Images and Attributes', 'WooCommerce Images and Attributes']
  ];
  fieldMappingList.innerHTML = mapping
    .map(([source, target]) => `
      <div class="mapping-row">
        <strong>${source}</strong>
        <span>→</span>
        <span>${target}</span>
      </div>
    `)
    .join('');
}

function normalizeWooTimestamp(value) {
  if (!value) return null;
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function renderSyncLogs() {
  const logs = getState().syncLogs || [];
  syncLogList.innerHTML = logs.length
    ? logs.slice(0, 8).map((log) => `
      <div class="sync-log-item">
        <div><strong>${log.message}</strong></div>
        <div class="meta">${new Date(log.timestamp).toLocaleString()}</div>
      </div>
    `).join('')
    : '<div class="warning-item"><div><strong>No synchronization activity yet</strong><small>Verified results will appear here after a connection or sync attempt.</small></div></div>';
}

async function parseResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    const error = new Error(result.message || `Request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = result.code;
    error.payload = result;
    throw error;
  }
  return result;
}

async function refreshConnectionStatus(showMessage = false) {
  try {
    const status = await parseResponse(await fetch('/api/woocommerce/status'));
    const state = getState();
    state.integration.mode = status.mode;
    state.integration.status = status.configured
      ? `Configured (${status.mode === 'live' ? 'live' : status.mode})`
      : status.mode === 'configuration-error' ? 'Configuration error' : 'Not connected (demo mode)';
    saveState(state);
    woocommerceStatus.textContent = status.configured
      ? `Live mode configured for ${status.storeUrl}. Connection has not been tested yet.`
      : status.message || 'Demo mode: configure WooCommerce credentials in the server environment.';
    if (showMessage) syncStatusMessage.textContent = woocommerceStatus.textContent;
    window.smartPIM.renderDashboard();
  } catch (error) {
    woocommerceStatus.textContent = `Could not read server connection status: ${error.message}`;
  }
}

async function testConnection() {
  testConnectionBtn.disabled = true;
  woocommerceStatus.textContent = 'Testing WooCommerce connection…';
  try {
    const result = await parseResponse(await fetch('/api/woocommerce/test', { method: 'POST' }));
    woocommerceStatus.textContent = result.message;
    const state = getState();
    state.integration.mode = result.mode;
    state.integration.status = result.connected ? 'Connected (live)' : 'Not connected (demo mode)';
    saveState(state);
    window.smartPIM.renderDashboard();
  } catch (error) {
    woocommerceStatus.textContent = error.message;
    const state = getState();
    state.integration.status = error.payload?.mode === 'demo' ? 'Not connected (demo mode)' : 'Connection failed';
    saveState(state);
    window.smartPIM.renderDashboard();
  } finally {
    testConnectionBtn.disabled = false;
  }
}

function mapImportedProduct(wooProduct, existing = null) {
  const attributes = Object.fromEntries((wooProduct.attributes || []).map((attribute) => [
    attribute.name,
    (attribute.options || []).join(', ')
  ]));
  const brand = wooProduct.meta_data?.find((item) => item.key === 'smartpim_brand')?.value ||
    attributes.Brand || attributes.brand || '';
  delete attributes.Brand;
  delete attributes.brand;
  const product = {
    ...(existing || {}),
    id: existing?.id || `woo-${wooProduct.id}`,
    wooCommerceId: wooProduct.id,
    name: wooProduct.name || '',
    sku: wooProduct.sku || '',
    description: wooProduct.description || '',
    category: wooProduct.categories?.[0]?.name || existing?.category || 'Uncategorized',
    brand,
    price: Number(wooProduct.regular_price || wooProduct.price || 0),
    salePrice: wooProduct.sale_price ? Number(wooProduct.sale_price) : null,
    status: wooProduct.status === 'publish' ? 'Published' : 'Draft',
    images: (wooProduct.images || []).map((image) => image.src).filter(Boolean),
    attributes,
    syncStatus: 'Synced',
    lastUpdated: normalizeWooTimestamp(wooProduct.date_modified_gmt || wooProduct.date_modified) || new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
    wooModifiedAt: normalizeWooTimestamp(wooProduct.date_modified_gmt || wooProduct.date_modified)
  };
  product.completeness = calculateCompleteness(product, getState().attributes || []);
  return product;
}

async function importProducts() {
  importProductsBtn.disabled = true;
  syncStatusMessage.textContent = 'Retrieving products from WooCommerce…';
  try {
    const result = await parseResponse(await fetch('/api/woocommerce/products'));
    const state = getState();
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    result.products.forEach((remoteProduct) => {
      const linkedProduct = state.products.find((product) =>
        String(product.wooCommerceId || '') === String(remoteProduct.id)
      );
      if (linkedProduct) {
        Object.assign(linkedProduct, mapImportedProduct(remoteProduct, linkedProduct));
        updated += 1;
        return;
      }

      const skuMatch = state.products.find((product) =>
        product.sku?.toLowerCase() === String(remoteProduct.sku || '').toLowerCase()
      );
      if (skuMatch) {
        skipped += 1;
        return;
      }

      state.products.push(mapImportedProduct(remoteProduct));
      imported += 1;
    });

    state.integration.lastSync = new Date().toISOString();
    state.integration.status = 'Connected (live)';
    state.integration.mode = 'live';
    if (imported || updated) {
      appendActivity(state, `WooCommerce import: ${imported} added, ${updated} updated.`, 'sync');
    }
    appendSyncLog(state, `WooCommerce import finished: ${imported} added, ${updated} updated, ${skipped} existing SKU conflicts skipped.`, 'success');
    saveState(state);
    syncStatusMessage.textContent = `Imported ${imported}; updated ${updated}; skipped ${skipped} existing SKU conflict${skipped === 1 ? '' : 's'}.`;
    renderProductOptions();
    renderSyncSummary();
    renderSyncLogs();
    window.smartPIM.renderDashboard();
    document.dispatchEvent(new CustomEvent('smartpim:products-changed'));
  } catch (error) {
    syncStatusMessage.textContent = `Import failed: ${error.message}`;
    const state = getState();
    appendSyncLog(state, `WooCommerce import failed: ${error.message}`, 'error');
    saveState(state);
    renderSyncLogs();
  } finally {
    importProductsBtn.disabled = false;
  }
}

async function requestProductSync(product, attributes, force = false) {
  const state = getState();
  const response = await fetch('/api/woocommerce/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product,
      attributes,
      lastSyncedAt: product.lastSyncedAt || null,
      force
    })
  });
  return parseResponse(response);
}

async function syncSelectedProducts(onlyFailed = false) {
  const state = getState();
  const selectedIds = new Set([...syncProductSelect.selectedOptions].map((option) => option.value));
  const selected = (state.products || []).filter((product) =>
    (onlyFailed
      ? (product.syncStatus === 'Failed' || product.syncStatus === 'Needs Review')
      : selectedIds.has(product.id))
  );

  if (!selected.length) {
    syncStatusMessage.textContent = onlyFailed
      ? 'There are no failed products to retry.'
      : 'Select one or more products to synchronize.';
    return;
  }

  syncSelectedBtn.disabled = true;
  retrySyncBtn.disabled = true;
  let completed = 0;
  const results = [];
  const definitions = state.attributes || [];
  syncStatusMessage.textContent = `Synchronizing 0 of ${selected.length} products…`;

  for (const originalProduct of selected) {
    const product = state.products.find((item) => item.id === originalProduct.id);
    const validationErrors = validateProduct(product, definitions);
    if (validationErrors.length) {
      product.syncStatus = 'Needs Review';
      appendSyncLog(state, `${product.name} not sent: ${validationErrors.join(' ')}`, 'warning');
      results.push(`${product.name}: needs review`);
      completed += 1;
      syncStatusMessage.textContent = `Processed ${completed} of ${selected.length} products…`;
      continue;
    }

    try {
      let result;
      try {
        result = await requestProductSync(product, definitions);
      } catch (error) {
        if (error.status !== 409 || error.code !== 'remote_conflict') throw error;
        const overwrite = confirm(`${product.name}: ${error.message}\n\nSmartPIM is the source of truth for an explicit overwrite. Continue?`);
        if (!overwrite) {
          product.syncStatus = 'Needs Review';
          appendSyncLog(state, `${product.name} sync paused for conflict review.`, 'warning');
          results.push(`${product.name}: conflict needs review`);
          completed += 1;
          syncStatusMessage.textContent = `Processed ${completed} of ${selected.length} products…`;
          continue;
        }
        result = await requestProductSync(product, definitions, true);
      }
      product.wooCommerceId = result.product.id;
      product.lastSyncedAt = result.syncedAt;
      product.wooModifiedAt = normalizeWooTimestamp(result.product.date_modified_gmt || result.product.date_modified);
      product.syncStatus = 'Synced';
      state.integration.lastSync = result.syncedAt;
      state.integration.status = 'Connected (live)';
      state.integration.mode = 'live';
      appendSyncLog(state, `${product.name} ${result.operation} in WooCommerce (SKU ${product.sku}, WooCommerce ID ${result.product.id}).`, 'success');
      results.push(`${product.name}: ${result.operation}`);
    } catch (error) {
      product.syncStatus = 'Failed';
      appendSyncLog(state, `${product.name} sync failed: ${error.message}`, 'error');
      results.push(`${product.name}: failed`);
    }
    completed += 1;
    saveState(state);
    renderSyncSummary();
    renderSyncLogs();
    syncStatusMessage.textContent = `Processed ${completed} of ${selected.length} products…`;
  }

  if (results.some((result) => result.includes(': created') || result.includes(': updated'))) {
    appendActivity(state, 'WooCommerce synchronization results recorded.', 'sync');
  }
  saveState(state);
  syncStatusMessage.textContent = results.join(' | ');
  renderProductOptions();
  renderSyncSummary();
  renderSyncLogs();
  window.smartPIM.renderDashboard();
  syncSelectedBtn.disabled = false;
  retrySyncBtn.disabled = false;
}

export function initializeSync() {
  if (!syncSummaryGrid || !fieldMappingList || !progressBar) return;

  retrySyncBtn.addEventListener('click', () => syncSelectedProducts(true));
  syncSelectedBtn.addEventListener('click', () => syncSelectedProducts(false));
  testConnectionBtn.addEventListener('click', testConnection);
  importProductsBtn.addEventListener('click', importProducts);
  refreshStatusBtn.addEventListener('click', () => refreshConnectionStatus(true));
  document.addEventListener('smartpim:products-changed', renderProductOptions);

  renderProductOptions();
  renderSyncSummary();
  renderFieldMapping();
  renderSyncLogs();
  refreshConnectionStatus();
}

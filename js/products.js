import {
  getState,
  saveState,
  formatCurrency,
  getStatusLabel,
  getMissingFields,
  appendActivity,
  enrichProduct,
  calculateCompleteness,
  validateProduct
} from './data.js';

const catalogTableBody = document.querySelector('#catalog-table-body');
const catalogGrid = document.querySelector('#catalog-grid');
const catalogSearch = document.querySelector('#catalog-search');
const categoryFilter = document.querySelector('#catalog-category-filter');
const statusFilter = document.querySelector('#catalog-status-filter');
const completenessFilter = document.querySelector('#catalog-completeness-filter');
const catalogSort = document.querySelector('#catalog-sort');
const productModal = document.querySelector('#product-modal');
const productForm = document.querySelector('#product-form');
const modalTitle = document.querySelector('#modal-title');

let gridMode = false;

function getFilteredProducts() {
  const state = getState();
  const search = (catalogSearch?.value || '').toLowerCase().trim();
  const categoryValue = categoryFilter?.value || 'all';
  const statusValue = statusFilter?.value || 'all';
  const completenessValue = completenessFilter?.value || 'all';
  const sortValue = catalogSort?.value || 'updated-desc';

  let products = [...(state.products || [])];

  if (search) {
    products = products.filter((product) => {
      const haystack = `${product.name} ${product.sku}`.toLowerCase();
      return haystack.includes(search);
    });
  }

  if (categoryValue !== 'all') {
    products = products.filter((product) => product.category === categoryValue);
  }

  if (statusValue !== 'all') {
    products = products.filter((product) => (product.status || getStatusLabel(product)) === statusValue);
  }

  if (completenessValue !== 'all') {
    const minimum = Number(completenessValue);
    products = products.filter((product) => Number(product.completeness || 0) >= minimum);
  }

  products.sort((a, b) => {
    if (sortValue === 'price-desc') return Number(b.price || 0) - Number(a.price || 0);
    if (sortValue === 'price-asc') return Number(a.price || 0) - Number(b.price || 0);
    if (sortValue === 'name-asc') return String(a.name).localeCompare(String(b.name));
    return new Date(b.lastUpdated) - new Date(a.lastUpdated);
  });

  return products;
}

function createStatusBadge(product) {
  const status = getStatusLabel(product);
  if (status === 'Published') return '<span class="status-pill status-published">Published</span>';
  if (status === 'Ready to Publish') return '<span class="status-pill status-ready">Ready to Publish</span>';
  return '<span class="status-pill status-draft">Draft</span>';
}

function createSyncBadge(product) {
  const syncStatus = product.syncStatus || 'Queued';
  if (syncStatus === 'Synced') return '<span class="status-sync">Synced</span>';
  if (syncStatus === 'Failed' || syncStatus === 'Needs Review') return '<span class="status-error">Needs Review</span>';
  return '<span class="status-warning">Queued</span>';
}

function renderTable() {
  const products = getFilteredProducts();

  if (!products.length) {
    catalogTableBody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="warning-item"><div><strong>No products yet</strong><small>Start building your product catalogue by adding your first product.</small></div></div>
        </td>
      </tr>
    `;
    return;
  }

  catalogTableBody.innerHTML = products
    .map(
      (product) => `
        <tr>
          <td>
            <div class="product-name">
              <img src="${product.images?.[0] || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=300&q=80'}" alt="${product.name}" />
              <div>
                <span>${product.name}</span>
                <small>${product.sku}</small>
              </div>
            </div>
          </td>
          <td>${product.category}</td>
          <td>${formatCurrency(product.price || 0)}</td>
          <td>${createStatusBadge(product)}</td>
          <td>
            <div class="progress">
              <div class="progress-bar" style="width:${product.completeness || 0}%"></div>
            </div>
            <small>${product.completeness || 0}%</small>
          </td>
          <td>${createSyncBadge(product)}</td>
          <td>${new Date(product.lastUpdated).toLocaleDateString()}</td>
          <td>
            <div class="action-buttons">
              <button class="action-btn" data-action="view-product" data-id="${product.id}">View</button>
              <button class="action-btn" data-action="edit-product" data-id="${product.id}">Edit</button>
              <button class="action-btn" data-action="delete-product" data-id="${product.id}">Delete</button>
            </div>
          </td>
        </tr>
      `
    )
    .join('');
}

function renderGrid() {
  const products = getFilteredProducts();

  if (!products.length) {
    catalogGrid.innerHTML = '<div class="warning-item"><div><strong>No products yet</strong><small>Start building your product catalogue by adding your first product.</small></div><button class="primary-btn" type="button" data-add-product-empty="true">Add Product</button></div>';
    return;
  }

  catalogGrid.innerHTML = products
    .map(
      (product) => `
        <div class="product-card">
          <img src="${product.images?.[0] || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=300&q=80'}" alt="${product.name}" />
          <div class="product-card-body">
            <h4>${product.name}</h4>
            <p>${product.category} • ${product.sku}</p>
            <div class="progress">
              <div class="progress-bar" style="width:${product.completeness || 0}%"></div>
            </div>
            <div class="action-buttons" style="margin-top:12px;">
              <button class="action-btn" data-action="view-product" data-id="${product.id}">View</button>
              <button class="action-btn" data-action="edit-product" data-id="${product.id}">Edit</button>
              <button class="action-btn" data-action="delete-product" data-id="${product.id}">Delete</button>
            </div>
          </div>
        </div>
      `
    )
    .join('');
}

function renderCatalog() {
  if (gridMode) {
    catalogGrid.classList.remove('hidden');
    catalogTableBody.closest('table').parentElement.classList.add('hidden');
    renderGrid();
  } else {
    catalogGrid.classList.add('hidden');
    catalogTableBody.closest('table').parentElement.classList.remove('hidden');
    renderTable();
  }
}

function refreshCategoryFilters() {
  const state = getState();
  const categories = [...new Set((state.products || []).map((product) => product.category))];
  categoryFilter.innerHTML = ['<option value="all">All categories</option>', ...categories.map((category) => `<option value="${category}">${category}</option>`)].join('');
}

function setProductModalState(productId = null) {
  const state = getState();
  const product = state.products.find((item) => item.id === productId);

  if (product) {
    modalTitle.textContent = 'Edit Product';
    productForm.dataset.productId = product.id;
    productForm.name.value = product.name;
    productForm.sku.value = product.sku;
    productForm.category.value = product.category;
    productForm.brand.value = product.brand || '';
    productForm.price.value = product.price || 0;
    productForm.salePrice.value = product.salePrice || '';
    productForm.status.value = product.status || 'Draft';
    productForm.description.value = product.description || '';
    productForm.imageUrl.value = product.images?.[0] || '';
    productForm.attributesJson.value = JSON.stringify(product.attributes || {}, null, 2);
  } else {
    modalTitle.textContent = 'Add Product';
    productForm.reset();
    productForm.dataset.productId = '';
    productForm.status.value = 'Draft';
    productForm.category.value = 'Electronics';
    productForm.attributesJson.value = '{}';
  }
}

export function openProductModal(productId = null) {
  setProductModalState(productId);
  productModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function validateProductData({ name, sku, category, brand, price, description }) {
  if (!name || !sku || !category || !brand || !description || Number(price || 0) <= 0) {
    return 'Please fill in the required product details before saving.';
  }

  const state = getState();
  const duplicate = state.products.some((item) => item.sku?.toLowerCase() === sku.toLowerCase() && item.id !== productForm.dataset.productId);
  if (duplicate) {
    return 'Duplicate SKU detected. Use a unique product code.';
  }

  return null;
}

function handleProductSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const state = getState();
  const productId = form.dataset.productId || `prod-${Date.now().toString().slice(-6)}`;
  const productPayload = {
    id: productId,
    name: formData.get('name')?.toString().trim(),
    sku: formData.get('sku')?.toString().trim(),
    category: formData.get('category')?.toString(),
    brand: formData.get('brand')?.toString().trim(),
    description: formData.get('description')?.toString().trim(),
    price: Number(formData.get('price') || 0),
    salePrice: formData.get('salePrice') ? Number(formData.get('salePrice')) : null,
    status: formData.get('status')?.toString() || 'Draft',
    lastUpdated: new Date().toISOString(),
    syncStatus: 'Queued',
    images: formData.get('imageUrl') ? [formData.get('imageUrl').toString()] : ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80'],
    attributes: {}
  };

  const validationError = validateProductData(productPayload);
  if (validationError) {
    alert(validationError);
    return;
  }

  const rawAttributes = formData.get('attributesJson')?.toString().trim();
  try {
    productPayload.attributes = rawAttributes ? JSON.parse(rawAttributes) : {};
  } catch (error) {
    alert('Additional attribute data must be valid JSON.');
    return;
  }

  const validationErrors = validateProduct(productPayload, state.attributes || []);
  const substantiveErrors = validationErrors.filter((message) =>
    message.startsWith('Sale price') || message.startsWith('Image URL') ||
    (productPayload.status !== 'Draft' && message.startsWith('Complete required fields')) ||
    message.includes(' must be one of: ')
  );
  if (substantiveErrors.length) {
    alert(substantiveErrors.join('\n'));
    return;
  }

  const existingIndex = state.products.findIndex((product) => product.id === productId);
  if (existingIndex >= 0) {
    state.products[existingIndex] = { ...state.products[existingIndex], ...productPayload };
    appendActivity(state, `Updated product ${productPayload.name}.`, 'update');
  } else {
    state.products.unshift(enrichProduct(productPayload));
    appendActivity(state, `Added product ${productPayload.name}.`, 'create');
  }

  state.products = state.products.map((product) => {
    const enriched = enrichProduct(product, state.attributes || []);
    enriched.completeness = calculateCompleteness(enriched, state.attributes || []);
    if (enriched.status !== 'Published' && enriched.completeness >= 90) {
      enriched.status = 'Ready to Publish';
    }
    if (enriched.status === 'Published') {
      enriched.syncStatus = 'Synced';
    }
    return enriched;
  });

  saveState(state);
  renderCatalog();
  window.smartPIM.renderDashboard();
  document.dispatchEvent(new CustomEvent('smartpim:products-changed'));
  productModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  form.reset();
}

function handleProductAction(event) {
  const actionBtn = event.target.closest('[data-action]');
  if (!actionBtn) return;

  const { action, id } = actionBtn.dataset;
  const state = getState();
  const item = state.products.find((product) => product.id === id);

  if (!item) return;

  if (action === 'view-product') {
    const details = [
      `Name: ${item.name}`,
      `SKU: ${item.sku}`,
      `Category: ${item.category}`,
      `Brand: ${item.brand}`,
      `Price: ${formatCurrency(item.price || 0)}`,
      `Description: ${item.description || 'Not provided'}`
    ].join('\n');
    alert(details);
  }

  if (action === 'edit-product') {
    openProductModal(id);
  }

  if (action === 'delete-product') {
    const shouldDelete = confirm(`Delete ${item.name}? This action cannot be undone.`);
    if (!shouldDelete) return;
    state.products = state.products.filter((product) => product.id !== id);
    appendActivity(state, `Deleted product ${item.name}.`, 'delete');
    saveState(state);
    renderCatalog();
    window.smartPIM.renderDashboard();
    document.dispatchEvent(new CustomEvent('smartpim:products-changed'));
  }
}

export function initializeProducts() {
  if (!catalogTableBody || !productForm) return;

  document.querySelector('#catalog-grid-btn').addEventListener('click', () => {
    gridMode = !gridMode;
    document.querySelector('#catalog-grid-btn').textContent = gridMode ? 'Table View' : 'Grid View';
    renderCatalog();
  });

  document.querySelector('#catalog-add-btn').addEventListener('click', () => openProductModal());
  document.querySelector('#catalog-search').addEventListener('input', renderCatalog);
  document.querySelector('#catalog-category-filter').addEventListener('change', renderCatalog);
  document.querySelector('#catalog-status-filter').addEventListener('change', renderCatalog);
  document.querySelector('#catalog-completeness-filter').addEventListener('change', renderCatalog);
  document.querySelector('#catalog-sort').addEventListener('change', renderCatalog);

  productForm.addEventListener('submit', handleProductSubmit);
  document.addEventListener('click', (event) => {
    const emptyStateAdd = event.target.closest('[data-add-product-empty="true"]');
    if (emptyStateAdd) {
      openProductModal();
      return;
    }
    handleProductAction(event);
  });

  refreshCategoryFilters();
  renderCatalog();
  document.addEventListener('smartpim:products-changed', () => {
    refreshCategoryFilters();
    renderCatalog();
  });
}

window.addEventListener('load', () => {
  refreshCategoryFilters();
  renderCatalog();
});

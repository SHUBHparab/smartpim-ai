import { getState, saveState, formatCurrency, validateProduct, appendActivity, appendSyncLog } from './data.js';
import { initializeProducts, openProductModal } from './products.js';
import { initializeAttributes } from './attributes.js';
import { initializeAssistant } from './ai-assistant.js';
import { initializeSync } from './sync.js';

const navButtons = [...document.querySelectorAll('.nav-item')];
const summaryGrid = document.querySelector('#summary-grid');
const completenessChart = document.querySelector('#completeness-chart');
const syncTimeline = document.querySelector('#sync-timeline');
const recentProducts = document.querySelector('#recent-products');
const warningList = document.querySelector('#warning-list');

function setActiveView(viewId) {
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === viewId);
  });
  navButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
}

function renderDashboard() {
  const state = getState();
  const products = state.products || [];
  const total = products.length;
  const published = products.filter((product) => (product.status || '').toLowerCase() === 'published').length;
  const draft = products.filter((product) => (product.status || '').toLowerCase() === 'draft').length;
  const missing = products.filter((product) => validateProduct(product, state.attributes || []).length > 0).length;
  const statusText = state.integration?.lastSync ? new Date(state.integration.lastSync).toLocaleString() : 'Never';
  const hasProducts = total > 0;
  const averageCompleteness = total
    ? Math.round(products.reduce((sum, product) => sum + Number(product.completeness || 0), 0) / total)
    : 0;

  summaryGrid.innerHTML = `
    <div class="metric-card">
      <div class="metric-head">
        <span class="label">Total Products</span>
        <span class="icon-pill">▣</span>
      </div>
      <div class="value">${total}</div>
      <div class="delta">${hasProducts ? `${averageCompleteness}% average completeness` : 'No products yet'}</div>
    </div>
    <div class="metric-card">
      <div class="metric-head">
        <span class="label">Published</span>
        <span class="icon-pill">✓</span>
      </div>
      <div class="value">${published}</div>
      <div class="delta">${hasProducts ? `${Math.round((published / Math.max(total, 1)) * 100)}% active` : '0% active'}</div>
    </div>
    <div class="metric-card">
      <div class="metric-head">
        <span class="label">Draft</span>
        <span class="icon-pill">•</span>
      </div>
      <div class="value">${draft}</div>
      <div class="delta">${hasProducts ? `${Math.round((draft / Math.max(total, 1)) * 100)}% awaiting review` : '0% awaiting review'}</div>
    </div>
    <div class="metric-card">
      <div class="metric-head">
        <span class="label">Missing</span>
        <span class="icon-pill">!</span>
      </div>
      <div class="value">${missing}</div>
      <div class="delta">${hasProducts ? 'Requires attention' : 'No items requiring attention'}</div>
    </div>
    <div class="metric-card">
      <div class="metric-head">
        <span class="label">Last Sync</span>
        <span class="icon-pill">⇄</span>
      </div>
      <div class="value">${statusText}</div>
      <div class="delta">${state.integration?.status || 'Not connected'}</div>
    </div>
  `;

  const groups = hasProducts
    ? products.slice(0, 4).map((product, index) => ({
      label: String.fromCharCode(65 + index),
      value: Number(product.completeness || 0),
      name: product.name
    }))
    : [
    { label: 'A', value: 0 },
    { label: 'B', value: 0 },
    { label: 'C', value: 0 },
    { label: 'D', value: 0 }
  ];

  completenessChart.innerHTML = groups
    .map(
      (item) => `
        <div class="bar-group" title="${item.name || 'No product data'}">
          <div class="bar" style="height:${item.value}%"></div>
          <div class="bar-label">${item.label}</div>
        </div>
      `
    )
    .join('');

  const recent = [...products]
    .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
    .slice(0, 4);

  recentProducts.innerHTML = recent.length
    ? recent
        .map(
          (product) => `
            <div class="list-row">
              <div class="product-row-meta">
                <img class="product-thumb" src="${product.images?.[0] || 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=300&q=80'}" alt="${product.name}" />
                <div>
                  <strong>${product.name}</strong>
                  <small>${product.category}</small>
                </div>
              </div>
              <div>
                <strong>${formatCurrency(product.price || 0)}</strong>
                <small>${new Date(product.lastUpdated).toLocaleDateString()}</small>
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="warning-item"><div><strong>No products yet</strong><small>Start building your product catalogue by adding your first product.</small></div></div>';

  const warnings = products
    .filter((product) => validateProduct(product, state.attributes || []).length > 0)
    .slice(0, 4)
    .map((product) => ({
      title: `${product.name} needs attention`,
      detail: validateProduct(product, state.attributes || []).slice(0, 2).join(' '),
      severity: product.completeness < 70 ? 'High' : 'Medium'
    }));

  warningList.innerHTML = warnings.length
    ? warnings
        .map(
          (warning) => `
          <div class="warning-item">
            <div>
              <strong>${warning.title}</strong>
              <small>${warning.detail || 'Check required fields before publishing'}</small>
            </div>
            <span class="status-warning">${warning.severity}</span>
          </div>
        `
        )
        .join('')
    : hasProducts
      ? '<div class="warning-item"><div><strong>No products requiring attention</strong><small>Required product information is complete.</small></div></div>'
      : '<div class="warning-item"><div><strong>No products yet</strong><small>Start building your product catalogue by adding your first product.</small></div></div>';

  const timelineItems = [...(state.syncLogs || [])].slice(0, 4);
  syncTimeline.innerHTML = timelineItems.length
    ? timelineItems
        .map(
          (item) => `
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div>
                <div class="title">${item.message}</div>
                <div class="meta">${new Date(item.timestamp).toLocaleString()}</div>
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="warning-item"><div><strong>No sync activity yet</strong><small>Your sync timeline will appear here once products are processed.</small></div></div>';
}

function populateCategorySelects() {
  const categories = ['Electronics', 'Fashion', 'Home', 'Accessories'];
  const categorySelects = [
    ...document.querySelectorAll('#product-category-select'),
    ...document.querySelectorAll('#attribute-category-select')
  ];

  categorySelects.forEach((select) => {
    const current = select.value;
    select.innerHTML = categories
      .map((category) => `<option value="${category}">${category}</option>`)
      .join('');
    if (current) {
      select.value = current;
    }
  });
}

function handleNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.view));
  });

  document.querySelector('#dashboard-view-all').addEventListener('click', () => setActiveView('catalog-view'));
  document.querySelector('#add-product-btn').addEventListener('click', () => openProductModal());
  document.querySelector('#catalog-add-btn').addEventListener('click', () => openProductModal());

  document.querySelectorAll('[data-close-modal="true"]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector('#product-modal').classList.add('hidden');
      document.body.classList.remove('modal-open');
    });
  });
}

window.smartPIM = {
  getState,
  saveState,
  renderDashboard,
  setActiveView,
  appendActivity,
  appendSyncLog,
  populateCategorySelects,
  openProductModal
};

document.addEventListener('DOMContentLoaded', () => {
  initializeProducts();
  initializeAttributes();
  initializeAssistant();
  initializeSync();
  handleNavigation();
  populateCategorySelects();
  setActiveView('dashboard-view');
  renderDashboard();
});

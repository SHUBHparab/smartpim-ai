import {
  getState,
  saveState,
  getMissingFields,
  calculateCompleteness,
  validateProduct,
  appendActivity
} from './data.js';

const aiProductSelect = document.querySelector('#ai-product-select');
const aiToneSelect = document.querySelector('#ai-tone-select');
const descriptionOutput = document.querySelector('#ai-description-output');
const aiStatus = document.querySelector('#ai-status');
const suggestionsList = document.querySelector('#ai-suggestions');
const qualityChecks = document.querySelector('#quality-checks');
const generateDescriptionButton = document.querySelector('#generate-description-btn');
const saveDescriptionButton = document.querySelector('#save-description-btn');
const suggestAttributesButton = document.querySelector('#suggest-attributes-btn');
const copyDescriptionButton = document.querySelector('#copy-description-btn');
let suggestionValues = {};

function getSelectedProduct() {
  const state = getState();
  const productId = aiProductSelect?.value;
  return (state.products || []).find((product) => product.id === productId) || (state.products || [])[0];
}

function renderProductOptions() {
  const state = getState();
  const products = state.products || [];
  if (!aiProductSelect) return;
  const selectedId = aiProductSelect.value;
  aiProductSelect.replaceChildren();
  products.forEach((product) => {
    aiProductSelect.add(new Option(`${product.name} (${product.sku})`, product.id));
  });
  if (products.some((product) => product.id === selectedId)) {
    aiProductSelect.value = selectedId;
  } else if (products.length) {
    aiProductSelect.value = products[0].id;
  }
}

function renderSuggestions(message = '') {
  const product = getSelectedProduct();
  if (!product) {
    suggestionsList.innerHTML = '<li class="check-item">No products available.</li>';
    return;
  }

  const state = getState();
  const missing = getMissingFields(product, state.attributes || []);
  if (!missing.length) {
    suggestionsList.innerHTML = '<li class="check-item">No missing required attributes detected.</li>';
    return;
  }

  suggestionsList.innerHTML = `
    ${message ? `<li class="check-item">${message}</li>` : ''}
    ${missing.map((field) => `
      <li class="check-item">
        <div>
          <strong>${field}</strong>
          <label>
            Verified value
            <input type="text" data-suggestion-field="${field}" value="${suggestionValues[field] || ''}" />
          </label>
          <small data-suggestion-evidence="${field}"></small>
          <button class="secondary-btn" type="button" data-save-suggestion="${field}">Approve and save value</button>
        </div>
      </li>
    `).join('')}
  `;
}

function renderQualityChecks() {
  const product = getSelectedProduct();
  if (!product) {
    qualityChecks.innerHTML = '<li class="check-item">No quality checks available.</li>';
    return;
  }

  const state = getState();
  const checks = [];
  if (!product.description || product.description.length < 40) checks.push('Add a richer product description to improve conversion quality.');
  if (!product.images || product.images.length === 0) checks.push('Add a representative product image.');
  checks.push(...validateProduct(product, state.attributes || []));

  qualityChecks.innerHTML = checks.length
    ? checks.map((check) => `<li class="check-item"><div>${check}</div></li>`).join('')
    : '<li class="check-item">No missing required fields detected.</li>';
}

async function parseResponse(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.message || `Request failed with HTTP ${response.status}.`);
  return result;
}

async function generateDescription() {
  const product = getSelectedProduct();
  if (!product) {
    aiStatus.textContent = 'Add a product before generating a description.';
    return;
  }

  generateDescriptionButton.disabled = true;
  aiStatus.textContent = 'Generating from supplied product facts…';
  try {
    const result = await parseResponse(await fetch('/api/ai/generate-description', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: product.name,
        category: product.category,
        brand: product.brand,
        attributes: product.attributes || {},
        tone: aiToneSelect?.value || 'Professional'
      })
    }));
    descriptionOutput.textContent = result.description;
    aiStatus.textContent = result.mode === 'demo'
      ? 'Demo mode: generated only from supplied facts. Review and edit before saving.'
      : 'AI-generated from supplied facts. Review and edit before saving.';
  } catch (error) {
    aiStatus.textContent = `Description generation failed: ${error.message}`;
  } finally {
    generateDescriptionButton.disabled = false;
  }
}

async function suggestAttributes() {
  const product = getSelectedProduct();
  if (!product) {
    renderSuggestions('Add a product to review its missing attributes.');
    return;
  }

  const state = getState();
  const missingFields = getMissingFields(product, state.attributes || []);
  if (!missingFields.length) {
    renderSuggestions();
    return;
  }

  suggestAttributesButton.disabled = true;
  renderSuggestions('Checking supplied product facts for verifiable suggestions…');
  try {
    const result = await parseResponse(await fetch('/api/ai/suggest-attributes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, missingFields })
    }));
    suggestionValues = Object.fromEntries(result.suggestions.map(({ field, value }) => [field, value]));
    renderSuggestions(result.suggestions.length
      ? 'Suggestions are grounded in existing product text; verify and approve each value before saving.'
      : (result.message || 'No missing values could be verified from the supplied facts. Enter verified values manually.'));
    result.suggestions.forEach(({ field, evidence }) => {
      const evidenceElement = suggestionsList.querySelector(`[data-suggestion-evidence="${CSS.escape(field)}"]`);
      if (evidenceElement) evidenceElement.textContent = `Source text: ${evidence}`;
    });
  } catch (error) {
    renderSuggestions(`Suggestion request failed: ${error.message}. Enter verified values manually.`);
  } finally {
    suggestAttributesButton.disabled = false;
  }
}

function saveDescription() {
  const product = getSelectedProduct();
  const description = descriptionOutput.textContent.trim();
  if (!product || !description || description.startsWith('Select a product')) {
    aiStatus.textContent = 'Select a product and generate or enter a description first.';
    return;
  }
  const state = getState();
  const storedProduct = state.products.find((item) => item.id === product.id);
  storedProduct.description = description;
  storedProduct.lastUpdated = new Date().toISOString();
  storedProduct.syncStatus = 'Queued';
  if (storedProduct.status === 'Published') storedProduct.status = 'Draft';
  storedProduct.completeness = calculateCompleteness(storedProduct, state.attributes || []);
  appendActivity(state, `AI-assisted description saved for ${storedProduct.name}.`, 'update');
  saveState(state);
  aiStatus.textContent = 'Description saved to the product. Review status is Draft until you publish it.';
  window.smartPIM.renderDashboard();
  document.dispatchEvent(new CustomEvent('smartpim:products-changed'));
}

function saveAttributeSuggestion(event) {
  const button = event.target.closest('[data-save-suggestion]');
  if (!button) return;
  const product = getSelectedProduct();
  const field = button.dataset.saveSuggestion;
  const input = suggestionsList.querySelector(`[data-suggestion-field="${CSS.escape(field)}"]`);
  const value = input?.value.trim();
  if (!product || !value) {
    alert('Enter a verified value before approving it.');
    return;
  }

  const state = getState();
  const definition = (state.attributes || []).find((attribute) =>
    attribute.category === product.category && attribute.name === field
  );
  if (definition?.values?.length && !definition.values.some((allowed) => allowed.toLowerCase() === value.toLowerCase())) {
    alert(`${field} must be one of: ${definition.values.join(', ')}.`);
    return;
  }

  const storedProduct = state.products.find((item) => item.id === product.id);
  if (['name', 'sku', 'description', 'brand', 'category', 'price'].includes(field)) {
    if (field === 'sku' && state.products.some((item) =>
      item.id !== storedProduct.id && item.sku?.toLowerCase() === value.toLowerCase()
    )) {
      alert('Duplicate SKU detected. Use a unique product code.');
      return;
    }
    if (field === 'price' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) {
      alert('Regular price must be a number greater than zero.');
      return;
    }
    storedProduct[field] = field === 'price' ? Number(value) : value;
  } else {
    storedProduct.attributes = { ...(storedProduct.attributes || {}), [field]: value };
  }
  storedProduct.lastUpdated = new Date().toISOString();
  storedProduct.syncStatus = 'Queued';
  if (storedProduct.status === 'Published') storedProduct.status = 'Draft';
  storedProduct.completeness = calculateCompleteness(storedProduct, state.attributes || []);
  appendActivity(state, `Verified ${field} for ${storedProduct.name}.`, 'update');
  saveState(state);
  suggestionValues = {};
  renderSuggestions();
  renderQualityChecks();
  window.smartPIM.renderDashboard();
  document.dispatchEvent(new CustomEvent('smartpim:products-changed'));
}

async function copyToClipboard() {
  const text = descriptionOutput.textContent.trim();
  if (!text || text.includes('Select a product')) return;
  try {
    await navigator.clipboard.writeText(text);
    aiStatus.textContent = 'Description copied to clipboard.';
  } catch {
    aiStatus.textContent = 'Clipboard access is unavailable in this browser.';
  }
}

export function initializeAssistant() {
  if (!aiProductSelect || !generateDescriptionButton) return;

  renderProductOptions();
  aiProductSelect.addEventListener('change', () => {
    suggestionValues = {};
    descriptionOutput.textContent = 'Select a product and generate a polished product description.';
    aiStatus.textContent = 'Review generated text before saving it to the selected product.';
    renderSuggestions();
    renderQualityChecks();
  });
  generateDescriptionButton.addEventListener('click', generateDescription);
  saveDescriptionButton.addEventListener('click', saveDescription);
  suggestAttributesButton.addEventListener('click', suggestAttributes);
  suggestionsList.addEventListener('input', (event) => {
    const input = event.target.closest('[data-suggestion-field]');
    if (input) suggestionValues[input.dataset.suggestionField] = input.value;
  });
  suggestionsList.addEventListener('click', saveAttributeSuggestion);
  copyDescriptionButton.addEventListener('click', copyToClipboard);
  document.addEventListener('smartpim:products-changed', () => {
    renderProductOptions();
    renderSuggestions();
    renderQualityChecks();
  });
  renderSuggestions();
  renderQualityChecks();
}

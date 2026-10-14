import { getState, saveState, appendActivity, appendSyncLog, calculateCompleteness, validateProduct } from './data.js';

const attributeForm = document.querySelector('#attribute-form');
const attributeSummary = document.querySelector('#attribute-summary');
const attributeTableBody = document.querySelector('#attribute-table-body');
let editingAttributeId = null;

function renderAttributeSummary() {
  const state = getState();
  const categories = [...new Set([...(state.products || []).map((product) => product.category), 'Electronics', 'Fashion', 'Home', 'Accessories'])];

  attributeSummary.innerHTML = categories
    .map(
      (category) => {
        const required = (state.attributes || []).filter((attribute) => attribute.category === category && attribute.required);
        const items = required.length ? required.map((attribute) => attribute.name).join(', ') : 'No required attributes';
        return `
          <div class="summary-item">
            <strong>${category}</strong>
            <span>${items}</span>
          </div>
        `;
      }
    )
    .join('');
}

function renderAttributeTable() {
  const state = getState();
  const attributes = state.attributes || [];

  if (!attributes.length) {
    attributeTableBody.innerHTML = '<tr><td colspan="5"><div class="warning-item"><div><strong>No attributes yet</strong><small>Create your first custom attribute.</small></div></div></td></tr>';
    return;
  }

  attributeTableBody.innerHTML = attributes
    .map(
      (attribute) => `
        <tr>
          <td>${attribute.name}</td>
          <td>${attribute.category}</td>
          <td>${(attribute.values || []).join(', ') || '—'}</td>
          <td>${attribute.required ? 'Required' : 'Optional'}</td>
          <td>
            <div class="action-buttons">
              <button class="action-btn" data-action="edit-attribute" data-id="${attribute.id}">Edit</button>
              <button class="action-btn" data-action="delete-attribute" data-id="${attribute.id}">Delete</button>
            </div>
          </td>
        </tr>
      `
    )
    .join('');
}

function handleAttributeSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const state = getState();
  const values = (formData.get('values') || '')
    .toString()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const attribute = {
    id: editingAttributeId || `attr-${Date.now()}`,
    name: formData.get('name')?.toString().trim(),
    category: formData.get('category')?.toString(),
    values,
    required: Boolean(formData.get('required'))
  };

  if (!attribute.name || !attribute.category) {
    alert('Attribute name and category are required.');
    return;
  }

  const duplicate = (state.attributes || []).some((item) =>
    item.id !== editingAttributeId &&
    item.category === attribute.category &&
    item.name.toLowerCase() === attribute.name.toLowerCase()
  );
  if (duplicate) {
    alert('An attribute with this name already exists for the selected category.');
    return;
  }

  const previous = (state.attributes || []).find((item) => item.id === editingAttributeId);
  state.attributes = editingAttributeId
    ? state.attributes.map((item) => item.id === editingAttributeId ? attribute : item)
    : [...(state.attributes || []), attribute];
  state.products = (state.products || []).map((product) => {
    const updatedProduct = {
      ...product,
      completeness: calculateCompleteness(product, state.attributes)
    };
    if (updatedProduct.status === 'Published' && validateProduct(updatedProduct, state.attributes).length) {
      updatedProduct.status = 'Draft';
      updatedProduct.syncStatus = 'Queued';
    }
    return updatedProduct;
  });
  appendActivity(state, `${editingAttributeId ? 'Updated' : 'Created'} attribute ${attribute.name}.`, 'attribute');
  appendSyncLog(state, `Attribute ${attribute.name} ${editingAttributeId ? 'updated' : 'added'} for ${attribute.category}.`, 'info');
  if (previous?.required !== attribute.required || previous?.category !== attribute.category) {
    appendSyncLog(state, 'Product completeness was recalculated after the attribute definition changed.', 'info');
  }
  saveState(state);
  editingAttributeId = null;
  form.reset();
  form.querySelector('button[type="submit"]').textContent = 'Save Attribute';
  renderAttributeTable();
  renderAttributeSummary();
  window.smartPIM.renderDashboard();
}

function handleAttributeAction(event) {
  const target = event.target.closest('[data-action="edit-attribute"], [data-action="delete-attribute"]');
  if (!target) return;

  const state = getState();
  const attributeId = target.dataset.id;
  const attribute = (state.attributes || []).find((item) => item.id === attributeId);
  if (!attribute) return;

  if (target.dataset.action === 'edit-attribute') {
    editingAttributeId = attribute.id;
    attributeForm.elements.name.value = attribute.name;
    attributeForm.elements.category.value = attribute.category;
    attributeForm.elements.values.value = (attribute.values || []).join(', ');
    attributeForm.elements.required.checked = Boolean(attribute.required);
    attributeForm.querySelector('button[type="submit"]').textContent = 'Update Attribute';
    attributeForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const confirmed = confirm(`Delete the ${attribute.name} attribute?`);
  if (!confirmed) return;

  state.attributes = (state.attributes || []).filter((item) => item.id !== attributeId);
  state.products = (state.products || []).map((product) => ({
    ...product,
    completeness: calculateCompleteness(product, state.attributes)
  }));
  if (editingAttributeId === attributeId) {
    editingAttributeId = null;
    attributeForm.reset();
    attributeForm.querySelector('button[type="submit"]').textContent = 'Save Attribute';
  }
  appendActivity(state, `Deleted attribute ${attribute.name}.`, 'attribute');
  saveState(state);
  renderAttributeTable();
  renderAttributeSummary();
}

export function initializeAttributes() {
  if (!attributeForm || !attributeTableBody) return;

  const categories = ['Electronics', 'Fashion', 'Home', 'Accessories'];
  document.querySelector('#attribute-category-select').innerHTML = categories
    .map((category) => `<option value="${category}">${category}</option>`)
    .join('');

  attributeForm.addEventListener('submit', handleAttributeSubmit);
  document.addEventListener('click', handleAttributeAction);
  renderAttributeSummary();
  renderAttributeTable();
}

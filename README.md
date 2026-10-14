# SmartPIM — Product Information Management with WooCommerce Integration

SmartPIM is a lightweight product information management dashboard for the KILOWOTT hackathon problem of centralizing product catalogue data, validating product attributes, and synchronizing approved products with WooCommerce.

## Features

- Product create, edit, delete, view, search, filter, and sort.
- Browser LocalStorage persistence; a fresh installation starts with an empty catalogue.
- Dashboard totals and completeness values are calculated from saved products.
- INR display formatting without converting stored numeric prices.
- Required and optional custom attributes, category-specific definitions, allowed values, edit/delete actions, and per-product completeness.
- Product validation for required fields, sale-price rules, image URLs, custom allowed values, and category attributes.
- WooCommerce REST API v3 connection test, product import, SKU-based create/update, conflict checks, actionable logs, and failed-sync retry.
- AI-assisted descriptions and attribute suggestions through a server-side OpenAI-compatible endpoint. The UI keeps generated text editable and requires user approval before saving.
- Clearly labeled fact-bound demo behavior when AI or WooCommerce credentials are not configured.

## Technology and Architecture

- Frontend: HTML, CSS, and browser JavaScript modules.
- Backend: Node.js, Express, and `dotenv`.
- Product and attribute storage: browser LocalStorage (not a shared database).
- WooCommerce: official REST API v3, called only from the Express server.
- AI: OpenAI-compatible Chat Completions API, called only from the Express server.

The browser sends product data to the local Express API. The server reads API credentials from environment variables and makes authenticated provider requests. WooCommerce consumer keys/secrets and AI keys are never stored in LocalStorage or returned to frontend code.

## Installation and Run

Requirements: Node.js 18 or later (global `fetch` is used).

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open `http://localhost:3000`.

Run the integration tests:

```powershell
npm test
```

The test suite runs against local mock HTTP servers and does not require live WooCommerce or AI credentials.

## Environment Configuration

Edit `.env` on the server only. `.env` is ignored by Git; never commit real credentials.

```dotenv
PORT=3000
WOOCOMMERCE_URL=https://your-store.example
WOOCOMMERCE_CONSUMER_KEY=ck_replace_with_your_key
WOOCOMMERCE_CONSUMER_SECRET=cs_replace_with_your_secret
AI_API_KEY=replace_with_your_ai_api_key
AI_API_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

Keep the three WooCommerce settings together. If all are absent, the app reports demo/not-connected status. A partial or invalid configuration is reported as an error rather than as a successful connection. Real stores must use HTTPS; HTTP is permitted only for localhost integration testing.

## WooCommerce Setup and Workflow

1. In WooCommerce, create a REST API key with read/write access.
2. Add the store URL, consumer key, and consumer secret to the server `.env`.
3. Restart SmartPIM and use **Test Connection** in Integration Settings. The test makes an authenticated request to the store; the UI reports the real response.
4. Use **Import Products** to retrieve the store catalogue. Import adds unmatched SKUs and updates products already linked by WooCommerce ID. If an unlinked local product has the same SKU, the import skips it instead of silently overwriting the local record.
5. Select one or more products in Data Synchronization and select **Sync Selected Products**. Products are validated before any write.
6. Sync searches WooCommerce by SKU. It creates a product when no SKU matches and updates the matched WooCommerce product otherwise. Categories are matched by name or created in WooCommerce; price, sale price, descriptions, images, attributes, and brand metadata are mapped.
7. Use **Retry Failed Sync** to retry products whose last API operation failed.

### Conflict rule

SmartPIM treats each explicit sync as an instruction to send the current PIM record to WooCommerce. Before updating an existing remote record, the server compares WooCommerce's `date_modified_gmt` with the last confirmed SmartPIM sync time. If WooCommerce is newer (or there is no prior baseline), SmartPIM pauses with a conflict response. The user must choose to keep reviewing/importing the remote version or explicitly confirm the overwrite. The application never silently overwrites a detected newer remote version.

WooCommerce API errors, authentication failures, timeouts, and rate limits are reported in the status/log UI. Rate-limited requests are retried briefly by the server; use the product retry action for subsequent failures. The server limits a single import to 1,000 products.

## AI Setup and Behavior

Set `AI_API_KEY`, and optionally `AI_API_BASE_URL` and `AI_MODEL`, on the server. The key is not sent to the browser.

- Description generation uses only submitted product facts and should not invent specifications. Generated text is editable and is not saved until **Save Description to Product** is selected.
- Missing-attribute suggestions are limited to values that the server can verify as exact text in supplied product facts. Suggestions are editable and each value requires user approval before saving.
- With no AI key, demo mode produces a short description from supplied facts and does not invent attribute values. Provider errors are displayed instead of silently replacing them with fabricated content.

## Attribute Validation and Completeness

The category requirements in `js/data.js` are the built-in baseline. Attribute Manager supports category-specific custom definitions with required/optional status and optional allowed values. Required values affect product completeness and dashboard attention counts. Before publishing or syncing, required product fields and category attributes must be complete; values that violate a configured allowed-value list are rejected with a field-specific message. Editing or deleting an attribute definition recalculates stored product completeness.

## Demo Mode and Persistence

Without WooCommerce credentials, the app remains usable for local catalogue work, but connection tests and sync/import actions report that WooCommerce is not configured; they do not claim a simulated sync succeeded. Without an AI key, only the explicitly identified fact-bound demo response is available.

Products, attributes, sync state, and activity are stored in browser LocalStorage for this hackathon build. Data is isolated to that browser profile and is not shared across users or devices. The integration credentials are server environment values only and are excluded from client storage.

## Testing and Known Limitations

- `npm test` verifies server-side live-mode routing against a local WooCommerce API mock, credential isolation from API responses, connection testing, category resolution, create/update by SKU, conflict handling, validation, import, and fact-bound AI demo behavior.
- Browser checks should additionally cover product CRUD, refresh persistence, custom-attribute validation, and the user-facing empty states.
- A live end-to-end WooCommerce/AI request requires valid credentials and an accessible store/provider; no live credentials are included in this repository.
- Catalogue data uses LocalStorage rather than a server database.
- WooCommerce mapping currently targets simple products. Variations, inventory, taxes, shipping, and custom plugin-specific product types are not synchronized.
- Import is capped at 1,000 products per request.

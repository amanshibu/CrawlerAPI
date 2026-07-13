# CrawlerAPI 🛡️

CrawlerAPI is a high-performance, Playwright-powered web crawler and API mapping tool designed for security engineers, bug hunters, and developers. It crawls modern single-page applications (SPAs), intercepts underlying network traffic, auto-discovers client-side routes, and compiles a comprehensive inventory of REST APIs, GraphQL queries, and WebSockets.

```text
  ____                      _             _     ____   ___  
 / ___|_ __ __ ___      ___| | ___ _ __  / \   |  _ \ |_ _| 
| |   | '__/ _` \ \ /\ / / |/ _ \ '__|/ _ \  | |_) | | |  
| |___| | | (_| |\ V  V /| |  __/ |  / ___ \ |  __/  | |  
 \____|_|  \__,_| \_/\_/ |_|\___|_| /_/   \_\|_|    |___| 
           - Dynamic SPA & API Web Mapper -
```

---

## Key Features

* 🚀 **Modern SPA Crawling:** Natively navigates JavaScript-heavy applications (React, Angular, Vue) using a real Chromium browser.
* 🌐 **Complete API Mapping:** Intercepts runtime request and response payloads, logging HTTP methods, endpoints, query parameters, and headers.
* 🔐 **MFA & Manual Authentication Support:** Pauses execution (headed mode) to allow manual authentication steps before automating the crawl.
* 💾 **Session State Export/Import:** Saves active cookies and local storage states into a session profile to skip manual login on subsequent runs.
* 🧪 **Dynamic Form Fuzzing:** Detects page forms and automatically submits mock values inside isolated contexts to force target apps to trigger background APIs.
* 📝 **OpenAPI v3 Spec Generation:** Automatically compiles your unique REST endpoint catalog into standard Swagger/OpenAPI `openapi.json` files.
* 📁 **Target Partitioning:** Allows output folder customization to keep targets organized.

---

## Installation

### Prerequisites
* Node.js (v18 or higher)
* npm

### Setup
1. Clone the repository and navigate to the directory:
   ```bash
   git clone https://github.com/your-username/crawlerapi.git
   cd crawlerapi
   ```
2. Install the package dependencies and browser files:
   ```bash
   npm install
   npx playwright install chromium
   ```

---

## Usage

You can launch scans using either flagged parameters or positional fallback formatting:

### 1. Flagged Execution
```bash
npm run crawl -- -t <targetUrl> -d <maxDepth> -o <outputFolderName> [options]
```
* **Flags:**
  * `-t` / `--target`: The seed URL to start crawling from.
  * `-d` / `--depth`: Maximum directories crawl depth (default: `3`).
  * `-o` / `--output`: Specific output folder under `./results/` to store data.
  * `-s` / `--session`: Custom storage path for cookies/session state (default: `./session.json`).
  * `--no-login`: Disables manual login pause.
  * `--no-fuzz`: Disables automated form submission actions.

### 2. Positional Execution (Shorthand)
```bash
npm run crawl -- "<targetUrl>" <maxDepth> <outputFolder> [no-login] [no-fuzz]
```

### Examples

* **Perform an Initial Headed Authenticated Scan:**
  Opens a visible browser window, waits 60 seconds for you to log in, and saves cookies to `session.json`:
  ```bash
  npm run crawl -- "https://example.com" 2 target_scan
  ```
  
* **Run a Headless Automation Scan Using the Saved Session:**
  Loads your active session state and crawls immediately without prompt:
  ```bash
  npm run crawl -- "https://example.com" 2 target_scan no-login
  ```

---

## Output Structure

All findings are outputted inside your specified directory segment `./results/<outputFolder>/`:

```text
results/<outputFolder>/
├── api/                   # Individual parsed HTTP request/response maps
│   ├── GET_a1b2c3d4.json
│   └── POST_e5f6g7h8.json
├── responses/             # Full raw JSON/JS/text response payloads
├── screenshots/           # Screenshots of visited pages
├── api_inventory.json     # Summary of discovered endpoint URLs
├── requests.json          # Combined raw request logging list
├── responses.json         # Combined raw response metadata
├── websockets.json        # Intercepted WebSocket connections
├── routes.json            # Discovered Angular/Client router paths
├── report.md              # Consolidated Markdown summary report
└── openapi.json           # Standardized OpenAPI v3 spec contract
```

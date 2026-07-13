import { chromium, Browser, BrowserContext, Page, Request, Response, WebSocket } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CrawlerConfig, NetworkRequest, NetworkResponse, WebSocketConnection, PageInfo } from './types';

export class PlaywrightCrawler {
  private config: CrawlerConfig;
  private browser!: Browser;
  private context!: BrowserContext;
  private visitedUrls: Set<string> = new Set();
  private queue: { url: string; depth: number }[] = [];
  
  // Data stores
  private requests: NetworkRequest[] = [];
  private responses: NetworkResponse[] = [];
  private websockets: WebSocketConnection[] = [];
  private pages: PageInfo[] = [];
  private staticJsFiles: Set<string> = new Set();
  private apiEndpoints: Set<string> = new Set();
  private discoveredRoutes: Set<string> = new Set();

  constructor(config: CrawlerConfig) {
    this.config = config;
    // Normalize target URL trailing slash
    if (this.config.targetUrl.endsWith('/')) {
      this.config.targetUrl = this.config.targetUrl.slice(0, -1);
    }
  }

  private cleanHeaders(headers: Record<string, string>): Record<string, string> {
    const cleaned: Record<string, string> = {};
    const sensitive = this.config.sensitiveHeaders.map(h => h.toLowerCase());
    for (const [key, val] of Object.entries(headers)) {
      if (sensitive.includes(key.toLowerCase())) {
        cleaned[key] = '[REDACTED]';
      } else {
        cleaned[key] = val;
      }
    }
    return cleaned;
  }

  private setupDirectories() {
    const base = this.config.resultsDir;
    const dirs = [
      base,
      path.join(base, 'api'),
      path.join(base, 'requests'),
      path.join(base, 'responses'),
      path.join(base, 'screenshots'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private async generateHash(data: string): Promise<string> {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  public async start() {
    this.setupDirectories();
    console.log(`\x1b[92m[+]\x1b[0m Starting crawl on: \x1b[96m${this.config.targetUrl}\x1b[0m`);

    // Check if session file exists
    const hasSession = this.config.sessionFile && fs.existsSync(this.config.sessionFile);
    if (hasSession) {
      console.log(`\x1b[92m[+]\x1b[0m Found active session state file: \x1b[33m${this.config.sessionFile}\x1b[0m. Loading session...`);
    }

    // Launch Chromium browser (fallback to headless if headed mode fails due to environment limits)
    try {
      this.browser = await chromium.launch({
        headless: !this.config.manualLogin || hasSession ? !this.config.manualLogin : true,
        args: ['--disable-web-security', '--allow-running-insecure-content']
      });
    } catch (err) {
      console.warn(`\x1b[93m[!]\x1b[0m Headed browser launch failed (possibly running in a headless shell/environment). Falling back to headless mode...`);
      this.config.manualLogin = false; // Disable manual login since it requires headed browser
      this.browser = await chromium.launch({
        headless: true,
        args: ['--disable-web-security', '--allow-running-insecure-content']
      });
    }

    this.context = await this.browser.newContext({
      storageState: hasSession ? this.config.sessionFile : undefined,
      userAgent: this.config.userAgent,
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 }
    });

    const page = await this.context.newPage();

    // Perform manual authentication step if configured (only if we don't have an active session loaded)
    if (this.config.manualLogin && !hasSession) {
      console.log(`\x1b[93m[!]\x1b[0m Manual Login Mode: Navigating to seed URL...`);
      try {
        await page.goto(this.config.targetUrl, { waitUntil: 'load', timeout: this.config.requestTimeoutMs });
        console.log(`\x1b[93m[!]\x1b[0m Please log in manually if required. Crawler will resume automatically in \x1b[96m${this.config.manualLoginTimeoutMs / 1000} seconds\x1b[0m...`);
        console.log(`\x1b[93m[!]\x1b[0m Keep the browser window open and complete your login/authentication steps now.`);
        await page.waitForTimeout(this.config.manualLoginTimeoutMs);
        console.log(`\x1b[92m[+]\x1b[0m Proceeding with automated crawl...`);
        
        // Save session structure
        if (this.config.sessionFile) {
          await this.context.storageState({ path: this.config.sessionFile });
          console.log(`\x1b[92m[+]\x1b[0m Session state successfully exported to: \x1b[33m${this.config.sessionFile}\x1b[0m`);
        }
      } catch (err: any) {
        console.warn(`\x1b[91m[-]\x1b[0m Manual login phase interrupted or page closed: ${err?.message || err}`);
      }
    }

    // Initialize crawling queue
    let startUrl = this.config.targetUrl;
    try {
      if (this.config.manualLogin && !page.isClosed()) {
        const currentUrl = page.url();
        if (currentUrl && currentUrl !== 'about:blank') {
          startUrl = currentUrl;
        }
      }
    } catch (_) {}

    this.queue.push({ url: startUrl, depth: 0 });
    this.visitedUrls.add(startUrl);

    // Close the initial page, we will spawn new pages for crawling to isolate runs
    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (_) {}

    // Begin navigation loop
    while (this.queue.length > 0) {
      const current = this.queue.shift();
      if (!current) break;

      if (current.depth > this.config.maxDepth) {
        continue;
      }

      try {
        await this.crawlPage(current.url, current.depth);
      } catch (err) {
        console.error(`\x1b[91m[-]\x1b[0m Error crawling page \x1b[36m${current.url}\x1b[0m:`, err);
      }
    }

    // Save final reports & raw files
    await this.saveResults();
    await this.browser.close();
    console.log(`\x1b[92m[+]\x1b[0m Crawl complete. Results saved in: \x1b[96m${this.config.resultsDir}\x1b[0m`);
  }

  private async crawlPage(url: string, depth: number) {
    console.log(`\x1b[92m[+]\x1b[0m Crawling [\x1b[33mDepth: ${depth}\x1b[0m]: \x1b[36m${url}\x1b[0m`);
    const page = await this.context.newPage();

    // Intercept network requests
    page.on('request', (req: Request) => {
      const reqUrl = req.url();
      // Skip binary, CSS, analytics etc based on file extensions
      const ext = path.extname(new URL(reqUrl).pathname).toLowerCase();
      if (this.config.excludedExtensions.includes(ext)) {
        return;
      }

      const id = crypto.randomUUID();
      const networkReq: NetworkRequest = {
        id,
        url: reqUrl,
        method: req.method(),
        headers: this.cleanHeaders(req.headers()),
        postData: req.postData(),
        timestamp: new Date().toISOString()
      };
      this.requests.push(networkReq);

      // Track static JS assets
      if (ext === '.js') {
        this.staticJsFiles.add(reqUrl);
      }
      
      // Track API endpoints (e.g. JSON requests or typical API paths)
      const isApi = reqUrl.includes('/api/') || 
                    reqUrl.includes('/graphql') || 
                    req.headers()['accept']?.includes('json') || 
                    req.headers()['content-type']?.includes('json');
      if (isApi) {
        this.apiEndpoints.add(`${req.method()} ${reqUrl.split('?')[0]}`);
      }
    });

    // Intercept network responses
    page.on('response', async (res: Response) => {
      const resUrl = res.url();
      const ext = path.extname(new URL(resUrl).pathname).toLowerCase();
      if (this.config.excludedExtensions.includes(ext)) {
        return;
      }

      const id = crypto.randomUUID();
      const responseInfo: NetworkResponse = {
        id,
        url: resUrl,
        status: res.status(),
        headers: this.cleanHeaders(res.headers()),
        timestamp: new Date().toISOString()
      };

      try {
        const contentType = res.headers()['content-type'] || '';
        if (contentType.includes('json') || contentType.includes('text') || contentType.includes('javascript')) {
          const text = await res.text();
          // Write full response body to file
          const safeName = `${res.status()}_${await this.generateHash(resUrl)}_${id.substring(0, 8)}.json`;
          fs.writeFileSync(path.join(this.config.resultsDir, 'responses', safeName), text);
          responseInfo.bodyFile = `responses/${safeName}`;
          responseInfo.bodyPreview = text.substring(0, 500);

          // Save API response mappings specifically
          if (resUrl.includes('/api/') || contentType.includes('json')) {
            const apiFileName = `${res.request().method()}_${await this.generateHash(resUrl).then(h => h.substring(0, 12))}.json`;
            let parsedBody: any = null;
            try {
              if (text.length > 50000) {
                parsedBody = { _info: "Response body too large, truncated", preview: text.substring(0, 1000) + "..." };
              } else {
                parsedBody = JSON.parse(text);
              }
            } catch (_) {
              parsedBody = text.length > 1000 ? text.substring(0, 1000) + "..." : text;
            }

            fs.writeFileSync(path.join(this.config.resultsDir, 'api', apiFileName), JSON.stringify({
              url: resUrl,
              method: res.request().method(),
              status: res.status(),
              responseBody: parsedBody
            }, null, 2));
          }
        }
      } catch (err) {
        // Body reading can fail for non-text components or active streams
      }

      this.responses.push(responseInfo);
    });

    // Intercept WebSockets
    page.on('websocket', (ws: WebSocket) => {
      console.log(`\x1b[92m[+]\x1b[0m WebSocket connection detected: \x1b[95m${ws.url()}\x1b[0m`);
      this.websockets.push({
        url: ws.url(),
        timestamp: new Date().toISOString()
      });
    });

    // Navigate to the target page
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: this.config.requestTimeoutMs });
    } catch (err) {
      console.warn(`\x1b[93m[!]\x1b[0m Initial load timeout or error on \x1b[36m${url}\x1b[0m, proceeding to gather current state`);
    }

    // Take screenshot
    const safeTitle = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const screenshotPath = path.join(this.config.resultsDir, 'screenshots', `${safeTitle}.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (err) {
      console.warn(`\x1b[93m[!]\x1b[0m Could not capture screenshot for \x1b[36m${url}\x1b[0m`);
    }

    // Analyze page DOM
    const pageAnalysis = await page.evaluate((targetDomain) => {
      // 1. Extract Links within the same domain
      const links: string[] = [];
      document.querySelectorAll('a').forEach(a => {
        if (a.href) {
          try {
            const urlObj = new URL(a.href);
            if (urlObj.hostname === targetDomain) {
              links.push(a.href);
            }
          } catch (_) {}
        }
      });

      // 2. Extract Forms and their field inputs
      const formsData: any[] = [];
      document.querySelectorAll('form').forEach(form => {
        const action = form.action || '';
        const method = form.method || 'get';
        const inputs: any[] = [];
        form.querySelectorAll('input, select, textarea').forEach((el: any) => {
          inputs.push({
            name: el.name || el.id || '',
            type: el.type || el.tagName.toLowerCase(),
            placeholder: el.placeholder || '',
            value: el.value || ''
          });
        });
        formsData.push({ action, method, inputs });
      });

      // 3. Dynamic route discovery (specifically targeting Angular patterns if present)
      const angularRoutes: string[] = [];
      try {
        // Attempt Angular route extraction from common configuration references in window namespace
        const ng = (window as any).ng;
        if (ng) {
          // Check for router objects on root elements
          const rootEl = document.querySelector('[ng-version]') || document.querySelector('app-root');
          if (rootEl) {
            const injector = (window as any).ng.probe?.(rootEl)?.injector;
            const router = injector?.get((window as any).ng.router?.Router);
            if (router && router.config) {
              const traverseRoutes = (routes: any[], parent = '') => {
                for (const route of routes) {
                  const path = parent ? `${parent}/${route.path}` : route.path;
                  if (route.path !== undefined && route.path !== '**') {
                    angularRoutes.push('/' + path);
                  }
                  if (route.children) {
                    traverseRoutes(route.children, path);
                  }
                }
              };
              traverseRoutes(router.config);
            }
          }
        }
      } catch (_) {}

      // 4. Also capture performance entries for loaded JS assets to build static file list
      const staticFiles: string[] = [];
      performance.getEntriesByType('resource').forEach((entry: any) => {
        if (entry.initiatorType === 'script' || entry.name.endsWith('.js')) {
          staticFiles.push(entry.name);
        }
      });

      return {
        title: document.title,
        links: Array.from(new Set(links)),
        forms: formsData,
        angularRoutes: Array.from(new Set(angularRoutes)),
        staticFiles: Array.from(new Set(staticFiles))
      };
    }, new URL(this.config.targetUrl).hostname);

    // Save Page Metadata
    const pageInfo: PageInfo = {
      url,
      title: pageAnalysis.title,
      screenshotFile: `screenshots/${safeTitle}.png`,
      forms: pageAnalysis.forms,
      links: pageAnalysis.links,
      angularRoutes: pageAnalysis.angularRoutes,
      staticJsFiles: pageAnalysis.staticFiles,
      timestamp: new Date().toISOString()
    };
    this.pages.push(pageInfo);

    // Merge static files and Angular routes discovered
    pageAnalysis.staticFiles.forEach(f => this.staticJsFiles.add(f));
    pageAnalysis.angularRoutes.forEach(r => {
      this.discoveredRoutes.add(r);
      // Try resolving absolute URL for discovered Angular routes and queue them
      try {
        const absoluteRoute = new URL(r, this.config.targetUrl).toString();
        if (!this.visitedUrls.has(absoluteRoute)) {
          this.visitedUrls.add(absoluteRoute);
          this.queue.push({ url: absoluteRoute, depth: depth + 1 });
        }
      } catch (_) {}
    });

    // Populate normal links into crawling queue
    for (const link of pageAnalysis.links) {
      // Basic normalization
      const cleanLink = link.split('#')[0];
      if (!this.visitedUrls.has(cleanLink)) {
        this.visitedUrls.add(cleanLink);
        this.queue.push({ url: cleanLink, depth: depth + 1 });
      }
    }

    // Try finding hidden routes in loaded JS scripts (static analysis of bundle strings)
    // We fetch and parse text from static js files that belong to the target host
    for (const scriptUrl of pageAnalysis.staticFiles) {
      if (scriptUrl.includes(new URL(this.config.targetUrl).hostname)) {
        try {
          const res = await page.context().request.get(scriptUrl);
          const body = await res.text();
          
          // Regex to search for potential path strings (e.g. "/dashboard", "/api/v1/...")
          const routeRegex = /['"`]([a-zA-Z0-9_\-\/]{2,50})['"`]/g;
          let match;
          while ((match = routeRegex.exec(body)) !== null) {
            const possiblePath = match[1];
            if (possiblePath.startsWith('/') && possiblePath.length > 2 && !possiblePath.includes('//')) {
              // Add to discovered routes
              this.discoveredRoutes.add(possiblePath);
              
              // If it looks like a typical router route, add to queue
              if (!possiblePath.includes('.') && !possiblePath.includes('/api/')) {
                const absUrl = new URL(possiblePath, this.config.targetUrl).toString();
                if (!this.visitedUrls.has(absUrl)) {
                  this.visitedUrls.add(absUrl);
                  this.queue.push({ url: absUrl, depth: depth + 1 });
                }
              }
            }
          }
        } catch (_) {}
      }
    }

    // Perform isolated form fuzzing if enabled
    if (this.config.formFuzzing && pageAnalysis.forms.length > 0) {
      await this.fuzzForms(url, pageAnalysis.forms);
    }

    await page.close();
  }

  private async fuzzForms(pageUrl: string, forms: any[]) {
    console.log(`\x1b[92m[+]\x1b[0m Dynamic Form Fuzzing: Interacting with \x1b[93m${forms.length}\x1b[0m forms on \x1b[36m${pageUrl}\x1b[0m in isolated contexts...`);
    for (let i = 0; i < forms.length; i++) {
      const tempPage = await this.context.newPage();
      try {
        // Navigate to the form page in a fresh tab
        await tempPage.goto(pageUrl, { waitUntil: 'networkidle', timeout: this.config.requestTimeoutMs });
        
        // Find the form element in the page
        const formHandle = await tempPage.locator('form').nth(i);
        if (!formHandle) continue;

        // Fill in the form fields with mock details
        const inputs = await formHandle.locator('input, textarea, select').all();
        for (const input of inputs) {
          const type = await input.getAttribute('type') || '';
          const isVisible = await input.isVisible();
          const isDisabled = await input.isDisabled();
          
          if (!isVisible || isDisabled) continue;

          if (type === 'submit' || type === 'button' || type === 'image') continue;

          try {
            if (type === 'checkbox') {
              await input.check().catch(() => {});
            } else if (type === 'radio') {
              await input.check().catch(() => {});
            } else if (type === 'email') {
              await input.fill('test-user@example.com').catch(() => {});
            } else if (type === 'number') {
              await input.fill('123').catch(() => {});
            } else if (type === 'password') {
              await input.fill('SafePass123!').catch(() => {});
            } else {
              // Standard text input
              await input.fill('test_input_value').catch(() => {});
            }
          } catch (_) {}
        }

        // Locate submit button and click
        const submitButton = await formHandle.locator('button[type="submit"], input[type="submit"]').first();
        if (submitButton && await submitButton.isVisible()) {
          console.log(`\x1b[92m[+]\x1b[0m Submitting form \x1b[33m#${i}\x1b[0m on isolated context...`);
          await Promise.all([
            tempPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}),
            submitButton.click().catch(() => {})
          ]);
        } else {
          // If no submit button found, trigger form submit event directly
          console.log(`\x1b[92m[+]\x1b[0m Triggering direct form submit element \x1b[33m#${i}\x1b[0m...`);
          await Promise.all([
            tempPage.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}),
            formHandle.evaluate(formEl => (formEl as HTMLFormElement).submit()).catch(() => {})
          ]);
        }
      } catch (err: any) {
        console.warn(`\x1b[91m[-]\x1b[0m Form fuzzing failed for form \x1b[33m#${i}\x1b[0m on \x1b[36m${pageUrl}\x1b[0m: ${err?.message || err}`);
      } finally {
        await tempPage.close();
      }
    }
  }

  private async saveResults() {
    const base = this.config.resultsDir;

    // Save RAW tracking files
    fs.writeFileSync(path.join(base, 'requests.json'), JSON.stringify(this.requests, null, 2));
    fs.writeFileSync(path.join(base, 'responses.json'), JSON.stringify(this.responses, null, 2));
    fs.writeFileSync(path.join(base, 'websockets.json'), JSON.stringify(this.websockets, null, 2));
    fs.writeFileSync(path.join(base, 'pages.json'), JSON.stringify(this.pages, null, 2));
    fs.writeFileSync(path.join(base, 'jsfiles.json'), JSON.stringify(Array.from(this.staticJsFiles), null, 2));
    fs.writeFileSync(path.join(base, 'routes.json'), JSON.stringify(Array.from(this.discoveredRoutes), null, 2));

    // Consolidate API schema and endpoints inventory
    const apiInventory = Array.from(this.apiEndpoints).map(endpoint => {
      const [method, url] = endpoint.split(' ');
      return { method, url };
    });
    fs.writeFileSync(path.join(base, 'api_inventory.json'), JSON.stringify(apiInventory, null, 2));
  }
}

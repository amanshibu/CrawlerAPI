import * as fs from 'fs';
import * as path from 'path';
import { PageInfo, NetworkRequest, NetworkResponse, WebSocketConnection } from './types';

export class CrawlReporter {
  private resultsDir: string;

  constructor(resultsDir: string) {
    this.resultsDir = resultsDir;
  }

  public generateMarkdownReport(): string {
    console.log('[+] Generating consolidated Markdown report...');
    
    // Read raw data
    const requests: NetworkRequest[] = JSON.parse(fs.readFileSync(path.join(this.resultsDir, 'requests.json'), 'utf-8'));
    const websockets: WebSocketConnection[] = JSON.parse(fs.readFileSync(path.join(this.resultsDir, 'websockets.json'), 'utf-8'));
    const pages: PageInfo[] = JSON.parse(fs.readFileSync(path.join(this.resultsDir, 'pages.json'), 'utf-8'));
    const jsFiles: string[] = JSON.parse(fs.readFileSync(path.join(this.resultsDir, 'jsfiles.json'), 'utf-8'));
    const routes: string[] = JSON.parse(fs.readFileSync(path.join(this.resultsDir, 'routes.json'), 'utf-8'));
    
    let apiInventory: { method: string; url: string }[] = [];
    if (fs.existsSync(path.join(this.resultsDir, 'api_inventory.json'))) {
      apiInventory = JSON.parse(fs.readFileSync(path.join(this.resultsDir, 'api_inventory.json'), 'utf-8'));
    }

    let md = `# Crawl & API Inventory Report\n\n`;
    md += `Generated on: ${new Date().toUTCString()}\n\n`;

    // 1. Executive Summary
    md += `## 1. Executive Summary\n\n`;
    md += `| Metric | Count |\n`;
    md += `| --- | --- |\n`;
    md += `| Visited Pages | ${pages.length} |\n`;
    md += `| Discovered Client Routes | ${routes.length} |\n`;
    md += `| Unique API Endpoints Detected | ${apiInventory.length} |\n`;
    md += `| Total Network Requests Logged | ${requests.length} |\n`;
    md += `| WebSocket Connections | ${websockets.length} |\n`;
    md += `| Static JS Bundles Identified | ${jsFiles.length} |\n\n`;

    // 2. Discovered Routes Map
    md += `## 2. Route Mapping & Client-Side Paths\n\n`;
    md += `Below is the list of client-side path definitions and URLs discovered during navigation:\n\n`;
    for (const route of routes.sort()) {
      md += `- \`${route}\`\n`;
    }
    md += `\n`;

    // 3. API Inventory
    md += `## 3. API Endpoints Inventory\n\n`;
    md += `The crawler identified the following unique API endpoints. Security auditors should review these for information disclosure, authentication requirements, and proper parameter validation:\n\n`;
    md += `| Method | API Path | Context |\n`;
    md += `| --- | --- | --- |\n`;
    for (const api of apiInventory) {
      const isAuthExclusion = api.url.toLowerCase().includes('login') || api.url.toLowerCase().includes('auth');
      md += `| \`${api.method}\` | \`${api.url}\` | ${isAuthExclusion ? 'Authentication Endpoint' : 'General API'} |\n`;
    }
    md += `\n`;

    // 4. WebSockets Inventory
    md += `## 4. WebSocket Connections\n\n`;
    if (websockets.length > 0) {
      md += `The following WebSocket servers and channels were requested:\n\n`;
      for (const ws of websockets) {
        md += `- \`${ws.url}\` (Triggered: ${ws.timestamp})\n`;
      }
    } else {
      md += `No WebSocket connections were initiated during the crawl.\n`;
    }
    md += `\n`;

    // 5. JavaScript Asset Inventory
    md += `## 5. JavaScript Bundles\n\n`;
    md += `Exposed client application bundles that were loaded and analyzed for routing strings:\n\n`;
    for (const js of jsFiles) {
      md += `- \`${js}\`\n`;
    }
    md += `\n`;

    // 6. Page Analysis Details
    md += `## 6. Detailed Page Audits\n\n`;
    for (const page of pages) {
      md += `### URL: ${page.url}\n`;
      md += `- **Page Title:** ${page.title}\n`;
      md += `- **Screenshot Path:** \`${page.screenshotFile}\`\n\n`;
      
      // Forms
      md += `#### Forms & Inputs Found:\n`;
      if (page.forms.length > 0) {
        for (const form of page.forms) {
          md += `- **Action:** \`${form.action || '(self)'}\` | **Method:** \`${form.method.toUpperCase()}\`\n`;
          md += `  - **Inputs:**\n`;
          for (const input of form.inputs) {
            md += `    - Name: \`${input.name}\` | Type: \`${input.type}\` | Placeholder: "${input.placeholder || ''}"\n`;
          }
        }
      } else {
        md += `No HTML form elements identified on this page.\n`;
      }
      md += `\n---\n\n`;
    }

    // Write Markdown report file
    fs.writeFileSync(path.join(this.resultsDir, 'report.md'), md);
    console.log(`[+] Markdown report successfully written to ${path.join(this.resultsDir, 'report.md')}`);
    
    // Auto-generate OpenAPI v3 Schema
    try {
      this.generateOpenApiSchema(apiInventory);
    } catch (err: any) {
      console.warn(`[!] Failed to generate OpenAPI v3 schema: ${err?.message || err}`);
    }

    return md;
  }

  private generateOpenApiSchema(apiInventory: { method: string; url: string }[]) {
    console.log('[+] Generating OpenAPI v3 contract schema...');
    
    const openapi: any = {
      openapi: '3.0.0',
      info: {
        title: 'Discovered API Inventory',
        description: 'Auto-compiled REST API schema captured during dynamic crawl operations.',
        version: '1.0.0'
      },
      paths: {}
    };

    for (const api of apiInventory) {
      try {
        const urlObj = new URL(api.url);
        let apiPath = urlObj.pathname;
        
        // Ensure path starts with slash
        if (!apiPath.startsWith('/')) {
          apiPath = '/' + apiPath;
        }

        const method = api.method.toLowerCase();
        
        // Extract query parameters if any exist
        const parameters: any[] = [];
        urlObj.searchParams.forEach((value, key) => {
          parameters.push({
            name: key,
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              default: value
            },
            description: `Auto-extracted default parameter value`
          });
        });

        // Initialize path node if empty
        if (!openapi.paths[apiPath]) {
          openapi.paths[apiPath] = {};
        }

        openapi.paths[apiPath][method] = {
          summary: `Discovered ${api.method} endpoint`,
          description: `Logged target: ${api.url}`,
          parameters: parameters.length > 0 ? parameters : undefined,
          responses: {
            '200': {
              description: 'Successful response captured during crawl audit.'
            }
          }
        };
      } catch (_) {
        // Skip malformed/invalid URLs
      }
    }

    const outputPath = path.join(this.resultsDir, 'openapi.json');
    fs.writeFileSync(outputPath, JSON.stringify(openapi, null, 2), 'utf-8');
    console.log(`[+] OpenAPI v3 contract schema successfully written to ${outputPath}`);
  }
}

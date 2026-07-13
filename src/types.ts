export interface CrawlerConfig {
  targetUrl: string;
  maxDepth: number;
  maxConcurrency: number;
  requestTimeoutMs: number;
  resultsDir: string;
  userAgent: string;
  sensitiveHeaders: string[];
  excludedExtensions: string[];
  manualLogin: boolean;
  manualLoginTimeoutMs: number;
  sessionFile?: string;
  formFuzzing?: boolean;
}

export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData: string | null;
  timestamp: string;
}

export interface NetworkResponse {
  id: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  bodyFile?: string;
  bodyPreview?: string;
  timestamp: string;
}

export interface WebSocketConnection {
  url: string;
  timestamp: string;
}

export interface PageFormInput {
  name: string;
  type: string;
  placeholder?: string;
  value?: string;
}

export interface PageForm {
  action: string;
  method: string;
  inputs: PageFormInput[];
}

export interface PageInfo {
  url: string;
  title: string;
  screenshotFile?: string;
  forms: PageForm[];
  links: string[];
  angularRoutes: string[];
  staticJsFiles: string[];
  timestamp: string;
}

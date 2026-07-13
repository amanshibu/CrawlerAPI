import * as fs from 'fs';
import * as path from 'path';
import { PlaywrightCrawler } from './crawler';
import { CrawlReporter } from './reporter';
import { CrawlerConfig } from './types';

async function main() {
  // Print CLI Banner (CrawlerAPI with colorful ANSI gradient)
  console.log(`
\x1b[95m  ____                      _             _     ____   ___  \x1b[0m
\x1b[94m / ___|_ __ __ ___      ___| | ___ _ __  / \\   |  _ \\ |_ _| \x1b[0m
\x1b[96m| |   | '__/ _\` \\ \\ /\\ / / |/ _ \\ '__|/ _ \\  | |_) | | |  \x1b[0m
\x1b[92m| |___| | | (_| |\\ V  V /| |  __/ |  / ___ \\ |  __/  | |  \x1b[0m
\x1b[93m \\____|_|  \\__,_| \\_/\\_/ |_|\\___|_| /_/   \\_\\|_|    |___| \x1b[0m
\x1b[90m           - Dynamic SPA & API Web Mapper - \x1b[0m
  `);

  const args = process.argv.slice(2);
  const configPath = path.join(process.cwd(), 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error(`\x1b[91m[-]\x1b[0m Configuration file not found at ${configPath}`);
    process.exit(1);
  }

  const config: CrawlerConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Robust CLI argument parser
  // Supports:
  // - Positional arguments: npm run crawl -- https://example.com 2 target_folder no-login fuzz
  // - Flagged arguments: npm run crawl -- -t https://example.com -d 2 -o target_folder -s session.json --fuzz
  let positionalIndex = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-t' || arg === '--target') {
      config.targetUrl = args[i + 1];
      i++;
    } else if (arg === '-d' || arg === '--depth') {
      config.maxDepth = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--no-login' || arg === 'no-login') {
      config.manualLogin = false;
    } else if (arg === '--fuzz' || arg === 'fuzz') {
      config.formFuzzing = true;
    } else if (arg === '-s' || arg === '--session') {
      config.sessionFile = args[i + 1];
      i++;
    } else if (arg === '-o' || arg === '--output') {
      const outputDirName = args[i + 1];
      config.resultsDir = path.join('./results', outputDirName);
      i++;
    } else if (!arg.startsWith('-')) {
      // Treat as positional argument
      if (positionalIndex === 0) {
        config.targetUrl = arg;
      } else if (positionalIndex === 1) {
        config.maxDepth = parseInt(arg, 10);
      } else if (positionalIndex === 2) {
        if (arg === 'no-login') {
          config.manualLogin = false;
        } else if (arg === 'fuzz') {
          config.formFuzzing = true;
        } else {
          config.resultsDir = path.join('./results', arg);
        }
      } else if (positionalIndex === 3 || positionalIndex === 4) {
        if (arg === 'no-login') {
          config.manualLogin = false;
        } else if (arg === 'fuzz') {
          config.formFuzzing = true;
        }
      }
      positionalIndex++;
    }
  }

  if (!config.targetUrl) {
    console.error('\x1b[91m[-]\x1b[0m Error: Seed target URL is missing.');
    console.log('\x1b[93mUsage options:\x1b[0m');
    console.log('  npm run crawl -- <targetUrl> [<maxDepth>] [<outputFolder>] [no-login] [fuzz]');
    console.log('  npm run crawl -- -t <targetUrl> -d <depth> [-o <outputFolder>] [-s <sessionFile>] [--no-login] [--fuzz]');
    process.exit(1);
  }

  try {
    const crawler = new PlaywrightCrawler(config);
    await crawler.start();

    const reporter = new CrawlReporter(config.resultsDir);
    reporter.generateMarkdownReport();
  } catch (err) {
    console.error('\x1b[91m[-]\x1b[0m Fatal error running crawler CLI:', err);
    process.exit(1);
  }
}

main();

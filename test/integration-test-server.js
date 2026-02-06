/**
 * Omosuen Integration Test Server
 *
 * Serves test page and validates integration test flow via console logs.
 * Expected test sequence:
 * 1. Omosuen init
 * 2. Omosuen start
 * 3. Scene A loaded (integration-scene.js)
 * 4. Scene A serialized
 * 5. Scene A unloaded
 * 6. Scene B loaded (memory countdown scene)
 * 7. Countdown complete
 * 8. Scene B unloaded
 * 9. Scene A deserialized
 * 10. Scene A reloaded
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const INACTIVITY_TIMEOUT = 30000; // 30 seconds

// Required log checklist (must arrive in this sequence)
const REQUIRED_LOGS = [
  'Omosuen init',
  'Omosuen start',
  'scene a loaded',
  'scene a serialized',
  'scene a unloaded',
  'scene b loaded',
  'countdown complete',
  'scene b unloaded',
  'scene a deserialized',
  'scene a reloaded',
];

// Test state
let checklistIndex = 0;
let errorCount = 0;
let warningCount = 0;
let infoCount = 0;
let consoleCount = 0;
let unexpectedInfoCount = 0;
let unexpectedConsoleCount = 0;
let serializedScene = null;
let inactivityTimer = null;

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Reset inactivity timer on each log received
 */
function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  inactivityTimer = setTimeout(() => {
    console.error(
      `${colors.red}✗ TEST TIMEOUT: No logs received for 30 seconds${colors.reset}`,
    );
    printSummary(false, 'Inactivity timeout');
    process.exit(1);
  }, INACTIVITY_TIMEOUT);
}

/**
 * Print test summary and exit
 */
function printSummary(passed, reason = '') {
  console.log(`\n${colors.cyan}━━━ Integration Test Summary ━━━${colors.reset}`);
  console.log(
    `Required logs: ${checklistIndex}/${REQUIRED_LOGS.length} ${checklistIndex === REQUIRED_LOGS.length ? '✓' : '✗'}`,
  );
  console.log(
    `Errors: ${errorCount} ${errorCount === 0 ? '✓' : '✗'}`,
  );
  console.log(`Warnings: ${warningCount} (allowed)`);
  console.log(
    `Info logs: ${infoCount}${unexpectedInfoCount > 0 ? ` (${unexpectedInfoCount} unexpected)` : ''}`,
  );
  console.log(
    `Console logs: ${consoleCount}${unexpectedConsoleCount > 0 ? ` (${unexpectedConsoleCount} unexpected)` : ''}`,
  );

  if (reason) {
    console.log(`${colors.red}Reason: ${reason}${colors.reset}`);
  }

  if (passed && checklistIndex === REQUIRED_LOGS.length && errorCount === 0) {
    console.log(`\n${colors.green}Status: ✓ PASS${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}Status: ✗ FAIL${colors.reset}\n`);
    process.exit(1);
  }
}

/**
 * Handle incoming logs from browser
 */
function handleLog(logData) {
  resetInactivityTimer();

  const { level, message } = logData;

  // Track log counts
  switch (level) {
    case 'error':
      errorCount++;
      console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
      printSummary(false, `Error logged: ${message}`);
      return;
    case 'warn':
      warningCount++;
      console.warn(`${colors.yellow}[WARN]${colors.reset} ${message}`);
      return;
    case 'info':
      infoCount++;
      console.info(`${colors.cyan}[INFO]${colors.reset} ${message}`);
      break;
    case 'log':
      consoleCount++;
      console.log(`${colors.gray}[LOG]${colors.reset} ${message}`);
      break;
  }

  // Check against required checklist
  if (checklistIndex < REQUIRED_LOGS.length) {
    const expectedLog = REQUIRED_LOGS[checklistIndex];

    // Check if this message matches the next expected log
    if (message.includes(expectedLog)) {
      console.log(
        `${colors.green}✓ Checklist [${checklistIndex + 1}/${REQUIRED_LOGS.length}]${colors.reset} ${expectedLog}`,
      );
      checklistIndex++;

      // Test complete!
      if (checklistIndex === REQUIRED_LOGS.length) {
        setTimeout(() => {
          printSummary(true);
        }, 1000); // Give browser time to finish
      }
    } else {
      // Track unexpected logs
      if (level === 'info') unexpectedInfoCount++;
      if (level === 'log') unexpectedConsoleCount++;
    }
  } else {
    // All checklist items received, but still getting logs
    if (level === 'info') unexpectedInfoCount++;
    if (level === 'log') unexpectedConsoleCount++;
  }
}

/**
 * Get MIME type for file extension
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Serve static files
 */
function serveStaticFile(res, filePath) {
  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': getMimeType(fullPath) });
    res.end(data);
  });
}

/**
 * HTTP request handler
 */
const server = http.createServer((req, res) => {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // POST /log - Receive console logs from browser
  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const logData = JSON.parse(body);
        handleLog(logData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error(`${colors.red}[ERROR] Failed to parse log:${colors.reset}`, err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // POST /save-scene - Store serialized scene
  if (req.method === 'POST' && req.url === '/save-scene') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        serializedScene = JSON.parse(body);
        console.log(`${colors.cyan}[SERVER] Scene saved to memory${colors.reset}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error(`${colors.red}[ERROR] Failed to save scene:${colors.reset}`, err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // GET /load-scene - Retrieve serialized scene
  if (req.method === 'GET' && req.url === '/load-scene') {
    if (serializedScene) {
      console.log(`${colors.cyan}[SERVER] Scene loaded from memory${colors.reset}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(serializedScene));
    } else {
      console.error(`${colors.red}[ERROR] No scene in memory${colors.reset}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No scene saved' }));
    }
    return;
  }

  // Serve static files
  if (req.method === 'GET') {
    let filePath = req.url === '/' ? '/integration-test.html' : req.url;
    serveStaticFile(res, filePath);
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

// Start server
server.listen(PORT, (err) => {
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `${colors.red}✗ Port ${PORT} is already in use. Please free the port and try again.${colors.reset}`,
      );
      process.exit(1);
    } else {
      console.error(`${colors.red}✗ Server error:${colors.reset}`, err);
      process.exit(1);
    }
  }

  console.log(`${colors.green}✓ Test server running at http://localhost:${PORT}/${colors.reset}`);
  console.log(`${colors.cyan}Waiting for test to begin...${colors.reset}\n`);

  // Start inactivity timer
  resetInactivityTimer();
});

// Handle server errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `${colors.red}✗ Port ${PORT} is already in use. Please free the port and try again.${colors.reset}`,
    );
    process.exit(1);
  } else {
    console.error(`${colors.red}✗ Server error:${colors.reset}`, err);
    process.exit(1);
  }
});

// Handle process termination
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}Test interrupted by user${colors.reset}`);
  printSummary(false, 'Interrupted by user');
});

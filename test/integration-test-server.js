/**
 * Simple HTTP server for testing Omosuen
 * Serves the test/ directory on http://localhost:3000
 */

import handler from 'serve-handler';
import http from 'http';

const server = http.createServer((request, response) => {
  return handler(request, response, {
    public: 'test',
    headers: [
      {
        source: '**/*.@(js|mjs)',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript'
          }
        ]
      }
    ]
  });
});

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   Omosuen Test Server Running            ║
║   http://localhost:${PORT}                   ║
╚═══════════════════════════════════════════╝
  `);
});

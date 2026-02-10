// CLI Test Runner
// Imports and runs all CLI-based tests

import { runArray3DiTests } from './array3di.test.js';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

console.log(
  `${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}`,
);
console.log(
  `${colors.bright}${colors.cyan}Omosuen CLI Test Suite${colors.reset}`,
);
console.log(
  `${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`,
);

// Run all CLI tests
runArray3DiTests();

console.log(
  `\n${colors.bright}${colors.green}CLI Test Suite Complete${colors.reset}\n`,
);

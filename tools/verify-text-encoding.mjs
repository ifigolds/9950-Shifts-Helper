import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanRoots = [
  path.join(rootDir, 'server'),
  path.join(rootDir, 'web', 'src'),
];

const textFilePattern = /\.(js|jsx|mjs|cjs|css|html|json|md|txt)$/i;
const suspiciousPatterns = [
  { label: 'replacement character', pattern: /\uFFFD/ },
  { label: 'question-mark mojibake', pattern: /\?{3,}/ },
  { label: 'latin mojibake marker', pattern: /(?:Ã|Â|ðŸ|âœ|â|â€¢|â†)/ },
];

function collectFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }

    return textFilePattern.test(entry.name) ? [fullPath] : [];
  });
}

const failures = [];

for (const filePath of scanRoots.flatMap(collectFiles)) {
  const content = fs.readFileSync(filePath, 'utf8');

  for (const { label, pattern } of suspiciousPatterns) {
    if (pattern.test(content)) {
      failures.push(`${path.relative(rootDir, filePath)}: ${label}`);
    }
  }
}

if (failures.length) {
  console.error('Suspicious text encoding markers found:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Text encoding smoke test passed.');

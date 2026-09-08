const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');

const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
while ((match = regex.exec(html)) !== null) {
  const code = match[1];
  if (!code.trim()) continue; // skip empty or external scripts
  count++;
  try {
    new vm.Script(code);
  } catch (e) {
    console.error('Script block failed to parse:');
    console.error(e.message);
    const lineNum = html.substring(0, match.index).split('\n').length;
    console.error('Near line:', lineNum);
    process.exit(1);
  }
}
console.log(`Successfully parsed ${count} inline script blocks.`);

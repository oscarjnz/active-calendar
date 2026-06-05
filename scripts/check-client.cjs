// Extrae el <script type="module"> de un html.ts, lo desescapa y verifica sintaxis.
const fs = require('fs');
const { execSync } = require('node:child_process');
const FILE = process.argv[2] || 'src/html.ts';
const s = fs.readFileSync(FILE, 'utf8');
const a = s.indexOf('<script type="module">');
const b = s.lastIndexOf('</script>');
let js = s.slice(s.indexOf('\n', a) + 1, b);
js = js.replace(/\\`/g, '`').replace(/\\\$\{/g, '${').replace(/\\\\/g, '\\');
const out = FILE + '.check.mjs';
fs.writeFileSync(out, js);
try {
  execSync('node --check ' + out, { stdio: 'inherit' });
  console.log('CLIENT_JS_OK');
} finally {
  fs.unlinkSync(out);
}

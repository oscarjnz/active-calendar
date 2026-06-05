// Minifica el <script type="module"> embebido en src/html.ts para el deploy.
// El repo se mantiene legible; en CI se reescribe el archivo (checkout efímero)
// para que lo que llega al navegador esté minificado y sea difícil de copiar.
//
// Uso: node scripts/minify-client.mjs [rutaHtmlTs]
// Por defecto opera sobre src/html.ts EN EL SITIO. Pásale otra ruta para pruebas.

import { readFileSync, writeFileSync } from 'node:fs';
import { transform } from 'esbuild';

const FILE = process.argv[2] || 'src/html.ts';

const START = '<script type="module">';
const END = '</script>';

function unescapeTemplate(s) {
  // Invierte el escape del template literal de TS -> JS real.
  return s.replace(/\\`/g, '`').replace(/\\\$\{/g, '${').replace(/\\\\/g, '\\');
}
function escapeTemplate(s) {
  // Reescapa para volver a meterlo dentro del template literal de TS.
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const html = readFileSync(FILE, 'utf8');
const iStart = html.indexOf(START);
if (iStart === -1) {
  console.error('No se encontró el <script type="module"> en', FILE);
  process.exit(1);
}
const contentStart = html.indexOf('\n', iStart) + 1;
const iEnd = html.lastIndexOf(END);
if (iEnd === -1 || iEnd <= contentStart) {
  console.error('No se encontró el </script> de cierre en', FILE);
  process.exit(1);
}

const rawEscaped = html.slice(contentStart, iEnd);
const realJs = unescapeTemplate(rawEscaped);

const result = await transform(realJs, {
  loader: 'js',
  format: 'esm',
  minify: true,
  target: 'es2022',
  legalComments: 'none',
});

const minEscaped = escapeTemplate(result.code.trim());
const out = html.slice(0, contentStart) + minEscaped + '\n' + html.slice(iEnd);
writeFileSync(FILE, out, 'utf8');

const before = rawEscaped.length;
const after = minEscaped.length;
console.log(`client minificado: ${before} -> ${after} bytes (${Math.round((1 - after / before) * 100)}% menos)`);

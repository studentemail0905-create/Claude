// Builds dist-single/no-clearance.html: one self-contained page (JS + CSS inlined), no external requests.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const html = readFileSync('dist/index.html', 'utf8');
const js = readFileSync('dist/' + html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1], 'utf8').replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = readFileSync('dist/' + html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1], 'utf8');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const out = `<title>NO CLEARANCE</title>
<style>
:root { color-scheme: dark; }
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/no-clearance.html', out);
console.log('dist-single/no-clearance.html', (out.length / 1024).toFixed(0), 'KB');

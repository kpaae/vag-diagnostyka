// Składa aplikację w jeden plik: node src/build.js  →  index.html
const fs = require('fs');
const path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

const css = rd('style.css');
const body = rd('body.html');
const core = rd('core.js').replace(/\nif \(typeof module[^\n]*\n?/, '\n');
const panels = rd('panels.js');
const app = rd('app.js');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">';

const out = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1215" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#e8ebee" media="(prefers-color-scheme: light)">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>VAG Diagnostyka</title>
${fonts}
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
<style>
${css}</style>
${body}
<script>
${core}
${panels}
${app}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), out);
console.log('index.html', out.length, 'B');

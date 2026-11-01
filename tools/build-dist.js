'use strict';
/* Собирает автономный однофайловый HTML: CSS и все скрипты встраиваются внутрь. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (m, href) {
  const css = fs.readFileSync(path.join(root, href), 'utf8');
  return '<style>\n/* ' + href + ' */\n' + css + '\n</style>';
});

let scripts = 0;
html = html.replace(/<script src="([^"]+)"><\/script>/g, function (m, src) {
  const js = fs.readFileSync(path.join(root, src), 'utf8');
  scripts++;
  if (js.indexOf('</script>') >= 0) throw new Error('В ' + src + ' есть </script>');
  return '<script>\n/* ' + src + ' */\n' + js + '\n</script>';
});

const external = html.match(/(?:src|href)="(?:js|css)\//);
if (external) throw new Error('Остались внешние ссылки: ' + external[0]);

const banner = '<!-- Геодезист: Полевой выезд. Автономная сборка. Открывается двойным щелчком, интернет не нужен. -->\n';
html = html.replace('<!doctype html>', '<!doctype html>\n' + banner);

const out1 = path.join(root, 'dist', 'geodezist.html');
const out2 = path.join(root, 'dist', 'Геодезист_Полевой_выезд.html');
fs.writeFileSync(out1, html, 'utf8');
fs.writeFileSync(out2, html, 'utf8');
console.log('dist: ' + scripts + ' скриптов, ' + Math.round(html.length / 1024) + ' КБ');
console.log(out1);
console.log(out2);

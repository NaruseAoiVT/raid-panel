// RAID PANEL の自己点検。直したら `node test.mjs` を実行する。
import fs from 'fs';

const js = fs.readFileSync('panel.js', 'utf8');
let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) { console.log('  ok  ' + label); return; }
  fail++;
  console.log('  NG  ' + label + (detail ? '\n      ' + detail : ''));
};

// ---- panel.js が要求している部品を洗い出す ----
const required = new Set();
for (const m of js.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)) required.add(m[1]);
for (const m of js.matchAll(/getElementById\('([A-Za-z0-9_]+)'\)/g)) required.add(m[1]);
const listBlock = js.match(/var el = \{\};\n\[([\s\S]*?)\]\.forEach/);
if (listBlock) for (const m of listBlock[1].matchAll(/'([A-Za-z0-9_]+)'/g)) required.add(m[1]);

console.log('--- 画面の部品がそろっているか ---');
console.log('  panel.js が要求する部品: ' + required.size + '個');

for (const file of ['index.html', 'dock.html']) {
  const html = fs.readFileSync(file, 'utf8');
  const ids = new Set([...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map(m => m[1]));
  const missing = [...required].filter(id => !ids.has(id));
  const dup = [...ids].filter(id => (html.match(new RegExp('id="' + id + '"', 'g')) || []).length > 1);
  ok(file + ' に全部そろっている', missing.length === 0, '足りない: ' + missing.join(', '));
  ok(file + ' にidの重複がない', dup.length === 0, '重複: ' + dup.join(', '));
}

console.log('--- 共有ファイルの読み込み ---');
for (const file of ['index.html', 'dock.html']) {
  const html = fs.readFileSync(file, 'utf8');
  ok(file + ' が panel.css を読む', html.includes('href="panel.css"'));
  ok(file + ' が config.js を読む', html.includes('src="config.js"'));
  ok(file + ' が panel.js を読む', html.includes('src="panel.js"'));
  ok(file + ' に古い埋め込みが残っていない', !/<style>[\s\S]*--bg:/.test(html) && !html.includes("'use strict'"));
}

console.log('--- モードの指定 ---');
ok('index.html は wide',
   /<body data-mode="wide">/.test(fs.readFileSync('index.html', 'utf8')));
ok('dock.html は dock',
   /<body data-mode="dock">/.test(fs.readFileSync('dock.html', 'utf8')));

console.log('--- 設定 ---');
const cfg = fs.readFileSync('config.js', 'utf8');
ok('CLIENT_ID が入っている', /CLIENT_ID:\s*"[a-z0-9]{20,}"/.test(cfg));

console.log(fail === 0 ? '\n全テスト通過' : '\n失敗 ' + fail + ' 件');
process.exit(fail ? 1 : 0);

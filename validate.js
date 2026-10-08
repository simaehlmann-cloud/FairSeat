/* Statische Prüfung von FairSeat – läuft vor jedem Store-Build.
 *
 *   node validate.js
 *
 * Prüft, was beim Bauen nicht auffällt, im Store aber teuer wird:
 * Syntax, fehlende Übersetzungen, verwaiste Element-IDs, Versionsgleichstand
 * (config.xml, index.html, sw.js), Icons, Manifest, Rechtstexte und das
 * Privacy-Manifest für Apple.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { JSDOM } = require('jsdom');

let fehler = 0, ok = 0;
function pruefe(bedingung, text){
  if(bedingung){ ok++; }
  else { fehler++; console.error('  ✗ ' + text); }
}
function abschnitt(t){ console.log('· ' + t); }

const html = fs.readFileSync('index.html', 'utf8');

/* ---- 1. Syntax ---- */
abschnitt('Syntax');
const skripte = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
pruefe(skripte.length === 1, 'Erwartet genau einen eingebetteten Skriptblock, gefunden: ' + skripte.length);
try { new vm.Script(skripte[0], { filename: 'index.html' }); ok++; }
catch(e){ fehler++; console.error('  ✗ Syntaxfehler: ' + e.message); }
pruefe(!/https?:\/\/(?!www\.w3\.org)/.test(skripte[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')),
  'Das Skript enthält eine Netzadresse – die App muss offline bleiben');
pruefe(!/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(skripte[0]), 'Das Skript baut Netzverbindungen auf');
pruefe(/<script src="cordova\.js"><\/script>/.test(html), 'cordova.js wird nicht geladen – Teilen und Zurück-Taste fehlen in der App');
pruefe(/Content-Security-Policy/.test(html), 'Content-Security-Policy fehlt');

/* ---- 2. Laufzeitobjekte über jsdom ---- */
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/' });
const w = dom.window;
const I18N = w.eval('I18N');
const APP_VERSION = w.eval('APP_VERSION');

/* ---- 3. Übersetzungen ---- */
abschnitt('Übersetzungen');
const schluessel = new Set();
for(const m of skripte[0].matchAll(/\bt\("([A-Za-z0-9_]+)"\)/g)) schluessel.add(m[1]);
for(const m of html.matchAll(/data-(?:i|ph)="([A-Za-z0-9_]+)"/g)) schluessel.add(m[1]);
for(const k of schluessel){
  pruefe(I18N.de[k] !== undefined, 'Deutscher Text fehlt: ' + k);
  pruefe(I18N.en[k] !== undefined, 'Englischer Text fehlt: ' + k);
}
for(const k of Object.keys(I18N.de)){
  if(typeof I18N.de[k] === 'string') pruefe(I18N.en[k] !== undefined, 'Nur deutsch vorhanden: ' + k);
}
for(const k of Object.keys(I18N.en)){
  if(typeof I18N.en[k] === 'string') pruefe(I18N.de[k] !== undefined, 'Nur englisch vorhanden: ' + k);
}
['items', 'presets', 'presetsSub', 'tags', 'tagsSub'].forEach(g => {
  Object.keys(I18N.de[g]).forEach(k => pruefe(I18N.en[g] && I18N.en[g][k] !== undefined, 'Englisch fehlt: ' + g + '.' + k));
});
pruefe(Array.isArray(I18N.de.info) && I18N.de.info.length === I18N.en.info.length, 'Info-Abschnitte de/en ungleich lang');

/* ---- 4. Element-IDs ---- */
abschnitt('Element-IDs');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
for(const m of skripte[0].matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)){
  pruefe(ids.has(m[1]), 'Skript greift auf fehlende ID zu: #' + m[1]);
}
const doppelt = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
pruefe(!doppelt.length, 'Doppelte IDs: ' + doppelt.join(', '));

/* ---- 4b. Katalog: jedes Möbel braucht Symbol, Aussehen, Druckfarbe ---- */
abschnitt('Möbelkatalog');
const ITEMS = w.eval('ITEMS'), PRINT_FILL = w.eval('PRINT_FILL'), ROOM_TEMPLATES = w.eval('ROOM_TEMPLATES');
for(const type of Object.keys(ITEMS)){
  if(type === 'desk') continue;
  pruefe(html.includes('<symbol id="i-' + type + '"'), 'Symbol i-' + type + ' fehlt (Palette)');
  pruefe(html.includes('.t-' + type + '{') || type === 'label', 'Aussehen .t-' + type + ' fehlt');
  pruefe(PRINT_FILL[type] !== undefined, 'Druckfarbe für ' + type + ' fehlt (PDF/PNG)');
}
for(const [key, tpl] of Object.entries(ROOM_TEMPLATES)){
  pruefe(tpl.items.every(r => ITEMS[r[0]]), 'Vorlage ' + key + ' nutzt unbekanntes Möbel');
  pruefe(tpl.w >= 600 && tpl.w <= 6000 && tpl.h >= 600 && tpl.h <= 6000, 'Vorlage ' + key + ' hat unplausible Größe');
}

/* ---- 5. Version an drei Stellen ---- */
abschnitt('Version');
const config = fs.readFileSync('config.xml', 'utf8');
const ver = (config.match(/<widget[^>]*\sversion="([^"]+)"/) || [])[1];
const code = (config.match(/android-versionCode="(\d+)"/) || [])[1];
const iosCode = (config.match(/ios-CFBundleVersion="(\d+)"/) || [])[1];
pruefe(ver === APP_VERSION, 'config.xml version ' + ver + ' ≠ APP_VERSION ' + APP_VERSION);
if(ver){
  const [a, b, c] = ver.split('.').map(Number);
  pruefe(String(a * 10000 + b * 100 + c) === code, 'android-versionCode passt nicht zu ' + ver + ' (erwartet ' + (a * 10000 + b * 100 + c) + ')');
}
pruefe(code === iosCode, 'ios-CFBundleVersion ' + iosCode + ' ≠ android-versionCode ' + code);
const sw = fs.readFileSync('sw.js', 'utf8');
pruefe(sw.includes("const CACHE = 'fairseat-" + APP_VERSION + "';"), 'Cache-Name in sw.js trägt nicht die Version ' + APP_VERSION);
pruefe(/<widget id="de\.fairseat\.app"/.test(config), 'Paketkennung ist nicht de.fairseat.app');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pruefe(pkg.version === APP_VERSION, 'package.json version ≠ APP_VERSION');

/* ---- 6. Icons ---- */
abschnitt('Icons');
function pngMasse(datei){
  const b = fs.readFileSync(datei);
  if(b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), farbtyp: b[25] };
}
const sollIcons = { 'icon-1024.png': 1024, 'icon.png': 512, 'icon-192.png': 192, 'icon-maskable-512.png': 512 };
for(const [d, n] of Object.entries(sollIcons)){
  const m = fs.existsSync(d) ? pngMasse(d) : null;
  pruefe(m && m.w === n && m.h === n, d + ' fehlt oder ist nicht ' + n + '×' + n);
}
const icon1024 = pngMasse('icon-1024.png');
pruefe(icon1024 && icon1024.farbtyp === 2, 'icon-1024.png muss ohne Alphakanal sein (Apple)');
for(const m of config.matchAll(/(?:src|foreground)="(res\/android\/[^"]+)"/g)){
  pruefe(fs.existsSync(m[1]), 'In config.xml genannt, aber nicht vorhanden: ' + m[1]);
}
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
for(const ic of manifest.icons){
  const m = fs.existsSync(ic.src) ? pngMasse(ic.src) : null;
  pruefe(m && ic.sizes === m.w + 'x' + m.h, 'manifest.json: ' + ic.src + ' fehlt oder hat falsche Größe');
}

/* ---- 7. Rechtstexte und Apple ---- */
abschnitt('Rechtstexte');
['datenschutz.html', 'impressum.html', 'datenschutz-en.html', 'impressum-en.html'].forEach(d => {
  pruefe(fs.existsSync(d), d + ' fehlt');
  if(fs.existsSync(d)){
    const t = fs.readFileSync(d, 'utf8');
    pruefe(!/FairMix Pro/.test(t), d + ' nennt noch FairMix Pro');
    pruefe(/smaehlmann\.appdev@gmail\.com/.test(t), d + ' ohne Kontaktadresse');
  }
  pruefe(html.includes('"' + d + '"'), 'Die App verlinkt ' + d + ' nicht');
});
const { erwarteteDateien } = require('./make-legal-pages.js');
for(const [ziel, inhalt] of Object.entries(erwarteteDateien())){
  pruefe(fs.existsSync(ziel) && fs.readFileSync(ziel, 'utf8') === inhalt,
    ziel + ' ist veraltet – bitte "node make-legal-pages.js" ausführen');
}
const privacy = fs.readFileSync(path.join('res', 'ios', 'PrivacyInfo.xcprivacy'), 'utf8');
pruefe(privacy.includes('CA92.1') && privacy.includes('NSPrivacyTracking'), 'PrivacyInfo.xcprivacy unvollständig');
pruefe(/<preference name="target-device" value="universal" \/>/.test(config), 'iPad-Unterstützung (target-device universal) fehlt in config.xml');
/* Das Teilen-Plugin liest den Schlüssel „iPadCoordinates“ (SocialSharing.m) – ein anderer Name wird still ignoriert */
pruefe(/iPadCoordinates:\s*shareAnchor\(\)/.test(skripte[0]) && !/iPadPopupCoordinates:/.test(skripte[0]), 'Teilen ohne iPad-Ankerpunkt – bricht auf dem iPad ab');
/* Übertragen enthält alle Noten: nur entsperrt und nur verschlüsselt */
pruefe(/function openTransfer\(\)\{\s*if\(!hasCrypto\(\)\)\{[^}]*\}\s*if\(needUnlock\(openTransfer\)\) return;/.test(skripte[0]) && /encryptBackup\(JSON\.stringify\(\{ app: "fairseat", v: 2, data: backupData\(\) \}\), pass\);\s*const blob = new Blob\(\[JSON\.stringify\(obj\)\]/.test(skripte[0]),
  'Übertragen auf ein anderes Gerät ohne Sperre oder ohne Verschlüsselung');
pruefe(/NSPhotoLibraryAddUsageDescription/.test(config) && /NSPhotoLibraryUsageDescription/.test(config),
  'Foto-Hinweistexte für iOS fehlen in config.xml');

w.close();
console.log('\n' + ok + ' Prüfungen bestanden, ' + fehler + ' Fehler.');
process.exit(fehler ? 1 : 0);

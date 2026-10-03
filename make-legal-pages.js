/* Erzeugt aus den Rechtstexten der App die Fassungen für GitHub Pages.
 *
 *   node make-legal-pages.js
 *
 * Die Dateien im Wurzelverzeichnis sind die einzige Quelle. Einzige
 * Umformung: "Zurück zur App" zeigt im Web auf die Übersichtsseite, weil
 * Pages aus docs/ liefert und die App selbst dort nicht liegt.
 * validate.js führt dieselbe Umformung im Speicher aus und vergleicht –
 * so kann die Datenschutzerklärung im Store nicht von der in der App abweichen.
 *
 * Adresse nach dem Einschalten (Settings → Pages → main, /docs):
 *   https://simaehlmann-cloud.github.io/FairSeat/fairseat/datenschutz.html
 */
const fs = require('fs');
const path = require('path');

const ZIEL = 'docs';

function fuerWeb(html) {
  return html
    .replace(/href="index\.html">Zurück zur App</g, 'href="../">Zur Übersicht<')
    .replace(/href="index\.html">Back to the app</g, 'href="../">Overview<')
    .replace(/<title>([^<]*)<\/title>/, '<title>$1</title>\n<meta name="robots" content="index, follow">');
}

const START = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FairSeat – Rechtliches</title>
<meta name="theme-color" content="#003366">
<style>
  :root { --bg:#bcdcff; --card:#fff; --text:#003366; --border:#0055aa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#121220; --card:#1e1e30; --text:#e6e6ee; --border:#5b9ce6; }
  }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--text);
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         line-height:1.5; }
  main { max-width:640px; margin:0 auto; background:var(--card);
         border:2px solid var(--border); border-radius:14px; padding:24px; }
  h1 { font-size:24px; margin:0 0 8px; }
  h2 { font-size:18px; margin:24px 0 8px; }
  ul { margin:0; padding-left:20px; }
  li { margin:6px 0; }
  a { color:var(--border); }
</style>
</head>
<body>
<main>
  <h1>Wisdompeak Apps</h1>
  <p>Rechtliche Angaben zu FairSeat von Simon Mählmann.</p>

  <h2>FairSeat</h2>
  <ul>
    <li><a href="fairseat/datenschutz.html">Datenschutzerklärung</a></li>
    <li><a href="fairseat/impressum.html">Impressum</a></li>
    <li><a href="fairseat/datenschutz-en.html">Privacy Policy (English)</a></li>
    <li><a href="fairseat/impressum-en.html">Legal Notice (English)</a></li>
  </ul>

  <p>Kontakt: <a href="mailto:smaehlmann.appdev@gmail.com">smaehlmann.appdev@gmail.com</a></p>
</main>
</body>
</html>
`;

function erwarteteDateien() {
  const d = n => fuerWeb(fs.readFileSync(n, 'utf8'));
  return {
    [path.join(ZIEL, 'index.html')]: START,
    /* Bewusst keine .nojekyll: Beim Hochladen über die GitHub-Webseite fallen Dateien
       mit Punkt am Anfang weg, und reine HTML-Seiten brauchen sie nicht. */
    [path.join(ZIEL, 'fairseat', 'datenschutz.html')]: d('datenschutz.html'),
    [path.join(ZIEL, 'fairseat', 'impressum.html')]: d('impressum.html'),
    [path.join(ZIEL, 'fairseat', 'datenschutz-en.html')]: d('datenschutz-en.html'),
    [path.join(ZIEL, 'fairseat', 'impressum-en.html')]: d('impressum-en.html')
  };
}

module.exports = { erwarteteDateien, ZIEL };

if (require.main === module) {
  const dateien = erwarteteDateien();
  for (const [ziel, inhalt] of Object.entries(dateien)) {
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, inhalt);
    console.log('  ' + ziel);
  }
  console.log(Object.keys(dateien).length + ' Dateien geschrieben.');
}

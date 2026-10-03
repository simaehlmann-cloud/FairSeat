# FairSeat – Sitzplaner

Sitzpläne für Klasse, Hochzeit und Feier: **Namen verwalten**, **Räume gestalten**, **Sitzpläne zuordnen**.
Läuft als Android- und iOS-App (Cordova, iPhone und iPad) und als Web-App – vollständig offline,
ohne Konto, ohne Tracking, ohne externe Bibliotheken. Paketkennung: `de.fairseat.app`.

Store-Eintrag (je höchstens 30 Zeichen):
- Name: **FairSeat – Sitzplaner** · Untertitel: *Klasse, Hochzeit & Feier*
- englisch: **FairSeat – Seating Planner** · Untertitel: *Classroom, wedding & party*

Zur Marke: FairSeat gehört zur Familie von FairMix (gleiches Design, gleicher Import).
Vor der ersten Veröffentlichung kurz im Markenregister (DPMA, EUIPO) prüfen.

## Dateien

```
index.html                     die komplette App (HTML, CSS, Logik)
config.xml                     Cordova: Name, Kennung, Version, Icons, Plugins
manifest.json, sw.js           Web-App (Installierbarkeit, Offline-Cache)
datenschutz(-en).html          Datenschutzerklärung (in der App und im Web)
impressum(-en).html            Impressum
make-legal-pages.js            erzeugt docs/ für GitHub Pages
icon-1024.png                  Store-Icon (ohne Alphakanal)
icon.png, icon-192.png         512 und 192 px
icon-maskable-512.png          Web-App, maskierbar
res/android/                   Icons je Dichte, adaptiver Vordergrund, colors.xml
res/ios/PrivacyInfo.xcprivacy  Datenschutz-Manifest für Apple
make-ios-icons.py              erzeugt im Build die iOS-Icons und das Startbild
tools/icon/                    Quelle des App-Icons (art.py) und Renderer
tools/store-bilder.py          erzeugt die Store-Screenshots
store-bilder/ipad-13/          iPad 13 Zoll (2048×2732) für App Store Connect
store-bilder/iphone-69/        iPhone 6,9 Zoll (1290×2796), auch für Google Play
validate.js                    statische Prüfung
smoketest.js                   Ablauftests gegen jsdom
test/fairmix-backup.json       echte FairMix-Sicherung als Testdatei
.github/workflows/             android.yml (APK/AAB), ios.yml (IPA, Upload)
```

## Prüfen

```bash
npm install          # einmalig, holt jsdom
npm test             # validate.js + smoketest.js
```

Beide Workflows führen die Prüfungen zuerst aus. Schlägt eine fehl, entsteht kein Build.

## Version anheben

Drei Stellen, `validate.js` prüft den Gleichstand:

1. `config.xml`: `version`, `android-versionCode`, `ios-CFBundleVersion`
   (Code = Haupt·10000 + Neben·100 + Patch, z. B. 2.0.1 → 20001)
2. `index.html`: `const APP_VERSION`
3. `sw.js`: `const CACHE = 'fairseat-…'` und `package.json`: `version`

## Einmalige Einrichtung

### GitHub Pages (Datenschutz-URL für beide Stores)

Settings → Pages → Branch `main`, Ordner `/docs`. Danach:
`https://simaehlmann-cloud.github.io/FairSeat/fairseat/datenschutz.html`
(Repo-Name „FairSeat“ angenommen – bei anderem Namen ändert sich der Pfad entsprechend.)

Nach jeder Änderung an einem Rechtstext: `node make-legal-pages.js` ausführen.

### Android (Play Store)

Eigener Keystore – **nicht** der von FairMix:

```bash
keytool -genkey -v -keystore fairseat.keystore -alias fairseat \
        -keyalg RSA -keysize 2048 -validity 10000 -storetype pkcs12
base64 -w0 fairseat.keystore      # macOS: base64 -i fairseat.keystore
```

Repository-Secrets (Settings → Secrets and variables → Actions):

| Secret | Inhalt |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Ausgabe von `base64` oben |
| `ANDROID_KEYSTORE_PASSWORD` | Passwort des Keystores |
| `ANDROID_KEY_ALIAS` | `fairseat` |
| `ANDROID_KEY_PASSWORD` | Passwort des Schlüssels |

Ohne Secrets entsteht nur eine Debug-APK. Mit Secrets: signierte APK zum Testen und
AAB für die Play Console (Artefakte im Workflow-Lauf). Keystore gut sichern – ohne ihn
sind keine Updates mehr möglich.

### iOS (App Store)

1. developer.apple.com → Identifiers: neue App-ID `de.fairseat.app`
2. Profiles: neues **App Store**-Provisioning-Profil für diese App-ID
3. App Store Connect: neue App mit Bundle-ID `de.fairseat.app` anlegen

Von FairMix weiterverwendbar (gleiches Konto): Distribution-Zertifikat, Team-ID,
Signing-Identity und der App-Store-Connect-API-Schlüssel. Neu ist nur das Profil.

| Secret | Inhalt |
|---|---|
| `IOS_CERTIFICATE_P12_BASE64` | Distribution-Zertifikat als .p12, base64 |
| `IOS_CERTIFICATE_PASSWORD` | Passwort der .p12 |
| `IOS_PROVISIONING_PROFILE` | das **neue** .mobileprovision, base64 |
| `IOS_TEAM_ID` | zehnstellige Team-ID |
| `IOS_SIGNING_IDENTITY` | z. B. `Apple Distribution: Simon Mählmann (TEAMID)` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | App-Store-Connect-API |

Der Upload nach App Store Connect läuft nur bei manuellem Start
(Actions → Build FairSeat (iOS) → Run workflow), damit nicht jeder Push eine
Build-Nummer verbraucht.

### iPad

Die App ist universell (`target-device` = `universal` in `config.xml`) und läuft auf
iPhone und iPad in allen Lagen, auch in Split View und Slide Over. Im Querformat steht
im Editor eine Seitenleiste neben dem Plan, im Hochformat sitzen die Knöpfe unter dem Plan.
Das Teilen-Menü hängt auf dem iPad am auslösenden Knopf.

Apple verlangt für universelle Apps iPad-Screenshots (13 Zoll). Fertige Bilder für iPad und iPhone
liegen in `store-bilder/`; neu erzeugen mit `python3 tools/store-bilder.py`. Bild 1–4 zeigen die
Schule, Bild 5–8 die Hochzeit (runde Tische, Raumpalette, Saalvorlagen).

### Angaben in den Stores

- Datenschutz / Data Safety: keine Daten erhoben, keine Weitergabe, kein Tracking
- Altersfreigabe: für alle; Zielgruppe Lehrkräfte (keine Kinder-App)
- Kategorie: Bildung

## Räume und Feiern

- Räume haben eine Größe in Metern (150 px = 1 m, 4–40 m) und einen Boden (schlicht, Parkett,
  Fliesen, Teppich, Stein). Ältere Räume ohne Größe bekommen beim Laden 9,3 × 6,7 m.
- Vorlagen: Klassisch, Modern, Fachraum, Festsaal, Partyraum, Konferenzraum, Aula.
- Runde Tische und lange Tafeln (4–12 Plätze) weichen Möbeln aus. Die Tischplatte wird nicht
  gespeichert, sondern aus den Stühlen einer Gruppe berechnet (`tableShapes`).
- Türen und Fenster rasten immer an der nächsten Wand ein, Tafeln nur in Wandnähe (`snapToWall`).
- Beim ersten Start fragt die App: Schule oder Feier. Das steuert Bezeichnungen, Vorlagen und Beispiel.
- Weitere Tischformen: quadratisch, oval, U-Tafel, T-Tafel (`tbl` = `square`, `oval`, `long`, `longv`).
  Einseitig besetzte Tafeln liegen auf der Seite zur Mitte ihrer Anordnung.
- Gäste: Zusage, Menü, Küchenhinweis, Begleitung; Gruppen mit Farbe (auch in der Schule).
  Exporte für Feiern: Tisch- und Platzkarten (Klappkarten), „Wer sitzt wo?“, Küchenliste.
- Schule: Klassenarbeit mit Platznummern und A/B im Schachbrett, Vertretungsmappe als PDF.

## Stundenplan und Bewertungen (nur Schulmodus)

- Stundenplan: `DB.tt` (Beginn, Länge, Stunden, Pausen nach jeder Stunde, Mo–Fr/Mo–Sa, A/B-Wochen ab `abRef`),
  `DB.subjects` (Name, Kürzel, Farbe), `DB.lessons` (Tag, Stunde, Einzel-/Doppelstunde, Woche, Fach, Klasse,
  Raum, optional Sitzplan). Die Startseite zeigt laufende und nächste Stunde und öffnet den passenden Sitzplan.
- Bewertungen je Klasse und Fach in `c.assess` (Noten 1–6 mit +/−, Punkte 0–15, Smileys; „fehlt“),
  Gewichtung schriftlich : mündlich & sonstige je Fach in `c.gradeW`, Gewicht je Bewertung ½–3.
  Smileys zählen nicht in Durchschnitte; Punkte werden mit Noten gemischt über (17 − P) : 3 umgerechnet.
- Beides lässt sich in den Einstellungen ausblenden. Vor der ersten Nutzung der Bewertungen erscheint
  ein Datenschutzhinweis.

## Datenschutz

- Keine Datenerhebung durch den Anbieter; alles bleibt im App-Speicher des Geräts.
- Sicherungen lassen sich mit Passwort verschlüsseln (AES-GCM 256, PBKDF2-SHA-256, 250 000 Runden).
- Beim ersten Start im Schulmodus, in der Info und in der Datenschutzerklärung steht der Hinweis auf die
  schriftliche Genehmigung der Schulleitung (z. B. Niedersachsen) und die üblichen Auflagen.
- Küchenhinweise (Allergien) sind als Gesundheitsdaten gekennzeichnet: nur mit Einverständnis des Gastes.

## Icon ändern

`tools/icon/art.py` bearbeiten, dann `python3 tools/icon/render.py`
(braucht Playwright mit Chromium). Die Ergebnisse aus `tools/icon/out/` in das
Wurzelverzeichnis bzw. nach `res/android/` kopieren.

# FairSeat – Sitzplan & Noten

Sitzpläne für den Unterricht: **Klassen verwalten**, **Sitzpläne** (mit dem Reiter **Räume** für alle Klassen) – dazu Stundenplan, Bewertungen
(auch Klassenarbeiten mit Punkten je Aufgabe und Notenschlüssel), Kursheft, Fehlzeiten mit Verspätungen und Entschuldigungen,
Beobachtungen, Abhak- und Strichlisten.
Läuft als Android- und iOS-App (Cordova, iPhone und iPad) und als Web-App – vollständig offline,
ohne Konto, ohne Tracking, ohne externe Bibliotheken. Paketkennung: `de.fairseat.app`.

Store-Eintrag (je höchstens 30 Zeichen):
- Name: **FairSeat – Sitzplan & Noten** · Untertitel: *Stundenplan & Fehlzeiten*
- englisch: **FairSeat – Seating & Grades** · Untertitel: *Timetable & attendance*
- Zeile unter dem Logo in der App: „Sitzplan, Noten, Stundenplan — offline“
- Den Namen in App Store Connect nur mit einer neuen Version ändern; bei Google Play jederzeit.

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
liegen in `store-bilder/`; neu erzeugen mit `python3 tools/store-bilder.py`.
Die Reihe: Start, Namen, neuer Sitzplan, Sitzplan mit Gruppen, Notenübersicht, Unterricht (Anwesenheit und
Schnellbewertung am Platz), Abhaken, Stundenplan mit Ausfall – alles mit erfundenen Namen aus `test/fairmix-backup.json`.

### Angaben in den Stores

- Datenschutz / Data Safety: keine Daten erhoben, keine Weitergabe, kein Tracking
- Altersfreigabe: für alle; Zielgruppe Lehrkräfte (keine Kinder-App)
- Kategorie: Bildung

## Räume und Tische

- Räume haben eine Größe in Metern (150 px = 1 m, 4–40 m) und einen Boden (schlicht, Parkett,
  Fliesen, Teppich, Stein). Ältere Räume ohne Größe bekommen beim Laden 9,3 × 6,7 m.
- Vorlagen: Klassisch, Modern, Fachraum, Konferenzraum, Aula.
- Runde Tische und lange Tafeln (4–12 Plätze) weichen Möbeln aus. Die Tischplatte wird nicht
  gespeichert, sondern aus den Stühlen einer Gruppe berechnet (`tableShapes`).
- Türen und Fenster rasten immer an der nächsten Wand ein, Tafeln nur in Wandnähe (`snapToWall`).
- Den früheren Veranstaltungsmodus (Hochzeit/Feier) gibt es seit 2.0 nicht mehr; die App richtet sich nur an Lehrkräfte.
- Weitere Tischformen: quadratisch, oval, U-Tafel, T-Tafel (`tbl` = `square`, `oval`, `long`, `longv`).
  Einseitig besetzte Tafeln liegen auf der Seite zur Mitte ihrer Anordnung.
- Gruppen mit Farbe (eigene oder aus FairMix).
- Schule: Klassenarbeit mit Platznummern und A/B im Schachbrett, Vertretungsmappe als PDF.

## Stundenplan und Bewertungen

- Stundenplan: `DB.tt` (Beginn, Länge, Stunden, Pausen nach jeder Stunde, Mo–Fr/Mo–Sa, A/B-Wochen ab `abRef`),
  `DB.subjects` (Name, Kürzel, Farbe), `DB.lessons` (Tag, Stunde, Einzel-/Doppelstunde, Woche, Fach, Klasse,
  Raum, optional Sitzplan). Die Startseite zeigt laufende und nächste Stunde und öffnet den passenden Sitzplan.
- Bewertungen je Klasse und Fach in `c.assess` (Noten 1–6 mit +/−, Punkte 0–15, Smileys; „fehlt“),
  Gewichtung schriftlich : mündlich & sonstige je Fach in `c.gradeW`, Gewicht je Bewertung ½–3.
  Smileys zählen nicht in Durchschnitte; Punkte werden mit Noten gemischt über (17 − P) : 3 umgerechnet.
- Beides lässt sich in den Einstellungen ausblenden. Vor der ersten Nutzung der Bewertungen erscheint
  ein Datenschutzhinweis.
- Klassenarbeit mit Aufgaben: `a.tasks` (Name, Höchstpunkte, halbe Punkte), `a.key` (Mindest-% je Stufe,
  Vorlagen 50 %/40 % = ausreichend bzw. Abitur-Raster; optional Tendenz = Drittel je Stufe), `a.pts` (Punkte
  je Schüler und Aufgabe). Die Note wird immer aus Punkten und Schlüssel berechnet (`keyGrade`, auch beim Laden).
  Lösungsquote je Aufgabe, Excel-Auswertung, Warnung bei mehr als 30 % „5/6“ (Niedersachsen, Erlass
  „Schriftliche Arbeiten“ Nr. 8).
- Kursheft `c.journal` (Datum, Stunde, Fach, Thema, Hausaufgabe) aus der Unterrichtsleiste, mit letzter Stunde.
- Fehlzeiten: entschuldigte Tage `c.exc` („Datum|ID“), Verspätungen `c.late` (Minuten je Stunde) aus dem
  Unterrichtsblatt; Übersicht je Name über „Anwesenheit“ oder die Bewertungsübersicht.
- Strichlisten: Abhaklisten mit `type: "tally"` und `ticks` („Datum|ID“, ein Strich je Tag), Summe am Platz.
  Abhak- und Strichlisten lassen sich auch unter „Klassen verwalten“ ohne Sitzplan öffnen.
- Halbjahre: `DB.settings.termSplit` (Ende 1. Halbjahr, Standard 31.1.; beim Schuljahreswechsel zurückgesetzt).
  Übersicht, Notenvorschlag und Ausgaben umschaltbar: 1. Halbjahr, 2. Halbjahr, Schuljahr.
  Fehlstunden in Übersicht/CSV/Excel folgen dem Halbjahr; Bewertungen ohne Datum zählen nur im Schuljahr (Hinweis in der Übersicht).
- Zieldifferent: `c.zd` („Fach|ID“), nur das Merkmal; solche Arbeiten zählen bei der 30-%-Warnung nicht mit.
- Elternkontakte: Beobachtungen mit `k: "parent"` und Art `m` (Gespräch, Telefonat, Brief, E-Mail), eigener
  Abschnitt im Gesprächsblatt.
- Unterrichtsblatt: Mitarbeit für „Heute“ oder die letzte Stunde laut Stundenplan (`lastLessonDate`).
- Feedback-Zielscheibe (`c.targets`): Thema, 1–4 Bereiche, Punkte `{ id, k, r, a }` ohne Namen, an zufälliger Stelle eingefügt.
  Schülermodus auf eigenem Bildschirm (`#screen-target`), Beenden wie bei der Selbsteinschätzung (✕ halten, mit Sperre entsperren),
  nach Neustart zurück (`DB.targetLock`). Auswertung mit Mittelwert je Bereich (100 % = Mitte), groß und als PDF. Abgleich: `tg|`/`tp|`.
- Namen aus Excel (.xlsx, entpackt per `DecompressionStream`) und CSV (UTF-8 oder Windows-1252): Überschriften Vorname/Nachname/Name
  erkennen, Format wählbar, Vorschau mit Doppelten. Einfügen räumt Nummern, Datumsangaben und Kopfzeilen auf. Testdateien in `test/`.
- Plätze sperren (`desk.blocked`): automatisch setzen, mischen, Gruppen und Klassenarbeits-Nummern lassen sie aus. Meldung „x von y Regeln erfüllt“.
- Tagesübersicht: weitere Stunden heute, offene Aufgaben (Kursheft-Lücken der letzten 14 Tage, unvollständige Abhaklisten).
- „Größere Schrift und Knöpfe“ (`DB.big`, nur dieses Gerät).
- Zeugnisnoten (`c.zn`: `{ s: Fach, t: "h1" | "y", sid, g }`): Spalte „Zeugnis“ in der Übersicht (`openFinalPick`), im
  1. Halbjahr fürs Halbjahreszeugnis, sonst fürs Jahreszeugnis (2. Halbjahr → Jahr, Vorschlag mit dem ganzen Schuljahr, `znRange`).
  Skala wie der Kurs (1–6 ganz bzw. 0–15). Abweichung vom Vorschlag markiert. „Vorschläge übernehmen“ füllt nur Leeres,
  ohne Tendenz (`znFromProposal`). Notenliste aller Fächer der Klasse mit Fehlstunden als PDF (`finalsPdfPages`) und als
  eigenes Blatt der Excel-Auswertung (hinter den Fächern). Abgleich: `zn|`. Fach löschen und Schuljahreswechsel (Bewertungen leeren) räumen auf.
- Kategorien je Klasse und Fach (`c.gcat[Fach] = [{ id, n, w }]`, Summe 100): „written“ und „other“ bleiben immer
  (30-%-Regel, „Mitarbeit heute“), eigene kommen dazu (`a.cat`, `catOfAssess`). Ohne eigene gilt wie bisher `gradeW`
  (wird beim Speichern mitgeführt, damit ältere App-Stände weiter rechnen). `studentAverages` liefert `parts` je Kategorie;
  Übersicht, Rechenweg, PDF, CSV, Excel und Gesprächsblatt zeigen je Kategorie eine Spalte. Abgleich: eigene Einträge `gc|` (je Fach)
  und `ac|` (Zuordnung), damit ältere App-Stände sie nicht überschreiben; Prozent-Schlüssel über `tk|`.
- Weitere Skalen: Drittelnoten (`third`, ±⅓), Prozent (`pct`, ganze Zahl 0–100, über Schlüssel `a.key.th` zur Note,
  Vorlagen 50 %/40 %), eigene Skalen (`DB.scales`, `u:<id>`, Stufen `{ k, l, v }` mit Notenwert 1–6; eingetragen wird
  der Stufenname, Umbenennen zieht Einträge mit, benutzte Stufen/Skalen (auch im Papierkorb) lassen sich nicht löschen; Abgleich `us|`, eine noch benutzte Skala bleibt nach
  dem Zusammenführen erhalten). Wechsel einer leeren Bewertung auf eine neue Skala vergibt eine neue Kennung.
  `markNum` = Wert in der Skala der Bewertung, `valIn` = Wert im Maßstab des Kurses. Aufgaben/Notenschlüssel nur bei Noten und Punkten.
- Kriterienraster und Erwartungshorizont (nur Noten/Punkte, nicht bei Aufgaben oder „Mitarbeit heute“): `a.crit = { lv: [3–5 Stufen],
  items: [{ id, n: Kriterium, e: Erwartung, w: Gewicht 1–3 }] }`, Bewertung je Schüler `a.cr[sid] = { v: { Kriterium: Stufe }, c: Kommentar, n: Stufenzahl }`.
  Erfüllungsgrad = Σ w·Stufe/(Stufen−1) ÷ Σ w, über den Schlüssel `a.key` (wie bei Aufgaben, mit Tendenz) zur Note – erst wenn alle Kriterien
  bewertet sind (`critResult`, `critTok`, `applyCritMarks` beim Laden). Anzeige auf 0,1 % wie in der Note (`fmtPct`). Vorlagen: zwei
  mitgelieferte, eigene in `DB.critTpl` (gleicher Name aktualisiert; verwalten/löschen). Rückmeldebogen je Schüler als PDF (`critPdfPages`,
  mehrseitig mit Fortsetzungskopf), Klassenüberblick je Kriterium. Eine direkt gesetzte Note (auch „fehlt“) ersetzt die Raster-Bewertung.
  Abgleich: `cr|` (Raster + Schlüssel), `cp|` (je Schüler), `ct|` (Vorlagen); Bewertungen unter anderer Stufenzahl gelten nicht; eine jüngere
  Direktnote eines Geräts ohne Raster-Eintrag gewinnt; treffen Aufgaben und Raster zusammen, gilt der jüngere Eintrag.
- Termine (`DB.events`: `{ id, k: "ka"|"test"|"ev"|"due", d, e?, tm?, p?, t, c?, s?, n?, rem?, aid? }`): Wochenansicht im Stundenplan
  (`ttWeekOff`, `ttMonday`, Datum je Tag, Marke „KA“ an der Stunde über `examsAt`, Liste „Diese Woche“), Terminliste (`openEvents`),
  Hinweise (`examWarn`: zweite Klassenarbeit am Tag, mehr als drei in der Woche, Termin an einem freien Tag), Stunde aus dem
  Stundenplan vorgeschlagen (`guessPeriod`), „Als Bewertung anlegen“ (verknüpft über `aid`). Kalender-Export als .ics (`icsText`,
  RFC 5545: CRLF, Zeilen ≤ 75 Byte, ganztägig mit DTEND am Folgetag, Erinnerung als VALARM). Startseite „Demnächst“ (14 Tage, `upcomingItems`).
- Ferien und Feiertage: `DB.holidays` (`{ id, a, b, n }`), `DB.hst` (Bundesland); `pubHolidays` berechnet die gesetzlichen Feiertage
  je Land (Ostern nach Gauß). Vorlage Niedersachsen 2026/27 und 2027/28 laut Ferienerlass (`HOL_NI`). An freien Tagen (`freeInfo`) gibt es
  keine Stunden (`lessonsOnDate`, `nowLessons`, `currentLessonFor`), also auch keine Kursheft-Mahnung und keine Fehlstunden.
- Unterrichtsplanung: Reihen je Klasse und Fach (`c.units`: `{ id, s, t, a, items: [{ id, t, hw, n }] }`), ausgelassene Stunden `c.uskip`
  („Datum|StundenID“). `unitPlan` verteilt die Themen bei jedem Aufruf neu auf die Stunden ab Beginn (Doppelstunde = 1, Ausfall, Ferien
  und Auslassungen rücken nach; eine Folgereihe beginnt frühestens nach der vorigen). Im Stundenblatt: Thema, „+1 Stunde“, Auslassen,
  Klassenarbeit, Kursheft (mit Vorschlag aus der Planung, Hausaufgabe in der letzten Stunde des Themas). Liste einfügen
  (`parseUnitLines`), in andere Klasse kopieren. Schuljahreswechsel: Reihen mit dem Stundenplan, vergangene Termine entfallen.
  Abgleich: `ev|`, `hol|`, `hst`, `un|`, `uk|` als eigene Einträge – ältere App-Stände lassen sie stehen.
- Rechenweg: „Wie berechnet?“ unter einem Namen (Bewertungen) zeigt jede Bewertung mit Wert und Gewicht, die Teildurchschnitte,
  die Gewichtung, die Rundungsregel und die Fehlstunden des Fachs (`gradeCalc` nutzt dieselben Schritte wie `studentAverages`,
  `proposeGrade` und `missedLessons`). Als PDF und auf Wunsch (`settings.talkCalc`) im Gesprächsblatt.
- Schülermodus: Ist die Sperre an, verlangt das Beenden (✕ halten) zusätzlich Face ID/Geräte-PIN; ohne nutzbare Entsperrung endet er,
  Noten bleiben gesperrt. Ohne Sperre einmaliger Hinweis (`DB.selfGuardSeen`) mit „Sperre einschalten“.
- Daten & Datenschutz (Startseite): letzte Sicherung (`DB.lastBackupEnc`), Sperre, Anzahlen, belegter Speicher (Warnung ab 70 %,
  beim Start ab 80 %), alte Klassen in den Papierkorb, Papierkorb leeren. „Ohne Passwort sichern“ fragt nach.
- Größe: „Größe“ in der Auswahlleiste gilt für jeden Gegenstand (Breite/Tiefe in cm, ±10 cm, Standardgröße; Tische mit Einzel-/Doppel-/Gruppentisch).
  Wandgegenstände (Tür, Fenster, Wand, Tafeln) nur in der Länge und bleiben an der Wand, Rundes (Pflanze, Uhr, runder Tisch, Säule) nur im Durchmesser.
  Bei genau einem Gegenstand ohne Gruppe zusätzlich ein Ziehgriff an der Ecke (10-cm-Raster, gegenüberliegende Ecke bleibt stehen); nicht im Vorführ- und Unterrichtsmodus.
- Timer (Unterrichtsleiste, Menü ···, Vorführmodus): Countdown über den Endzeitpunkt, groß am Beamer, wird nicht gespeichert. Hält per Wake-Lock-API den Bildschirm wach, solange er läuft (nicht in der Pause; wo die WebView es nicht kann, ohne Wirkung).

## Sitzpläne: PC-Plätze, Speichern unter, Wechseln

- PC-Platz: Tisch mit `pc: true` (Bildschirm an der Kante gegenüber dem Stuhl, auch in PNG/PDF).
  Vorlagen „PC-Raum (Wände)“ (links/hinten/rechts, Blick zur Wand, Rest als Reihe in der Mitte) und „PC-Raum (Reihen)“.
  Einzeln über „PC-Platz“ im Bereich Plätze oder in der Auswahlleiste umschaltbar.
- Tipp auf den Plannamen: alle Pläne der Klasse (wechseln, umbenennen) und „Als neuen Sitzplan speichern“.
  Danach auf Wunsch das Original auf den Stand beim Öffnen zurücksetzen (`planSnap`).
- Auswahlleiste: Pfeil am rechten Rand, solange sie weitergeht.

## Datenschutz

- Keine Datenerhebung durch den Anbieter; alles bleibt im App-Speicher des Geräts.
- Sicherungen lassen sich mit Passwort verschlüsseln (AES-GCM 256, PBKDF2-SHA-256, 250 000 Runden).
- Beim ersten Start, in der Info und in der Datenschutzerklärung steht der Hinweis auf die
  schriftliche Genehmigung der Schulleitung (z. B. Niedersachsen) und die üblichen Auflagen.
- Notizen und Beobachtungen: Hinweis, keine Gesundheitsdaten (Art. 9 DSGVO) einzutragen.

## Icon ändern

`tools/icon/art.py` bearbeiten, dann `python3 tools/icon/render.py`
(braucht Playwright mit Chromium). Die Ergebnisse aus `tools/icon/out/` in das
Wurzelverzeichnis bzw. nach `res/android/` kopieren.

## Sperre für Noten und Beobachtungen

- Optional in den Einstellungen (`DB.settings.lock`). Nutzt `cordova-plugin-fingerprint-aio`
  (Face ID, Touch ID, Fingerabdruck, ersatzweise Geräte-PIN; unter Android braucht die PIN einen eingerichteten
  Fingerabdruck bzw. Gesichtserkennung). Die App erfährt nur „entsperrt“ oder nicht. Die Einstellung gilt je Gerät
  und wird nicht mitgesichert. Fällt die Entsperrung weg, bietet die App das Ausschalten an.
- Gesperrt sind: Bewertungen (Kachel, Bewerten im Plan und im Unterricht, Punkte und Notenschlüssel), Beobachtungen,
  Gesprächsblatt/CSV/Excel (liegen in den Bewertungen), Sicherung, Übertragen und Schuljahreswechsel.
- Frei bleiben Sitzplan, Anwesenheit mit Fehlzeiten und Verspätungen, Kursheft, Abhak- und Strichlisten
  und die Selbsteinschätzung (bewusst: organisatorisch, ohne Noten).
- Wieder gesperrt nach 5 Minuten im Hintergrund und nach jeder Selbsteinschätzung.
  Ausschalten nur nach Entsperren.

## Abgleich zwischen Geräten (Sicherungsdatei)

- Jeder Eintrag hat einen Schlüssel (`syncEntities`): Klasse, Schüler, Regel, Gruppe, Plan, Bewertung,
  einzelne Note, Aufgaben/Schlüssel (`tk`), Punkte je Schüler (`pt`), Beobachtung, Fehlzeit je Schüler,
  Entschuldigung (`ex`), Verspätung (`lt`), Kursheft (`j`), Abhak-Haken (`kd`), Listentyp (`kty`), Striche (`kt`),
  Raum, Fach, Stunde, Ausfall … Neue Arten sind eigene Einträge, damit ältere App-Stände sie nicht verwerfen.
- `syncStamp` (bei jedem Speichern) vermerkt Änderungszeiten in `DB.stamps` und Löschungen in `DB.del`
  (400 Tage). Gespeichert wird beides kompakt (`packStamps`).
- Beim Laden einer Sicherung: Vergleich Datei/Gerät, Warnung bei älterer Datei oder falscher Uhr,
  Vorschau, dann „Zusammenführen“ (`mergeDB`: je Eintrag gewinnt der neuere Stand; Löschen gewinnt nur,
  wenn es nach der letzten Änderung samt allem Abhängigen lag – Abhängiges, das im selben Abgleich selbst
  gelöscht wird, zählt nicht) oder „Ersetzen“. Beides 14 Tage rückgängig.
- Knopf „Auf anderes Gerät übertragen“ (`openTransfer`): immer mit Passwort verschlüsselt, öffnet in einem
  Schritt das Teilen-Menü (AirDrop, Quick Share, Mail) und erklärt das Zusammenführen auf dem Zielgerät.
  Zählt nicht als Sicherung (die Sicherungserinnerung bleibt).
- Klassenarbeit mit Aufgaben: Die Note folgt nach dem Abgleich immer aus Punkten und Schlüssel. Ausnahme: Ein
  Gerät, das die Aufgaben noch nicht kannte, hat später direkt eine Note gesetzt – dann gilt diese Note.
- Gerätebezogen und nie übernommen: Sprache, Design, Papierkorb, Sperre, zuletzt geöffnete Klasse.
- Grenzen: Datum und Uhrzeit sollten auf beiden Geräten stimmen; unabhängig angelegte Klassen erscheinen doppelt.

## Abgleich über WebDAV (z. B. IServ)

- Einstellungen → „Abgleich über WebDAV“ (`openDavSetup`), auch im Datenschutz-Cockpit (`#pv-sync`).
  Eine Datei `FairSeat-Abgleich.json` im Ordner des Servers, Inhalt wie eine verschlüsselte Sicherung
  (`encryptBackup`, Abgleich-Passwort, auf allen Geräten gleich) – lässt sich notfalls über „Wiederherstellen“ laden.
- Adresse (`davNormUrl`): nur https. Nur der Servername oder `…/webdav` → `…/webdav/Files/` (IServ: oberste Ebene
  hat nur „Files“ und „Groups“). Andere Server: WebDAV-Adresse des Ordners (z. B. Nextcloud `…/remote.php/dav/files/NAME/`).
- Ablauf (`davRun`): GET mit `If-None-Match` → 304 (nichts Neues) / 404 (noch keine Datei) / 200 (entschlüsseln,
  `mergeDB`, still übernehmen per `davApply`). Hochladen nur, wenn sich hier seit dem letzten Abgleich etwas
  geändert hat (Fingerabdruck `davHash` über `backupData`), mit `If-Match` bzw. `If-None-Match: *`; 412 → neu
  holen und zusammenführen (höchstens 3 Runden). Leeres Gerät übernimmt den Stand, ohne zurückzuschicken.
- Nie mitten in eine Eingabe: Ist ein Fenster offen oder läuft Bewertungs-, Abhak-, Schüler-, Zielscheiben- oder
  Vorführmodus, wartet Eingehendes (`davPending`) bis zum Schließen. Das Einrichtungsfenster selbst zählt nicht.
- Automatisch: `deviceready`, Zurückkehren (höchstens alle 30 s), Verlassen, 2 Minuten nach `save()`.
  Fehler nur in der Statuszeile (`.davstatus`), Rückmeldung bei eingegangenen Änderungen.
- Gerätebezogen: Einstellungen in `localStorage["fairseat-dav"]`, Passwörter in `fairseat-dav-sec`,
  verschlüsselt mit einem nicht auslesbaren AES-Schlüssel in IndexedDB (`Secrets`); ohne IndexedDB nur im Speicher.
  Nichts davon steht in `DB`, also nie in Sicherung oder Abgleich.
- Nativ über das eigene Plugin `plugins-src/cordova-plugin-fairseat-http` (Swift/URLSession, Java/HttpURLConnection,
  `window.FairSeatHttp.sendRequest`), weil der WebView fremde Server per CORS sperrt. Ohne Cookies, Zwischenspeicher und
  Weiterleitungen; nur https. Ersetzt `cordova-plugin-advanced-http`, dessen AFNetworking unter Xcode 26 nicht mehr
  übersetzt (`netinet6/in6.h`). `config.xml` verweist mit `../plugins-src/…` darauf (vom Ordner `build/` aus).
  Im Browser: nur Hinweis.
- Tests: `davServer()` in `smoketest.js` bildet einen WebDAV-Server nach (Anmeldung, ETag, 412, Ordner, offline).

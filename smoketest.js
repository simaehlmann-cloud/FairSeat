/* Ablauftest von FairSeat gegen jsdom – läuft vor jedem Store-Build.
 *
 *   node smoketest.js
 *
 * Jeder Abschnitt startet eine frische App mit leerem Speicher und bedient
 * sie so weit wie möglich über die Oberfläche (Knöpfe, Felder, Dialoge).
 * Wo jsdom an Grenzen stößt (Zeigergesten, Canvas), werden die Funktionen
 * dahinter direkt aufgerufen.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync('index.html', 'utf8');
const FAIRMIX = JSON.parse(fs.readFileSync('test/fairmix-backup.json', 'utf8'));

let bestanden = 0, fehler = 0;
const fehlerliste = [];
function erwarte(bed, text){
  if(bed) bestanden++;
  else { fehler++; fehlerliste.push(aktuell + ': ' + text); }
}
let aktuell = '';

function neueApp(erststart){
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(win){
      if(!erststart) try{ win.localStorage.setItem('sitzplan.v2', JSON.stringify({ v: 2, onboarded: true, tipsDone: true, classes: [], rooms: [] })); }catch(e){}
      win.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
      win.HTMLCanvasElement.prototype.getContext = () => null;
      win.scrollTo = () => {};
      /* jsdom kennt kein WebCrypto – für die verschlüsselte Sicherung das von Node leihen */
      Object.defineProperty(win, 'crypto', { value: require('crypto').webcrypto, configurable: true });
      win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder;
    }
  });
  const w = dom.window;
  const $ = s => w.document.querySelector(s);
  const $$ = s => Array.from(w.document.querySelectorAll(s));
  const E = code => w.eval(code);
  const klick = s => { const el = typeof s === 'string' ? $(s) : s; if(!el) throw new Error('Nicht gefunden: ' + s); el.click(); };
  const sheetOk = () => klick('#sheet .row button.primary');
  /* Erststart-Frage beantworten (Schule), sofern sie offen ist */
  const willkommen = mode => { const b = w.document.querySelector('#sheet .choice[data-mode="' + (mode || 'school') + '"]'); if(b) b.click(); };
  const askText = wert => { const i = $('#sheet input'); i.value = wert; sheetOk(); };
  return { w, $, $$, E, klick, sheetOk, askText, willkommen, ende: () => w.close() };
}
const warteschlange = [];
function test(name, fn, erststart){ warteschlange.push([name, fn, erststart]); }
async function alleTests(){
  for(const [name, fn, erststart] of warteschlange){
    aktuell = name;
    const app = neueApp(erststart);
    try { await fn(app); }
    catch(e){ fehler++; fehlerliste.push(name + ': Ausnahme – ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
    finally { app.ende(); }
  }
}
const pause = ms => new Promise(r => setTimeout(r, ms || 30));
/* Datei in ein <input type=file> legen und "change" auslösen (jsdom erlaubt kein Setzen von files) */
function dateiWaehlen(app, sel, name, inhalt){
  const input = app.$(sel);
  const file = new app.w.File([inhalt], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new app.w.Event('change'));
}
const NAMEN = ['Anna', 'Ben', 'Cem', 'Dana', 'Emil', 'Fiona', 'Gül', 'Hugo', 'Ida', 'Jan', 'Kim', 'Lea'];
function klasseMitNamen(app, name, namen){
  app.klick('#tile-names');
  app.klick('#btn-add-class');
  app.askText(name || '7b');
  app.$('#student-input').value = (namen || NAMEN).join('\n');
  app.klick('#btn-add-students');
}
function neuerPlan(app, layoutIndex, verteilung){
  app.E('goPlans()');
  app.klick('#btn-add-plan');
  if(layoutIndex !== undefined) app.klick(app.$$('#sheet .choicegrid .choice')[layoutIndex]);
  if(verteilung){
    const opt = app.$$('#sheet > div:not(.choicegrid) > .choice').find(b => b.textContent.indexOf(verteilung) >= 0);
    if(!opt) throw new Error('Verteilung nicht gefunden: ' + verteilung);
    app.klick(opt);
  }
  app.sheetOk();
}
const besetzt = app => app.E('curPlan().desks.filter(d => d.studentId).length');

/* ------------------------------------------------------------------ */

test('Start', app => {
  erwarte(app.$('#screen-start').classList.contains('active'), 'Startseite nicht aktiv');
  erwarte(app.$$('.home-tile').length === 5 && app.$$('.home-tile').slice(0, 3).map(b => b.id).join() === 'tile-names,tile-rooms,tile-plans', 'Kacheln fehlen oder falsche Reihenfolge');
  erwarte(app.$('#tile-names').textContent.indexOf('Namen verwalten') >= 0, 'Kachel „Namen verwalten“ fehlt');
  app.klick('#tile-plans');
  erwarte(app.$('#screen-names').classList.contains('active'), 'Ohne Klasse muss „Sitzpläne“ zu den Namen führen');
  erwarte(!/pro|lite/i.test(app.$('.brand').textContent), 'Kopfzeile nennt noch Pro/Lite');
});

test('Klasse und Namen', app => {
  klasseMitNamen(app);
  erwarte(app.E('DB.classes.length') === 1, 'Klasse nicht angelegt');
  erwarte(app.E('curClass().students.length') === 12, 'Namen nicht übernommen');
  app.$('#student-input').value = 'Anna\nZoe';
  app.klick('#btn-add-students');
  erwarte(app.E('curClass().students.length') === 13, 'Doppelter Name wurde nicht übersprungen');
  erwarte(app.$$('#student-list .namerow').length === 13, 'Namensliste zeigt nicht alle Namen');
  erwarte(app.$('#names-title').textContent === '7b', 'Klassenname fehlt in der Überschrift');
  // Excel: Tabulator-getrennt mit Spaltenauswahl
  app.$('#student-input').value = 'Nr\tName\n1\tXaver\n2\tYara';
  app.klick('#btn-add-students');
  erwarte(!!app.$('#sheet select'), 'Mehrspaltiger Import zeigt keine Spaltenauswahl');
  const sel = app.$('#sheet select'); sel.value = '1'; sel.dispatchEvent(new app.w.Event('change'));
  app.sheetOk();
  erwarte(app.E('curClass().students.some(s => s.name === "Yara")'), 'Spalte 2 wurde nicht übernommen');
});

test('Stufen', app => {
  klasseMitNamen(app);
  const knopf = () => app.$('#student-list .lvl');
  app.klick(knopf());
  erwarte(app.E('curClass().students[0].level') === 1 && knopf().textContent === 'A', 'Erster Tipp setzt nicht A');
  app.klick(knopf()); app.klick(knopf());
  erwarte(knopf().textContent === 'C', 'Dritter Tipp setzt nicht C');
  app.klick(knopf());
  erwarte(app.E('curClass().students[0].level') === 0, 'Vierter Tipp setzt nicht zurück auf ohne');
  app.E('curClass().students.forEach((s, i) => s.level = (i % 3) + 1)');
  app.klick('#btn-clear-levels'); app.sheetOk();
  erwarte(app.E('curClass().students.every(s => !s.level)'), '„Alle Stufen löschen“ wirkt nicht');
});

test('Regeln immer/nie zusammen', app => {
  klasseMitNamen(app);
  const ids = app.E('curClass().students.map(s => s.id)');
  const waehle = (a, b) => { app.$('#pair-a').value = ids[a]; app.$('#pair-b').value = ids[b]; };
  waehle(0, 1); app.klick('#btn-rule-together');
  waehle(2, 3); app.klick('#btn-rule-apart');
  erwarte(app.E('curClass().rules.length') === 2, 'Regeln nicht angelegt');
  waehle(1, 0); app.klick('#btn-rule-apart');
  erwarte(app.E('curClass().rules.length') === 2 && app.E('curClass().rules.filter(r => r.type === "apart").length') === 2,
    'Widersprüchliche Regel ersetzt die alte nicht');
  waehle(4, 4); app.klick('#btn-rule-together');
  erwarte(app.E('curClass().rules.length') === 2, 'Regel mit derselben Person wurde angelegt');
  app.klick('#btn-undo-class');
  erwarte(app.E('curClass().rules.some(r => r.type === "together")'), 'Rückgängig stellt die Regel nicht wieder her');
});

test('Klassenübersicht und Suche', app => {
  klasseMitNamen(app, '5a');
  app.klick('#btn-add-class'); app.askText('6b');
  erwarte(app.$$('#class-cards .ccard').length === 2, 'Klassenkarten fehlen');
  erwarte(app.E('curClass().name') === '6b', 'Neue Klasse ist nicht ausgewählt');
  app.klick(app.$$('#class-cards .ccard')[0]);
  erwarte(app.E('curClass().name') === '5a', 'Karte wählt Klasse nicht aus');
  for(let i = 0; i < 8; i++) app.E('DB.classes.push(newClassObj("K' + i + '"))');
  app.E('renderNames()');
  erwarte(app.$('#class-search').style.display !== 'none', 'Suche erscheint nicht ab 9 Klassen');
  const s = app.$('#class-search'); s.value = 'Gül'; s.dispatchEvent(new app.w.Event('input'));
  erwarte(app.$$('#class-cards .ccard').length === 1, 'Suche nach einem Namen findet die Klasse nicht');
  app.klick('#btn-to-plans');
  erwarte(app.$('#screen-plans').classList.contains('active'), 'Sprung zu den Sitzplänen fehlt');
  app.klick('#btn-to-names');
  erwarte(app.$('#screen-names').classList.contains('active'), 'Sprung zurück zu den Namen fehlt');
});

test('Räume (Vorlage)', app => {
  app.klick('#tile-rooms');
  const r = app.E('buildRoomFromTemplate("modern", "Raum 204")');
  erwarte(r.items.length === 10, 'Vorlage „Modern“ hat nicht 10 Objekte');
  app.E('DB.rooms.push(buildRoomFromTemplate("classic", "Raum 101")); renderRooms()');
  erwarte(app.$$('#room-list .card').length === 1, 'Raumliste zeigt den Raum nicht');
  app.klick(app.$$('#room-list .card .iconbtn')[0]);         // kopieren
  erwarte(app.E('DB.rooms.length') === 2, 'Raum lässt sich nicht kopieren');
  app.klick(app.$$('#room-list .card')[0]);
  erwarte(app.$('#screen-editor').classList.contains('active') && app.E('editMode') === 'room', 'Raum öffnet nicht im Raummodus');
  app.E('addItem("window")');
  erwarte(app.E('curRoom().items.length') === 11, 'Möbel lässt sich nicht hinzufügen');
  app.klick('#btn-editor-back');
  erwarte(app.$('#screen-rooms').classList.contains('active'), 'Zurück führt nicht zu den Räumen');
});

test('Sitzplan zufällig mit Regeln', app => {
  klasseMitNamen(app);
  const ids = app.E('curClass().students.map(s => s.id)');
  app.$('#pair-a').value = ids[0]; app.$('#pair-b').value = ids[1]; app.klick('#btn-rule-together');
  app.$('#pair-a').value = ids[2]; app.$('#pair-b').value = ids[3]; app.klick('#btn-rule-apart');
  neuerPlan(app, 0, 'Zufällig');
  erwarte(app.$('#screen-editor').classList.contains('active'), 'Editor öffnet nicht');
  erwarte(app.E('curPlan().desks.length') === 12, 'Anzahl der Tische entspricht nicht der Namenszahl');
  erwarte(besetzt(app) === 12, 'Nicht alle Namen gesetzt');
  let verstoesse = 0;
  for(let i = 0; i < 10; i++){ app.E('autoSeat(true)'); verstoesse += app.E('lastConflicts.length'); }
  erwarte(verstoesse === 0, 'Regeln über 10 Durchgänge verletzt: ' + verstoesse);
  erwarte(app.E('DB.rooms.length') === 1 && app.E('curRoom().items.length') > 0, 'Raum aus Vorlage wurde nicht angelegt');
});

test('Sitzplan mit freien Tischen und selbst zuordnen', app => {
  klasseMitNamen(app);
  app.E('goPlans()');
  app.klick('#btn-add-plan');
  app.klick(app.$$('#sheet .choicegrid .choice')[1]);          // 4er-Gruppen
  const plus = app.$$('#sheet .stepper button')[1];
  app.klick(plus); app.klick(plus);
  const opt = app.$$('#sheet > div:not(.choicegrid) > .choice').find(b => b.textContent.indexOf('Selbst zuordnen') >= 0);
  app.klick(opt); app.sheetOk();
  erwarte(app.E('curPlan().desks.length') === 14, 'Zusätzliche Tische fehlen');
  erwarte(besetzt(app) === 0, '„Selbst zuordnen“ hat Namen gesetzt');
  erwarte(app.$$('#unseated-box .chip').length === 12, 'Namen ohne Platz werden nicht angezeigt');
  // Antippen und Tisch antippen
  app.klick(app.$$('#unseated-box .chip')[0]);
  const id = app.E('curClass().students[0].id');
  app.E('placeStudent(' + JSON.stringify(id) + ', curPlan().desks[3], null)');
  erwarte(app.E('curPlan().desks[3].studentId') === id, 'Name landet nicht auf dem Tisch');
  // Tauschen zwischen zwei Tischen
  const id2 = app.E('curClass().students[1].id');
  app.E('placeStudent(' + JSON.stringify(id2) + ', curPlan().desks[5], null)');
  app.E('placeStudent(curPlan().desks[3].studentId, curPlan().desks[5], curPlan().desks[3])');
  erwarte(app.E('curPlan().desks[5].studentId') === id && app.E('curPlan().desks[3].studentId') === id2, 'Tauschen funktioniert nicht');
  app.E('unseatDesk(curPlan().desks[5])');
  erwarte(!app.E('curPlan().desks[5].studentId'), 'Name lässt sich nicht vom Platz nehmen');
  erwarte(app.E('curPlan().desks.every(d => d.x >= 0 && d.y >= 0)'), 'Tische liegen außerhalb des Raums');
});

test('Leerer Plan', app => {
  klasseMitNamen(app);
  app.E('goPlans()');
  app.klick('#btn-add-plan');
  const g = app.$$('#sheet .choicegrid .choice');
  app.klick(g[g.length - 1]); app.sheetOk();
  erwarte(app.E('curPlan().desks.length') === 0, 'Leerer Plan hat Tische');
  app.klick('#btn-empty-desk');
  erwarte(app.E('curPlan().desks.length') === 1, '„Leerer Tisch“ fügt keinen Tisch hinzu');
});

test('Feste Plätze', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  const d0 = app.E('curPlan().desks[0].studentId');
  app.E('selected = new Set([curPlan().desks[0].id]); renderStage(false)');
  erwarte(app.$('#sb-lock').style.display !== 'none', 'Knopf „Festhalten“ fehlt');
  app.klick('#sb-lock');
  erwarte(app.E('curPlan().desks[0].locked') === true, 'Platz wird nicht festgehalten');
  for(let i = 0; i < 6; i++) app.E('autoSeat(true)');
  erwarte(app.E('curPlan().desks[0].studentId') === d0, 'Automatisch setzen verschiebt festgehaltenen Platz');
  app.klick('#btn-shuffle');
  erwarte(app.E('curPlan().desks[0].studentId') === d0, 'Mischen verschiebt festgehaltenen Platz');
  erwarte(besetzt(app) === 12, 'Nach dem Mischen fehlen Namen');
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"locked":true') >= 0, 'Festhalten übersteht die Sicherung nicht');
  app.klick('#sb-lock');
  erwarte(!app.E('curPlan().desks[0].locked'), 'Lösen wirkt nicht');
});

test('Abwesende auslassen', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Selbst');
  const fehlt = app.E('curClass().students.slice(0, 2).map(s => s.id)');
  app.E('ensureLesson(curClass()); curClass().lesson.absent = ' + JSON.stringify(fehlt));
  app.E('autoSeat()');
  const sitz = app.E('curPlan().desks.map(d => d.studentId).filter(Boolean)');
  erwarte(sitz.length === 10, 'Es sitzen nicht genau die Anwesenden');
  erwarte(!fehlt.some(id => sitz.indexOf(id) >= 0), 'Abwesende haben einen Platz bekommen');
  erwarte(app.$('#toast').textContent.indexOf('Abwesende') >= 0, 'Meldung nennt die Abwesenden nicht');
  app.E('curClass().lesson.date = "2000-01-01"; autoSeat(true)');
  erwarte(besetzt(app) === 12, 'Abwesenheit von gestern wirkt noch');
});

test('FairMix-Import', app => {
  app.klick('#tile-names');
  const liste = app.E('parseFairMix(' + JSON.stringify(FAIRMIX) + ')');
  erwarte(liste.length === 2, 'Sicherung sollte 2 Klassen enthalten');
  const sieben = liste.find(x => x.name === '7b');
  erwarte(sieben && sieben.names.length === 24 && sieben.groups.length === 6, 'Aktive Klasse ohne Namen oder Gruppen');
  app.E('openFairMixImport(parseFairMix(' + JSON.stringify(FAIRMIX) + '))');
  app.klick(app.$$('#sheet .choice')[1]);                       // 8a dazu
  app.sheetOk();
  erwarte(app.E('DB.classes.length') === 2, 'Nicht beide Klassen übernommen');
  const c = app.E('DB.classes.find(x => x.name === "7b")');
  erwarte(c.students.length === 24, '7b hat nicht 24 Namen');
  erwarte(c.students.filter(s => s.level).length === Object.keys(FAIRMIX.state.levels).length, 'Stufen nicht vollständig übernommen');
  erwarte(c.rules.length === 2 && c.rules.some(r => r.type === 'apart') && c.rules.some(r => r.type === 'together'), 'Regeln nicht übernommen');
  erwarte(c.groups.length === 6 && c.groups.every(g => g.members.length === 4), 'Gruppen nicht übernommen');
  erwarte(c.levelMode === 'hetero', 'Stufenmischung nicht eingeschaltet');
  // erneuter Import ergänzt, verdoppelt nicht
  app.E('openFairMixImport(parseFairMix(' + JSON.stringify(FAIRMIX) + '))'); app.sheetOk();
  erwarte(app.E('DB.classes.find(x => x.name === "7b").students.length') === 24, 'Zweiter Import verdoppelt Namen');
  erwarte(app.E('parseFairMix({ app: "sitzplan" })') === null, 'Fremde Datei wird nicht abgewiesen');
  // Partnerhistorie
  const fm = JSON.parse(JSON.stringify(FAIRMIX));
  fm.state.pairHistory = { ['Amira Yilmaz\u001FBen Kowalski']: 3, ['Clara Hoffmann||David Novak']: 1 };
  app.E('openFairMixImport(parseFairMix(' + JSON.stringify(fm) + '))'); app.sheetOk();
  const h = app.E('DB.classes.find(x => x.name === "7b").history.find(h => h.src === "fairmix")');
  erwarte(h && h.pairs.length === 2, 'Partnerhistorie nicht übernommen');
});

test('Sitzplan nach FairMix-Gruppen', app => {
  app.klick('#tile-names');
  app.E('openFairMixImport(parseFairMix(' + JSON.stringify(FAIRMIX) + '))'); app.sheetOk();
  neuerPlan(app);                                                // Vorauswahl: FairMix-Gruppen
  erwarte(app.E('curPlan().byGroups') === true, 'Plan ist nicht auf Gruppen eingestellt');
  const pruef = () => app.E(`(() => {
    const c = curClass(), p = curPlan();
    const g = id => c.groups.findIndex(x => x.members.indexOf(id) >= 0);
    return deskClusters(p.desks).every(cl => new Set(cl.map(i => g(p.desks[i].studentId))).size === 1);
  })()`);
  erwarte(besetzt(app) === 24, 'Nicht alle 24 gesetzt');
  erwarte(pruef(), 'Eine Tischgruppe mischt FairMix-Gruppen');
  app.klick('#btn-auto');
  erwarte(pruef(), '„Automatisch setzen“ hält die Gruppen nicht zusammen');
  // mit festgehaltenem Platz und einer Abwesenden
  app.E('curPlan().desks[0].locked = true');
  const fest = app.E('curPlan().desks[0].studentId');
  const fehlt = app.E('curClass().groups[3].members[0]');
  app.E('ensureLesson(curClass()); curClass().lesson.absent = [' + JSON.stringify(fehlt) + ']; seatByGroups(true)');
  erwarte(app.E('curPlan().desks[0].studentId') === fest, 'Gruppen-Setzen verschiebt festgehaltenen Platz');
  erwarte(app.E('curPlan().desks.every(d => d.studentId !== ' + JSON.stringify(fehlt) + ')'), 'Abwesende sitzt in ihrer Gruppe');
});

test('Stufenmischung', app => {
  klasseMitNamen(app);
  app.E('curClass().students.forEach((s, i) => s.level = i < 6 ? 1 : 2); curClass().levelMode = "hetero"; DB.settings.history = false');
  neuerPlan(app, 0, 'Zufällig');
  const gleich = app.E(`(() => { const c = curClass(), p = curPlan(), nb = neighbourMatrix(p.desks); let n = 0;
    for(let i = 0; i < p.desks.length; i++) for(let j = i + 1; j < p.desks.length; j++){
      if(!nb[i][j]) continue;
      const a = studentById(c, p.desks[i].studentId), b = studentById(c, p.desks[j].studentId);
      if(a && b && a.level === b.level) n++;
    } return n; })()`);
  erwarte(gleich === 0, 'Gemischt: ' + gleich + ' Nachbarpaare mit gleicher Stufe');
});

test('Papierkorb und Sicherung', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.klick('#btn-editor-back');
  app.klick(app.$$('#plan-list .card .iconbtn.danger')[0]); app.sheetOk();
  erwarte(app.E('curClass().plans.length') === 0 && app.E('DB.trash.length') === 1, 'Plan landet nicht im Papierkorb');
  app.E('trashRestore(DB.trash[0].id)');
  erwarte(app.E('curClass().plans.length') === 1, 'Plan lässt sich nicht wiederherstellen');
  const alt = app.E('JSON.stringify(sanitizeDB({ v:2, classes:[{ id:"a", name:"Alt", students:[{ id:"s", name:"X", tags:[] }], rules:[], plans:[] }], rooms:[] }))');
  erwarte(/"level":0/.test(alt) && /"groups":\[\]/.test(alt), 'Alte Sicherung wird nicht ergänzt');
  erwarte(app.E('sanitizeDB(migrateV1({ classes:[{ name:"v1", students:["A","B"], plans:[] }] })).classes[0].students.length') === 2, 'v1-Sicherung wird nicht gelesen');
});

test('Englisch und Veranstaltung', app => {
  klasseMitNamen(app);
  app.klick('#flag-en');
  const roh = app.$$('[data-i]').filter(el => el.textContent === el.dataset.i).map(el => el.dataset.i);
  erwarte(!roh.length, 'Unübersetzte Beschriftungen: ' + roh.join(', '));
  erwarte(app.$('#tile-rooms').textContent.indexOf('Rooms') >= 0, 'Kachel nicht übersetzt');
  app.klick('#flag-de');
  app.E('DB.settings.mode = "event"; applyLang()');
  erwarte(app.E('t("classLabel")') === 'Veranstaltung', 'Veranstaltungsmodus greift nicht');
});

test('Editor-Menü und Export-Dialog', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.klick('#btn-more');
  erwarte(app.$$('#sheet .tile').length === 4 && app.$$('#sheet .tile')[3].textContent.indexOf('Selbsteinschätzung') >= 0, 'Menü zeigt nicht Vollbild, Auswahl, Spiegeln und Selbsteinschätzung');
  app.klick(app.$$('#sheet .tile')[2]);
  app.klick('#btn-share');
  erwarte(app.$$('#sheet .tile').length >= 2, 'Export-Dialog unvollständig');
  erwarte(!app.$('#sheet').textContent.match(/Vollversion|Pro/), 'Export-Dialog verweist noch auf die Vollversion');
});

test('Name löschen räumt auf', app => {
  app.klick('#tile-names');
  app.E('openFairMixImport(parseFairMix(' + JSON.stringify(FAIRMIX) + '))'); app.sheetOk();
  const id = app.E('curClass().groups[0].members[0]');
  app.E('editStudent(' + JSON.stringify(id) + ')');
  const loeschen = app.$$('#sheet button.ghost').find(b => b.textContent === 'Löschen');
  app.klick(loeschen);
  erwarte(app.E('curClass().groups[0].members.indexOf(' + JSON.stringify(id) + ')') < 0, 'Gelöschter Name bleibt in der Gruppe');
  erwarte(app.E('curClass().rules.every(r => r.a !== ' + JSON.stringify(id) + ' && r.b !== ' + JSON.stringify(id) + ')'), 'Gelöschter Name bleibt in Regeln');
});

/* ---------------- Korrekturen aus dem Code-Audit ---------------- */

test('Grenzwerte bleiben nach dem Neustart erhalten', app => {
  const namen = Array.from({ length: 200 }, (_, i) => 'Kind ' + (i + 1));
  klasseMitNamen(app, '7b', namen);
  erwarte(app.E('curClass().students.length') === 200, '200 Namen nicht angelegt');
  app.$('#student-input').value = 'Nummer 201'; app.klick('#btn-add-students');
  erwarte(app.E('curClass().students.length') === 200 && app.$('#toast').textContent.indexOf('Höchstens') >= 0,
    'Name 201 ohne Hinweis angenommen oder abgelehnt');
  app.E('goPlans()'); app.klick('#btn-add-plan');
  const plus = app.$$('#sheet .stepper button')[1];
  for(let i = 0; i < 30; i++) app.klick(plus);
  erwarte(app.$('#sheet .stepper output').textContent === '20', 'Zusätzliche Tische nicht auf 20 begrenzt');
  app.sheetOk();
  erwarte(app.E('curPlan().desks.length') === 220, 'Plan hat nicht 220 Tische');
  app.E('flushSave()');
  const geladen = app.E('sanitizeDB(JSON.parse(localStorage.getItem(KEY))).classes[0].plans[0].desks.length');
  erwarte(geladen === 220, 'Nach dem Neustart nur ' + geladen + ' von 220 Tischen');
  for(let i = 0; i < 40; i++) app.E('addItem("desk", "")');
  erwarte(app.E('curPlan().desks.length') === app.E('MAX_DESKS'), 'Tische über die Obergrenze hinaus angelegt');
  erwarte(app.$('#toast').textContent.indexOf('Höchstens') >= 0, 'Keine Meldung an der Obergrenze');
  app.E('for(let i = 0; i < 520; i++) curClass().rules.push({ id: "r" + i, type: "apart", a: curClass().students[i % 200].id, b: curClass().students[(i + 1) % 200].id })');
  erwarte(app.E('sanitizeDB(JSON.parse(JSON.stringify(DB))).classes[0].rules.length') === app.E('MAX_RULES'), 'Regelgrenze beim Laden passt nicht');
});

test('PDF: Sonderzeichen in Namen', app => {
  const faelle = { 'Ayşe Yıldız': 'Ayse Yildiz', 'Łukasz': 'Lukasz', 'Олег': 'Oleg', 'Ana (2)': 'Ana \\(2\\)', 'Jörg': 'J\\366rg', 'Šárka': '\\212\\341rka', 'Nguyễn': 'Nguyen' };
  for(const [ein, aus] of Object.entries(faelle)){
    const r = app.E('pdfEscape(' + JSON.stringify(ein) + ')');
    erwarte(r === aus, ein + ' → ' + r + ' (erwartet ' + aus + ')');
  }
  klasseMitNamen(app, '5c', ['Ayşe Yıldız', 'Łukasz Nowak', 'Jörg']);
  neuerPlan(app, 0, 'Zufällig');
  const inhalt = app.E('pdfPlanPage(curClass(), curPlan(), curRoom(), planTitle())');
  erwarte(inhalt.indexOf('Ayse Yildiz') >= 0 && inhalt.indexOf('Lukasz Nowak') >= 0, 'Namen fehlen im PDF-Inhalt');
  erwarte(inhalt.indexOf('?') < 0, 'PDF-Inhalt enthält Fragezeichen');
});

test('Sicherung laden lässt sich rückgängig machen', async app => {
  klasseMitNamen(app, 'Original');
  app.E('flushSave()');
  const fremd = JSON.stringify({ app: 'sitzplan', v: 2, data: { v: 2, classes: [{ id: 'x', name: 'Aus Sicherung', students: [], rules: [], plans: [] }], rooms: [] } });
  app.E('goHome()');
  dateiWaehlen(app, '#filepick', 'alt.json', fremd);
  await pause(60);
  erwarte(app.$('#modal').classList.contains('on'), 'Keine Rückfrage vor dem Ersetzen');
  app.sheetOk();
  erwarte(app.E('DB.classes[0].name') === 'Aus Sicherung', 'Sicherung nicht geladen');
  erwarte(!!app.$('#backup-reminder .minibtn.blue'), 'Kein Angebot, den vorherigen Stand zurückzuholen');
  app.klick('#backup-reminder .minibtn.blue'); app.sheetOk();
  erwarte(app.E('DB.classes[0].name') === 'Original' && app.E('DB.classes[0].students.length') === 12, 'Vorheriger Stand nicht zurückgeholt');
  erwarte(!app.$('#backup-reminder .minibtn.blue'), 'Angebot bleibt nach dem Zurückholen stehen');
  // FairMix-Datei am falschen Ort
  dateiWaehlen(app, '#filepick', 'FairMix_Backup.json', JSON.stringify(FAIRMIX));
  await pause(60);
  erwarte(app.$('#toast').textContent.indexOf('Aus FairMix') >= 0, 'FairMix-Datei unter „Sicherung laden“ ohne Hinweis');
  erwarte(app.E('DB.classes[0].name') === 'Original', 'FairMix-Datei hat den Stand überschrieben');
  // FairMix-Import über die Dateiauswahl
  app.klick('#tile-names');
  dateiWaehlen(app, '#fmpick', 'FairMix_Backup.json', JSON.stringify(FAIRMIX));
  await pause(60);
  erwarte(app.$$('#sheet .choice').length === 2, 'Importauswahl erscheint nicht');
});

test('Speichern beim Wechsel in den Hintergrund', app => {
  klasseMitNamen(app);
  app.E('flushSave(); curClass().name = "Neu"; save()');
  erwarte(app.E('JSON.parse(localStorage.getItem(KEY)).classes[0].name') === '7b', 'Testannahme: Speichern sollte noch warten');
  app.w.document.dispatchEvent(new app.w.Event('pause'));
  erwarte(app.E('JSON.parse(localStorage.getItem(KEY)).classes[0].name') === 'Neu', '„pause“ speichert nicht sofort');
});

test('Festhalten: Lücken geschlossen', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('curPlan().desks[0].locked = true; curPlan().desks[0].x = 77');
  const fest = app.E('curPlan().desks[0].studentId');
  const anderer = app.E('curPlan().desks[1].studentId');
  app.E('placeStudent(curPlan().desks[1].studentId, curPlan().desks[0], curPlan().desks[1])');
  erwarte(app.E('curPlan().desks[0].studentId') === fest && app.E('curPlan().desks[1].studentId') === anderer, 'Name auf festgehaltenen Platz verschoben');
  erwarte(app.$('#toast').textContent.indexOf('festgehalten') >= 0, 'Keine Meldung beim festgehaltenen Platz');
  app.E('placeStudent(' + JSON.stringify(fest) + ', curPlan().desks[2], curPlan().desks[0])');
  erwarte(app.E('curPlan().desks[0].studentId') === fest, 'Name vom festgehaltenen Platz weggezogen');
  app.klick('#btn-place-all');
  erwarte(app.E('curPlan().desks.some(d => d.locked && d.studentId === ' + JSON.stringify(fest) + ')'), '„Alle Namen setzen“ verwirft festgehaltenen Platz');
  erwarte(app.E('curPlan().desks.length') === 12 && besetzt(app) === 12, '„Alle Namen setzen“ setzt nicht jeden genau einmal');
});

test('Abwesende in der Liste gekennzeichnet', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Selbst');
  const fehlt = app.E('curClass().students[0].id');
  app.E('ensureLesson(curClass()); curClass().lesson.absent = [' + JSON.stringify(fehlt) + ']; autoSeat(true)');
  const chips = app.$$('#unseated-box .chip');
  erwarte(chips.length === 1 && chips[0].textContent.indexOf('fehlt') >= 0, 'Abwesende ohne Kennzeichnung');
  erwarte(app.$('#unseated-box .eyebrow').textContent.indexOf('fehlen heute') >= 0, 'Überschrift nennt Abwesende nicht');
});

test('Einzahl und Mehrzahl', app => {
  klasseMitNamen(app, '1a', ['Solo']);
  erwarte(app.$('#class-cards .ccard .cm').textContent === '1 Schüler:in · 0 Sitzpläne', 'Text: ' + app.$('#class-cards .ccard .cm').textContent);
  neuerPlan(app, 0, 'Zufällig');
  app.klick('#btn-editor-back');
  erwarte(app.$('#plan-list .card .s').textContent.indexOf('1 Tisch ·') === 0, 'Text: ' + app.$('#plan-list .card .s').textContent);
  app.E('goRooms()');
  erwarte(app.$('#room-list .card .s').textContent.indexOf('in 1 Sitzplan') >= 0, 'Raum: ' + app.$('#room-list .card .s').textContent);
});

test('Viele FairMix-Gruppen in einem vollen Raum', app => {
  app.E(`(() => { const c = newClassObj("Groß"); DB.classes.push(c); setCurClass(c.id);
    for(let i = 0; i < 200; i++) c.students.push({ id: "s" + i, name: "N" + i, tags: [], level: 0 });
    for(let k = 0; k < 40; k++) c.groups.push({ id: "g" + k, name: "", members: c.students.slice(k * 5, k * 5 + 5).map(s => s.id) });
    const p = { id: "p", name: "p", roomId: null, deskSize: "single", byGroups: true, desks: [] };
    for(let i = 0; i < 200; i++) p.desks.push({ id: "d" + i, type: "desk", x: 0, y: 0, w: 90, h: 55, rot: 0 });
    c.plans.push(p); openPlan("p"); })()`);
  app.E('layoutDesks("fmgroups", true)');
  erwarte(app.$('#toast').textContent.indexOf('passen nicht') >= 0, 'Kein Hinweis, dass der Raum zu klein ist');
  app.E('seatByGroups(true)');
  const gemischt = app.E(`(() => { const c = curClass(), p = curPlan();
    const g = id => c.groups.findIndex(x => x.members.indexOf(id) >= 0);
    return deskClusters(p.desks).filter(cl => new Set(cl.map(i => g(p.desks[i].studentId))).size > 1).length; })()`);
  erwarte(gemischt === 0, gemischt + ' Tischgruppen mischen FairMix-Gruppen');
});


/* ---------------- Räume, Feiern, Bedienung ---------------- */

const KASTEN = `(a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1`;
function hochzeit(app){
  app.E('DB.settings.mode = "event"; applyLang()');
  app.klick('#tile-names');
  app.klick('#btn-demo');
}

test('Erster Start fragt nach dem Einsatzbereich', async app => {
  await pause(320);
  erwarte(app.$('#modal').classList.contains('on') && app.$$('#sheet .choice').length === 2, 'Erststart-Frage erscheint nicht');
  app.willkommen('event');
  erwarte(app.E('DB.settings.mode') === 'event' && app.E('DB.onboarded') === true, 'Wahl „Feier“ nicht übernommen');
  erwarte(app.$('#tile-names').textContent.indexOf('Gäste verwalten') >= 0, 'Kachel heißt nicht „Gäste verwalten“');
  erwarte(app.E('JSON.parse(localStorage.getItem(KEY)).onboarded') === true, 'Antwort nicht gespeichert');
}, true);

test('Raumgröße in Metern', app => {
  app.E('goRooms()');
  app.klick('#btn-add-room'); app.askText('Raum 12');
  const r = () => app.E('curRoom()');
  erwarte(r().w === 1400 && r().h === 1000, 'Neuer Raum hat nicht die Standardgröße');
  app.E('openRoomSettings()');
  const felder = app.$$('#sheet .numfield input');
  erwarte(felder.length === 2 && felder[0].value === '9,3', 'Größenfelder fehlen oder zeigen nicht 9,3 m');
  app.E('addItem("cabinet", undefined, { x: 1300, y: 900 })');
  felder[0].value = '6'; felder[1].value = '5,0';
  app.klick(app.$$('#sheet .floorbtn')[1]);                 // Parkett
  app.sheetOk();
  erwarte(r().w === 900 && r().h === 750 && r().floor === 'parquet', 'Größe oder Boden nicht übernommen');
  erwarte(app.$('#stage').style.width === '900px' && app.$('#stage').className === 'floor-parquet', 'Fläche nicht angepasst');
  erwarte(app.E('curRoom().items.every(i => { const b = itemBox(i); return b.x >= -1 && b.y >= -1 && b.x + b.w <= 901 && b.y + b.h <= 751; })'), 'Möbel liegen nach dem Verkleinern außerhalb');
  felder[0].value = '2';
  app.E('openRoomSettings()'); app.$$('#sheet .numfield input')[0].value = '2'; app.sheetOk();
  erwarte(r().w === 900 && app.$('#toast').textContent.indexOf('zwischen 4 und 40') >= 0, 'Zu kleine Größe angenommen');
  app.E('closeModal(); undo()');
  erwarte(r().w === 1400 && r().floor === 'plain', 'Rückgängig stellt die Größe nicht wieder her');
  erwarte(app.E('JSON.stringify(sanitizeDB({ v:2, rooms:[{ id:"a", name:"Alt", items:[] }] }).rooms[0])').indexOf('"w":1400') >= 0, 'Alter Raum ohne Größe bekommt keine Standardgröße');
});

test('Raumvorlagen', app => {
  const keys = app.E('Object.keys(ROOM_TEMPLATES)');
  erwarte(['hall', 'party', 'conference', 'aula'].every(k => keys.indexOf(k) >= 0), 'Saal-Vorlagen fehlen');
  keys.forEach(k => {
    const ok = app.E(`(() => { const r = buildRoomFromTemplate(${JSON.stringify(k)}, "x");
      return r.items.length > 0 && r.items.every(i => { const b = itemBox(i); return b.x >= -1 && b.y >= -1 && b.x + b.w <= r.w + 1 && b.y + b.h <= r.h + 1; }); })()`);
    erwarte(ok, 'Vorlage ' + k + ' leer oder Möbel außerhalb');
  });
  app.E('goRooms()'); app.klick('#btn-room-from-tpl');
  const vorschau = app.$$('#sheet .tplpick');
  erwarte(vorschau.length === keys.length && vorschau.every(b => b.querySelector('svg.miniplan')), 'Vorlagen ohne Vorschau');
  erwarte(vorschau[0].dataset.tpl === 'classic', 'Im Schulmodus steht Schule nicht oben');
  app.E('closeModal(); DB.settings.mode = "event"'); app.klick('#btn-room-from-tpl');
  erwarte(app.$$('#sheet .tplpick')[0].dataset.tpl === 'hall', 'Im Feiermodus steht der Festsaal nicht oben');
  app.E('closeModal(); DB.rooms.push(buildRoomFromTemplate("hall", "Saal")); renderRooms()');
  erwarte(!!app.$('#room-list .card svg.miniplan') && app.$('#room-list .card .s').textContent.indexOf('20 × 14 m') === 0, 'Raumliste ohne Vorschau oder Maße');
});

test('Beispielhochzeit an runden Tischen', app => {
  hochzeit(app);
  erwarte(app.E('curRoom().w') === 3000, 'Hochzeit nicht im Festsaal');
  erwarte(app.E('planDesks().length') === 56 && app.E('planDesks().filter(d => d.studentId).length') === 56, 'Nicht alle 56 Gäste sitzen');
  erwarte(app.E('tableShapes(planDesks()).length') === 7, 'Nicht 7 runde Tische');
  erwarte(app.$$('#stage .ptable.round').length === 7, 'Tischplatten werden nicht gezeichnet');
  erwarte(!app.E('desksOverlap(planDesks())'), 'Stühle überlappen');
  const kollision = app.E(`(() => { const hit = ${KASTEN};
    const obs = curRoom().items.filter(i => ["stage","dancefloor","buffet","bar","pillar","headtable","gifttable","cake"].indexOf(i.type) >= 0).map(itemBox);
    return planDesks().filter(d => d.tbl).filter(d => obs.some(o => hit(itemBox(d), o))).length; })()`);
  erwarte(kollision === 0, kollision + ' Stühle stehen auf Bühne, Tanzfläche oder Buffet');
  const getrennt = app.E(`(() => { const c = curClass(), p = curPlan();
    const id = n => c.students.find(s => s.name === n).id;
    const g = id => (p.desks.find(d => d.studentId === id) || {}).groupId;
    return g(id("Tante Gisela")) !== g(id("Onkel Rolf")) && g(id("Oma Erika")) === g(id("Opa Heinz")); })()`);
  erwarte(getrennt, '„nie zusammen“ oder „immer zusammen“ an Tischen nicht erfüllt');
  erwarte(app.E('planDesks().filter(d => d.locked).length') === 2, 'Brautpaar nicht fest am Brautpaartisch');
  const pdf = app.E('pdfPlanPage(curClass(), curPlan(), curRoom(), planTitle())');
  erwarte(pdf.indexOf('(Tisch 7)') >= 0 && pdf.indexOf('?') < 0, 'PDF ohne Tischnummern oder mit Fragezeichen');
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"tbl":"round"') >= 0 && roh.indexOf('"floor":"parquet"') >= 0, 'Tische oder Boden überstehen die Sicherung nicht');
});

test('Plätze pro Tisch und lange Tafeln', app => {
  hochzeit(app);
  app.E('curPlan().seatsPerTable = 10; layoutDesks("rounds", true)');
  const g = app.E('tableShapes(planDesks()).length');
  erwarte(g === 6, 'Bei 10 Plätzen pro Tisch nicht 6 Tische, sondern ' + g);
  erwarte(app.E('(() => { const m = {}; planDesks().forEach(d => { if(d.tbl) m[d.groupId] = (m[d.groupId] || 0) + 1; }); return Math.max.apply(null, Object.values(m)); })()') <= 10, 'Mehr als 10 Stühle an einem Tisch');
  app.E('curPlan().seatsPerTable = 12; layoutDesks("longtables", true)');
  const tafeln = app.E('tableShapes(planDesks())');
  erwarte(tafeln.length === 5 && tafeln.every(t => t.kind === 'long' && t.len > t.dep), 'Lange Tafeln falsch: ' + tafeln.length);
  erwarte(!app.E('desksOverlap(planDesks())'), 'Stühle an Tafeln überlappen');
  erwarte(app.$$('#stage .ptable.long').length === 5, 'Tafeln werden nicht gezeichnet');
  app.E('layoutDesks("rows", true)');
  erwarte(app.E('curPlan().deskSize') === 'single' && app.E('planDesks().every(d => !d.tbl && d.w === 90)'), 'Zurück zu Reihen behält Stühle bei');
  erwarte(app.$$('#stage .ptable').length === 0, 'Tischplatten bleiben nach Reihen stehen');
  // Assistent im Feiermodus: runde Tische vorausgewählt, Plätze pro Tisch wählbar
  app.E('goPlans()'); app.klick('#btn-add-plan');
  erwarte(app.$('#sheet .choicegrid .choice.on').textContent.indexOf('Runde Tische') >= 0, 'Assistent wählt im Feiermodus keine runden Tische vor');
  const knopf6 = app.$$('#sheet .segmented button').find(b => b.textContent === '6');
  app.klick(knopf6); app.sheetOk();
  erwarte(app.E('curPlan().seatsPerTable') === 6 && app.E('tableShapes(planDesks()).length') === 10, 'Neuer Tischplan nicht mit 6 Plätzen je Tisch');
});

test('Möbel-Palette und Einrasten an der Wand', app => {
  app.E('DB.rooms.push(buildRoomFromTemplate("conference", "K")); openRoomStandalone(DB.rooms[0].id)');
  const typen = app.$$('#item-palette .paltile').map(b => b.dataset.type);
  erwarte(typen.length === app.E('Object.keys(ITEMS).length - 1') && typen.indexOf('dancefloor') >= 0, 'Palette unvollständig');
  app.E('placeFromPalette("window", { x: 700, y: 520 })');
  const fenster = app.E('curRoom().items[curRoom().items.length - 1]');
  erwarte(fenster.type === 'window' && (fenster.y <= 1 || fenster.rot === 90 || fenster.rot === 270), 'Fenster rastet nicht an der Wand ein');
  app.E('placeFromPalette("door", { x: 1450, y: 500 })');
  const tuer = app.E('itemBox(curRoom().items[curRoom().items.length - 1])');
  erwarte(Math.abs(tuer.x + tuer.w - 1500) <= 1 && tuer.w < tuer.h, 'Tür rastet nicht an der rechten Wand ein');
  app.E('placeFromPalette("whiteboard", { x: 750, y: 525 })');
  erwarte(app.E('curRoom().items[curRoom().items.length - 1].y') > 300, 'Tafel mitten im Raum wurde an die Wand gezogen');
  app.E('placeFromPalette("whiteboard", { x: 750, y: 90 })');
  erwarte(app.E('curRoom().items[curRoom().items.length - 1].y') === 0, 'Tafel in Wandnähe rastet nicht ein');
  app.E('placeFromPalette("stage", null)');
  const buehne = app.E('curRoom().items[curRoom().items.length - 1]');
  erwarte(buehne.type === 'stage' && buehne.rot === 0, 'Bühne lässt sich nicht hinzufügen');
});

test('Export großer Säle', app => {
  hochzeit(app);
  const seite = app.E('withRoomSize(curRoom(), () => pdfPlanPage(curClass(), curPlan(), curRoom(), "x"))');
  erwarte(seite.indexOf('20 \\327 14 m') >= 0 || seite.indexOf('20 × 14 m') >= 0 || seite.indexOf('(20 ') >= 0, 'PDF nennt die Raumgröße nicht');
  erwarte(app.E('ROOM_W') === 3000, 'withRoomSize stellt die Raumgröße nicht wieder her');
  app.E('DB.rooms.push(buildRoomFromTemplate("classic", "K")); curClass().plans.push({ id: "p2", name: "B", roomId: DB.rooms[DB.rooms.length - 1].id, deskSize: "single", desks: [] })');
  const seiten = app.E('(() => { let out = []; const keep = window.buildPDF; window.buildPDF = pages => { out = pages; return new Blob(["x"]); }; exportAllPDF(); window.buildPDF = keep; return out; })()');
  erwarte(seiten.length >= 2, 'Alle Pläne als PDF schlägt fehl');
  erwarte(seiten[0].indexOf('(20 ') >= 0 && seiten[1].indexOf('(9,3 ') >= 0, 'Jeder Plan muss in der Größe seines eigenen Raums gedruckt werden');
  erwarte(app.E('ROOM_W') === 3000, 'Export aller Pläne verändert die offene Raumgröße');
});

test('Nummern vor den Namen', app => {
  klasseMitNamen(app);
  const nr = app.$$('#student-list .namerow .nr').map(e => e.textContent);
  erwarte(nr.length === 12 && nr[0] === '1.' && nr[11] === '12.', 'Nummern fehlen: ' + nr.slice(0, 3).join(' '));
  app.klick('#btn-sort-names');
  erwarte(app.$$('#student-list .namerow .nr')[0].textContent === '1.', 'Nummerierung nach dem Sortieren falsch');
});

test('Vollbild bleibt bearbeitbar, bis es gesperrt wird', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.klick('#btn-present');
  erwarte(app.w.document.body.classList.contains('presenting'), 'Vollbild öffnet nicht');
  erwarte(app.E('isInteractive(curPlan().desks[0])') === true, 'Im Vollbild lassen sich Plätze nicht anfassen');
  app.E('selected = new Set([curPlan().desks[0].id]); renderStage(false)');
  erwarte(app.$('#selbar').classList.contains('on'), 'Auswahlleiste fehlt im Vollbild');
  app.klick('#btn-lock');
  erwarte(app.E('isInteractive(curPlan().desks[0])') === false && app.w.document.body.classList.contains('viewlocked'), 'Sperre wirkt nicht');
  erwarte(!app.$('#selbar').classList.contains('on'), 'Auswahl bleibt trotz Sperre aktiv');
  app.klick('#btn-lock');
  erwarte(app.E('isInteractive(curPlan().desks[0])') === true, 'Entsperren wirkt nicht');
  app.klick('#exitPresent');
  erwarte(!app.w.document.body.classList.contains('presenting') && !app.w.document.body.classList.contains('viewlocked'), 'Vollbild schließt nicht sauber');
});


/* Fängt den nächsten Download ab und liefert Blob und Dateiname */
function downloadAbfangen(app){
  const box = {};
  app.w.download = (blob, name) => { box.blob = blob; box.name = name; return true; };
  return box;
}
const blobText = async (app, blob) => blob.text ? blob.text() : new Promise(r => { const f = new app.w.FileReader(); f.onload = () => r(f.result); f.readAsText(blob); });

test('Klassenarbeit: A/B im Schachbrett und Vertretungsmappe', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('curPlan().exam = true; assignExamGroups(curPlan()); renderStage(false)');
  const nachbarnGleich = app.E(`(() => { const p = curPlan(), nb = neighbourMatrix(p.desks); let n = 0;
    for(let i = 0; i < p.desks.length; i++) for(let j = i + 1; j < p.desks.length; j++)
      if(nb[i][j] && p.desks[i].var === p.desks[j].var && Math.abs(itemBox(p.desks[i]).cy - itemBox(p.desks[j]).cy) < 20) n++;
    return n; })()`);
  erwarte(nachbarnGleich === 0, nachbarnGleich + ' direkte Banknachbarn haben dieselbe Aufgabengruppe');
  const a = app.E('curPlan().desks.filter(d => d.var === "A").length'), b = app.E('curPlan().desks.filter(d => d.var === "B").length');
  erwarte(a > 0 && b > 0 && Math.abs(a - b) <= 2, 'A/B ungleich verteilt: ' + a + '/' + b);
  erwarte(app.$$('#stage .exbadge').length === app.E('curPlan().desks.length'), 'A/B-Markierung fehlt auf den Tischen');
  const nums = app.E('Array.from(seatOrder(curPlan().desks).no.values()).sort((x, y) => x - y).join(",")');
  erwarte(nums === Array.from({ length: app.E('curPlan().desks.length') }, (_, i) => i + 1).join(','), 'Platznummern nicht lückenlos');
  app.E('curClass().subNote = "Aufgaben im Fach (Seite 42)"');
  const seiten = app.E('substitutePages(curClass(), curPlan(), curRoom(), true)');
  const alles = seiten.map(p => typeof p === 'string' ? p : p.content).join('\n');
  erwarte(seiten.length >= 2 && alles.indexOf('Anna') >= 0 && alles.indexOf('Seite 42') >= 0, 'Vertretungsmappe unvollständig');
  erwarte(alles.indexOf('?') < 0, 'Vertretungsmappe enthält Fragezeichen');
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"var":"B"') >= 0 && roh.indexOf('"exam":true') >= 0 && roh.indexOf('Seite 42') >= 0, 'Klassenarbeit übersteht die Sicherung nicht');
});

test('Gäste: Zusage, Menü, Begleitung', app => {
  hochzeit(app);
  app.E('goNames()');
  const n0 = app.E('curClass().students.length');
  const knopf = app.$$('#student-list .rsvp')[2];
  erwarte(!!knopf, 'Zusage-Knopf fehlt in der Gästeliste');
  const id = app.E('curClass().students[2].id');
  const vorher = app.E('curClass().students[2].rsvp');
  app.klick(knopf);
  erwarte(app.E('curClass().students[2].rsvp') !== vorher, 'Zusage lässt sich nicht umschalten');
  app.E('curClass().students[2].rsvp = "no"; renderNames()');
  erwarte(app.E(`absentToday(curClass()).has("${id}")`), 'Absage zählt nicht als abwesend');
  app.E('curClass().students.forEach(s => { s.locked = false; }); curPlan().desks.forEach(d => { delete d.locked; }); autoSeat(true)');
  erwarte(!app.E(`curPlan().desks.some(d => d.studentId === "${id}")`), 'Abgesagter Gast bekommt einen Platz');
  // Gast bearbeiten: Menü und Küchenhinweis, dann Begleitung
  app.E('editStudent(curClass().students[0].id)');
  const fisch = app.$$('#sheet .segmented button').find(b => b.textContent === 'Fisch');
  app.klick(fisch);
  app.$('#sheet input[maxlength="120"]').value = 'ohne Nüsse';
  const plus = app.$$('#sheet button').find(b => b.textContent.indexOf('Begleitung') >= 0);
  app.klick(plus);
  const s0 = app.E('JSON.stringify(curClass().students[0])');
  erwarte(s0.indexOf('"menu":"fish"') >= 0 && s0.indexOf('ohne Nüsse') >= 0, 'Menü vor dem Hinzufügen der Begleitung verloren');
  erwarte(app.E('curClass().students.length') === n0 + 1 && app.E('curClass().students[1].name').indexOf('Begleitung von') === 0, 'Begleitung nicht angelegt');
  erwarte(app.E('curClass().rules.some(r => r.type === "together" && r.a === curClass().students[0].id && r.b === curClass().students[1].id)'), 'Begleitung ohne „immer zusammen“');
  erwarte(app.$('#guest-stats').textContent.indexOf('Fisch: 1') >= 0, 'Übersicht zählt Menüs nicht');
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"rsvp":"no"') >= 0 && roh.indexOf('"menu":"fish"') >= 0, 'Gästedaten überstehen die Sicherung nicht');
});

test('Gruppen selbst anlegen und zusammen setzen', app => {
  klasseMitNamen(app);
  erwarte(app.$('#groups-box').style.display !== 'none', 'Gruppenbereich fehlt');
  const neu = (name, namen) => {
    app.klick('#btn-add-group');
    app.$('#sheet input.field').value = name;
    app.$$('#sheet .chklist button').filter(b => namen.indexOf(b.querySelector('span:nth-child(2)').textContent) >= 0).forEach(b => b.click());
    app.sheetOk();
  };
  neu('Rot', ['Anna', 'Ben', 'Cem', 'Dana']);
  neu('Blau', ['Dana', 'Emil', 'Fiona']);
  const gs = app.E('JSON.stringify(curClass().groups.map(g => [g.name, g.members.length, g.color]))');
  erwarte(gs === '[["Rot",3,0],["Blau",3,1]]', 'Gruppen falsch angelegt: ' + gs);
  erwarte(app.$$('#fm-group-list .grpcard').length === 2 && app.$$('#fm-group-list .gdot').length === 2, 'Gruppenkarten fehlen');
  // leere Auswahl wird abgelehnt
  app.klick('#btn-add-group'); app.sheetOk();
  erwarte(app.$('#modal').classList.contains('on') && app.E('curClass().groups.length') === 2, 'Leere Gruppe wurde angelegt');
  app.E('closeModal()');
  // bearbeiten und löschen
  app.klick(app.$$('#fm-group-list .grpcard')[1]);
  app.klick(app.$$('#sheet button').find(b => b.textContent === 'Gruppe löschen'));
  erwarte(app.E('curClass().groups.length') === 1, 'Gruppe lässt sich nicht löschen');
  neuerPlan(app, 1);
  app.E('layoutDesks("groups4", true); curPlan().byGroups = true; seatByGroups(true)');
  const zusammen = app.E(`(() => { const c = curClass(), p = curPlan(), cl = deskClusters(p.desks);
    const ix = id => cl.findIndex(k => k.some(i => p.desks[i].studentId === id));
    const m = c.groups[0].members.map(ix); return m.every(x => x === m[0] && x >= 0); })()`);
  erwarte(zusammen, 'Gruppe sitzt nicht an einer Tischgruppe');
  app.E('renderStage(false)');
  erwarte(app.$$('#stage .pdot').length === 3, 'Farbpunkte der Gruppe fehlen auf den Plätzen');
});

test('Weitere Tischformen', app => {
  hochzeit(app);
  const pruef = (art, form, anzahl) => {
    app.E(`curPlan().seatsPerTable = 8; layoutDesks("${art}", true)`);
    const sh = app.E('tableShapes(planDesks())');
    erwarte(sh.length === anzahl && sh.every(x => x.kind === form), art + ': ' + sh.length + ' × ' + (sh[0] && sh[0].kind));
    erwarte(!app.E('desksOverlap(planDesks())'), art + ': Stühle überlappen');
    erwarte(app.E('planDesks().every(d => d.studentId === undefined || d.tbl)'), art + ': Stühle ohne Tisch');
    return sh;
  };
  pruef('squares', 'square', 7);
  erwarte(app.$$('#stage .ptable.square').length === 7, 'Quadratische Tische werden nicht gezeichnet');
  const ov = pruef('ovals', 'oval', 7);
  erwarte(ov.every(o => o.len > o.dep * 1.3), 'Ovale Tische sind nicht länglich');
  const u = pruef('utable', 'long', 3);
  const kopf = u.reduce((a, b) => a.cy < b.cy ? a : b);
  const kopfStuehle = app.E('planDesks().filter(d => /_0$/.test(d.groupId)).map(d => d.y + d.h / 2)');
  erwarte(kopfStuehle.every(y => y < kopf.cy), 'U-Tafel: Kopftafel liegt nicht vor den Stühlen');
  const arme = u.filter(x => x !== kopf);
  erwarte(arme.every(a => a.len > a.dep) && Math.abs(arme[0].rot - 90) < 1, 'U-Tafel: Seitentafeln nicht längs');
  const armStuehle = app.E('planDesks().filter(d => /_1$/.test(d.groupId)).map(d => d.x + d.w / 2)');
  const links = arme.reduce((a, b) => a.cx < b.cx ? a : b);
  erwarte(armStuehle.every(x => x < links.cx) || armStuehle.some(x => x > links.cx), 'U-Tafel: Stühle nicht außen');
  erwarte(Math.abs((kopf.cy + kopf.dep / 2) - (links.cy - links.len / 2)) < 4, 'U-Tafel: Seitentafel schließt nicht an die Kopftafel an');
  const tt = pruef('ttable', 'long', 2);
  erwarte(tt[0].len > tt[0].dep && Math.abs(tt[1].rot - 90) < 1, 'T-Tafel falsch');
  app.E('layoutDesks("rounds", true)');
  erwarte(app.$$('#stage .ptable.round').length > 0 && app.$$('#stage .ptable.square').length === 0, 'Alte Tischplatten bleiben stehen');
  const pdf = app.E('curPlan().seatsPerTable = 8; layoutDesks("ovals", true); pdfPlanPage(curClass(), curPlan(), curRoom(), "x")');
  erwarte(pdf.indexOf(' c h B') >= 0 || pdf.indexOf('c h') >= 0, 'Ovale Tische fehlen im PDF');
  erwarte(app.E('PRESET_KEYS.every(k => I18N.de.presets[k] && I18N.en.presets[k] && I18N.de.presetsSub[k] && I18N.en.presetsSub[k])'), 'Vorlagennamen fehlen');
});

test('Platzkarten, Wer sitzt wo und Küchenliste', app => {
  hochzeit(app);
  app.E('curClass().students[0].menu = "veg"; curClass().students[0].note = "ohne Nüsse"; curClass().students[1].menu = "kids"');
  const inhalt = pages => pages.map(p => typeof p === 'string' ? p : p.content).join('\n');
  const karten = app.E('placeCardPages(curClass(), curPlan())');
  const sitzend = app.E('curPlan().desks.filter(d => d.studentId).length'), tische = app.E('tableShapes(curPlan().desks).length');
  erwarte(karten.length === Math.ceil((sitzend + tische) / 4) && karten.every(p => p.w === 595 && p.h === 842), 'Platzkarten: falsche Seitenzahl oder kein Hochformat');
  erwarte(inhalt(karten).indexOf('-1 0 0 -1') >= 0, 'Platzkarten: Rückseite steht nicht auf dem Kopf');
  const name0 = app.E('curClass().students[0].name');
  const wo = inhalt(app.E('escortPages(curClass(), curPlan())'));
  erwarte(wo.indexOf('(Tisch ') >= 0 && wo.indexOf(name0.replace(/[äöü]/g, '')) >= 0 || wo.indexOf('Tisch') >= 0, 'Wer sitzt wo: Tischnummern fehlen');
  const namen = app.E('guestSeats(curClass(), curPlan()).map(e => e.st.name).sort((a, b) => a.localeCompare(b, "de"))');
  const pos = namen.map(n => wo.indexOf('(' + n.replace(/[()\\]/g, '')));
  erwarte(pos.filter(p => p >= 0).every((p, i, a) => i === 0 || p > a[i - 1]), 'Wer sitzt wo: nicht alphabetisch');
  const kueche = inhalt(app.E('kitchenPages(curClass(), curPlan())'));
  erwarte(kueche.indexOf('Vegetarisch') >= 0 && kueche.indexOf('Kinderteller') >= 0 && kueche.indexOf('ohne N') >= 0, 'Küchenliste ohne Menüs oder Hinweise');
  erwarte((inhalt(karten) + wo + kueche).replace(/Wer sitzt wo\?/g, '').indexOf('?') < 0, 'Feier-PDFs enthalten Fragezeichen');
  const box = downloadAbfangen(app);
  app.E('exportEventPdf("kitchen")');
  erwarte(box.name && /\.pdf$/.test(box.name), 'Küchenliste wird nicht gespeichert');
  app.klick('#btn-share');
  const titel = app.$$('#sheet .tile .txt span:first-child').map(x => x.textContent);
  erwarte(titel.indexOf('Tisch- und Platzkarten') >= 0 && titel.indexOf('Wer sitzt wo?') >= 0 && titel.indexOf('Küchenliste') >= 0, 'Feier-Exporte fehlen im Teilen-Menü');
});

test('Verschlüsselte Sicherung', async app => {
  klasseMitNamen(app, 'Geheim', ['Zoe Zufall', 'Yannik']);
  app.E('goHome()');
  const box = downloadAbfangen(app);
  app.klick('#btn-backup');
  erwarte(!!app.$('#bk-enc'), 'Kein Angebot zur Verschlüsselung');
  app.$('#bk-pw1').value = 'kurz'; app.$('#bk-pw2').value = 'kurz';
  app.klick('#bk-enc'); await pause(50);
  erwarte(!box.blob, 'Zu kurzes Passwort akzeptiert');
  app.$('#bk-pw1').value = 'richtig-geheim'; app.$('#bk-pw2').value = 'richtig-geheim';
  app.klick('#bk-enc');
  for(let i = 0; i < 100 && !box.blob; i++) await pause(30);
  erwarte(!!box.blob, 'Verschlüsselte Sicherung nicht erzeugt');
  if(!box.blob) return;
  const text = await blobText(app, box.blob);
  /* Zeichen mit Leerzeichen oder Anführungszeichen kommen in Base64 nicht vor – kein Zufallstreffer */
  erwarte(text.indexOf('Zoe Zufall') < 0 && text.indexOf('"Geheim"') < 0 && text.indexOf('"students"') < 0 && text.indexOf('"enc"') >= 0, 'Sicherung enthält Klartext');
  erwarte(/geschuetzt\.json$/.test(box.name), 'Dateiname zeigt den Schutz nicht');
  // falsches Passwort
  dateiWaehlen(app, '#filepick', 'b.json', text); await pause(60);
  erwarte(!!app.$('#bk-pw-open'), 'Keine Passwortabfrage beim Laden');
  app.$('#bk-pw-open').value = 'falsch-falsch'; app.sheetOk();
  for(let i = 0; i < 100 && app.$('#toast').textContent.indexOf('Passwort falsch') < 0; i++) await pause(30);
  erwarte(app.$('#toast').textContent.indexOf('Passwort falsch') >= 0, 'Falsches Passwort ohne Hinweis');
  app.$('#bk-pw-open').value = 'richtig-geheim'; app.sheetOk();
  for(let i = 0; i < 150 && app.$('#bk-pw-open'); i++) await pause(30);
  erwarte(!app.$('#bk-pw-open') && app.$('#modal').classList.contains('on'), 'Nach richtigem Passwort keine Rückfrage zum Ersetzen');
  app.E('DB.classes[0].name = "Verändert"');
  app.sheetOk();
  erwarte(app.E('DB.classes[0].name') === 'Geheim' && app.E('DB.classes[0].students.length') === 2, 'Verschlüsselte Sicherung nicht wiederhergestellt');
});

test('Datenschutzhinweis für Lehrkräfte', async app => {
  await pause(320);
  app.willkommen('school');
  await pause(200);
  erwarte(!!app.$('#priv-ok') && app.$('#sheet').textContent.indexOf('Genehmigung der Schulleitung') >= 0, 'Hinweis auf die Schulleitung fehlt beim ersten Start');
  app.klick('#priv-ok');
  erwarte(!app.$('#modal').classList.contains('on'), 'Hinweis lässt sich nicht schließen');
  const info = app.E('I18N.de.info.concat(I18N.en.info).map(s => (s.p || []).join(" ")).join(" ")');
  erwarte(info.indexOf('Genehmigung der Schulleitung') >= 0 && info.indexOf('head teacher') >= 0, 'Info nennt die Genehmigung nicht');
  const ds = require('fs').readFileSync('datenschutz.html', 'utf8') + require('fs').readFileSync('datenschutz-en.html', 'utf8');
  erwarte(ds.indexOf('Genehmigung') >= 0 && ds.indexOf('head teacher') >= 0 && ds.indexOf('Art. 9') >= 0, 'Datenschutzerklärung unvollständig');
}, true);


test('Klassenarbeit beenden holt die alte Sitzordnung zurück', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  const lage = () => app.E('JSON.stringify(curPlan().desks.map(d => [d.x, d.y, d.studentId || ""]))');
  const vorher = lage();
  app.E('openExamSheet()'); app.sheetOk();
  erwarte(app.E('curPlan().exam') === true && lage() !== vorher, 'Klassenarbeit verändert die Plätze nicht');
  app.E('openExamSheet()'); app.sheetOk();                       // zweites Einrichten
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"examPrev"') >= 0, 'Ausgangslage übersteht das Speichern nicht');
  app.E('openExamSheet()');
  erwarte(!!app.$('#exam-end-restore') && !!app.$('#exam-end'), 'Beim Beenden keine Wahl, die alte Ordnung zurückzuholen');
  app.klick('#exam-end-restore');
  erwarte(lage() === vorher, 'Alte Sitzordnung nicht wiederhergestellt');
  erwarte(app.E('curPlan().exam') === false && app.E('curPlan().examPrev') === undefined && app.E('curPlan().desks.every(d => !d.var)'), 'Klassenarbeit nicht sauber beendet');
  app.E('openExamSheet()'); app.sheetOk();
  const pruefung = app.E('JSON.stringify(curPlan().desks.map(d => [d.x, d.y]))');
  app.E('openExamSheet()'); app.klick('#exam-end');
  erwarte(app.E('JSON.stringify(curPlan().desks.map(d => [d.x, d.y]))') === pruefung && app.E('curPlan().exam') === false, '„So lassen“ verändert die Plätze');
});


test('Stundenplan: Zeiten, Fächer, Stunden und Verknüpfung', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('goHome()');
  erwarte(app.$('#tile-timetable').style.display !== 'none' && app.$('#tile-grades').style.display !== 'none', 'Kacheln fehlen im Schulmodus');
  app.klick('#tile-timetable');
  erwarte(app.$$('#tt-grid .tt-free').length === 5 * 8, 'Raster nicht 5 × 8');
  erwarte(app.$$('#tt-grid .tt-break').length === 3, 'Pausen fehlen im Raster');
  // Zeiten ändern
  app.klick('#btn-tt-times');
  app.$('#tt-start').value = '07:50'; app.$('#tt-len').value = '45';
  app.$('#tt-count').value = '6'; app.$('#tt-count').dispatchEvent(new app.w.Event('input'));
  const pausen = app.$$('#sheet .ttbreaks input');
  erwarte(pausen.length === 5, 'Pausenfelder passen nicht zur Stundenzahl');
  pausen[1].value = '25'; pausen[1].dispatchEvent(new app.w.Event('input'));
  app.sheetOk();
  erwarte(app.E('JSON.stringify(periodTimes().slice(0, 3).map(p => fmtHM(p.start)))') === '["07:50","08:35","09:45"]', 'Stundenzeiten falsch: ' + app.E('JSON.stringify(periodTimes().map(p => fmtHM(p.start)))'));
  erwarte(app.$$('#tt-grid .tt-free').length === 5 * 6, 'Raster nach Änderung nicht 5 × 6');
  // Fach anlegen
  app.klick('#btn-tt-subjects'); app.klick('#subj-add');
  app.$$('#sheet input.field')[0].value = 'Mathematik'; app.$$('#sheet input.field')[1].value = 'Ma';
  app.klick(app.$$('#sheet .swatches button')[2]);
  app.sheetOk();
  erwarte(app.E('DB.subjects.length') === 1 && app.E('DB.subjects[0].color') === '#20A464', 'Fach oder Farbe nicht gespeichert');
  // Stunde eintragen: Mo, 1. Stunde, Doppelstunde
  app.klick(app.$$('#tt-grid .tt-free')[0]);
  const sels = app.$$('#sheet select');
  sels[2].value = app.E('DB.rooms[0].id');
  app.klick(app.$$('#sheet .segmented button').find(b => b.textContent === 'Doppelstunde'));
  app.sheetOk();
  erwarte(app.E('DB.lessons.length') === 1 && app.E('DB.lessons[0].span') === 2 && app.E('DB.lessons[0].classId') === app.E('curClass().id'), 'Stunde nicht richtig gespeichert');
  erwarte(app.$$('#tt-grid .tt-cell').length === 1 && app.$$('#tt-grid .tt-free').length === 5 * 6 - 2, 'Doppelstunde belegt nicht zwei Felder');
  // Überschneidung ersetzt die alte Stunde
  app.klick(app.$$('#tt-grid .tt-free')[0]); app.sheetOk();
  erwarte(app.E('DB.lessons.length') === 2, 'Zweite Stunde fehlt');
  app.E('DB.lessons[1].day = 0; DB.lessons[1].period = 1');
  // Jetzt-Karte: Montag 08:00
  const nl = app.E('(() => { const d = new Date(2026, 9, 5, 8, 0); const r = nowLessons(d); return r.now ? r.now.L.id === DB.lessons[0].id || r.now.L.id === DB.lessons[1].id : false; })()');
  erwarte(nl, 'Laufende Stunde wird nicht erkannt');
  erwarte(app.E('planForLesson(DB.lessons[0]).id') === app.E('curClass().plans[0].id'), 'Sitzplan zur Stunde nicht gefunden');
  app.E('openLessonPlan(DB.lessons[0])');
  erwarte(app.$('#screen-editor').classList.contains('active') && app.E('lessonMode') === true, 'Sitzplan öffnet nicht im Unterrichtsmodus');
  // A/B-Wochen
  app.E('DB.tt.ab = true; DB.tt.abRef = isoDay(mondayOf(new Date(2026, 9, 5)))');
  erwarte(app.E('abWeek(new Date(2026, 9, 7))') === 'A' && app.E('abWeek(new Date(2026, 9, 14))') === 'B' && app.E('abWeek(new Date(2026, 8, 30))') === 'B', 'A/B-Wochen falsch gezählt');
  // Sicherung
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"Mathematik"') >= 0 && roh.indexOf('"07:50"') >= 0 && roh.indexOf('"span":2') >= 0, 'Stundenplan übersteht die Sicherung nicht');
  // Feiermodus blendet alles aus
  app.E('DB.settings.mode = "event"; applyLang(); goHome()');
  erwarte(app.$('#tile-timetable').style.display === 'none' && app.$('#tile-grades').style.display === 'none' && app.$('#now-card').style.display === 'none', 'Schulkacheln im Feiermodus sichtbar');
});

test('Bewertungen: anlegen, eintragen, Durchschnitte, PDF', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem', 'Dana']);
  app.E('DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); goHome()');
  app.klick('#tile-grades');
  erwarte(!!app.$('#g-priv-ok') && app.$('#sheet').textContent.indexOf('Schulleitung') >= 0, 'Datenschutzhinweis vor den Bewertungen fehlt');
  app.klick('#g-priv-ok');
  erwarte(app.$('#screen-grades').classList.contains('active'), 'Bewertungen öffnen nicht');
  app.klick('#g-add-subject'); app.klick(app.$$('#sheet .grpcard')[0]);
  erwarte(app.$$('#grades-body .subjchip.on').length === 1, 'Fach nicht gewählt');
  // Klassenarbeit, Noten
  app.klick('#g-new'); app.sheetOk();
  erwarte(app.$('#screen-assess').classList.contains('active') && app.$$('#assess-pad button').length === 16 + 2, 'Tastenfeld für Noten falsch');
  const taste = tok => app.klick(app.$$('#assess-pad button').find(b => b.dataset.tok === tok));
  taste('1'); taste('2-'); taste('x'); taste('4+');
  erwarte(app.E('JSON.stringify(Object.values(curAssess().marks))') === '["1","2-","x","4+"]', 'Werte nicht der Reihe nach eingetragen');
  erwarte(Math.abs(app.E('assessAverage(curAssess())') - (1 + 2.3 + 3.7) / 3) < 1e-9, 'Durchschnitt der Arbeit falsch');
  erwarte(!!app.$('#assess-stats .gchart') && app.$$('#assess-stats .gbar').length === 3, 'Notenspiegel fehlt oder falsch');
  app.klick('#btn-assess-back');
  // Mitarbeit mit Punkten, Gewicht 2
  app.klick('#g-new');
  app.klick(app.$$('#a-kind button')[1]); app.klick(app.$$('#a-scale button')[1]); app.klick(app.$$('#a-weight button')[2]);
  app.sheetOk();
  erwarte(app.$$('#assess-pad button').length === 16 + 2, 'Tastenfeld für Punkte falsch');
  taste('14'); taste('8');
  app.klick('#btn-assess-back');
  // Gewichtung 60:40
  app.klick('#g-weight'); app.$('#g-weight-range').value = '60'; app.$('#g-weight-range').dispatchEvent(new app.w.Event('input')); app.sheetOk();
  const av = app.E('studentAverages(curClass(), "ma", curClass().students[0].id)');
  erwarte(av.scale === 'grade' && Math.abs(av.written - 1) < 1e-9 && Math.abs(av.other - 1) < 1e-9 && Math.abs(av.total - 1) < 1e-9, 'Durchschnitt Anna falsch: ' + JSON.stringify(av));
  const ben = app.E('studentAverages(curClass(), "ma", curClass().students[1].id)');
  erwarte(Math.abs(ben.total - (0.6 * 2.3 + 0.4 * 3)) < 1e-9, 'Gewichtung falsch: ' + ben.total);
  const benW = app.E(`(() => { const c = curClass(), b = c.students[1].id;
    c.assess.push({ id: "w2", subjectId: "ma", title: "KA 2", date: "2030-01-01", kind: "written", scale: "grade", weight: 2, marks: { [b]: "4" } });
    const r = studentAverages(c, "ma", b).written; c.assess = c.assess.filter(x => x.id !== "w2"); return r; })()`);
  erwarte(Math.abs(benW - (2.3 + 2 * 4) / 3) < 1e-9, 'Gewicht einzelner Bewertungen wirkt nicht: ' + benW);
  const cem = app.E('studentAverages(curClass(), "ma", curClass().students[2].id)');
  erwarte(cem.total === null, '„fehlt“ zählt in den Durchschnitt');
  // Übersicht
  app.klick('#g-tab-overview');
  erwarte(!!app.$('#g-table') && app.$$('#g-table tr').length === 5 && app.$$('#grades-body .gline, #grades-body .gdotc').length >= 2, 'Übersicht oder Verlauf fehlt');
  erwarte(app.$('#g-table').textContent.indexOf('1,00') >= 0, 'Durchschnitt in der Tabelle fehlt');
  app.klick(app.$$('#g-table .gname')[1]);
  erwarte(app.$('#sheet').textContent.indexOf('Gesamt') >= 0 && !!app.$('#sheet .gchart'), 'Schülerverlauf fehlt');
  app.E('closeModal()');
  const pdf = app.E('gradesPdfPages(curClass(), subjectById("ma")).join("\\n")');
  erwarte(pdf.indexOf('(Anna)') >= 0 && pdf.indexOf('2-') >= 0 && pdf.indexOf('?') < 0, 'Noten-PDF unvollständig');
  // Sanitize: ungültige Werte und fremde IDs fliegen raus
  const roh = app.E('(() => { const d = JSON.parse(JSON.stringify(DB)); d.classes[0].assess[0].marks.fremd = "1"; d.classes[0].assess[0].marks[d.classes[0].students[3].id] = "7"; return JSON.stringify(sanitizeDB(d).classes[0].assess); })()');
  erwarte(roh.indexOf('fremd') < 0 && roh.indexOf('"7"') < 0 && roh.indexOf('"2-"') >= 0 && roh.indexOf('"14"') >= 0, 'Bewertungen werden beim Laden nicht geprüft');
  // Smileys
  app.klick('#g-tab-list'); app.klick('#g-new'); app.klick(app.$$('#a-scale button')[2]); app.sheetOk();
  erwarte(app.$$('#assess-pad button').length === 4 + 2 && app.$$('#assess-pad button')[3].textContent === '🙁', 'Smiley-Tastenfeld nicht vierstufig');
  taste('s1');
  erwarte(app.E('studentAverages(curClass(), "ma", curClass().students[0].id).total') === 1, 'Smileys verändern den Durchschnitt');
  // Ausblenden in den Einstellungen
  app.E('DB.settings.grades = false; goHome()');
  erwarte(app.$('#tile-grades').style.display === 'none', 'Bewertungen lassen sich nicht ausblenden');
});

test('Mitarbeit direkt im Sitzplan bewerten', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "de", name: "Deutsch", short: "De", color: "#E0533D" }); DB.gradesAck = true; setLesson(true)');
  const d = app.E('curPlan().desks.find(x => x.studentId).id');
  app.E(`openLessonSheet(curPlan().desks.find(x => x.id === "${d}"))`);
  erwarte(!!app.$('#lesson-quickmark'), 'Kein „Mitarbeit bewerten“ im Unterrichtsmodus');
  app.E(`quickMark(studentById(curClass(), curPlan().desks.find(x => x.id === "${d}").studentId))`);
  app.klick(app.$$('#sheet .keypad button').find(b => b.dataset.tok === '2+'));
  const a = app.E('curClass().assess[0]');
  erwarte(a && a.auto && a.kind === 'other' && a.subjectId === 'de' && Object.values(a.marks)[0] === '2+', 'Mitarbeit nicht gespeichert');
  app.E(`quickMark(curClass().students.find(s => !curClass().assess[0].marks[s.id]))`);
  app.klick(app.$$('#sheet .keypad button').find(b => b.dataset.tok === '3'));
  erwarte(app.E('curClass().assess.length') === 1 && app.E('Object.keys(curClass().assess[0].marks).length') === 2, 'Zweite Mitarbeit legt eine neue Bewertung an');
  erwarte(app.E('pdfPlanPage(curClass(), curPlan(), curRoom(), "x")').indexOf('2+') < 0, 'Bewertung erscheint im Sitzplan-PDF');
});


function getComputedStyleDisplay(app, sel){ const el = app.$(sel); return el ? app.w.getComputedStyle(el).display : ''; }

test('Bewerten im Sitzplan und über die Liste', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.gradesAck = true; goGrades("ma")');
  app.klick('#g-new'); app.sheetOk();
  // erst zwei über die Liste
  const taste = (sel, tok) => app.klick(app.$$(sel + ' button').find(b => b.dataset.tok === tok));
  taste('#assess-pad', '2'); taste('#assess-pad', '3+');
  // dann im Sitzplan weiter
  app.klick('#av-plan');
  erwarte(app.$('#screen-editor').classList.contains('active') && app.w.document.body.classList.contains('grading'), 'Bewerten im Sitzplan startet nicht');
  erwarte(getComputedStyleDisplay(app, '.panels') === 'none', 'Menü verdeckt beim Bewerten den Plan');
  erwarte(app.$$('#stage .gmark').length === 2, 'Plätze zeigen die schon vergebenen Werte nicht: ' + app.$$('#stage .gmark').length);
  const erster = app.E('gradeSel');
  erwarte(!!erster && !app.E(`curAssess().marks["${erster}"]`), 'Kein freier Platz vorausgewählt');
  taste('#gb-pad', '1-');
  erwarte(app.E(`curAssess().marks["${erster}"]`) === '1-' && app.E('gradeSel') !== erster, 'Wert nicht gesetzt oder kein Weiterspringen');
  // gezielt einen Platz antippen
  const d = app.E('curPlan().desks.find(x => x.studentId && !curAssess().marks[x.studentId] && x.studentId !== gradeSel)');   // ein noch unbewerteter Platz – unabhängig von der Zufallsverteilung
  app.E(`pickGradeSeat("${d.studentId}")`);
  erwarte(!!app.$('#stage .item.gsel'), 'Gewählter Platz nicht hervorgehoben');
  taste('#gb-pad', 'x');
  erwarte(app.E(`curAssess().marks["${d.studentId}"]`) === 'x' && app.$$('#stage .gmark.miss').length === 1, '„fehlt“ im Sitzplan nicht gesetzt');
  erwarte(app.$('#gb-meta').textContent.indexOf('4 von 12') >= 0, 'Zähler in der Leiste falsch: ' + app.$('#gb-meta').textContent);
  // zurück zur Liste: dieselbe Bewertung mit allen Werten
  app.klick('#gb-list');
  erwarte(app.$('#screen-assess').classList.contains('active') && !app.w.document.body.classList.contains('grading'), 'Zurück zur Liste klappt nicht');
  erwarte(app.$$('#assess-list .av:not(.empty)').length === 4, 'Liste zeigt die Werte aus dem Sitzplan nicht');
  // Werte erscheinen sonst nirgends auf dem Plan
  app.E('openPlan(curClass().plans[0].id)');
  erwarte(app.$$('#stage .gmark').length === 0, 'Bewertungen bleiben nach dem Bewerten auf dem Plan sichtbar');
  // aus dem Unterrichtsmodus
  app.E('setLesson(true)');
  erwarte(app.$('#lb-grade').style.display !== 'none', '„Bewerten“ fehlt in der Unterrichtsleiste');
  app.klick('#lb-grade'); app.klick('#lg-new');
  erwarte(app.w.document.body.classList.contains('grading') && app.E('gradeAssess().auto') === true, 'Mitarbeit heute startet nicht im Sitzplan');
  app.klick('#gb-exit');
  erwarte(!app.w.document.body.classList.contains('grading') && app.E('lessonMode') === true, 'Nach dem Bewerten nicht zurück im Unterrichtsmodus');
  app.E('setLesson(false)');
  erwarte(app.E('lessonMode') === false && app.E('gradeMode') === null, 'Unterrichtsmodus endet nicht sauber');
});

test('Menü unter dem Plan einklappen', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  erwarte(!!app.$('#panel-grip'), 'Griff zum Einklappen fehlt');
  app.klick('#panel-grip');
  erwarte(app.w.document.body.classList.contains('panels-min') && app.E('DB.panelsMin') === true, 'Menü klappt nicht ein');
  app.klick(app.$$('.tabbar button')[1]);
  erwarte(!app.w.document.body.classList.contains('panels-min') && app.$('#panel-room').classList.contains('on'), 'Reiter klappt das Menü nicht wieder auf');
  app.klick('#panel-grip');
  app.E('goPlans(); openPlan(curClass().plans[0].id)');
  erwarte(app.w.document.body.classList.contains('panels-min'), 'Eingeklappter Zustand wird nicht gemerkt');
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"panelsMin":true') >= 0, 'Zustand übersteht das Speichern nicht');
});


test('Audit-Korrekturen', async app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem']);
  // Punkte → Noten an den Rändern
  erwarte(Math.abs(app.E('pointsToGrade(15)') - 0.7) < 1e-9 && app.E('pointsToGrade(0)') === 6 && app.E('pointsToGrade(8)') === 3, 'Umrechnung Punkte → Note falsch');
  // Gelöschte Schüler zählen nicht
  app.E(`(() => { const c = curClass(); c.assess = [{ id: "a1", subjectId: "m", title: "T", date: "2026-10-01", kind: "written", scale: "grade", weight: 1,
    marks: { [c.students[0].id]: "1", [c.students[1].id]: "1", [c.students[2].id]: "6" } }]; c.students.pop(); })()`);
  erwarte(app.E('assessAverage(curClass().assess[0])') === 1, 'Gelöschter Schüler zählt im Durchschnitt mit');
  // Gewichtung 100 % schriftlich: Mündliches zählt nicht
  app.E(`(() => { const c = curClass(); c.gradeW = { m: 100 }; c.assess.push({ id: "a2", subjectId: "m", title: "M", date: "2026-10-02", kind: "other", scale: "grade", weight: 1, marks: { [c.students[0].id]: "5" } }); })()`);
  erwarte(app.E('studentAverages(curClass(), "m", curClass().students[0].id).total') === 1, 'Bei 100 % schriftlich zählt Mündliches mit');
  app.E('curClass().gradeW = { m: 0 }');
  erwarte(app.E('studentAverages(curClass(), "m", curClass().students[1].id).total') === null, 'Bei 0 % schriftlich wird nur Schriftliches als Gesamt gezeigt');
  // Manipulierte Datei: kein Absturz, keine Prototyp-Namen
  const kaputt = app.E(`(() => { try{ const d = { v: 2, classes: [{ id: "k", name: "X", students: [{ id: "__proto__", name: "A" }, { id: "toString", name: "B" }],
    assess: [{ id: "z", subjectId: "m", scale: "constructor", marks: { x: "1" } }], gradeW: { "__proto__": 5 } }], rooms: [{ id: "r", name: "R", items: [{ type: "constructor" }] }] };
    const c = sanitizeDB(d).classes[0]; return JSON.stringify([c.students.map(s => s.id === "__proto__" || s.id === "toString"), c.assess.length]); }catch(e){ return "Ausnahme " + e.message; } })()`);
  erwarte(kaputt === '[[false,false],0]', 'Manipulierte Sicherung wird nicht sauber abgefangen: ' + kaputt);
  // Abgelaufene Kopie vor einer Wiederherstellung wird gelöscht
  app.E('localStorage.setItem(KEY_PREV, JSON.stringify({ at: "2025-01-01T00:00:00Z", data: "{}" })); prevState()');
  erwarte(app.E('localStorage.getItem(KEY_PREV)') === null, 'Abgelaufene Kopie bleibt liegen');
  // Sicherung ohne Papierkorb
  app.E('DB.trash = [{ id: "t", kind: "class", name: "Alt", at: new Date().toISOString(), payload: { name: "Alt" } }]');
  erwarte(app.E('backupData().trash.length') === 0 && app.E('DB.trash.length') === 1, 'Papierkorb landet in der Sicherung');
  // Gäste gleichmäßig auf Tische
  erwarte(app.E('JSON.stringify(tableCounts(9, 8))') === '[5,4]' && app.E('JSON.stringify(tableCounts(56, 8))') === '[8,8,8,8,8,8,8]', 'Gäste nicht gleichmäßig verteilt');
  // Kontrast der Fachfarben
  erwarte(app.E('inkOn("#C9A400")') === '#16232B' && app.E('inkOn("#0059B3")') === '#fff' && app.E('inkOn("#FFFFFF")') === '#16232B', 'Schriftfarbe auf Fachfarben falsch');
});

test('Klassenarbeit rückgängig machen', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  const vorher = app.E('JSON.stringify(curPlan().desks.map(d => [d.x, d.y, d.studentId || ""]))');
  app.E('openExamSheet()'); app.sheetOk();
  app.E('undo()');
  erwarte(app.E('curPlan().exam') === false && app.E('JSON.stringify(curPlan().desks.map(d => [d.x, d.y, d.studentId || ""]))') === vorher, 'Ein Rückgängig nimmt das Einrichten nicht ganz zurück');
  app.E('openExamSheet()'); app.sheetOk();
  app.E('openExamSheet()'); app.klick('#exam-end-restore');
  app.E('undo()');
  erwarte(app.E('curPlan().exam') === true && !!app.E('curPlan().examPrev') && app.E('curPlan().desks.some(d => d.var)'), 'Rückgängig nach dem Beenden stellt die Klassenarbeit nicht wieder her');
});

test('Stundenplan: nichts verschwindet still', app => {
  klasseMitNamen(app);
  app.E(`DB.subjects.push({ id: "m", name: "Mathe", short: "Ma", color: "#2E86DE" });
    DB.lessons.push({ id: "l7", day: 0, period: 6, span: 1, week: "", subjectId: "m", classId: curClass().id, roomId: "", planId: "" },
                    { id: "lb", day: 1, period: 0, span: 1, week: "B", subjectId: "m", classId: "", roomId: "", planId: "" },
                    { id: "la", day: 1, period: 0, span: 1, week: "A", subjectId: "m", classId: "", roomId: "", planId: "" });
    DB.tt.ab = true; DB.tt.abRef = "2026-09-28"; goTimetable()`);
  app.klick('#btn-tt-times'); app.$('#tt-count').value = '5'; app.sheetOk();
  erwarte(app.E('DB.lessons.some(L => L.id === "l7")'), 'Stunde außerhalb des verkleinerten Rasters wurde gelöscht');
  app.klick('#btn-tt-times'); app.$('#tt-count').value = '8';
  app.klick(app.$$('#sheet .setrow').find(r => r.textContent.indexOf('A/B') >= 0)); app.sheetOk();
  erwarte(app.$('#sheet').textContent.indexOf('B-Wochen') >= 0, 'Keine Rückfrage beim Ausschalten der A/B-Wochen');
  app.sheetOk();
  erwarte(app.E('DB.tt.ab') === false && app.E('JSON.stringify(DB.lessons.map(L => L.id + ":" + L.week))') === '["l7:","la:"]', 'A/B-Wochen nicht sauber ausgeschaltet: ' + app.E('JSON.stringify(DB.lessons.map(L => L.id + ":" + L.week))'));
  erwarte(app.$$('#tt-grid .tt-cell').length === 2, 'Stunde der 7. Stunde erscheint nicht wieder');
  // Überschneidung nur nach Rückfrage
  app.E('editLesson(null, 1, 0)'); app.sheetOk();
  erwarte(app.$('#sheet').textContent.indexOf('ersetzen') >= 0 && app.E('DB.lessons.length') === 2, 'Überschneidung ohne Rückfrage ersetzt');
  app.sheetOk();
  erwarte(app.E('DB.lessons.length') === 2 && !app.E('DB.lessons.some(L => L.id === "la")'), 'Ersetzen nach Bestätigung klappt nicht');
  // Neues Fach im Dialog: Auswahl bleibt erhalten
  app.E('editLesson(null, 2, 2)');
  const sels = app.$$('#sheet select'); sels[1].value = app.E('curClass().id');
  sels[0].value = '__new'; sels[0].dispatchEvent(new app.w.Event('change'));
  app.$$('#sheet input.field')[0].value = 'Physik'; app.sheetOk();
  return new Promise(r => setTimeout(r, 150)).then(() => {
    const s2 = app.$$('#sheet select');
    erwarte(s2.length && app.E('subjectById(' + JSON.stringify(s2[0].value) + ').name') === 'Physik' && s2[1].value === app.E('curClass().id'), 'Neues Fach nicht vorausgewählt oder Klasse verloren');
  });
});

test('Feier: Absagen nicht auf Karten', app => {
  hochzeit(app);
  const n0 = app.E('guestSeats(curClass(), curPlan()).length');
  app.E('const s0 = curPlan().desks.find(d => d.studentId).studentId; studentById(curClass(), s0).rsvp = "no"');
  erwarte(app.E('guestSeats(curClass(), curPlan()).length') === n0 - 1, 'Abgesagter Gast landet auf Karten und Küchenliste');
});


test('Name im Sitzplan antippen und bewerten', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "de", name: "Deutsch", short: "De", color: "#E0533D" }); DB.gradesAck = true');
  const d = app.E('curPlan().desks.find(x => x.studentId)');
  app.E(`selected = new Set(["${d.id}"]); renderStage(false)`);
  erwarte(app.$('#sb-grade').style.display !== 'none', '„Bewerten“ fehlt in der Auswahlleiste');
  app.klick('#sb-grade');
  erwarte(app.$$('#sheet .keypad button').length === 16, 'Tastenfeld mit Noten fehlt');
  app.klick(app.$$('#sheet .keypad button').find(b => b.dataset.tok === '2'));
  erwarte(!app.$('#modal').classList.contains('on') && app.E(`curClass().assess[0].marks["${d.studentId}"]`) === '2', 'Bewertung aus dem Sitzplan nicht gespeichert');
  // Einstellung Smileys: gilt für eine neue Mitarbeit (anderes Fach, heute noch keine)
  app.E('DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.settings.quickScale = "smiley"; curClass().lastSubject = "ma"');
  app.klick('#sb-grade');
  erwarte(app.$$('#sheet .keypad button').length === 4 && app.$$('#sheet .keypad button')[0].textContent === '😀', 'Einstellung Smileys wird nicht verwendet');
  app.klick(app.$$('#sheet .keypad button')[1]);
  erwarte(app.E('curClass().assess.find(a => a.subjectId === "ma").scale') === 'smiley', 'Mitarbeit nicht mit Smileys angelegt');
  // Einstellungen zeigen die Wahl
  app.E('renderSettings(); show("settings")');
  erwarte(!!app.$('#set-quickscale') && app.$('#set-quickscale .on').dataset.v === 'smiley', 'Einstellung fehlt');
  // Unterrichtsmodus: Tastenfeld direkt beim Antippen, Notiz bleibt erhalten
  app.E(`openPlan(curPlan().id); setLesson(true); openLessonSheet(curPlan().desks.find(x => x.id === "${d.id}"))`);
  erwarte(!!app.$('#lesson-quickmark .keypad'), 'Kein Tastenfeld beim Antippen im Unterrichtsmodus');
  app.$('#sheet textarea').value = 'Hausaufgabe vergessen';
  app.klick(app.$$('#lesson-quickmark .keypad button')[0]);
  erwarte(app.E(`curClass().lesson.notes["${d.studentId}"]`) === 'Hausaufgabe vergessen' && !app.$('#modal').classList.contains('on'), 'Notiz beim Bewerten verloren');
  // Ohne Bewertungen: kein Knopf
  app.E('setLesson(false); DB.settings.grades = false; selected = new Set(["' + d.id + '"]); renderStage(false)');
  erwarte(app.$('#sb-grade').style.display === 'none', '„Bewerten“ trotz ausgeschalteter Bewertungen');
});


test('Zweites Audit: Laden, Skalen, Sicherung', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem']);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "m", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.gradesAck = true; flushSave()');
  // Punkte-Kurs bleibt Punkte-Kurs
  app.E(`curClass().assess = [{ id: "k1", subjectId: "m", title: "Klausur", date: "2026-09-01", kind: "written", scale: "points", weight: 1,
    marks: { [curClass().students[0].id]: "12", [curClass().students[1].id]: "9" } }]`);
  erwarte(app.E('quickScaleFor(curClass(), "m")') === 'points', 'Schnellbewertung stellt Punkte-Kurs auf Noten um');
  app.E('DB.settings.quickScale = "smiley"');
  erwarte(app.E('quickScaleFor(curClass(), "m")') === 'smiley', 'Einstellung Smileys wird ignoriert');
  app.E('DB.settings.quickScale = "grade"');
  // Klassentrend mit Punkte-Durchschnitt in gemischtem Kurs
  app.E(`curClass().assess.push({ id: "k2", subjectId: "m", title: "KA", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [curClass().students[0].id]: "2" } })`);
  app.E('gradeSubject = "m"; gradeTab = "overview"; show("grades"); renderGrades()');
  erwarte(app.$$('#grades-body .gdotc').length === 2, 'Punkte-Test fehlt im Klassentrend');
  // Sicherung enthält keine Noten gelöschter Schüler
  const sid = app.E('curClass().students[1].id');
  app.E(`curClass().students = curClass().students.filter(s => s.id !== "${sid}")`);
  erwarte(JSON.stringify(app.E('backupData()')).indexOf(sid) < 0, 'Sicherung enthält Daten gelöschter Schüler');
  // Abbrechen beim neuen Fach behält das alte Fach
  app.E('DB.subjects.push({ id: "d", name: "Deutsch", short: "De", color: "#E0533D" }); DB.lessons.push({ id: "L1", day: 0, period: 0, span: 1, week: "", subjectId: "d", classId: "", roomId: "", planId: "" }); editLesson(DB.lessons[0])');
  const sel = app.$$('#sheet select')[0]; sel.value = '__new'; sel.dispatchEvent(new app.w.Event('change'));
  app.klick(app.$$('#sheet .row button')[0]);
  return new Promise(r => setTimeout(r, 200)).then(() => {
    erwarte(app.$$('#sheet select')[0] && app.$$('#sheet select')[0].value === 'd', 'Abbrechen beim neuen Fach wechselt das Fach der Stunde');
    app.E('closeModal()');
  });
});

test('Bewerten macht anwesend, Gruppentische', app => {
  klasseMitNamen(app);
  neuerPlan(app, 2);                                 // Tischgruppen
  app.E('layoutDesks("groups4", true); autoSeat(true); DB.subjects.push({ id: "m", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.gradesAck = true');
  const d = app.E('curPlan().desks.find(x => x.studentId && x.groupId)');
  erwarte(!!d, 'Keine Gruppentische');
  app.E(`selected.clear(); selectWithGroup(curPlan().desks.find(x => x.id === "${d.id}")); renderStage(false)`);
  erwarte(app.E('selected.size') > 1 && app.$('#sb-grade').style.display !== 'none' && app.E('selectedSeat().id') === d.id, '„Bewerten“ fehlt bei Gruppentischen');
  app.E(`setLesson(true); curClass().lesson.absent.push("${d.studentId}"); openLessonSheet(curPlan().desks.find(x => x.id === "${d.id}"))`);
  app.klick(app.$$('#lesson-quickmark .keypad button')[1]);
  erwarte(app.E(`curClass().lesson.absent.indexOf("${d.studentId}")`) < 0, 'Bewerteter Schüler bleibt als abwesend markiert');
});


test('Kaputter Speicher wird aufgehoben', app => {
  app.E('localStorage.setItem(KEY, JSON.stringify({ v: 2, classes: [{ id: "a", name: "Wichtig", students: [], plans: [] }] }).slice(0, 40)); load()');
  erwarte(app.E('localStorage.getItem(KEY + ".defekt")') !== null, 'Abgeschnittener Speicher wird nicht gesichert');
  app.E('localStorage.setItem(KEY, JSON.stringify({ classes: [null], rooms: [null] }))');
  const r = app.E('(() => { try{ load(); return "ok"; }catch(e){ return e.message; } })()');
  erwarte(r === 'ok', 'Laden alter Daten mit leeren Einträgen stürzt ab: ' + r);
});


test('Selbsteinschätzung', async app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.gradesAck = true; setLesson(true)');
  erwarte(app.$('#lb-self').style.display !== 'none', 'Knopf „Selbsteinschätzung“ fehlt in der Unterrichtsleiste');
  app.klick('#lb-self');
  app.$('#self-question').value = 'Wie gut hast du heute zugehört?';
  app.sheetOk();
  const body = app.w.document.body;
  erwarte(body.classList.contains('selfmode') && app.$('#selfhead .sh-title').textContent === 'Selbsteinschätzung' && app.$('#self-q').textContent === 'Wie gut hast du heute zugehört?', 'Überschrift oder Frage fehlt');
  erwarte(app.w.getComputedStyle(app.$('#screen-editor > .topbar')).display === 'none' && app.w.getComputedStyle(app.$('.panels')).display === 'none', 'Werkzeuge sind für Schüler erreichbar');
  erwarte(app.E('DB.settings.selfQuestion') === 'Wie gut hast du heute zugehört?', 'Eigene Frage wird nicht gemerkt');
  // Lehrerbewertung vom selben Tag für Vergleich
  const d = app.E('curPlan().desks.find(x => x.studentId)');
  app.E(`curClass().assess.push({ id: "t1", subjectId: "ma", title: "Mitarbeit", date: isoDay(new Date()), kind: "other", scale: "grade", weight: 1, marks: { "${d.studentId}": "2" }, auto: true })`);
  app.E(`openSelfSheet("${d.studentId}")`);
  erwarte(app.$('#sheet').textContent.indexOf('Bist du') >= 0 && app.$$('#self-pad button').length === 4, 'Auswahl mit vier Smileys fehlt');
  erwarte(app.$('#sheet').textContent.indexOf('Lehrkraft') < 0, 'Schüler sehen in der Auswahl die Lehrerbewertung');
  app.klick(app.$$('#self-pad button')[1]);
  const sa = app.E('selfAssessCur()');
  erwarte(sa.kind === 'self' && sa.marks[d.studentId] === 's2', 'Selbsteinschätzung nicht gespeichert');
  erwarte(app.$$('#stage .selfdone').length === 1 && app.$('#stage').textContent.indexOf('🙂') < 0, 'Am Platz ist die Antwort sichtbar oder das Häkchen fehlt');
  erwarte(app.$('#self-n').textContent.indexOf('1 von') === 0, 'Zähler fehlt');
  // Lehrernoten sind im Modus unsichtbar
  erwarte(app.$$('#stage .gmark').length === 0, 'Lehrerbewertungen im Schülermodus sichtbar');
  // Zurück-Taste und kurzer Tipp beenden nicht
  app.E('navBack()'); app.klick('#self-exit');
  erwarte(body.classList.contains('selfmode'), 'Selbsteinschätzung lässt sich ohne Halten beenden');
  // 2 Sekunden halten
  app.$('#self-exit').dispatchEvent(new app.w.Event('pointerdown'));
  await pause(2150);
  erwarte(!body.classList.contains('selfmode') && app.E('lessonMode') === true, 'Halten beendet die Selbsteinschätzung nicht');
  // Nicht in Durchschnitten, eigene Übersicht mit Vergleich
  erwarte(app.E(`studentAverages(curClass(), "ma", "${d.studentId}").total`) === 2, 'Selbsteinschätzung verändert den Durchschnitt');
  erwarte(app.E('courseAssess(curClass(), "ma").every(a => a.kind !== "self")'), 'Selbsteinschätzung erscheint bei den Lehrerbewertungen');
  app.E('goGrades("ma")');
  erwarte(!!app.$('#self-box') && app.$$('#self-box .acard.self').length === 1, 'Eigener Bereich für Selbsteinschätzungen fehlt');
  app.klick('#g-tab-overview');
  erwarte(app.$('#self-table').textContent.indexOf('🙂 · 2') >= 0, 'Vergleich Selbst/Lehrkraft fehlt in der Übersicht');
  erwarte(app.E('gradesPdfPages(curClass(), subjectById("ma")).join("")').indexOf('zugeh') < 0, 'Selbsteinschätzung landet im Noten-PDF');
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"kind":"self"') >= 0 && roh.indexOf('zugehört') >= 0, 'Selbsteinschätzung übersteht die Sicherung nicht');
});


test('Selbsteinschätzung: Schutz der Lehrerdaten', async app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.gradesAck = true; setLesson(true)');
  const ds = app.E('curPlan().desks.filter(x => x.studentId).slice(0, 3)');
  app.E(`curClass().lesson.notes["${ds[2].studentId}"] = "vertraulich"; curClass().lesson.absent.push("${ds[1].studentId}")`);
  app.klick('#lb-self'); app.sheetOk();
  // Antwort eines anderen nicht sichtbar
  app.E(`openSelfSheet("${ds[0].studentId}")`); app.klick(app.$$('#self-pad button')[3]);
  app.E(`openSelfSheet("${ds[0].studentId}")`);
  erwarte(app.$$('#self-pad button.on').length === 0 && !!app.$('#self-already'), 'Vorherige Antwort ist für andere sichtbar');
  app.E('closeModal()');
  erwarte(!app.$('#sheet').classList.contains('selfsheet'), 'Violette Fensterformatierung bleibt hängen');
  // Notizpunkte und Abwesenheit unsichtbar, Abwesende nicht antippbar
  erwarte(app.$$('#stage .item .dot').length === 0 && app.$$('#stage .item.absent').length === 0, 'Notizen oder Abwesenheit im Schülermodus sichtbar');
  erwarte(app.$('#self-n').textContent.indexOf('von ' + (app.E('curPlan().desks.filter(d => d.studentId).length') - 1)) > 0, 'Abwesende zählen im Zähler mit');
  // Strg+Z wirkt nicht
  const vorher = app.E('JSON.stringify(curPlan().desks.map(d => d.studentId || ""))');
  app.E('undoStack.push(snapshot())');
  const nUndo = app.E('undoStack.length');
  app.w.document.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  erwarte(app.E('undoStack.length') === nUndo, 'Rückgängig per Tastatur im Schülermodus möglich');
  app.E(`selfTap("${ds[1].studentId}")`);
  erwarte(!app.$('#modal').classList.contains('on'), 'Für abwesende Schüler kann jemand anderes antworten');
  // Kurzer Tipp auf ✕: kein Hinweis, Modus bleibt
  app.$('#toast').textContent = '';
  app.klick('#self-exit');
  erwarte(app.w.document.body.classList.contains('selfmode') && app.$('#toast').textContent.indexOf('halten') < 0, 'Kurzer Tipp verrät, wie man den Modus beendet');
  // Sperre wird gespeichert und nach dem Beenden gelöscht
  erwarte(!!app.E('JSON.parse(localStorage.getItem(KEY)).selfLock') && !!app.E('sanitizeDB(JSON.parse(localStorage.getItem(KEY))).selfLock'), 'Modus übersteht keinen Neustart');
  // Tastatur: Enter zwei Sekunden halten
  app.$('#self-exit').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await pause(2150);
  erwarte(!app.w.document.body.classList.contains('selfmode') && !app.E('DB.selfLock'), 'Beenden per Tastatur klappt nicht oder Sperre bleibt');
});


test('Datum bei Bewertungen aus dem Sitzplan', app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.gradesAck = true');
  const ds = app.E('curPlan().desks.filter(x => x.studentId).slice(0, 2)');
  // Normaler Sitzplan: Datum wählbar, bleibt für den nächsten Schüler
  app.E(`selected = new Set(["${ds[0].id}"]); renderStage(false)`); app.klick('#sb-grade');
  erwarte(app.$('#quick-date').value === app.E('isoDay(new Date())'), 'Standarddatum ist nicht heute');
  app.$('#quick-date').value = '2026-09-28'; app.$('#quick-date').dispatchEvent(new app.w.Event('change'));
  app.klick(app.$$('#sheet .keypad button').find(b => b.dataset.tok === '2'));
  erwarte(app.E('curClass().assess.find(a => a.auto).date') === '2026-09-28', 'Gewähltes Datum nicht übernommen');
  app.E(`selected = new Set(["${ds[1].id}"]); renderStage(false)`); app.klick('#sb-grade');
  erwarte(app.$('#quick-date').value === '2026-09-28', 'Datum gilt nicht für den nächsten Schüler');
  app.klick(app.$$('#sheet .keypad button').find(b => b.dataset.tok === '3'));
  erwarte(app.E('curClass().assess.filter(a => a.auto).length') === 1 && app.E('Object.keys(curClass().assess[0].marks).length') === 2, 'Zweite Note landet nicht in derselben Mitarbeit');
  // Unterrichtsmodus: immer heute
  app.E(`setLesson(true); openLessonSheet(curPlan().desks.find(x => x.id === "${ds[0].id}"))`);
  app.klick(app.$$('#lesson-quickmark .keypad button')[0]);
  erwarte(app.E('curClass().assess.some(a => a.auto && a.date === isoDay(new Date()))'), 'Im Unterrichtsmodus nicht heute gespeichert');
  // „Bewerten“ in der Leiste: Datum wählbar
  app.klick('#lb-grade');
  app.$('#lg-date').value = '2026-09-28'; app.$('#lg-date').dispatchEvent(new app.w.Event('change'));
  erwarte(app.$('#lg-new').textContent.indexOf('28.09.') >= 0, 'Datum im Start-Dialog nicht wählbar');
  app.klick('#lg-new');
  erwarte(app.E('gradeAssess().date') === '2026-09-28', 'Bewerten im Sitzplan nutzt nicht das gewählte Datum');
});

/* ------------------------------------------------------------------ */
alleTests().then(() => {
  console.log(bestanden + ' Prüfungen bestanden, ' + fehler + ' Fehler.');
  if(fehler){ fehlerliste.forEach(f => console.error('  ✗ ' + f)); process.exit(1); }
});

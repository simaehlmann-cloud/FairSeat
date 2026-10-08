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
  const willkommen = () => { const b = w.document.querySelector('#welcome-ok'); if(b) b.click(); };
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
  erwarte(app.$$('.home-tile').length === 4 && app.$$('.home-tile').map(b => b.id).join() === 'tile-names,tile-plans,tile-timetable,tile-grades' && !app.$('#tile-rooms'), 'Kacheln fehlen oder falsche Reihenfolge');
  erwarte(/Klassen verwalten/.test(app.$('#tile-names').textContent) && /Namen, Stufen/.test(app.$('#tile-names').textContent), 'Kachel „Klassen verwalten“ fehlt');
  erwarte(/mit Räumen/.test(app.$('#tile-plans').textContent), 'Kachel „Sitzpläne“ nennt die Räume nicht');
  // Räume ohne Klasse über den Reiter erreichbar, Sitzpläne-Reiter führt dann zu den Klassen
  app.E('goRooms()');
  erwarte(app.$('#screen-rooms .pr-tab.on').dataset.pr === 'rooms' && /alle Klassen/.test(app.$('#screen-rooms').textContent), 'Räume-Reiter oder Hinweis fehlt');
  app.klick('#screen-rooms .pr-tab[data-pr="plans"]');
  erwarte(app.$('#screen-names').classList.contains('active'), 'Ohne Klasse muss der Sitzpläne-Reiter zu den Klassen führen');
  app.E('goHome()');
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
  klasseMitNamen(app, '7b', ['Anna']);
  app.E('goHome()'); app.klick('#tile-plans');
  erwarte(app.$('#screen-plans .pr-tab.on').dataset.pr === 'plans', 'Sitzpläne-Reiter nicht aktiv');
  app.klick('#screen-plans .pr-tab[data-pr="rooms"]');
  erwarte(app.$('#screen-rooms').classList.contains('active'), 'Reiter „Räume“ führt nicht zu den Räumen');
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
  app.klick('#screen-rooms .pr-tab[data-pr="plans"]');
  erwarte(app.$('#screen-plans').classList.contains('active'), 'Zurück zum Reiter „Sitzpläne“ fehlt');
  erwarte(app.w.document.activeElement === app.$('#screen-plans .pr-tab.on'), 'Fokus geht beim Reiterwechsel verloren');
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

test('Englisch', app => {
  klasseMitNamen(app);
  app.klick('#flag-en');
  const roh = app.$$('[data-i]').filter(el => el.textContent === el.dataset.i).map(el => el.dataset.i);
  erwarte(!roh.length, 'Unübersetzte Beschriftungen: ' + roh.join(', '));
  erwarte(app.$('#tile-names').textContent.indexOf('Manage classes') >= 0 && app.$('#screen-plans .pr-tab[data-pr="rooms"]').textContent === 'Rooms', 'Kachel oder Reiter nicht übersetzt');
  app.klick('#flag-de');
  erwarte(app.E('t("classLabel")') === 'Klasse' && !app.E('Object.keys(I18N.de).some(k => /^ev_/.test(k))'), 'Reste des Veranstaltungsmodus');
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
  erwarte(app.$('#modal').classList.contains('on') && !!app.$('#sync-merge') && !!app.$('#sync-replace'), 'Keine Auswahl vor dem Laden');
  app.klick('#sync-replace'); app.sheetOk();
  erwarte(app.E('DB.classes[0].name') === 'Aus Sicherung' && app.E('DB.classes.length') === 1, 'Sicherung nicht geladen');
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


/* ---------------- Räume, Tische, Bedienung ---------------- */

const KASTEN = `(a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1`;
/* 56 Personen an runden Achtertischen in der Aula (z. B. Abiball, Elternabend) */
function rundeTische(app){
  klasseMitNamen(app, 'Abi', Array.from({ length: 56 }, (_, i) => 'Person ' + (i + 1)));
  app.E('DB.rooms.push(buildRoomFromTemplate("aula", "Aula"))');
  neuerPlan(app, 0);
  app.E('curPlan().seatsPerTable = 8; layoutDesks("rounds", true); autoSeat(true); renderStage(false)');
}

test('Erster Start', async app => {
  await pause(320);
  erwarte(app.$('#modal').classList.contains('on') && !!app.$('#welcome-ok') && !app.$('#sheet .choice'), 'Begrüßung erscheint nicht oder fragt noch nach dem Einsatzbereich');
  app.willkommen();
  erwarte(app.E('DB.onboarded') === true && app.$('#tile-names').textContent.indexOf('Klassen verwalten') >= 0, 'Begrüßung nicht abgeschlossen');
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
  erwarte(['conference', 'aula'].every(k => keys.indexOf(k) >= 0) && keys.indexOf('hall') < 0 && keys.indexOf('party') < 0, 'Raumvorlagen falsch: ' + keys.join());
  keys.forEach(k => {
    const ok = app.E(`(() => { const r = buildRoomFromTemplate(${JSON.stringify(k)}, "x");
      return r.items.length > 0 && r.items.every(i => { const b = itemBox(i); return b.x >= -1 && b.y >= -1 && b.x + b.w <= r.w + 1 && b.y + b.h <= r.h + 1; }); })()`);
    erwarte(ok, 'Vorlage ' + k + ' leer oder Möbel außerhalb');
  });
  app.E('goRooms()'); app.klick('#btn-room-from-tpl');
  const vorschau = app.$$('#sheet .tplpick');
  erwarte(vorschau.length === keys.length && vorschau.every(b => b.querySelector('svg.miniplan')), 'Vorlagen ohne Vorschau');
  erwarte(vorschau[0].dataset.tpl === 'classic', 'Klassenraum steht nicht oben');
  app.E('closeModal(); DB.rooms.push(buildRoomFromTemplate("aula", "Aula")); renderRooms()');
  erwarte(!!app.$('#room-list .card svg.miniplan') && app.$('#room-list .card .s').textContent.indexOf('18 × 14 m') === 0, 'Raumliste ohne Vorschau oder Maße');
});

test('Runde Tische in der Aula', app => {
  rundeTische(app);
  erwarte(app.E('curRoom().w') === 2700, 'Plan nicht in der Aula');
  erwarte(app.E('planDesks().length') === 56 && app.E('planDesks().filter(d => d.studentId).length') === 56, 'Nicht alle 56 sitzen');
  erwarte(app.E('tableShapes(planDesks()).length') === 7, 'Nicht 7 runde Tische');
  erwarte(app.$$('#stage .ptable.round').length === 7, 'Tischplatten werden nicht gezeichnet');
  erwarte(!app.E('desksOverlap(planDesks())'), 'Stühle überlappen');
  const kollision = app.E(`(() => { const hit = ${KASTEN};
    const obs = curRoom().items.filter(i => ["stage","pillar"].indexOf(i.type) >= 0).map(itemBox);
    return planDesks().filter(d => d.tbl).filter(d => obs.some(o => hit(itemBox(d), o))).length; })()`);
  erwarte(kollision === 0, kollision + ' Stühle stehen auf Bühne oder Säulen');
  app.E(`(() => { const c = curClass(), id = n => c.students.find(s => s.name === n).id;
    c.rules.push({ id: "r1", type: "apart", a: id("Person 3"), b: id("Person 4") }, { id: "r2", type: "together", a: id("Person 10"), b: id("Person 30") });
    autoSeat(true); })()`);
  const getrennt = app.E(`(() => { const c = curClass(), p = curPlan();
    const id = n => c.students.find(s => s.name === n).id;
    const g = id => (p.desks.find(d => d.studentId === id) || {}).groupId;
    return g(id("Person 3")) !== g(id("Person 4")) && g(id("Person 10")) === g(id("Person 30")); })()`);
  erwarte(getrennt, '„nie zusammen“ oder „immer zusammen“ an Tischen nicht erfüllt');
  const pdf = app.E('pdfPlanPage(curClass(), curPlan(), curRoom(), planTitle())');
  erwarte(pdf.indexOf('(Tisch 7)') >= 0 && pdf.indexOf('?') < 0, 'PDF ohne Tischnummern oder mit Fragezeichen');
  const roh = app.E('JSON.stringify(sanitizeDB(JSON.parse(JSON.stringify(DB))))');
  erwarte(roh.indexOf('"tbl":"round"') >= 0 && roh.indexOf('"floor":"stone"') >= 0, 'Tische oder Boden überstehen die Sicherung nicht');
});

test('Plätze pro Tisch und lange Tafeln', app => {
  rundeTische(app);
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
  // Assistent: runde Tische wählen, Plätze pro Tisch wählbar
  app.E('goPlans()'); app.klick('#btn-add-plan');
  app.klick(app.$$('#sheet .choicegrid .choice').find(b => b.textContent.indexOf('Runde Tische') >= 0));
  const knopf6 = app.$$('#sheet .segmented button').find(b => b.textContent === '6');
  app.klick(knopf6); app.sheetOk();
  erwarte(app.E('curPlan().seatsPerTable') === 6 && app.E('tableShapes(planDesks()).length') === 10, 'Neuer Tischplan nicht mit 6 Plätzen je Tisch');
});

test('Möbel-Palette und Einrasten an der Wand', app => {
  app.E('DB.rooms.push(buildRoomFromTemplate("conference", "K")); openRoomStandalone(DB.rooms[0].id)');
  const typen = app.$$('#item-palette .paltile').map(b => b.dataset.type);
  erwarte(typen.length === app.E('Object.keys(ITEMS).length - 1') && typen.indexOf('stage') >= 0 && typen.indexOf('dancefloor') < 0, 'Palette unvollständig');
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
  rundeTische(app);
  const seite = app.E('withRoomSize(curRoom(), () => pdfPlanPage(curClass(), curPlan(), curRoom(), "x"))');
  erwarte(seite.indexOf('(18 ') >= 0, 'PDF nennt die Raumgröße nicht');
  erwarte(app.E('ROOM_W') === 2700, 'withRoomSize stellt die Raumgröße nicht wieder her');
  app.E('DB.rooms.push(buildRoomFromTemplate("classic", "K")); curClass().plans.push({ id: "p2", name: "B", roomId: DB.rooms[DB.rooms.length - 1].id, deskSize: "single", desks: [] })');
  const seiten = app.E('(() => { let out = []; const keep = window.buildPDF; window.buildPDF = pages => { out = pages; return new Blob(["x"]); }; exportAllPDF(); window.buildPDF = keep; return out; })()');
  erwarte(seiten.length >= 2, 'Alle Pläne als PDF schlägt fehl');
  erwarte(seiten[0].indexOf('(18 ') >= 0 && seiten[1].indexOf('(9,3 ') >= 0, 'Jeder Plan muss in der Größe seines eigenen Raums gedruckt werden');
  erwarte(app.E('ROOM_W') === 2700, 'Export aller Pläne verändert die offene Raumgröße');
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
  rundeTische(app);
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
  app.klick('#sync-replace'); app.sheetOk();
  erwarte(app.E('DB.classes[0].name') === 'Geheim' && app.E('DB.classes[0].students.length') === 2, 'Verschlüsselte Sicherung nicht wiederhergestellt');
});

test('Datenschutzhinweis für Lehrkräfte', async app => {
  await pause(320);
  app.willkommen();
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
  erwarte(JSON.stringify(app.E('(() => { const d = backupData(); delete d.del; return d; })()')).indexOf(sid) < 0, 'Sicherung enthält Daten gelöschter Schüler');
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


test('Name auf freie Fläche ziehen erzeugt einen Tisch', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem']);
  neuerPlan(app, 0);
  app.E('curPlan().desks = []; renderStage(false); renderUnseated()');
  // jsdom kennt kein elementFromPoint – die Prüfung „freie Fläche“ wird für den Test festgelegt
  app.E('window.stageFreeAt = () => true; zoom = 0.5; panX = 0; panY = 0; applyTransform()');
  const anna = app.E('curClass().students[0].id'), ben = app.E('curClass().students[1].id');
  const d1 = app.E(`deskFromName("${anna}", 200, 200)`);
  erwarte(d1 && app.E('curPlan().desks.length') === 1 && app.E('curPlan().desks[0].studentId') === anna, 'Kein Tisch mit Namen entstanden');
  // knapp daneben: rastet bündig an
  const d2 = app.E(`deskFromName("${ben}", 200 + (curPlan().desks[0].w + 30) * 0.5, 200)`);
  const a = app.E('curPlan().desks[0]'), b = app.E('curPlan().desks[1]');
  erwarte(b.y === a.y && b.x === a.x + a.w, 'Neuer Tisch rastet nicht bündig an: ' + JSON.stringify([a.x, a.y, b.x, b.y]));
  erwarte(!app.E('desksOverlap(curPlan().desks)'), 'Tische überlappen');
  // gleicher Name nochmal: wandert, kein Doppel
  app.E(`deskFromName("${anna}", 600, 400)`);
  erwarte(app.E(`curPlan().desks.filter(d => d.studentId === "${anna}").length`) === 1, 'Name sitzt doppelt');
  app.E('undo()');
  erwarte(app.E('curPlan().desks.length') === 2, 'Rückgängig entfernt den neuen Tisch nicht');
  // Unterrichtsmodus: keine neuen Tische
  app.E('setLesson(true)');
  erwarte(app.E(`deskFromName("${ben}", 300, 300)`) === null, 'Im Unterrichtsmodus entstehen Tische');
  app.E('setLesson(false)');
  // Ziehen und Antippen mit echten Zeigerereignissen prüft der Browsertest (jsdom kennt keine PointerEvents)
});

test('Klassenfarbe im Stundenplan', app => {
  klasseMitNamen(app, '7b');
  app.klick('#btn-rename-class');
  erwarte(!!app.$('#class-colors') && app.$$('#class-colors button').length === 9, 'Farbwahl für die Klasse fehlt');
  app.klick(app.$$('#class-colors button')[2]);
  app.sheetOk();
  const col = app.E('curClass().color');
  erwarte(col === app.E('CLASS_COLORS[1]'), 'Klassenfarbe nicht gespeichert: ' + col);
  erwarte(app.$('.ccard.on').style.boxShadow.indexOf('inset 6px') >= 0, 'Klassenkarte zeigt die Farbe nicht');
  app.E(`DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    DB.lessons.push({ id: "L", day: 0, period: 0, span: 1, week: "", subjectId: "ma", classId: curClass().id, roomId: "", planId: "" }); goTimetable()`);
  const cell = app.$('#tt-grid .tt-cell');
  erwarte(cell.classList.contains('hascls') && cell.style.getPropertyValue('--cc') === col && !!cell.querySelector('.ccbadge') && cell.querySelector('.ccbadge').textContent === '7b', 'Stunde zeigt die Klassenfarbe nicht');
  erwarte(/46, 134, 222|2E86DE/i.test(cell.style.background), 'Fachfarbe nicht mehr Grundfarbe');
  // ohne Farbe
  app.E('curClass().color = ""; goTimetable()');
  erwarte(!app.$('#tt-grid .tt-cell').classList.contains('hascls'), 'Rand bleibt ohne Klassenfarbe');
  const roh = app.E('JSON.stringify(sanitizeDB({ v: 2, classes: [{ id: "x", name: "A", color: "#abcdef", students: [] }, { id: "y", name: "B", color: "rot", students: [] }] }).classes.map(c => c.color))');
  erwarte(roh === '["#ABCDEF",""]', 'Klassenfarbe wird beim Laden nicht geprüft: ' + roh);
});


test('Neuer Tisch aus Namen: Platzsuche und Sonderfälle', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem', 'Dana', 'Emil']);
  neuerPlan(app, 0);
  app.E('window.stageFreeAt = () => true; zoom = 1; panX = 0; panY = 0; applyTransform()');
  const id = i => app.E('curClass().students[' + i + '].id');
  // zwei alte Tische überlappen weit weg – der neue landet trotzdem am Ablagepunkt
  app.E('curPlan().desks = [{ id: "o1", type: "desk", x: 1200, y: 800, w: 90, h: 55, rot: 0 }, { id: "o2", type: "desk", x: 1210, y: 805, w: 90, h: 55, rot: 0 }]; renderStage(false)');
  const d1 = app.E(`deskFromName("${id(0)}", 300, 300)`);
  erwarte(d1 && Math.abs(d1.x + d1.w / 2 - 300) < 2 && Math.abs(d1.y + d1.h / 2 - 300) < 2, 'Neuer Tisch wandert trotz freiem Platz weg');
  // gedrehter Nachbar: keine Überlappung
  app.E('curPlan().desks.push({ id: "r", type: "desk", x: 600, y: 300, w: 90, h: 55, rot: 90 }); renderStage(false)');
  const d2 = app.E(`deskFromName("${id(1)}", 645, 327)`);
  erwarte(d2 && !app.E('(() => { const n = curPlan().desks[curPlan().desks.length - 1]; return curPlan().desks.some(o => o !== n && boxHit(itemBox(n), itemBox(o))); })()'), 'Neuer Tisch überlappt einen gedrehten Tisch');
  // Tischgruppe wächst mit
  app.E('curPlan().desks.push({ id: "g1", type: "desk", x: 900, y: 500, w: 90, h: 55, rot: 0, groupId: "grp" }); renderStage(false)');
  const d3 = app.E(`deskFromName("${id(2)}", 900 + 90 + 50, 527)`);
  erwarte(d3 && d3.groupId === 'grp' && d3.x === 990, 'Neuer Tisch gehört nicht zur Tischgruppe');
  // Klassenarbeit: kein Anrasten, A/B gesetzt
  app.E('curPlan().exam = true');
  const d4 = app.E(`deskFromName("${id(3)}", 900 + 90 + 90 + 60, 527)`);
  erwarte(d4 && d4.x !== 1080 && !!d4.var, 'Bei Klassenarbeiten rastet der Tisch an oder bekommt keine Gruppe A/B');
  app.E('curPlan().exam = false');
  // Raummodus und Vollbild: kein Tisch, aufgenommener Name verfällt
  app.E(`armedStudent = "${id(4)}"; setEditMode("room")`);
  erwarte(app.E('armedStudent') === null && app.E(`deskFromName("${id(4)}", 400, 600)`) === null, 'Im Raummodus entsteht ein Tisch oder der Name bleibt aufgenommen');
  app.E(`setEditMode("desks"); armedStudent = "${id(4)}"; setPresenting(true)`);
  erwarte(app.E('armedStudent') === null, 'Im Vollbild bleibt der Name unsichtbar aufgenommen');
  app.E('setPresenting(false)');
});

test('Neuer Tisch nicht auf einer Tischplatte', app => {
  rundeTische(app);
  app.E('window.stageFreeAt = () => true; zoom = 1; panX = 0; panY = 0; applyTransform()');
  const sh = app.E('tableShapes(planDesks())[0]');
  const sid = app.E('curClass().students[0].id');
  const n0 = app.E('curPlan().desks.length');
  erwarte(app.E(`deskFromName("${sid}", ${sh.cx}, ${sh.cy})`) === null && app.E('curPlan().desks.length') === n0, 'Stuhl landet auf der Tischplatte');
});


/* ---------- 27. Zeugnisvorschlag, CSV, Gesprächsblatt, Fehlstunden, Schuljahr ---------- */
function bewertungsKlasse(app){
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem', 'Dana']);
  app.E(`DB.gradesAck = true; DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    curClass().gradeSubjects = ["ma"]`);
}
test('Zeugnisvorschlag: Rundung', app => {
  bewertungsKlasse(app);
  const P = (total, scale, rule) => app.E(`(() => { const c = curClass(); c.gradeRound = ${JSON.stringify(rule ? { ma: rule } : {})};
    return proposeGrade(c, "ma", { total: ${total}, scale: "${scale}" }); })()`);
  // Standard: zugunsten, ganze Noten
  erwarte(P(2.5, 'grade') === '2' && P(2.16, 'grade') === '2' && P(2.51, 'grade') === '3', 'Standard ist nicht „ganze Noten, zugunsten“');
  const T = { fav: true, tend: true };
  erwarte(P(2.15, 'grade', T) === '2', '2,15 zugunsten mit Tendenz muss 2 ergeben: ' + P(2.15, 'grade', T));
  erwarte(P(2.16, 'grade', T) === '2-', '2,16 muss 2- ergeben: ' + P(2.16, 'grade', T));
  erwarte(P(2.15, 'grade', { fav: false, tend: true }) === '2-', '2,15 kaufmännisch muss 2- ergeben');
  erwarte(P(1.0, 'grade', T) === '1' && P(1.84, 'grade', T) === '2+' && P(5.9, 'grade', T) === '6', 'Tendenzwerte falsch');
  // ohne Tendenz
  erwarte(P(2.5, 'grade', { fav: true, tend: false }) === '2', '2,5 zugunsten ohne Tendenz muss 2 sein');
  erwarte(P(2.5, 'grade', { fav: false, tend: false }) === '3', '2,5 kaufmännisch ohne Tendenz muss 3 sein');
  erwarte(P(2.49, 'grade', { fav: false, tend: false }) === '2' && P(2.51, 'grade', { fav: true, tend: false }) === '3', 'Rundung ohne Tendenz falsch');
  erwarte(P(0.4, 'grade', { fav: true, tend: false }) === '1' && P(6.4, 'grade', { fav: true, tend: false }) === '6', 'Vorschlag verlässt 1–6');
  // Punkte
  erwarte(P(10.5, 'points') === '11' && P(10.49, 'points') === '10' && P(15.2, 'points') === '15', 'Punkte falsch gerundet');
  erwarte(app.E('proposeGrade(curClass(), "ma", { total: null, scale: "grade" })') === null, 'Vorschlag ohne Werte');
  // Einstellung über die Oberfläche
  app.E('curClass().gradeRound = {}; goGrades("ma")');
  app.klick('#g-weight');
    erwarte(app.$$('#g-round button')[0].classList.contains('on') && app.$$('#g-tend button')[0].classList.contains('on') && app.$$('#g-tend button')[0].textContent === 'Ganze Noten', 'Standard-Rundung nicht markiert');
  app.klick(app.$$('#g-round button')[1]); app.klick(app.$$('#g-tend button')[1]); app.sheetOk();
  erwarte(app.E('JSON.stringify(curClass().gradeRound.ma)') === '{"fav":false,"tend":true}', 'Rundungsregel nicht gespeichert');
  app.klick('#g-weight');
  erwarte(app.$$('#g-round button')[1].classList.contains('on') && app.$$('#g-tend button')[1].classList.contains('on'), 'Rundungsregel beim Öffnen nicht markiert');
  app.E('closeModal()');
  const roh = app.E('JSON.stringify(sanitizeDB({ v: 2, classes: [{ id: "x", name: "A", students: [], gradeRound: { ma: { fav: false }, __proto__x: 1, en: "kaputt" } }] }).classes[0].gradeRound)');
  erwarte(roh === '{"ma":{"fav":false,"tend":false}}', 'Rundungsregel wird beim Laden nicht geprüft: ' + roh);
});

test('Zeugnisvorschlag in Übersicht, Schülerblatt und PDF', app => {
  bewertungsKlasse(app);
  app.E(`(() => { const c = curClass(), s = c.students;
    (c.assess = c.assess || []).push({ id: "w1", subjectId: "ma", title: "KA 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [s[0].id]: "2", [s[1].id]: "4" } });
    (c.assess = c.assess || []).push({ id: "o1", subjectId: "ma", title: "Mitarbeit", date: "2026-09-11", kind: "other", scale: "grade", weight: 1, marks: { [s[0].id]: "2-", [s[1].id]: "3" } });
  })(); goGrades("ma")`);
  app.klick('#g-tab-overview');
  const props = app.$$('#g-table td.prop').map(td => td.textContent);
  erwarte(props[0] === '2' && props[1] === '3' && props[2] === '', 'Vorschlagsspalte falsch: ' + JSON.stringify(props));
  app.klick(app.$$('#g-table .gname')[0]);
  erwarte(!!app.$('#sheet .propchip') && app.$('#sheet .propchip').textContent.indexOf('2') >= 0 && !!app.$('#talk-sheet'), 'Vorschlag oder Gesprächsblatt-Knopf im Schülerblatt fehlt');
  app.E('closeModal()');
  const pdf = app.E('gradesPdfPages(curClass(), subjectById("ma")).join("\\n")');
  erwarte(/\(3\) Tj/.test(pdf) && pdf.indexOf('?') < 0, 'Vorschlag fehlt im Noten-PDF');
  // mit Tendenz
  app.E('curClass().gradeRound = { ma: { fav: true, tend: true } }; renderGrades()');
  erwarte(app.$$('#g-table td.prop')[1].textContent === '3-', 'Vorschlag mit Tendenz falsch: ' + app.$$('#g-table td.prop')[1].textContent);
});

test('Noten als CSV', async app => {
  bewertungsKlasse(app);
  app.E(`(() => { const c = curClass(), s = c.students;
    s[2].name = "=HYPERLINK(1)"; s[3].name = 'Dana "D"; Test';
    (c.assess = c.assess || []).push({ id: "w1", subjectId: "ma", title: "KA; 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 2, marks: { [s[0].id]: "2-", [s[1].id]: "x", [s[2].id]: "1" } });
    (c.assess = c.assess || []).push({ id: "o1", subjectId: "ma", title: "Mitarbeit", date: "2026-09-11", kind: "other", scale: "smiley", weight: 1, marks: { [s[0].id]: "s1" } });
    (c.assess = c.assess || []).push({ id: "z1", subjectId: "ma", title: "Selbst", date: "2026-09-11", kind: "self", scale: "smiley", weight: 1, marks: { [s[0].id]: "s4" } });
    c.absLog = [{ d: "2026-09-12", p: 0, n: 2, s: "ma", ids: [s[0].id] }, { d: "2026-09-13", p: 1, n: 1, s: "de", ids: [s[0].id] }];
  })(); goGrades("ma")`);
  const box = downloadAbfangen(app);
  app.klick('#g-tab-overview'); app.klick('#g-csv');
  erwarte(!!box.blob && /\.csv$/.test(box.name), 'CSV wird nicht erzeugt');
  const text = await blobText(app, box.blob);
  const zeilen = text.replace(/^﻿/, '').split('\r\n');
  const bytes = new Uint8Array(await new Promise(r => { const f = new app.w.FileReader(); f.onload = () => r(f.result); f.readAsArrayBuffer(box.blob); }));
  erwarte(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, 'BOM fehlt (Umlaute in Excel)');
  erwarte(zeilen.length === 5, 'Zeilenzahl falsch: ' + zeilen.length);
  erwarte(zeilen[0].indexOf('"10.09. KA; 1 (schriftl. ×2)"') >= 0 || zeilen[0].indexOf('KA; 1') >= 0 && zeilen[0].indexOf('"') >= 0, 'Kopfzeile mit Semikolon nicht maskiert: ' + zeilen[0]);
  erwarte(zeilen[0].indexOf('Selbst') < 0, 'Selbsteinschätzung landet in der Noten-CSV');
  erwarte(/^Anna;2-;[^;]+;/.test(zeilen[1]) && zeilen[1].split(';').pop() === '2', 'Zeile Anna falsch: ' + zeilen[1]);
  erwarte(zeilen[2].split(';')[1] === 'fehlt', '„fehlt“ nicht ausgeschrieben: ' + zeilen[2]);
  erwarte(zeilen[3].indexOf("'=HYPERLINK(1)") === 0, 'Formel im Namen nicht entschärft: ' + zeilen[3]);
  erwarte(zeilen[4].indexOf('"Dana ""D""; Test"') === 0, 'Anführungszeichen nicht maskiert: ' + zeilen[4]);
  erwarte(text.indexOf('😀') < 0, 'Smiley als Emoji statt Wort in der CSV');
});

test('Fehlstunden aus Stundenplan und Unterricht', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem', 'Dana']);
  neuerPlan(app, 0);
  app.E(`DB.settings.lesson = true; DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    DB.lessons.push({ id: "L1", day: 0, period: 2, span: 2, week: "", subjectId: "ma", classId: curClass().id, roomId: "", planId: "" })`);
  const a = app.E('curClass().students[0].id'), b = app.E('curClass().students[1].id');
  // laufende Stunde vortäuschen
  // echte Uhrzeit-Suche prüfen: Montag 2. Stunde (nach Standard-Zeiten) liefert die Doppelstunde
  const tt = app.E('periodTimes()[2].start');
  const mo = app.E(`(() => { const d = new Date(2026, 9, 5, 0, 0); d.setMinutes(${tt} + 5); return currentLessonFor(curClass(), d) && currentLessonFor(curClass(), d).id; })()`);
  erwarte(mo === 'L1', 'Stunde der Klasse wird nicht gefunden');
  // überlappende Stunde einer anderen Klasse davor darf nicht stören
  app.E(`DB.lessons.unshift({ id: "L0", day: 0, period: 2, span: 1, week: "A", subjectId: "ma", classId: "fremd", roomId: "", planId: "" }); DB.tt.ab = true; DB.tt.abRef = ""`);
  const mo2 = app.E(`(() => { const d = new Date(2026, 9, 5, 0, 0); d.setMinutes(${tt} + 5); const L = currentLessonFor(curClass(), d); return L && L.id; })()`);
  erwarte(mo2 === 'L1', 'Überlappende Stunde einer anderen Klasse verdeckt die eigene');
  app.E('DB.lessons.shift(); DB.tt.ab = false');
  app.E('currentLessonFor = () => DB.lessons[0]');
  app.E(`setLesson(true); curClass().lesson.absent.push("${a}"); recordLessonAbsence(curClass())`);
  let m = app.E(`JSON.stringify(missedLessons(curClass(), "${a}"))`);
  erwarte(app.E('curClass().absLog.length') === 1 && /"total":2/.test(m) && /"ma":2/.test(m), 'Doppelstunde nicht als 2 Fehlstunden gezählt: ' + m);
  // erneut melden: kein Doppeleintrag; Ben kommt dazu, Anna zurück
  app.E(`curClass().lesson.absent = ["${b}"]; recordLessonAbsence(curClass()); recordLessonAbsence(curClass())`);
  erwarte(app.E('curClass().absLog.length') === 1 && app.E(`missedLessons(curClass(), "${a}").total`) === 0 && app.E(`missedLessons(curClass(), "${b}").total`) === 2, 'Eintrag der Stunde wird nicht aktualisiert');
  // über das Anwesenheitsblatt im Plan
  app.E(`curClass().lesson.absent = []; recordLessonAbsence(curClass()); openLessonSheet(curPlan().desks.find(d => d.studentId))`);
  const wer = app.E('curPlan().desks.find(d => d.studentId).studentId');
  app.klick('#sheet .tile.wide'); app.sheetOk();
  erwarte(app.E(`missedLessons(curClass(), "${wer}").total`) === 2, 'Abwesend im Unterricht zählt keine Fehlstunden');
  // Zurücksetzen der Anwesenheit wirkt auch auf die Fehlstunden
  app.klick('#lb-reset'); app.sheetOk();
  erwarte(app.E(`missedLessons(curClass(), "${wer}").total`) === 0, 'Zurücksetzen lässt Fehlstunden stehen');
  // außerhalb einer Stunde (Pause, Nachmittag): keine Phantomstunde
  app.E('currentLessonFor = () => null; curClass().lastSubject = "ma"');
  app.E(`curClass().lesson.absent = ["${a}"]; recordLessonAbsence(curClass())`);
  erwarte(app.E(`missedLessons(curClass(), "${a}").total`) === 0 && app.E('curClass().absLog.length') === 1, 'Fehlstunde außerhalb des Stundenplans gezählt');
  // nächste Stunde ohne Abwesende: kein leerer Eintrag
  app.E(`DB.lessons.push({ id: "L2", day: 0, period: 5, span: 1, week: "", subjectId: "de", classId: curClass().id, roomId: "", planId: "" }); currentLessonFor = () => DB.lessons[1]; curClass().lesson.absent = []; recordLessonAbsence(curClass())`);
  erwarte(app.E('curClass().absLog.length') === 1, 'Leerer Fehlstunden-Eintrag angelegt');
  app.E(`curClass().lesson.absent = ["${a}"]`);
  erwarte(app.E('recordLessonAbsence(curClass())') === true && app.E('recordLessonAbsence(curClass())') === false && app.E('curClass().absLog.length') === 2, 'Neue Stunde nicht erfasst oder doppelt');
  // Anwesenheitsblatt zeigt die Summe
  app.E('closeModal()'); app.klick('#btn-attendance');
  erwarte(!!app.$('#abs-missed') && /Anna.*1 Fehlstunde/.test(app.$('#abs-missed').textContent), 'Fehlstunden fehlen im Anwesenheitsblatt: ' + (app.$('#abs-missed') || {}).textContent);
  app.E('closeModal()');
  // Laden: fremde IDs fliegen raus, unsinnige Werte werden korrigiert
  const roh = app.E(`(() => { const d = JSON.parse(JSON.stringify(DB)); d.classes[0].absLog.push({ d: "kaputt", ids: [] }, { d: "2026-01-01", p: 99, n: 7, s: 5, ids: ["fremd", "${a}"] }); return JSON.stringify(sanitizeDB(d).classes[0].absLog.slice(-1)); })()`);
  erwarte(roh === `[{"d":"2026-01-01","p":-1,"n":1,"s":"","ids":["${a}"]}]`, 'Fehlstunden werden beim Laden nicht geprüft: ' + roh);
});

test('Gesprächsblatt als PDF', async app => {
  bewertungsKlasse(app);
  app.E(`(() => { const c = curClass(), s = c.students;
    (c.assess = c.assess || []).push({ id: "w1", subjectId: "ma", title: "KA 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [s[0].id]: "2", [s[1].id]: "5" } });
    (c.assess = c.assess || []).push({ id: "w2", subjectId: "ma", title: "KA 2", date: "2026-09-20", kind: "written", scale: "grade", weight: 1, marks: { [s[0].id]: "3+" } });
    (c.assess = c.assess || []).push({ id: "o1", subjectId: "ma", title: "Mitarbeit", date: "2026-09-11", kind: "other", scale: "grade", weight: 1, marks: { [s[0].id]: "2" } });
    (c.assess = c.assess || []).push({ id: "z1", subjectId: "ma", title: "Selbst", date: "2026-09-11", kind: "self", scale: "smiley", weight: 1, marks: { [s[0].id]: "s2" } });
    (c.assess = c.assess || []).push({ id: "nb", subjectId: "ma", title: "NurBen", date: "2026-09-15", kind: "written", scale: "grade", weight: 1, marks: { [s[1].id]: "1" } });
    c.absLog = [{ d: "2026-09-12", p: 0, n: 2, s: "ma", ids: [s[0].id] }];
    c.attendance = [{ date: "2026-09-12", absent: [s[0].id] }];
  })()`);
  const pdf = app.E('talkSheetPages(curClass(), curClass().students[0]).map(p => p.content).join("\\n")');
  erwarte(pdf.indexOf('(Anna)') >= 0 && pdf.indexOf('(Mathe)') >= 0 && pdf.indexOf('KA 2') >= 0, 'Gesprächsblatt ohne Name, Fach oder Arbeiten');
  erwarte(pdf.indexOf('Ben') < 0 && pdf.indexOf('(5)') < 0 && pdf.indexOf('NurBen') < 0, 'Gesprächsblatt enthält Daten anderer Schüler');
  erwarte(/Selbst/.test(pdf) && pdf.indexOf('+') >= 0, 'Selbsteinschätzung fehlt im Gesprächsblatt');
  erwarte(pdf.indexOf('?') < 0, 'Unbekannte Zeichen (?) im Gesprächsblatt');
  erwarte(/ l S/.test(pdf), 'Verlaufslinie fehlt');
  erwarte(/Mathe 2/.test(pdf) && /12\.09\./.test(pdf), 'Fehlzeiten fehlen im Gesprächsblatt');
  // ohne Bewertungen
  const leer = app.E('talkSheetPages(curClass(), curClass().students[3]).map(p => p.content).join("\\n")');
  erwarte(leer.indexOf('(Dana)') >= 0 && leer.indexOf('?') < 0, 'Leeres Gesprächsblatt fehlerhaft');
  // viele Arbeiten: weitere Seite statt Überlauf
  app.E(`(() => { const c = curClass(), a = c.students[0].id; for(let i = 0; i < 70; i++) (c.assess = c.assess || []).push({ id: "m" + i, subjectId: "ma", title: "Test " + i, date: "2026-10-01", kind: "other", scale: "grade", weight: 1, marks: { [a]: "3" } }); })()`);
  const pages = app.E('talkSheetPages(curClass(), curClass().students[0])');
  erwarte(pages.length >= 2 && pages.every(p => !/ -\d+(\.\d+)? Td/.test(p.content)), 'Langes Gesprächsblatt läuft über den Rand');
  const ys = app.E(`talkSheetPages(curClass(), curClass().students[0]).map(p => (p.content.match(/ (-?\\d+(?:\\.\\d+)?) Td/g) || []).map(s => +s.split(" ")[1]))`);
  erwarte(ys.every(l => l.every(y => y >= 30)), 'Text unter dem unteren Rand');
  // Export über den Knopf
  const box = downloadAbfangen(app);
  app.E('goGrades("ma")'); app.klick('#g-tab-overview'); app.klick(app.$$('#g-table .gname')[0]); app.klick('#talk-sheet');
  await pause(120);
  erwarte(!!box.blob && /Anna/.test(box.name) && /\.pdf$/.test(box.name), 'Gesprächsblatt-Export fehlt: ' + box.name);
});

test('Neues Schuljahr', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben']);
  neuerPlan(app, 0);
  klasseMitNamen(app, '9a', ['Cem']);
  klasseMitNamen(app, 'Q1', ['Dana']);
  app.E(`(() => { const [a, b, q] = DB.classes;
    (a.assess = a.assess || []).push({ id: "w1", subjectId: "ma", title: "KA", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [a.students[0].id]: "2" } });
    a.attendance = [{ date: "2026-09-12", absent: [a.students[0].id] }]; a.absLog = [{ d: "2026-09-12", p: 0, n: 1, s: "ma", ids: [a.students[0].id] }];
    (b.assess = b.assess || []).push({ id: "w9", subjectId: "ma", title: "KA", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [b.students[0].id]: "3" } });
    a.history = [{ at: 1, pairs: [] }]; a.plans[0].exam = true; a.plans[0].examPrev = {};
    DB.lessons.push({ id: "L", day: 0, period: 0, span: 1, week: "", subjectId: "ma", classId: a.id, roomId: "", planId: "" });
    DB.cancelled = ["2026-09-14|L"]; a.obs = [{ id: "o", sid: a.students[0].id, d: "2026-09-01", s: "", text: "x" }]; a.checks = [{ id: "k", title: "T", date: "", done: [] }];
  })(); renderSettings()`);
  app.klick('#set-newyear');
  erwarte(app.$('#ny-name-0').value === '8b' && app.$('#ny-name-1').value === '10a' && app.$('#ny-name-2').value === 'Q2', 'Neue Klassennamen nicht hochgezählt');
  app.klick(app.$$('#ny-act-1 button')[1]);          // 9a archivieren
  app.klick(app.$$('#ny-act-2 button')[2]);          // Q1 löschen
  erwarte(app.$('#ny-name-2').style.display === 'none', 'Namensfeld bleibt beim Löschen sichtbar');
  app.$('#ny-name-0').value = '8b neu'; app.$('#ny-name-0').dispatchEvent(new app.w.Event('input'));
  app.klick('#ny-opt-history');                       // Verlauf auch löschen
  app.sheetOk();
  // Bestätigung: abbrechen ändert nichts
  erwarte(app.$('#sheet').textContent.indexOf('1') >= 0, 'Bestätigung fehlt');
  app.klick('#sheet .row button.ghost');
  erwarte(app.E('DB.classes.length') === 3 && app.E('DB.classes[0].name') === '7b', 'Abbrechen ändert trotzdem etwas');
  // noch einmal, jetzt bestätigen
  app.klick('#set-newyear');
  app.klick(app.$$('#ny-act-1 button')[1]); app.klick(app.$$('#ny-act-2 button')[2]);
  app.klick('#ny-opt-history');
  app.sheetOk(); app.sheetOk();
  const a = app.E('DB.classes.find(c => c.name === "8b")');
  erwarte(!!a, 'Klasse nicht umbenannt: ' + app.E('JSON.stringify(DB.classes.map(c => c.name))'));
  erwarte(a && a.assess.length === 0 && a.attendance.length === 0 && a.absLog.length === 0 && a.history.length === 0 && a.students.length === 2 && a.plans.length === 1, 'Daten der Klasse nicht wie gewählt geleert');
  erwarte(a && !a.plans[0].exam && !('examPrev' in a.plans[0]), 'Klassenarbeit bleibt aktiv');
  erwarte(app.E('DB.classes.find(c => c.name === "9a").archived') === true, 'Klasse nicht archiviert');
  erwarte(app.E('DB.classes.find(c => c.name === "9a").assess.length') === 1, 'Archivierte Klasse verliert ihre Noten');
  erwarte(!app.E('DB.classes.some(c => c.name === "Q1" || c.name === "Q2")') && app.E('DB.trash.some(x => x.kind === "class" && x.name === "Q1")'), 'Gelöschte Klasse nicht im Papierkorb');
  erwarte(app.E('DB.lessons.length') === 0, 'Stundenplan nicht geleert');
  erwarte(app.E('DB.cancelled.length') === 0 && a.obs.length === 0 && a.checks.length === 0, 'Ausfälle, Beobachtungen oder Abhaklisten bleiben');
  // Daten überstehen Neuladen
  app.E('flushSave()');
  erwarte(app.E('JSON.parse(localStorage.getItem("sitzplan.v2")).classes.length') === 2, 'Schuljahreswechsel nicht gespeichert');
  erwarte(app.E('bumpClassName("Klasse 5c")') === 'Klasse 6c' && app.E('bumpClassName("AG Theater")') === 'AG Theater', 'Namen hochzählen falsch');
});


/* ---------- 28. Stundenausfall, Beobachtungen, Abhaklisten ---------- */
test('Stundenausfall', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben']);
  app.E(`DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    DB.lessons.push({ id: "L1", day: 0, period: 2, span: 2, week: "", subjectId: "ma", classId: curClass().id, roomId: "", planId: "" }); goTimetable()`);
  const dk = app.E('ttDateFor(DB.lessons[0])');
  erwarte(/^\d{4}-\d{2}-\d{2}$/.test(dk) && app.E(`new Date("${dk}T12:00:00").getDay()`) === 1, 'Datum der Stunde in dieser Woche falsch: ' + dk);
  app.klick('#tt-grid .tt-cell');
  erwarte(!!app.$('#tt-cancel') && app.$('#tt-cancel').textContent.indexOf(app.E('I18N.de.ttDays[0]') + ', ') >= 0, 'Schalter „Fällt aus“ fehlt');
  // Fehlstunden, die schon gezählt waren, verschwinden
  app.E(`curClass().absLog = [{ d: "${dk}", p: 2, n: 2, s: "ma", ids: [curClass().students[0].id] }, { d: "${dk}", p: 5, n: 1, s: "ma", ids: [curClass().students[0].id] }]`);
  app.klick('#tt-cancel');
  erwarte(app.E('JSON.stringify(DB.cancelled)') === JSON.stringify([dk + '|L1']), 'Ausfall nicht gespeichert: ' + app.E('JSON.stringify(DB.cancelled)'));
  const a0 = app.E('curClass().students[0].id');
  erwarte(app.E('curClass().absLog.length') === 2 && app.E(`missedLessons(curClass(), "${a0}").total`) === 1, 'Fehlstunden der ausgefallenen Stunde zählen weiter');
  app.E('closeModal()');
  const cell = app.$('#tt-grid .tt-cell');
  erwarte(cell.classList.contains('cancelled') && !!cell.querySelector('.ttoff') && /fällt aus/.test(cell.getAttribute('aria-label')), 'Ausgefallene Stunde nicht erkennbar');
  // ausgefallene Stunde wird nicht als laufende Stunde erkannt
  const tt = app.E('periodTimes()[2].start');
  const lauf = app.E(`(() => { const d = new Date("${dk}T00:00:00"); d.setMinutes(${tt} + 5); const L = currentLessonFor(curClass(), d); return L ? L.id : null; })()`);
  erwarte(lauf === null, 'Ausgefallene Stunde zählt als laufende Stunde');
  // wieder zurücknehmen
  app.klick('#tt-grid .tt-cell'); app.klick('#tt-cancel'); app.E('closeModal()');
  erwarte(app.E('DB.cancelled.length') === 0 && !app.$('#tt-grid .tt-cell').classList.contains('cancelled'), 'Ausfall lässt sich nicht zurücknehmen');
  erwarte(app.E(`missedLessons(curClass(), "${a0}").total`) === 3, 'Zurückgenommener Ausfall bringt die Fehlstunden nicht zurück');
  // Wochenende: der Ausfall gilt für die kommende Woche
  const we = app.E(`(() => { const D = Date; const fix = new D(2026, 9, 10, 12, 0); window.Date = class extends D { constructor(...a){ super(...(a.length ? a : [fix.getTime()])); } static now(){ return fix.getTime(); } };
    const r = ttDateFor(DB.lessons[0]); window.Date = D; return r; })()`);
  erwarte(we === '2026-10-12', 'Am Wochenende zeigt der Ausfall auf die vergangene Woche: ' + we);
  // Jetzt-Karte: heute ausfallen lassen
  app.E(`nowLessons = () => ({ now: { L: DB.lessons[0], start: 480, end: 570 }, next: null }); renderNowCard()`);
  app.klick('#now-cancel-ttNow');
  erwarte(app.E('isCancelled(DB.lessons[0], isoDay(new Date()))') && app.$('#now-card .nowrow').classList.contains('cancelled') && app.$('#now-card .nowt').textContent.indexOf('fällt aus') >= 0, 'Ausfall über die Jetzt-Karte fehlt');
  app.klick('#now-cancel-ttNow');
  erwarte(!app.E('isCancelled(DB.lessons[0], isoDay(new Date()))'), 'Ausfall über die Jetzt-Karte nicht umkehrbar');
  // Stunde löschen räumt Ausfälle auf
  app.E(`setCancelled(DB.lessons[0], "2026-01-05", true); goTimetable()`);
  app.klick('#tt-grid .tt-cell');
  app.klick(app.$$('#sheet button.ghost').find(b => b.textContent === app.E('t("ttDelete")')));
  erwarte(app.E('DB.cancelled.length') === 0, 'Ausfälle gelöschter Stunden bleiben');
  // Laden: nur gültige Einträge zu vorhandenen Stunden
  const roh = app.E(`JSON.stringify(sanitizeDB({ v: 2, subjects: [{ id: "ma", name: "M", color: "#2E86DE" }], lessons: [{ id: "L9", day: 0, period: 0, subjectId: "ma" }],
    cancelled: ["2026-01-05|L9", "2026-01-05|L9", "2026-01-06|weg", "kaputt|L9", 5] }).cancelled)`);
  erwarte(roh === '["2026-01-05|L9"]', 'Ausfälle werden beim Laden nicht geprüft: ' + roh);
});

test('Beobachtungen', app => {
  bewertungsKlasse(app);
  neuerPlan(app, 0);
  const a = app.E('curClass().students[0].id');
  // aus dem Notenblatt
  app.E(`(curClass().assess = curClass().assess || []).push({ id: "w1", subjectId: "ma", title: "KA", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { "${a}": "2" } }); goGrades("ma")`);
  app.klick('#g-tab-overview'); app.klick(app.$$('#g-table .gname')[0]);
  erwarte(app.$('#obs-open').textContent.indexOf('(0)') >= 0, 'Knopf „Beobachtungen“ fehlt im Schülerblatt');
  app.klick('#obs-open');
  erwarte(app.$('#obs-subj').value === 'ma', 'Fach nicht vorbelegt');
  app.klick('#obs-add');
  erwarte(app.E('(curClass().obs || []).length') === 0, 'Leere Beobachtung gespeichert');
  app.$('#obs-text').value = '  arbeitet konzentrierter  '; app.$('#obs-date').value = '2026-09-20';
  app.klick('#obs-add');
  erwarte(app.E('JSON.stringify(curClass().obs.map(o => [o.text, o.d, o.s]))') === '[["arbeitet konzentrierter","2026-09-20","ma"]]', 'Beobachtung falsch gespeichert: ' + app.E('JSON.stringify(curClass().obs)'));
  erwarte(app.$$('#obs-list .obsrow').length === 1 && app.$('#obs-list').textContent.indexOf('20.09.') >= 0, 'Beobachtung nicht in der Liste');
  // Datum in der Zukunft wird auf heute gesetzt
  app.$('#obs-text').value = 'Zukunft'; app.$('#obs-date').value = '2099-01-01'; app.klick('#obs-add');
  erwarte(app.E('curClass().obs[1].d') === app.E('isoDay(new Date())'), 'Beobachtung in der Zukunft datiert');
  app.klick(app.$$('#obs-list .obsrow .iconbtn')[0]);       // neueste zuerst -> „Zukunft“ weg
  erwarte(app.E('curClass().obs.length') === 2 && app.$('#sheet').textContent.indexOf('Zukunft') >= 0, 'Löschen ohne Rückfrage');
  app.sheetOk();
  erwarte(app.E('curClass().obs.length') === 1 && app.E('curClass().obs[0].text') === 'arbeitet konzentrierter', 'Löschen entfernt die falsche Beobachtung');
  // Zurück führt ins Schülerblatt
  app.klick(app.$$('#sheet button.ghost').pop());
  erwarte(!!app.$('#obs-open') && app.$('#obs-open').textContent.indexOf('(1)') >= 0, 'Zurück führt nicht ins Schülerblatt');
  app.E('closeModal()');
  // aus dem Unterrichtsmodus
  app.E('DB.settings.lesson = true; goPlans(); openPlan(curClass().plans[0].id); setLesson(true)');
  app.E('currentLessonFor = () => ({ subjectId: "ma", period: 0, span: 1 })');
  app.E('openLessonSheet(curPlan().desks.find(d => d.studentId))');
  const wer = app.E('curPlan().desks.find(d => d.studentId).studentId');
  erwarte(!!app.$('#lesson-obs'), 'Feld für Beobachtung im Unterricht fehlt');
  app.$('#lesson-obs').value = 'meldet sich oft'; app.sheetOk();
  erwarte(app.E(`studentObs(curClass(), "${wer}").some(o => o.text === "meldet sich oft" && o.s === "ma")`), 'Beobachtung aus dem Unterricht nicht gespeichert');
  // Namen: Schülerblatt
  app.E(`goNames(); editStudent("${a}")`);
  erwarte(!!app.$('#student-obs'), 'Beobachtungen fehlen bei den Namen');
  app.$('#sheet input.field').value = 'Anna-Lena';
  app.klick('#student-obs');
  erwarte(app.$$('#obs-list .obsrow').length === app.E(`studentObs(curClass(), "${a}").length`), 'Liste bei den Namen falsch');
  app.klick(app.$$('#sheet button.ghost').pop());
  erwarte(app.$('#sheet h3').textContent === app.E('t("editStudent")') && app.$('#sheet input.field').value === 'Anna-Lena', 'Zurück führt nicht zum Namen oder verliert die Eingabe');
  app.E('closeModal()');
  // Gesprächsblatt
  app.E(`curClass().checks = [{ id: "k1", title: "Einverständnis", date: "2026-09-01", done: [] }, { id: "k2", title: "Buch", date: "", done: ["${a}"] }]`);
  const pdf = app.E(`talkSheetPages(curClass(), studentById(curClass(), "${a}")).map(p => p.content).join("\\n")`);
  erwarte(pdf.indexOf('arbeitet konzentrierter') >= 0 && pdf.indexOf('(Beobachtungen)') >= 0, 'Beobachtungen fehlen im Gesprächsblatt');
  erwarte(pdf.indexOf('Einverst') >= 0 && pdf.indexOf('Buch') < 0, 'Offene Abhaklisten im Gesprächsblatt falsch');
  // sehr lange Wörter werden umbrochen
  app.E(`addObs(curClass(), "${a}", "${'W'.repeat(200)}", "")`);
  const lang = app.E(`talkSheetPages(curClass(), studentById(curClass(), "${a}")).map(p => p.content).join("\\n")`);
  erwarte(!/W{79}/.test(lang) && /W{78}/.test(lang), 'Langes Wort läuft aus dem Gesprächsblatt');
  // Laden
  const roh = app.E(`JSON.stringify(sanitizeDB({ v: 2, classes: [{ id: "x", name: "A", students: [{ id: "s1", name: "A" }],
    obs: [{ sid: "s1", d: "2026-01-01", text: "${'x'.repeat(400)}" }, { sid: "fremd", d: "2026-01-01", text: "y" }, { sid: "s1", d: "kaputt", text: "z" }, { sid: "s1", d: "2026-01-01", text: "   " }] }] }).classes[0].obs.map(o => o.text.length))`);
  erwarte(roh === '[300]', 'Beobachtungen werden beim Laden nicht geprüft: ' + roh);
});

test('Abhaklisten im Sitzplan', async app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem', 'Dana']);
  neuerPlan(app, 0);
  app.E('DB.settings.lesson = true; setLesson(true)');
  erwarte(app.$('#lb-check').style.display !== 'none', 'Knopf „Abhaken“ fehlt');
  app.klick('#lb-check');
  app.klick('#ck-new');
  erwarte(app.E('(curClass().checks || []).length') === 0 && app.$('#modal').classList.contains('on'), 'Liste ohne Titel angelegt');
  app.$('#ck-new-title').value = 'Einverständnis'; app.klick('#ck-new');
  erwarte(!!app.E('checkMode') && app.w.document.body.classList.contains('checking') && app.$('#cb-title').textContent === 'Einverständnis', 'Abhak-Modus startet nicht');
  erwarte(app.$('#cb-meta').textContent.indexOf('0 von 4') >= 0, 'Zähler falsch: ' + app.$('#cb-meta').textContent);
  const d = app.E('curPlan().desks.find(x => x.studentId)');
  app.E(`toggleCheck("${d.studentId}")`);
  const el = app.$(`#stage .item[data-id="${d.id}"]`);
  erwarte(!!el.querySelector('.ckmark') && el.classList.contains('ckdone') && app.$('#cb-meta').textContent.indexOf('1 von 4') >= 0, 'Haken am Platz fehlt');
  app.E(`toggleCheck("${d.studentId}")`);
  erwarte(!app.$(`#stage .item[data-id="${d.id}"]`).querySelector('.ckmark') && app.E('checkCur().done.length') === 0, 'Haken lässt sich nicht entfernen');
  // Liste: auch Schüler ohne Platz, umbenennen
  app.klick('#cb-list');
  erwarte(app.$$('#ck-names .setrow').length === 4, 'Namensliste unvollständig');
  app.klick(app.$$('#ck-names .setrow')[3]);
  erwarte(app.$('#cb-meta').textContent.indexOf('1 von 4') >= 0, 'Leiste nach Haken im Blatt nicht aktuell');
  app.$('#ck-title').value = 'Einverständnis Ausflug'; app.klick('#ck-ok');
  erwarte(app.E('checkCur().title') === 'Einverständnis Ausflug' && app.E('checkCur().done.length') === 1 && app.$('#cb-title').textContent === 'Einverständnis Ausflug', 'Liste bearbeiten wirkt nicht');
  // Beenden: zurück im Unterrichtsmodus
  app.klick('#cb-exit');
  erwarte(app.E('checkMode') === null && !app.w.document.body.classList.contains('checking') && app.E('lessonMode') === true, 'Beenden führt nicht zurück in den Unterricht');
  // Vorhandene Liste wieder öffnen, Zurücktaste beendet
  app.klick('#lb-check');
  erwarte(app.$$('#sheet .ckcard').length === 1 && app.$('#sheet .ckcard').textContent.indexOf('1 von 4') >= 0, 'Vorhandene Liste fehlt');
  app.klick('#sheet .ckcard');
  erwarte(!!app.E('checkMode'), 'Vorhandene Liste startet nicht');
  app.E('navBack()');
  erwarte(app.E('checkMode') === null && app.E('lessonMode') === true, 'Zurücktaste beendet Abhaken nicht');
  // Bewerten beendet das Abhaken
  app.E('startCheckMode(curClass().checks[0].id); startGradeMode("gibtsnicht")');
  erwarte(app.E('checkMode') === null && !app.w.document.body.classList.contains('checking'), 'Abhaken bleibt beim Bewerten aktiv');
  app.E('endGradeMode()');
  // Vorführen beendet Abhaken (keine Haken am Beamer)
  app.E('startCheckMode(curClass().checks[0].id); setPresenting(true)');
  erwarte(app.E('checkMode') === null && !app.w.document.body.classList.contains('checking') && !app.$('#stage .ckmark'), 'Haken im Vorführmodus sichtbar');
  app.E('setPresenting(false); setLesson(true)');
  // Unterricht beenden beendet Abhaken
  app.E('startCheckMode(curClass().checks[0].id); setLesson(false)');
  erwarte(app.E('checkMode') === null && !app.w.document.body.classList.contains('checking'), 'Abhaken bleibt nach dem Unterricht aktiv');
  // Löschen mit Rückfrage
  app.E('setLesson(true); startCheckMode(curClass().checks[0].id)');
  app.klick('#cb-list'); app.klick('#ck-delete');
  app.klick('#sheet .row button.ghost');                    // abbrechen -> zurück zur Liste
  await pause(100);
  erwarte(app.E('curClass().checks.length') === 1 && !!app.$('#ck-names'), 'Abbrechen beim Löschen falsch');
  app.klick('#ck-delete'); app.sheetOk();
  erwarte(app.E('curClass().checks.length') === 0 && app.E('checkMode') === null, 'Liste nicht gelöscht');
  // Laden
  const roh = app.E(`JSON.stringify(sanitizeDB({ v: 2, classes: [{ id: "x", name: "A", students: [{ id: "s1", name: "A" }],
    checks: [{ title: "T", date: "2026-01-01", done: ["s1", "s1", "fremd"] }, { title: "  " }, { title: "U", date: "kaputt", done: "s1" }] }] }).classes[0].checks.map(k => [k.title, k.date, k.done]))`);
  erwarte(roh === '[["T","2026-01-01",["s1"]],["U","",[]]]', 'Abhaklisten werden beim Laden nicht geprüft: ' + roh);
});


/* ---------- 29. Sperre für Noten und Beobachtungen ---------- */
function bioMock(app, verfuegbar){
  const m = { calls: 0, next: 'ok' };
  app.w.cordova = app.w.cordova || { platformId: 'ios' };
  app.w.Fingerprint = {
    isAvailable(ok, err){ verfuegbar === false ? err({ code: -106 }) : ok('face'); },
    show(o, ok, err){ m.calls++; m.opts = o; if(m.next === 'hold'){ m.pending = ok; return; } if(m.next === 'ok') ok(); else err({ code: m.next === 'nobio' ? -106 : -108 }); }
  };
  return m;
}
test('Sperre für Noten und Beobachtungen', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem']);
  app.E('DB.gradesAck = true; DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); renderSettings()');
  erwarte(!app.$('#set-lock'), 'Sperre angeboten, obwohl das Gerät sie nicht kann');
  // Gerät ohne eingerichtete Entsperrung
  bioMock(app, false); app.E('renderSettings()');
  app.klick('#set-lock');
  erwarte(app.E('DB.settings.lock') === false && /keine Bildschirmsperre/.test(app.$('#toast').textContent), 'Sperre ohne Entsperrmöglichkeit eingeschaltet');
  // Einschalten mit Entsperren
  const m = bioMock(app); app.E('renderSettings()');
  m.next = 'abbruch'; app.klick('#set-lock');
  erwarte(app.E('DB.settings.lock') === false, 'Sperre trotz Abbruch eingeschaltet');
  m.next = 'ok'; app.klick('#set-lock');
  erwarte(app.E('DB.settings.lock') === true && app.$('#set-lock .switch').classList.contains('on') && m.opts.disableBackup === false, 'Sperre lässt sich nicht einschalten oder ohne Geräte-PIN');
  // gesperrt: Bewertungen nur nach Entsperren
  app.E('lockOpen = false'); m.next = 'abbruch'; const n0 = m.calls;
  app.E('goGrades("ma")');
  erwarte(m.calls === n0 + 1 && !app.$('#screen-grades').classList.contains('active') && app.$('#toast').textContent === 'Nicht entsperrt', 'Bewertungen ohne Entsperren geöffnet');
  m.next = 'ok'; app.E('goGrades("ma")');
  erwarte(app.$('#screen-grades').classList.contains('active') && app.E('lockOpen') === true, 'Bewertungen nach Entsperren nicht geöffnet');
  const n1 = m.calls; app.E('goGrades("ma")');
  erwarte(m.calls === n1, 'Nach dem Entsperren wird erneut gefragt');
  // kurz im Hintergrund: bleibt offen; 6 Minuten: wieder gesperrt und Notenansicht verlassen
  app.E('lockPause(); lockResume()');
  erwarte(app.E('lockOpen') === true, 'Kurzer Wechsel sperrt sofort');
  app.E('lockPausedAt = Date.now() - 6 * 60 * 1000; lockResume()');
  erwarte(app.E('lockOpen') === false && !app.$('#screen-grades').classList.contains('active'), 'Nach 5 Minuten nicht gesperrt oder Noten bleiben sichtbar');
  // Beobachtungen, Sicherung, Schuljahr
  m.next = 'abbruch';
  app.E('openObservations(curClass(), curClass().students[0])');
  erwarte(!app.$('#obs-text'), 'Beobachtungen ohne Entsperren');
  app.E('$("#btn-backup").onclick()');
  erwarte(!app.$('#bk-enc') && !app.$('#modal').classList.contains('on'), 'Sicherung ohne Entsperren');
  app.E('openNewYear()');
  erwarte(!app.$('#ny-name-0'), 'Schuljahreswechsel ohne Entsperren');
  // Sicherung zurückspielen ebenfalls
  app.E('window.__pick = 0; $("#filepick").click = () => { window.__pick++; }; $("#btn-restore").onclick()');
  erwarte(app.E('window.__pick') === 0, 'Zurückspielen ohne Entsperren');
  // Doppeltipp: nur eine Abfrage, keine falsche Meldung
  m.next = 'hold'; const nd = m.calls; app.E('goGrades("ma"); goGrades("ma")');
  erwarte(m.calls === nd + 1 && !/keine Bildschirmsperre/.test(app.$('#toast').textContent), 'Doppeltipp startet zwei Abfragen oder meldet Unsinn');
  m.pending(); app.E('lockOpen = false; goHome()');
  // Unterricht: Sitzplan frei, Schnellbewertung erst nach Entsperren – Eingaben bleiben erhalten
  neuerPlan(app, 0);
  app.E('DB.settings.lesson = true; setLesson(true); openLessonSheet(curPlan().desks.find(d => d.studentId))');
  erwarte(!!app.$('#sheet .tile.wide') && !!app.$('#lock-open') && !app.$('#lesson-quickmark') && app.$('#sheet').textContent.indexOf('Beobachtungen (') < 0, 'Anwesenheit gesperrt oder Noten ohne Entsperren sichtbar');
  app.$('#sheet textarea').value = 'Notiz bleibt';
  m.next = 'ok'; app.klick('#lock-open');
  erwarte(!!app.$('#lesson-quickmark') && !app.$('#lock-open') && app.$('#sheet textarea').value === 'Notiz bleibt', 'Nach Entsperren keine Schnellbewertung oder Notiz verloren');
  app.E('closeModal()');
  // Abhaken bleibt frei
  app.E('lockOpen = false'); const n2 = m.calls;
  app.klick('#lb-check');
  erwarte(m.calls === n2 && !!app.$('#ck-new'), 'Abhaken fragt nach Entsperrung');
  app.E('closeModal()');
  // Selbsteinschätzung: danach wieder gesperrt
  app.E('lockOpen = true; selfMode = "x"; endSelfMode(true)');
  erwarte(app.E('lockOpen') === false, 'Nach der Selbsteinschätzung bleibt entsperrt');
  // Bewerten im Plan: Entsperren beim Sperren beendet das Bewerten
  app.E('lockOpen = true; curClass().assess = [{ id: "a1", subjectId: "ma", title: "T", date: "2026-10-01", kind: "other", scale: "grade", weight: 1, marks: {} }]; startGradeMode("a1")');
  app.E('lockPausedAt = Date.now() - 6 * 60 * 1000; lockResume()');
  erwarte(app.E('gradeMode') === null && !app.w.document.body.classList.contains('grading'), 'Bewerten im Plan bleibt nach dem Sperren offen');
  // Ausschalten nur nach Entsperren
  app.E('renderSettings()'); m.next = 'abbruch'; app.klick('#set-lock');
  erwarte(app.E('DB.settings.lock') === true, 'Sperre ohne Entsperren ausgeschaltet');
  m.next = 'ok'; app.klick('#set-lock');
  erwarte(app.E('DB.settings.lock') === false, 'Sperre lässt sich nicht ausschalten');
  // ausgeschaltet: keine Abfrage
  app.E('lockOpen = false'); const n3 = m.calls; app.E('goGrades("ma")');
  erwarte(m.calls === n3 && app.$('#screen-grades').classList.contains('active'), 'Ohne Sperre wird trotzdem gefragt');
  // Sperre gehört zum Gerät: nicht in der Sicherung, beim Zurückspielen bleibt sie
  app.E('DB.settings.lock = true');
  erwarte(app.E('backupData().settings.lock') === false && app.E('DB.settings.lock') === true, 'Sperre wandert mit der Sicherung');
  // Entsperrung weggefallen: Ausschalten wird angeboten
  app.E('lockOpen = false'); m.next = 'nobio'; app.E('goGrades("ma")');
  erwarte(app.$('#sheet').textContent.indexOf('Sperre ausschalten') >= 0, 'Ohne Biometrie bleibt man ausgesperrt');
  app.sheetOk();
  erwarte(app.E('DB.settings.lock') === false, 'Sperre lässt sich ohne Biometrie nicht ausschalten');
  // im Browser (ohne Cordova) sperrt nichts
  app.E('DB.settings.lock = true; lockOpen = false; window.__c = window.cordova; delete window.cordova');
  erwarte(app.E('lockedNow()') === false, 'Im Browser ausgesperrt');
  app.E('window.cordova = window.__c; DB.settings.lock = false');
  // Laden
  erwarte(app.E('sanitizeDB({ v: 2, settings: { lock: true } }).settings.lock') === true && app.E('sanitizeDB({ v: 2, settings: { lock: "ja" } }).settings.lock') === false, 'Einstellung wird beim Laden nicht geprüft');
});


/* ---------- 30. Excel-Export ---------- */
function zipLesen(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = {};
  let o = 0;
  while(dv.getUint32(o, true) === 0x04034b50){
    const crc = dv.getUint32(o + 14, true), size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), el = dv.getUint16(o + 28, true);
    const name = Buffer.from(buf.slice(o + 30, o + 30 + nl)).toString('utf8');
    const data = Buffer.from(buf.slice(o + 30 + nl + el, o + 30 + nl + el + size));
    out[name] = { crc, data, ok: require('zlib').crc32(data) === crc };
    o += 30 + nl + el + size;
  }
  return { files: out, ende: dv.getUint32(buf.byteLength - 22, true) === 0x06054b50 };
}
test('Bewertungen als Excel-Datei', async app => {
  bewertungsKlasse(app);
  app.E(`(() => { const c = curClass(), s = c.students; s[1].name = '=SUMME(1;2)'; s[2].name = 'Cem <&> "x"';
    DB.subjects.push({ id: "de", name: "Deutsch: Lyrik/Prosa [Q1]*", short: "De", color: "#C0392B" }); c.gradeSubjects = ["ma", "de"];
    c.assess = [{ id: "w1", subjectId: "ma", title: "KA 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [s[0].id]: "2+", [s[1].id]: "x" } },
      { id: "o1", subjectId: "ma", title: "Mitarbeit", date: "2026-09-12", kind: "other", scale: "smiley", weight: 2, marks: { [s[0].id]: "s1" } },
      { id: "p1", subjectId: "de", title: "Klausur", date: "2026-09-20", kind: "written", scale: "points", weight: 1, marks: { [s[0].id]: "11" } },
      { id: "z1", subjectId: "ma", title: "Selbst", date: "2026-09-12", kind: "self", scale: "smiley", weight: 1, marks: { [s[0].id]: "s4" } }];
    c.absLog = [{ d: "2026-09-01", p: 0, n: 2, s: "ma", ids: [s[0].id] }]; })(); goGrades("ma")`);
  const box = downloadAbfangen(app);
  app.klick('#g-tab-overview'); app.klick('#g-xlsx');
  erwarte(!!box.blob && /\.xlsx$/.test(box.name) && box.blob.type.indexOf('spreadsheetml') >= 0, 'Excel-Datei wird nicht erzeugt: ' + box.name);
  const bytes = new Uint8Array(await new Promise(r => { const f = new app.w.FileReader(); f.onload = () => r(f.result); f.readAsArrayBuffer(box.blob); }));
  const z = zipLesen(bytes), namen = Object.keys(z.files);
  erwarte(z.ende && ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml'].every(n => namen.indexOf(n) >= 0), 'ZIP-Aufbau falsch: ' + namen.join());
  erwarte(namen.every(n => z.files[n].ok), 'Prüfsumme im ZIP falsch');
  const wb = z.files['xl/workbook.xml'].data.toString('utf8');
  erwarte(/name="Mathe"/.test(wb) && /name="Deutsch Lyrik Prosa Q1"/.test(wb) && /name="Fehlzeiten"/.test(wb), 'Blattnamen falsch: ' + wb);
  const s1 = z.files['xl/worksheets/sheet1.xml'].data.toString('utf8');
  erwarte(s1.indexOf('<f>') < 0 && s1.indexOf('=SUMME(1;2)') >= 0 && s1.indexOf('Cem &lt;&amp;&gt; &quot;x&quot;') >= 0, 'Text nicht sicher abgelegt');
  erwarte(s1.indexOf('Selbst') < 0 && /state="frozen"/.test(s1) && s1.indexOf('sehr gut') >= 0 && s1.indexOf('fehlt') >= 0, 'Inhalt Mathe falsch');
  erwarte(/<c r="D2" s="1"><v>1\.7<\/v><\/c>/.test(s1), 'Durchschnitt nicht als Zahl: ' + (s1.match(/<c r="D2"[^/]*\/c>/) || [''])[0]);
  const s2 = z.files['xl/worksheets/sheet2.xml'].data.toString('utf8');
  erwarte(/<c r="B2"><v>11<\/v><\/c>/.test(s2), 'Punkte nicht als Zahl');
  const s3 = z.files['xl/worksheets/sheet3.xml'].data.toString('utf8');
  erwarte(/<c r="D2"><v>2<\/v><\/c>/.test(s3) && /<c r="E2"><v>2<\/v><\/c>/.test(s3) && s3.indexOf('Mathe') >= 0 && s3.indexOf('Verspätungen') >= 0, 'Fehlzeiten-Blatt falsch');
  // Steuerzeichen und doppelte Blattnamen
  erwarte(app.E('xmlEsc("a\\u0001b\\uD800c")') === 'abc', 'Ungültige XML-Zeichen bleiben');
  erwarte(app.E('JSON.stringify(xlsxSheetNames(["A", "a", "' + 'x'.repeat(40) + '"]))') === JSON.stringify(['A', 'a (2)', 'x'.repeat(31)]), 'Blattnamen nicht eindeutig oder zu lang');
  erwarte(app.E('xlsxCol(0) + xlsxCol(25) + xlsxCol(26) + xlsxCol(701)') === 'AZAAZZ', 'Spaltenbuchstaben falsch');
  erwarte(app.E(`JSON.stringify(xlsxSheetNames(["'Lyrik' *", "History", "A\\u0001", "A"]))`) === JSON.stringify(['Lyrik', 'History_', 'A', 'A (2)']), 'Blattnamen nicht Excel-tauglich: ' + app.E(`JSON.stringify(xlsxSheetNames(["'Lyrik' *", "History", "A\\u0001", "A"]))`));
  erwarte(app.E('xmlEsc("_x0041_")') === '_x005F_x0041_', '_xHHHH_ wird von Excel als Zeichen gelesen');
  // ganze Noten als Zahl, „ohne Fach“ und gelöschtes Fach in einer Spalte
  app.E(`(() => { const c = curClass(), s = c.students; c.assess[0].marks[s[2].id] = "3";
    c.absLog.push({ d: "2026-09-02", p: 1, n: 1, s: "", ids: [s[0].id] }, { d: "2026-09-03", p: 1, n: 1, s: "weg", ids: [s[0].id] }); })()`);
  const sh = app.E('gradesXlsxSheets(curClass())');
  erwarte(sh[0].rows[3][1] === 3 && sh[0].rows[1][1] === '2+', 'Ganze Noten nicht als Zahl oder Tendenz verloren');
  const fz = sh[sh.length - 1].rows;
  erwarte(fz[0].filter(x => x === 'ohne Fach').length === 1 && fz[1][fz[0].indexOf('ohne Fach')] === 2, '„ohne Fach“ doppelt: ' + JSON.stringify(fz[0]));
});

test('Teilen in der App behält den Dateinamen', async app => {
  const calls = [];
  app.E('window.cordova = { platformId: "android" }');
  app.w.plugins = { socialsharing: { shareWithOptions(o){ calls.push(o); } } };
  app.E('download(new Blob(["x"], { type: "" }), "7b_Bewertungen.xlsx", XLSX_MIME)');
  await pause(80);
  erwarte(calls.length === 1 && calls[0].files[0].indexOf('df:7b_Bewertungen.xlsx;data:' + app.E('XLSX_MIME') + ';base64,') === 0, 'Dateiname oder Typ geht beim Teilen verloren: ' + (calls[0] && calls[0].files[0].slice(0, 90)));
  erwarte(typeof calls[0].iPadCoordinates === 'string' && calls[0].iPadCoordinates.split(',').length === 4, 'iPad-Anker hat den falschen Schlüssel');
  app.E('download(new Blob(["a;b"], { type: "text/csv;charset=utf-8" }), "x.csv", "text/csv")');
  await pause(80);
  erwarte(calls[1] && calls[1].files[0].indexOf('df:x.csv;data:text/csv;base64,') === 0, 'CSV-Typ mit Zusatz: ' + (calls[1] && calls[1].files[0].slice(0, 50)));
  app.E('download(new Blob(["a;b"], { type: "text/csv;charset=utf-8" }), "y.csv")');
  await pause(80);
  erwarte(calls[2] && calls[2].files[0].indexOf('df:y.csv;data:text/csv;base64,') === 0, 'Blob-Typ mit Zusatz wird weitergegeben');
});


/* ---------- 31. Abgleich zwischen Geräten ---------- */
const uhr = (app, sek) => app.E('Date.now = () => ' + (sek * 1000))
const datei = app => app.E('JSON.stringify({ app: "fairseat", v: 2, exported: new Date(Date.now()).toISOString(), data: backupData() })');
const inhalt = app => app.E('(() => { const m = syncEntities(DB), o = {}; Array.from(m.keys()).sort().forEach(k => { if(k !== "set") o[k] = m.get(k).v; }); return JSON.stringify(o); })()');
function grundstand(app){
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem', 'Dana']);
  app.E(`(() => { DB.gradesAck = true; DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    const c = curClass(), s = c.students; c.gradeSubjects = ["ma"];
    c.assess = [{ id: "w1", subjectId: "ma", title: "KA 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [s[0].id]: "2", [s[3].id]: "4" } }];
    c.obs = []; c.absLog = []; c.checks = [{ id: "k1", title: "Einverständnis", date: "2026-09-01", done: [] }]; })()`);
  app.E('flushSave()');
}
const sid = (app, n) => app.E(`curClass().students.find(s => s.name === "${n}").id`);
async function laden(app, json, wie){
  app.E(`restoreParsed(${json})`);
  if(wie === 'merge') app.klick('#sync-merge');
  else { app.klick('#sync-replace'); if(app.$('#sheet .row button.primary')) app.sheetOk(); }
  await pause(10);
  app.E('curClassId = DB.classes[0] ? DB.classes[0].id : null');
}

test('Abgleich: Zeitstempel beim Speichern', app => {
  uhr(app, 1000); grundstand(app);
  const st = app.E('JSON.stringify(DB.stamps)');
  erwarte(app.E('DB.mod') === 1000 && app.E(`DB.stamps["m|" + curClass().id + "|w1|${sid(app, 'Anna')}"]`) === 1000, 'Neue Einträge ohne Zeitstempel: ' + st.slice(0, 200));
  uhr(app, 1500);
  app.E(`curClass().assess[0].marks["${sid(app, 'Anna')}"] = "3"; flushSave()`);
  const k = `"m|" + curClass().id + "|w1|${sid(app, 'Anna')}"`;
  erwarte(app.E(`DB.stamps[${k}]`) === 1500 && app.E(`DB.stamps["m|" + curClass().id + "|w1|${sid(app, 'Dana')}"]`) === 1000, 'Geänderte Note nicht gestempelt oder andere mitgestempelt');
  // unveränderter Stand: kein neuer Zeitstempel
  uhr(app, 1600); app.E('flushSave()');
  erwarte(app.E('DB.mod') === 1500, 'Speichern ohne Änderung verändert den Zeitstempel');
  // Löschen: Note → Eintrag in der Löschliste; ganze Bewertung → nur die Bewertung
  uhr(app, 1700);
  app.E(`delete curClass().assess[0].marks["${sid(app, 'Dana')}"]; flushSave()`);
  erwarte(app.E(`DB.del[hk("m|" + curClass().id + "|w1|${sid(app, 'Dana')}")]`) === 1700, 'Gelöschte Note nicht vermerkt');
  erwarte(app.E('Object.keys(DB.del).every(k => /^[0-9a-z]+$/.test(k))') && app.E('JSON.stringify(DB.del)').indexOf(sid(app, 'Dana')) < 0, 'Löschliste verrät Schlüssel');
  uhr(app, 1800);
  app.E('curClass().assess = []; flushSave()');
  erwarte(app.E('DB.del[hk("a|" + curClass().id + "|w1")]') === 1800 && app.E(`DB.del[hk("m|" + curClass().id + "|w1|${sid(app, 'Anna')}")]`) === undefined, 'Löschliste falsch bei ganzer Bewertung');
  // Rückgängig: Eintrag kommt zurück, Löschvermerk verschwindet
  uhr(app, 1900);
  app.E('curClass().assess = [{ id: "w1", subjectId: "ma", title: "KA 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: {} }]; flushSave()');
  erwarte(app.E('DB.del[hk("a|" + curClass().id + "|w1")]') === undefined && app.E('DB.stamps["a|" + curClass().id + "|w1"]') === 1900, 'Wiederhergestellter Eintrag bleibt als gelöscht vermerkt');
  // Gerätebezogenes zählt nicht als Änderung
  uhr(app, 2000); app.E('DB.lastClass = "x"; DB.trash = []; DB.settings.lock = true; LANG = "en"; flushSave(); LANG = "de"');
  erwarte(app.E('DB.mod') === 1900, 'Gerätebezogene Einstellungen gelten als Datenänderung');
  // Laden prüft Zeitstempel
  uhr(app, 1790000000);
  const roh = app.E(`JSON.stringify((() => { const d = sanitizeDB({ v: 2, stamps: { "c|a": 5, "c|b": -1, "c|c": "x", "c|d": 1.5, "zz|x": 1, constructor: 3, "s|k|z": 1790000000 + 999999 }, del: { [hk("c|alt")]: 10, [hk("c|neu")]: Math.floor(Date.now() / 1000), "c|klar": 5 }, mod: 1790000000 + 999999 }); return [d.stamps, d.del, d.mod, hk("c|neu")]; })())`);
  const hn = JSON.parse(roh)[3];
  erwarte(roh === JSON.stringify([{ "s|k|z": 1790999999, "c|a": 5 }, { [hn]: 1790000000 }, 1790999999, hn]), 'Zeitstempel werden beim Laden nicht geprüft: ' + roh);
});

test('Abgleich: zwei Geräte bearbeiten parallel', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    erwarte(B.E('DB.classes.length') === 1 && inhalt(B) === inhalt(app), 'Gleicher Ausgangsstand fehlt auf Gerät B');
    const ids0 = {}; ['Anna', 'Ben', 'Cem', 'Dana'].forEach(n => { ids0[n] = sid(app, n); });
    const A_ = n => ids0[n];
    // Gerät A
    uhr(app, 2000);
    app.E(`(() => { const c = curClass(), a = c.assess[0];
      a.marks["${A_('Ben')}"] = "3"; a.marks["${A_('Anna')}"] = "2-";
      c.obs.push({ id: "o1", sid: "${A_('Ben')}", d: "2026-09-20", s: "ma", text: "meldet sich oft" });
      c.students = c.students.filter(s => s.name !== "Cem");
      c.checks[0].done.push("${A_('Anna')}"); })(); flushSave()`);
    // Gerät B (später)
    uhr(B, 3000);
    B.E(`(() => { const c = curClass(), a = c.assess[0];
      a.marks["${A_('Anna')}"] = "1"; delete a.marks["${A_('Dana')}"];
      c.assess.push({ id: "w2", subjectId: "ma", title: "Test", date: "2026-09-25", kind: "other", scale: "points", weight: 1, marks: { "${A_('Ben')}": "12" } });
      c.absLog.push({ d: "2026-09-24", p: 1, n: 1, s: "ma", ids: ["${A_('Dana')}"] });
      c.students.find(s => s.name === "Ben").name = "Benjamin";
      c.checks[0].done.push("${A_('Ben')}"); })(); flushSave()`);
    const fA = datei(app), fB = datei(B);
    // B in A einspielen
    uhr(app, 4000);
    app.E(`restoreParsed(${fB})`);
    erwarte(!!app.$('#sync-preview') && /Noten/.test(app.$('#sync-preview').textContent) && !app.$('#sync-older'), 'Vorschau fehlt oder falsche Altersangabe');
    erwarte(!/beiden Geräten/.test(app.$('#sync-preview').textContent), 'Ohne früheren Abgleich werden Widersprüche gemeldet');
    app.klick('#sync-merge'); await pause(10);
    app.E('curClassId = DB.classes[0].id');
    const c = 'curClass()';
    const m = n => app.E(`(${c}.assess.find(a => a.id === "w1").marks || {})["${A_(n)}"]`);
    erwarte(m('Anna') === '1', 'Neuere Note von B nicht übernommen: ' + m('Anna'));
    erwarte(m('Ben') === '3', 'Note von A verloren');
    erwarte(m('Dana') === undefined, 'Auf B gelöschte Note kommt zurück');
    erwarte(app.E(`${c}.assess.some(a => a.id === "w2" && a.marks["${A_('Ben')}"] === "12")`), 'Neue Bewertung von B fehlt');
    erwarte(app.E(`${c}.obs.length`) === 1 && app.E(`${c}.absLog.length`) === 1, 'Beobachtung oder Fehlzeit fehlt');
    erwarte(!app.E(`${c}.students.some(s => s.name === "Cem")`) && app.E(`${c}.students.some(s => s.name === "Benjamin")`), 'Löschen oder Umbenennen nicht übernommen');
    erwarte(app.E(`${c}.checks[0].done.length`) === 2, 'Haken beider Geräte nicht zusammengeführt');
    erwarte(!!app.$('#backup-reminder .minibtn.blue'), 'Zusammenführen lässt sich nicht rückgängig machen');
    // A in B einspielen: beide Geräte haben danach denselben Stand
    uhr(B, 4000);
    await laden(B, fA, 'merge');
    erwarte(inhalt(B) === inhalt(app), 'Geräte kommen nicht zum selben Stand');
    // dieselbe Datei noch einmal: nichts ändert sich
    const vorher = inhalt(app);
    app.E(`restoreParsed(${fB})`);
    erwarte(/ändert sich nichts/.test(app.$('#sync-preview').textContent), 'Zweites Einspielen meldet Änderungen: ' + app.$('#sync-preview').textContent);
    app.klick('#sync-merge'); await pause(10);
    app.E('curClassId = DB.classes[0].id');
    erwarte(inhalt(app) === vorher, 'Zweites Einspielen verändert den Stand');
  } finally { B.ende(); }
});

test('Abgleich: Löschen gegen spätere Änderung', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1000); await laden(B, datei(app), 'replace');
    const ben = sid(app, 'Ben');
    // A löscht die Bewertung früh, B trägt später eine Note ein -> Bewertung bleibt
    uhr(app, 2000); app.E('curClass().assess = []; flushSave()');
    uhr(B, 3000); B.E(`curClass().assess[0].marks["${ben}"] = "5"; flushSave()`);
    uhr(app, 3500); await laden(app, datei(B), 'merge');
    erwarte(app.E('curClass().assess.length') === 1 && app.E(`curClass().assess[0].marks["${ben}"]`) === '5', 'Spätere Note geht durch frühere Löschung verloren');
    // A löscht danach erneut (neuer) -> bleibt gelöscht
    uhr(app, 5000); app.E('curClass().assess = []; flushSave()');
    uhr(B, 5000); await laden(B, datei(app), 'merge');
    erwarte(B.E('curClass().assess.length') === 0, 'Neuere Löschung wird nicht übernommen');
    // ganze Klasse: auf A gelöscht, auf B danach nicht verändert -> weg
    uhr(app, 6000); app.E('DB.classes = []; flushSave()');
    uhr(B, 6500); await laden(B, datei(app), 'merge');
    erwarte(B.E('DB.classes.length') === 0, 'Gelöschte Klasse kommt zurück');
    // Klasse neu auf B, A kennt sie nicht -> wird ergänzt
    uhr(B, 7000); klasseMitNamen(B, '8a', ['Xaver']); B.E('flushSave()');
    uhr(app, 7500); await laden(app, datei(B), 'merge');
    erwarte(app.E('DB.classes.length') === 1 && app.E('DB.classes[0].name') === '8a', 'Neue Klasse wird nicht ergänzt');
  } finally { B.ende(); }
});

test('Abgleich: ältere Datei, alte Sicherungen, Gerätebezogenes', async app => {
  uhr(app, 1790000000); grundstand(app);
  app.E('DB.settings.lock = true; DB.lastClass = curClass().id; LANG = "de"; flushSave()');
  // Sicherung ohne Zeitstempel (ältere Version): ergänzen, bei Unterschied gilt das Gerät
  const alt = JSON.stringify({ app: 'fairseat', v: 2, exported: '2026-01-01T10:00:00.000Z', data: app.E(`(() => { const d = backupData(); delete d.stamps; delete d.del; delete d.mod;
    d.lang = "en"; d.theme = "dark"; d.settings.timetable = false;
    d.classes[0].assess[0].marks[d.classes[0].students[0].id] = "6";
    d.classes[0].obs.push({ id: "alt", sid: d.classes[0].students[1].id, d: "2026-01-01", s: "", text: "aus alter Datei" });
    d.rooms.push({ id: "r9", name: "Aula", w: 2700, h: 2100, floor: "stone", items: [] }); return d; })()`) });
  app.E(`restoreParsed(${alt})`);
  erwarte(!!app.$('#sync-older') && app.$('#sync-cmp').textContent.indexOf('01.01.2026') >= 0, 'Keine Warnung bei älterer Datei');
  app.klick('#sync-merge'); await pause(10);
  app.E('curClassId = DB.classes[0].id');
  erwarte(app.E(`curClass().assess[0].marks["${sid(app, 'Anna')}"]`) === '2', 'Alte Datei überschreibt neueren Stand');
  erwarte(app.E('curClass().obs.some(o => o.id === "alt")') && app.E('DB.rooms.some(r => r.id === "r9")'), 'Neues aus alter Datei wird nicht ergänzt');
  erwarte(app.E('DB.settings.lock') === true && app.E('LANG') === 'de' && app.E('DB.theme') !== 'dark' && app.E('DB.settings.timetable') !== false, 'Gerätebezogenes aus der Datei übernommen');
  // Ersetzen mit älterer Datei: deutliche Rückfrage
  app.E(`restoreParsed(${alt})`); app.klick('#sync-replace');
  erwarte(app.$('#sheet').textContent.indexOf('älter') >= 0, 'Ersetzen mit älterer Datei ohne Warnung');
  app.klick('#sheet .row button.ghost'); await pause(100);
  erwarte(!!app.$('#sync-replace'), 'Abbrechen führt nicht zur Auswahl zurück');
  app.E('closeModal()');
  // leeres Gerät: nur „Laden“
  const B = neueApp();
  try{
    B.E(`restoreParsed(${alt})`);
    erwarte(!B.$('#sync-merge') && !!B.$('#sync-replace') && B.$('#sync-replace').textContent === B.E('t("restore")'), 'Leeres Gerät bietet Zusammenführen an');
    B.klick('#sync-replace'); await pause(10);
    erwarte(B.E('DB.classes.length') === 1, 'Laden auf leerem Gerät klappt nicht');
  } finally { B.ende(); }
});

test('Abgleich: heutiger Unterricht und Anwesenheit', async app => {
  uhr(app, 1000); grundstand(app);
  const B = neueApp();
  try{
    uhr(B, 1000); await laden(B, datei(app), 'replace');
    const ben = sid(app, 'Ben'), cem = sid(app, 'Cem');
    // A: gestern Ben abwesend (Unterrichtsstand von gestern), B: heute Cem abwesend
    uhr(app, 2000); app.E(`curClass().lesson = { date: "2026-10-05", absent: ["${ben}"], picked: [], notes: {} }; flushSave()`);
    uhr(B, 3000); B.E(`curClass().lesson = { date: "2026-10-06", absent: ["${cem}"], picked: [], notes: {} }; flushSave()`);
    uhr(app, 4000); await laden(app, datei(B), 'merge');
    erwarte(app.E('curClass().lesson.date') === '2026-10-06' && app.E('curClass().lesson.absent[0]') === cem, 'Jüngerer Unterrichtstag nicht übernommen');
    erwarte(app.E('curClass().attendance.some(x => x.date === "2026-10-05" && x.absent[0] === "' + ben + '")'), 'Älterer Tag geht verloren');
  } finally { B.ende(); }
});

test('Abgleich: große Datenmenge', app => {
  uhr(app, 1000);
  klasseMitNamen(app, 'Groß', Array.from({ length: 32 }, (_, i) => 'Kind ' + i));
  app.E(`(() => { const c = curClass(); DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    c.assess = []; for(let i = 0; i < 300; i++){ const m = {}; c.students.forEach((s, j) => { if((i + j) % 3) m[s.id] = String(1 + (i + j) % 6); });
      c.assess.push({ id: "a" + i, subjectId: "ma", title: "T" + i, date: "2026-09-10", kind: "other", scale: "grade", weight: 1, marks: m }); } })(); flushSave()`);
  const t0 = Date.now ? process.hrtime.bigint() : 0n;
  uhr(app, 20000);
  const ms = app.E('(() => { const t = performance.now(); const f = sanitizeDB(JSON.parse(JSON.stringify(DB))); f.classes[0].assess[5].marks[f.classes[0].students[2].id] = "1"; f.stamps["m|" + f.classes[0].id + "|a5|" + f.classes[0].students[2].id] = 9999; const r = mergeDB(DB, f); window.__r = r.report; return performance.now() - t; })()');
  erwarte(ms < 3000, 'Zusammenführen zu langsam: ' + Math.round(ms) + ' ms');
  erwarte(app.E('__r.upd') === 1 && app.E('__r.add') + app.E('__r.rem') === 0, 'Bericht falsch bei großer Datenmenge: ' + app.E('JSON.stringify(__r)'));
  const ms2 = app.E('(() => { const t = performance.now(); curClass().assess[0].title = "x"; flushSave(); return performance.now() - t; })()');
  erwarte(ms2 < 1500, 'Speichern mit Zeitstempeln zu langsam: ' + Math.round(ms2) + ' ms');
});


test('Abgleich: Verweise, Fehlzeiten, Papierkorb, Uhr', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1000); await laden(B, datei(app), 'replace');
    const ben = sid(app, 'Ben'), cem = sid(app, 'Cem');
    // A löscht Ben früh, B trägt später eine Note für Ben ein -> Ben bleibt (Verweis zählt)
    uhr(app, 2000); app.E(`curClass().students = curClass().students.filter(s => s.id !== "${ben}"); flushSave()`);
    uhr(B, 3000); B.E(`curClass().assess[0].marks["${ben}"] = "2"; flushSave()`);
    uhr(app, 3500); await laden(app, datei(B), 'merge');
    erwarte(app.E(`curClass().students.some(s => s.id === "${ben}")`) && app.E(`curClass().assess[0].marks["${ben}"]`) === '2', 'Spätere Note für gelöschten Schüler geht verloren');
    // gleichzeitig verschiedene Abwesende in derselben Stunde -> beide zählen; Austragen wirkt
    uhr(app, 4000); app.E(`curClass().absLog.push({ d: "2026-10-01", p: 0, n: 1, s: "ma", ids: ["${ben}"] }); flushSave()`);
    uhr(B, 4100); B.E(`curClass().absLog.push({ d: "2026-10-01", p: 0, n: 1, s: "ma", ids: ["${cem}"] }); flushSave()`);
    uhr(app, 4500); await laden(app, datei(B), 'merge');
    erwarte(app.E('JSON.stringify(curClass().absLog[0].ids.slice().sort())') === JSON.stringify([ben, cem].sort()), 'Gleichzeitige Abwesenheiten überschreiben sich');
    uhr(B, 4600); await laden(B, datei(app), 'merge');
    uhr(B, 5000); B.E(`curClass().absLog[0].ids = curClass().absLog[0].ids.filter(x => x !== "${cem}"); flushSave()`);
    uhr(app, 5500); await laden(app, datei(B), 'merge');
    erwarte(app.E('JSON.stringify(curClass().absLog[0].ids)') === JSON.stringify([ben]), 'Austragen einer Abwesenheit wird nicht übernommen');
    // Haken: auf B abgehakt, später auf A wieder entfernt
    uhr(B, 6000); B.E(`curClass().checks[0].done.push("${cem}"); flushSave()`);
    uhr(app, 6100); await laden(app, datei(B), 'merge');
    uhr(app, 6200); app.E(`curClass().checks[0].done = []; flushSave()`);
    uhr(B, 6300); await laden(B, datei(app), 'merge');
    erwarte(B.E('curClass().checks[0].done.length') === 0, 'Entfernter Haken kommt zurück');
    // Einstellungen: neuere werden übernommen, die Sperre nicht
    uhr(B, 6400); B.E('DB.settings.quickScale = "points"; DB.settings.lock = true; flushSave()');
    uhr(app, 6500); app.E('DB.settings.lock = false; flushSave()'); await laden(app, datei(B), 'merge');
    erwarte(app.E('DB.settings.quickScale') === 'points' && app.E('DB.settings.lock') === false, 'Einstellungen falsch übernommen');
    // Papierkorb: Klasse auf A gelöscht, auf B danach geändert -> wieder da, Papierkorb-Eintrag weg
    uhr(app, 7000); app.E('(() => { const c = curClass(); trashPush("class", c.name, c); DB.classes = []; })(); flushSave()');
    uhr(B, 7100); B.E('curClass().name = "7b neu"; flushSave()');
    uhr(app, 7200); await laden(app, datei(B), 'merge');
    erwarte(app.E('DB.classes.length') === 1 && app.E('DB.trash.length') === 0, 'Papierkorb behält die wieder vorhandene Klasse');
    app.E('trashPush("class", "x", DB.classes[0]); trashRestore(DB.trash[0].id)');
    erwarte(app.E('DB.classes.length') === 2 && app.E('DB.classes[0].id !== DB.classes[1].id'), 'Wiederherstellen erzeugt doppelte IDs');
    app.E('DB.classes.pop(); flushSave()');
    // Uhr des anderen Geräts in der Zukunft: Hinweis, Zeiten zählen als „jetzt“
    uhr(B, 7300 + 365 * 86400); B.E('curClass().name = "Zukunft"; flushSave()');
    uhr(app, 8000);
    const f = datei(B);
    app.E(`restoreParsed(${f})`);
    erwarte(!!app.$('#sync-clock'), 'Kein Hinweis auf falsche Uhr');
    app.klick('#sync-merge'); await pause(10);
    erwarte(app.E('Math.max(...Object.values(DB.stamps))') <= 8000 && app.E('DB.mod') <= 8000, 'Zeitstempel aus der Zukunft übernommen');
    app.E('curClassId = DB.classes[0].id');
    uhr(B, 8050); B.E('flushSave()');                 // Uhr von B wieder richtig – Zukunftszeiten bleiben lokal unverändert
    erwarte(B.E('Math.max(...Object.values(DB.stamps))') > 8050, 'Lokale Zeiten werden ohne Abgleich verändert');
    B.E(`restoreParsed(${datei(app)})`);
    erwarte(!!B.$('#sync-ownclock') && !!B.$('#sync-merge'), 'Kein Hinweis auf die eigene Uhr');
    B.klick('#sync-merge'); await pause(10); B.E('curClassId = DB.classes[0].id');
    erwarte(B.E('Math.max(...Object.values(DB.stamps))') <= 8050, 'Zukunftszeiten bleiben nach dem Abgleich bestehen');
    uhr(app, 8100); app.E('curClass().name = "Korrigiert"; flushSave()');
    uhr(B, 8200); await laden(B, datei(app), 'merge');
    erwarte(B.E('DB.classes[0].name') === 'Korrigiert', 'Nach falscher Uhr setzt sich die spätere Korrektur nicht durch');
  } finally { B.ende(); }
});

test('Abgleich: Vorschau, Widersprüche, Gelöschtes, alte Formate', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1000); await laden(B, datei(app), 'replace');
    const anna = sid(app, 'Anna'), ben = sid(app, 'Ben');
    // nur B ändert -> kein Widerspruch
    uhr(B, 2000); B.E(`curClass().rules.push({ id: "r1", type: "apart", a: "${anna}", b: "${ben}" }); curClass().history.push({ t: "2026-09-01T08:00:00.000Z", pairs: ["${anna}|${ben}"] }); flushSave()`);
    uhr(app, 2500); app.E(`restoreParsed(${datei(B)})`);
    const pv = app.$('#sync-preview').textContent;
    erwarte(/Regeln: 1 neu/.test(pv) && /Gemerkte Sitzordnungen: 1 neu/.test(pv) && !/beiden Geräten/.test(pv), 'Vorschau unvollständig oder falscher Widerspruch: ' + pv);
    app.klick('#sync-merge'); await pause(10); app.E('curClassId = DB.classes[0].id');
    // beide ändern dieselbe Note nach dem Abgleich -> ein Widerspruch (Einzahl)
    uhr(B, 2600); await laden(B, datei(app), 'merge');
    uhr(app, 3000); app.E(`curClass().assess[0].marks["${anna}"] = "5"; flushSave()`);
    uhr(B, 3100); B.E(`curClass().assess[0].marks["${anna}"] = "6"; flushSave()`);
    uhr(app, 3500); app.E(`restoreParsed(${datei(B)})`);
    erwarte(/1 Eintrag wurde auf beiden Geräten geändert/.test(app.$('#sync-preview').textContent), 'Widerspruch nicht (in Einzahl) gemeldet: ' + app.$('#sync-preview').textContent);
    app.klick('#sync-merge'); await pause(10); app.E('curClassId = DB.classes[0].id');
    erwarte(app.E(`curClass().assess[0].marks["${anna}"]`) === '6', 'Neuere Note nicht übernommen');
    // Gemerkte Sitzordnung nach Löschen eines Schülers nicht doppelt
    uhr(B, 3600); await laden(B, datei(app), 'merge');
    uhr(B, 3700); B.E(`curClass().students = curClass().students.filter(s => s.id !== "${ben}"); flushSave()`);
    uhr(app, 3800); await laden(app, datei(B), 'merge');
    uhr(B, 3900); await laden(B, datei(app), 'merge');
    erwarte(app.E('curClass().history.length') === 1 && B.E('curClass().history.length') === 1, 'Gemerkte Sitzordnung verdoppelt');
    // Datei-„Stand“ ist die letzte Änderung, nicht der Export
    uhr(app, 5000); app.E('curClass().obs.push({ id: "neu", sid: "' + anna + '", d: "2026-10-01", s: "", text: "x" }); flushSave()');
    uhr(B, 9000);
    app.E(`restoreParsed(${datei(B)})`);
    erwarte(!!app.$('#sync-older'), 'Ältere Datei (später exportiert) ohne Warnung');
    app.E('closeModal()');
    // Schuljahreswechsel auf A: alter Unterrichtstag von B kommt nicht zurück
    uhr(B, 9100); B.E(`curClass().lesson = { date: "2026-07-01", absent: ["${anna}"], picked: [], notes: {} }; flushSave()`);
    uhr(app, 9200); await laden(app, datei(B), 'merge');
    uhr(app, 9300); app.E('curClass().lesson = { date: "", absent: [], picked: [], notes: {} }; curClass().attendance = []; flushSave()');
    uhr(app, 9400); await laden(app, datei(B), 'merge');
    erwarte(app.E('curClass().lesson.date') === '' && app.E('curClass().attendance.length') === 0, 'Gelöschter Unterrichtstag kommt zurück');
    // sehr alte Sicherung (v1): nur Laden
    app.E(`restoreParsed({ classes: [{ name: "Alt", students: ["A"], plans: [] }] })`);
    erwarte(!app.$('#sync-merge') && !!app.$('#sync-replace') && app.$('#sheet').textContent.indexOf('sehr alten Version') >= 0, 'v1-Sicherung bietet Zusammenführen an');
    app.E('closeModal()');
  } finally { B.ende(); }
});

test('Abgleich: kompaktes Speichern und Schlüssel', app => {
  uhr(app, 1790000000); grundstand(app);
  const roh = app.E('localStorage.getItem(KEY)');
  erwarte(roh.indexOf('"~":1') >= 0 && roh.indexOf('"m|' + app.E('curClass().id') + '|w1|') < 0, 'Zeitstempel nicht kompakt gespeichert');
  const n = app.E('Object.keys(DB.stamps).length');
  erwarte(n > 5 && app.E('JSON.stringify(sanitizeDB(JSON.parse(localStorage.getItem(KEY))).stamps) === JSON.stringify(DB.stamps)'), 'Kompaktformat geht beim Laden verloren');
  erwarte(app.E('JSON.stringify(unpackStamps(packStamps({ "a|x": 5, "a|y": 7, tt: 9 })))') === '{"a|x":5,"a|y":7,"tt":9}', 'Packen und Entpacken falsch');
  erwarte(app.E('JSON.stringify(unpackStamps({ "~": 1, b: 0, g: { "": { "__proto__": "1", constructor: "2" } } }))') === '{}', 'Entpacken nicht abgesichert');
  // IDs mit „|“ führen nicht zu verwechselten Schlüsseln
  const ks = app.E('Array.from(syncEntities({ classes: [{ id: "a|b", name: "x", students: [{ id: "c", name: "y" }] }, { id: "a", name: "z", students: [{ id: "b|c", name: "w" }] }] }).keys())');
  erwarte(new Set(ks).size === ks.length && ks.length === 4, 'Schlüssel nicht eindeutig: ' + ks.join(' '));
  // Sicherung: kompakt, ohne Gerätezeit des letzten Abgleichs
  app.E('DB.syncAt = 5');
  const d = app.E('backupData()');
  erwarte(d.stamps['~'] === 1 && d.syncAt === undefined, 'Sicherung nicht kompakt oder mit Abgleichzeit');
});


test('Abgleich: Tageswechsel, Schuljahr, Historie, Gleichstand', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1000); await laden(B, datei(app), 'replace');
    const ben = sid(app, 'Ben'), cem = sid(app, 'Cem'), anna = sid(app, 'Anna');
    // Handy: Ben fehlt am 05.10.; Tablet: Cem fehlt am 05.10., am 06.10. Tageswechsel (05.10. wandert in die Anwesenheit)
    uhr(app, 2000); app.E(`curClass().lesson = { date: "2026-10-05", absent: ["${ben}"], picked: [], notes: {} }; flushSave()`);
    uhr(B, 2100); B.E(`curClass().lesson = { date: "2026-10-05", absent: ["${cem}"], picked: [], notes: {} }; flushSave()`);
    uhr(B, 2200); B.E(`(() => { const c = curClass(); c.attendance.push({ date: "2026-10-05", absent: c.lesson.absent.slice() }); c.lesson = { date: "2026-10-06", absent: [], picked: [], notes: {} }; })(); flushSave()`);
    erwarte(!B.E('Object.keys(DB.del).length'), 'Tageswechsel erzeugt Löschvermerke');
    uhr(app, 2300); await laden(app, datei(B), 'merge');
    uhr(B, 2400); await laden(B, datei(app), 'merge');
    const tag = x => x.E('JSON.stringify((curClass().attendance.find(a => a.date === "2026-10-05") || { absent: [] }).absent.slice().sort())');
    erwarte(tag(app) === JSON.stringify([ben, cem].sort()) && tag(B) === tag(app) && app.E('curClass().lesson.date') === '2026-10-06', 'Abwesenheit geht beim Tageswechsel verloren: ' + tag(app) + ' / ' + tag(B));
    // Schuljahreswechsel auf B löscht Fehlzeiten; A unverändert -> nichts kommt zurück
    uhr(B, 3000); B.E('curClass().attendance = []; curClass().lesson = { date: "", absent: [], picked: [], notes: {} }; flushSave()');
    uhr(B, 3100); B.E(`curClass().lesson = { date: "2026-09-01", absent: [], picked: [], notes: {} }; flushSave()`);
    uhr(app, 3200); await laden(app, datei(B), 'merge');
    uhr(B, 3300); await laden(B, datei(app), 'merge');
    erwarte(app.E('curClass().attendance.length') === 0 && B.E('curClass().attendance.length') === 0, 'Fehlzeiten des alten Schuljahres kehren zurück');
    // Unterricht auf B gelöscht (später), A hat ihn -> auf A gelöscht
    uhr(app, 3400); app.E(`curClass().lesson = { date: "2026-09-02", absent: ["${anna}"], picked: [], notes: {} }; flushSave()`);
    uhr(B, 3500); await laden(B, datei(app), 'merge');
    uhr(B, 3600); B.E('curClass().lesson = { date: "", absent: [], picked: [], notes: {} }; flushSave()');
    uhr(app, 3700); await laden(app, datei(B), 'merge');
    erwarte(app.E('curClass().lesson.date') === '', 'Gelöschter Unterricht bleibt bestehen');
    // Historie: 5 + 5 Einträge, höchstens 8 – beide Geräte behalten dieselben
    uhr(app, 4000); app.E('for(let i = 0; i < 5; i++) curClass().history.push({ t: "2026-09-0" + (i + 1) + "T08:00:00.000Z", pairs: [] }); flushSave()');
    uhr(B, 4000); B.E('for(let i = 0; i < 5; i++) curClass().history.push({ t: "2026-09-1" + i + "T09:00:00.000Z", pairs: [] }); flushSave()');
    for(let r = 0; r < 2; r++){ uhr(app, 4100 + r * 100); await laden(app, datei(B), 'merge'); uhr(B, 4150 + r * 100); await laden(B, datei(app), 'merge'); }
    const hist = x => x.E('JSON.stringify(curClass().history.map(h => h.t))');
    erwarte(hist(app) === hist(B) && app.E('curClass().history.length') === 8, 'Gemerkte Sitzordnungen laufen auseinander');
    app.E(`restoreParsed(${datei(B)})`);
    erwarte(/ändert sich nichts/.test(app.$('#sync-preview').textContent), 'Historie meldet bei jedem Abgleich Änderungen');
    app.E('closeModal()');
    // Gleichstand in derselben Sekunde: beide Geräte entscheiden gleich
    uhr(app, 5000); uhr(B, 5000);
    app.E(`curClass().assess[0].marks["${anna}"] = "4"; flushSave()`); B.E(`curClass().assess[0].marks["${anna}"] = "5"; flushSave()`);
    const fa = datei(app), fb = datei(B);
    uhr(app, 5100); await laden(app, fb, 'merge'); uhr(B, 5100); await laden(B, fa, 'merge');
    erwarte(app.E(`curClass().assess[0].marks["${anna}"]`) === B.E(`curClass().assess[0].marks["${anna}"]`), 'Gleichstand wird unterschiedlich entschieden');
  } finally { B.ende(); }
});

test('Abgleich: Vorrang lokal, Widersprüche, Verweise ohne Wiederkehr', async app => {
  uhr(app, 1000); grundstand(app);
  const cid = app.E('curClass().id'), anna = sid(app, 'Anna');
  // R hat die Bewertung früh gelöscht, L hat danach eine Note ergänzt -> bleibt
  const R1 = app.E(`(() => { const d = sanitizeDB(JSON.parse(JSON.stringify(DB))); d.classes[0].assess = []; d.del = { [hk("a|${cid}|w1")]: 2000 }; d.mod = 2000; return d; })()`);
  uhr(app, 3000); app.E(`curClass().assess[0].marks["${anna}"] = "1"; flushSave()`);
  uhr(app, 3500);
  erwarte(app.E(`mergeDB(DB, ${JSON.stringify(R1)}).db.classes[0].assess.length`) === 1, 'Spätere lokale Note geht durch frühere Löschung verloren');
  // Sperre aus der Datei wird nie übernommen, auch wenn die Datei neuere Einstellungen hat
  const R2 = app.E('(() => { const d = sanitizeDB(JSON.parse(JSON.stringify(DB))); d.settings.lock = true; d.settings.quickScale = "smiley"; d.stamps.set = 9999; return d; })()');
  uhr(app, 10000);
  const m2 = app.E(`(() => { const r = mergeDB(DB, ${JSON.stringify(R2)}).db; return [r.settings.lock, r.settings.quickScale]; })()`);
  erwarte(m2[0] === false && m2[1] === 'smiley', 'Sperre aus der Datei übernommen: ' + JSON.stringify(m2));
  // Zeiten in der Zukunft gewinnen beim Vergleich nicht
  const R3 = app.E(`(() => { const d = sanitizeDB(JSON.parse(JSON.stringify(DB))); d.classes[0].assess[0].marks["${anna}"] = "6"; d.stamps["m|${cid}|w1|${anna}"] = 99999999; return d; })()`);
  uhr(app, 10100); app.E(`curClass().assess[0].marks["${anna}"] = "2"; flushSave()`);
  erwarte(app.E(`mergeDB(DB, ${JSON.stringify(R3)}).db.classes[0].assess[0].marks["${anna}"]`) === '2', 'Zukunftszeit gewinnt beim Zusammenführen');
  // Widersprüche nur, wenn beide seit dem letzten Abgleich/Export geändert haben
  app.E('DB.syncAt = 10200');
  const R4 = app.E(`(() => { const d = sanitizeDB(JSON.parse(JSON.stringify(DB))); d.classes[0].assess[0].marks["${anna}"] = "3"; d.stamps["m|${cid}|w1|${anna}"] = 10300; return d; })()`);
  erwarte(app.E(`mergeDB(DB, ${JSON.stringify(R4)}).report.conflicts`) === 0, 'Einseitige Änderung als Widerspruch gemeldet');
  uhr(app, 10400); app.E(`curClass().assess[0].marks["${anna}"] = "1"; flushSave()`);
  erwarte(app.E(`mergeDB(DB, ${JSON.stringify(R4)}).report.conflicts`) === 1, 'Echter Widerspruch nicht gezählt');
  // ohne früheren Abgleich keine (womöglich falschen) Widersprüche
  app.E('DB.syncAt = 0');
  erwarte(app.E(`mergeDB(DB, ${JSON.stringify(R4)}).report.conflicts`) === 0, 'Widersprüche ohne gemeinsamen Ausgangsstand');
  // Stunde einer gelöschten Klasse holt die Klasse nicht zurück
  const R5 = app.E(`(() => { const d = sanitizeDB(JSON.parse(JSON.stringify(DB))); d.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    d.lessons = [{ id: "L1", day: 0, period: 0, span: 1, week: "", subjectId: "ma", classId: "${cid}", roomId: "", planId: "" }]; d.stamps["les|L1"] = 20000; return d; })()`);
  uhr(app, 15000); app.E('DB.classes = []; flushSave()');
  uhr(app, 21000);
  const m5 = app.E(`(() => { const r = mergeDB(DB, ${JSON.stringify(R5)}).db; return [r.classes.length, r.lessons.length]; })()`);
  erwarte(m5[0] === 0 && m5[1] === 1, 'Stunde holt gelöschte Klasse zurück: ' + JSON.stringify(m5));
});

test('Abgleich: eigene Datei ändert nichts, Zahlen im Vergleich', async app => {
  uhr(app, 1000); grundstand(app);
  const f = datei(app);
  // Schüler gelöscht – seine Noten liegen bis zum Neuladen noch im Speicher (für Rückgängig)
  uhr(app, 2000); app.E(`curClass().students = curClass().students.filter(s => s.name !== "Dana"); flushSave()`);
  const f2 = datei(app);
  app.E(`restoreParsed(${f2})`);
  erwarte(/ändert sich nichts/.test(app.$('#sync-preview').textContent), 'Eigene Datei meldet Änderungen: ' + app.$('#sync-preview').textContent);
  erwarte(/1 Klasse ·/.test(app.$('#sync-cmp').textContent) && /3 Namen/.test(app.$('#sync-cmp').textContent), 'Zahlen im Vergleich falsch: ' + app.$('#sync-cmp').textContent);
  app.E('closeModal()');
});

test('Abgleich: Speichern großer Klassen bleibt schnell', app => {
  uhr(app, 1000);
  for(let k = 0; k < 6; k++) klasseMitNamen(app, 'K' + k, Array.from({ length: 30 }, (_, i) => 'Kind ' + k + '-' + i));
  app.E(`(() => { DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    DB.classes.forEach(c => { c.assess = []; for(let i = 0; i < 40; i++){ const m = {}; c.students.forEach((s, j) => { m[s.id] = String(1 + (i + j) % 6); });
      c.assess.push({ id: "a" + i, subjectId: "ma", title: "T" + i, date: "2026-09-10", kind: "other", scale: "grade", weight: 1, marks: m }); } }); })(); flushSave()`);
  const ms = app.E('(() => { const t = performance.now(); for(let i = 0; i < 5; i++) flushSave(); return (performance.now() - t) / 5; })()');
  erwarte(ms < 60, 'Speichern ohne Änderung zu langsam: ' + Math.round(ms) + ' ms');
  const ms2 = app.E('(() => { const t = performance.now(); DB.classes[2].assess[3].marks[DB.classes[2].students[0].id] = "1"; flushSave(); return performance.now() - t; })()');
  erwarte(ms2 < 120, 'Speichern einer Note zu langsam: ' + Math.round(ms2) + ' ms');
  const size = app.E('localStorage.getItem(KEY).length'), ohne = app.E('JSON.stringify(Object.assign({}, DB, { stamps: {}, del: {} })).length');
  erwarte(size < ohne * 2, 'Zeitstempel brauchen zu viel Platz: ' + size + ' zu ' + ohne);
});

test('Übertragen auf ein anderes Gerät', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    uhr(B, 1500); B.E('curClass().students.find(s => s.name === "Ben").name = "Bennet"; flushSave()');
    klasseMitNamen(B, '9c', ['Xaver', 'Yara']); B.E('flushSave(); goHome()');
    app.E('goHome(); DB.lastBackup = "2026-01-01T00:00:00.000Z"');
    erwarte(!!app.$('#btn-transfer') && /anderes Gerät/.test(app.$('#btn-transfer').textContent), 'Knopf „Auf anderes Gerät übertragen“ fehlt');
    const box = downloadAbfangen(app);
    app.klick('#btn-transfer');
    erwarte(!!app.$('#tr-pw1') && !!app.$('#tr-send') && !app.$('#bk-plain') && app.E('document.querySelectorAll("#sheet ol li").length') === 3, 'Übertragen: Passwort, Anleitung oder Knopf fehlt – oder ungeschützt möglich');
    erwarte(/Zusammenführen/.test(app.$('#sheet ol').textContent) && /Sicherung laden/.test(app.$('#sheet ol').textContent), 'Anleitung nennt die Knöpfe auf dem anderen Gerät nicht');
    app.$('#tr-pw1').value = 'kurz'; app.$('#tr-pw2').value = 'kurz';
    app.klick('#tr-send'); await pause(50);
    erwarte(!box.blob && /8 Zeichen/.test(app.$('#toast').textContent), 'Zu kurzes Passwort beim Übertragen akzeptiert');
    app.$('#tr-pw1').value = 'geheim-geheim'; app.$('#tr-pw2').value = 'geheim-anders';
    app.klick('#tr-send'); await pause(50);
    erwarte(!box.blob && /stimmen nicht/.test(app.$('#toast').textContent), 'Abweichende Passwörter beim Übertragen akzeptiert');
    app.$('#tr-pw2').value = 'geheim-geheim';
    uhr(app, 2000); app.E('curClass().students.find(s => s.name === "Ben").name = "Benno"');   // noch nicht gespeichert, aber neuer als „Bennet“ auf B
    app.$('#tr-pw2').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));   // Enter im zweiten Feld sendet
    for(let i = 0; i < 100 && !box.blob; i++) await pause(30);
    erwarte(!!box.blob, 'Übertragungsdatei nicht erzeugt');
    if(!box.blob) return;
    erwarte(/^fairseat-uebertragung-\d{4}-\d{2}-\d{2}\.json$/.test(box.name), 'Dateiname: ' + box.name);
    erwarte(!app.$('#modal').classList.contains('on') && /Übertragungsdatei/.test(app.$('#toast').textContent), 'Blatt bleibt offen oder keine Rückmeldung');
    erwarte(app.E('DB.lastBackup') === '2026-01-01T00:00:00.000Z', 'Übertragung zählt fälschlich als Sicherung');
    const text = await blobText(app, box.blob);
    erwarte(text.indexOf('Anna') < 0 && text.indexOf('"students"') < 0 && text.indexOf('"enc"') >= 0, 'Übertragungsdatei enthält Klartext');
    // Gerät B: laden, Passwort, Zusammenführen – eigene Klasse bleibt
    uhr(B, 3000);
    dateiWaehlen(B, '#filepick', box.name, text); await pause(60);
    erwarte(!!B.$('#bk-pw-open'), 'Gerät B fragt nicht nach dem Passwort');
    B.$('#bk-pw-open').value = 'geheim-geheim'; B.sheetOk();
    for(let i = 0; i < 150 && !B.$('#sync-merge'); i++) await pause(30);
    erwarte(!!B.$('#sync-merge'), 'Gerät B bietet kein Zusammenführen an');
    B.klick('#sync-merge'); await pause(10);
    const namen = B.E('DB.classes.map(c => c.name).sort().join(",")');
    erwarte(namen === '7b,9c', 'Nach dem Übertragen fehlen Klassen: ' + namen);
    erwarte(B.E('DB.classes.find(c => c.name === "7b").students.some(s => s.name === "Benno")'), 'Ungespeicherte letzte Änderung nicht übertragen: ' + B.E('DB.classes.find(c => c.name === "7b").students.map(s => s.name).join()'));
    // Sperre: ohne Entsperren kein Übertragen
    const m = bioMock(app); app.E('DB.settings.lock = true; lockOpen = false'); m.next = 'abbruch';
    app.klick('#btn-transfer');
    erwarte(!app.$('#tr-pw1') && m.calls === 1, 'Übertragen ohne Entsperren möglich');
    m.next = 'ok'; app.klick('#btn-transfer');
    erwarte(!!app.$('#tr-pw1'), 'Nach dem Entsperren kein Übertragen');
    // länger im Hintergrund: Übertragen- und Sicherungsblatt schließen sich, nichts wird erzeugt
    const box2 = downloadAbfangen(app);
    app.$('#tr-pw1').value = 'geheim-geheim'; app.$('#tr-pw2').value = 'geheim-geheim';
    app.E('lockPause(); lockPausedAt = Date.now() - 6 * 60 * 1000; lockResume()');
    erwarte(!app.$('#tr-pw1') && !app.$('#modal').classList.contains('on'), 'Übertragen bleibt nach automatischer Sperre offen');
    m.next = 'ok'; app.klick('#btn-backup');
    erwarte(!!app.$('#bk-plain'), 'Sicherung nach Entsperren nicht offen');
    app.E('lockPause(); lockPausedAt = Date.now() - 6 * 60 * 1000; lockResume()');
    erwarte(!app.$('#bk-plain') && !app.$('#modal').classList.contains('on'), 'Sicherung bleibt nach automatischer Sperre offen');
    // gesperrt, während verschlüsselt wird: nichts verlässt das Gerät
    m.next = 'ok'; app.klick('#btn-transfer');
    app.$('#tr-pw1').value = 'geheim-geheim'; app.$('#tr-pw2').value = 'geheim-geheim';
    app.klick('#tr-send'); app.E('lockOpen = false');
    await pause(1500);
    erwarte(!box2.blob, 'Nach dem Sperren trotzdem übertragen');
    app.E('closeModal()');
  } finally { B.ende(); }
});

test('Übertragen in der App öffnet das Teilen-Menü', async app => {
  klasseMitNamen(app, '7b', ['Anna']);
  app.E('goHome()');
  const calls = [];
  app.E('window.cordova = { platformId: "ios" }');
  app.w.plugins = { socialsharing: { shareWithOptions(o){ calls.push(o); } } };
  app.klick('#btn-transfer');
  app.$('#tr-pw1').value = 'geheim-geheim'; app.$('#tr-pw2').value = 'geheim-geheim';
  app.klick('#tr-send');
  for(let i = 0; i < 100 && !calls.length; i++) await pause(30);
  erwarte(calls.length === 1 && /^df:fairseat-uebertragung-[\d-]+\.json;data:application\/json;base64,/.test(calls[0].files[0]), 'Teilen-Menü nicht mit der Datei geöffnet: ' + (calls[0] && calls[0].files[0].slice(0, 70)));
  // Blatt während des Verschlüsselns geschlossen: nichts wird geteilt
  app.klick('#btn-transfer');
  app.$('#tr-pw1').value = 'geheim-geheim'; app.$('#tr-pw2').value = 'geheim-geheim';
  app.klick('#tr-send'); app.E('closeModal()');
  await pause(1500);
  erwarte(calls.length === 1, 'Nach dem Schließen trotzdem geteilt');
  // Sicherung: Abbrechen während des Verschlüsselns teilt nichts und zählt nicht als Sicherung
  app.E('DB.lastBackup = ""');
  app.klick('#btn-backup');
  app.$('#bk-pw1').value = 'geheim-geheim'; app.$('#bk-pw2').value = 'geheim-geheim';
  app.klick('#bk-enc'); app.E('closeModal()');
  await pause(1500);
  erwarte(calls.length === 1 && app.E('DB.lastBackup') === '', 'Sicherung nach Abbrechen trotzdem geteilt');
});

/* ---------- 32. Klassenarbeit mit Aufgaben, Kursheft, Fehlzeiten, Strichlisten ---------- */
const feld = (app, sel, v) => { const f = app.$(sel); f.value = v; f.dispatchEvent(new app.w.Event('input')); if(f.onchange) f.onchange(); };
function klassenarbeit(app){
  bewertungsKlasse(app);
  app.E(`curClass().assess = [{ id: "w1", subjectId: "ma", title: "KA 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: {} }]; openAssess("w1")`);
}
test('Klassenarbeit: Aufgaben, Notenschlüssel, Punkte', async app => {
  klassenarbeit(app);
  erwarte(!!app.$('#a-tasks') && /Punkte je Aufgabe/.test(app.$('#a-tasks').textContent), 'Kein Einstieg für Aufgabenpunkte');
  app.klick('#a-tasks');
  erwarte(app.$$('#tk-list .tkrow').length === 3 && app.$$('#tk-key .tkrow').length === 5, 'Vorgabe: 3 Aufgaben und 5 Grenzen erwartet');
  erwarte(app.$$('#tk-preset button')[0].classList.contains('on') && !app.$$('#tk-preset button')[1].classList.contains('on'), 'Gewählte Vorlage nicht markiert');
  feld(app, '#tk-max-2', '20'); feld(app, '#tk-name-2', '3a');
  erwarte(/40 Punkte/.test(app.$('#tk-sum').textContent) && /ab 37 P/.test(app.$('#tk-key').textContent), 'Summe oder Schlüssel in Punkten falsch: ' + app.$('#tk-key').textContent.slice(0, 60));
  app.sheetOk();
  erwarte(app.E('curAssess().tasks.length') === 3 && app.E('taskMax(curAssess())') === 40 && app.E('curAssess().tasks[2].name') === '3a', 'Aufgaben nicht gespeichert');
  erwarte(app.E('JSON.stringify(keyNeeds(curAssess()))') === '[37,32.5,27,20,12]', 'Grenzen falsch gerundet: ' + app.E('JSON.stringify(keyNeeds(curAssess()))'));
  erwarte(!app.$$('#assess-pad button').some(b => b.dataset.tok === '2') && !!app.$('#a-pts'), 'Tastenfeld statt Punkte-Eingabe');
  // Anna: Zeile antippen öffnet die Punkte
  const anna = sid(app, 'Anna'), ben = sid(app, 'Ben'), cem = sid(app, 'Cem'), dana = sid(app, 'Dana');
  app.klick(`#assess-list .arow[data-sid="${anna}"]`);
  erwarte(!!app.$('#pt-0') && app.$$('#pt-grid input').length === 3, 'Punkteblatt nicht geöffnet');
  feld(app, '#pt-0', '10'); feld(app, '#pt-1', '10'); feld(app, '#pt-2', '17');
  erwarte(/37 von 40/.test(app.$('#pt-res').textContent) && /Note 1/.test(app.$('#pt-res').textContent), 'Vorschau falsch: ' + app.$('#pt-res').textContent);
  app.klick('#pt-next');
  erwarte(app.E(`curAssess().marks["${anna}"]`) === '1' && app.$('#sheet h3').textContent.indexOf('Ben') === 0, 'Note nicht berechnet oder nicht weiter zum nächsten Namen');
  feld(app, '#pt-0', '5'); feld(app, '#pt-1', '5');
  app.$('#pt-1').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));   // Enter: nächstes Feld
  erwarte(app.w.document.activeElement === app.$('#pt-2'), 'Enter springt nicht ins nächste Feld');
  app.$('#pt-2').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));   // letztes Feld: weiter
  erwarte(app.E(`curAssess().marks["${ben}"]`) === '6' && app.E(`JSON.stringify(curAssess().pts["${ben}"])`).indexOf('5') > 0, 'Ben: 10 Punkte müssen 6 ergeben');
  feld(app, '#pt-0', '9,5'); feld(app, '#pt-1', '10'); feld(app, '#pt-2', '10.3');
  app.klick('#pt-next');
  erwarte(app.E(`studentPoints(curAssess(), "${cem}")`) === 30 && app.E(`curAssess().marks["${cem}"]`) === '3', 'Komma oder halbe Punkte falsch: ' + app.E(`studentPoints(curAssess(), "${cem}")`));
  // Dana: zu viele Punkte werden abgelehnt, dann „fehlt“
  feld(app, '#pt-0', '11'); app.klick('#pt-save');
  erwarte(!!app.$('#pt-0') && /höchstens 10/.test(app.$('#toast').textContent) && !app.E(`curAssess().marks["${dana}"]`), 'Zu viele Punkte angenommen');
  app.klick('#pt-miss');
  erwarte(app.E(`curAssess().marks["${dana}"]`) === 'x' && !app.E(`curAssess().pts["${dana}"]`), '„fehlt“ nicht gesetzt');
  app.E('closeModal(); renderAssess()');
  erwarte(/Ben.*10 P/.test(app.$('#assess-list').textContent), 'Punkte fehlen in der Liste');
  // Notenspiegel-Warnung (Ben 6 von 3 Arbeiten = 33 %) und Auswertung je Aufgabe
  erwarte(!!app.$('#a-fail') && /33 %/.test(app.$('#a-fail').textContent) && /30 %/.test(app.$('#a-fail').textContent), 'Warnung über 30 % fehlt');
  erwarte(!!app.$('#tk-stats') && app.$$('#tk-stats .tkbar').length === 3, 'Lösungsquote je Aufgabe fehlt');
  // Tendenz
  app.E('curAssess().key.tend = true; applyTaskMarks(curAssess())');
  erwarte(app.E(`curAssess().marks["${anna}"]`) === '1-' && app.E(`curAssess().marks["${cem}"]`) === '3', 'Tendenz falsch: ' + app.E(`curAssess().marks["${anna}"]`) + ' ' + app.E(`curAssess().marks["${cem}"]`));
  erwarte(app.E('keyGrade(curAssess(), 40)') === '1+' && app.E('keyGrade(curAssess(), 11.5)') === '6' && app.E('keyGrade(curAssess(), 12)') === '5-', 'Ränder der Tendenz falsch');
  // „Löschen“ im Tastenfeld nimmt auch die Punkte weg
  app.E(`assessSel = "${ben}"; setMark(null)`);
  erwarte(!app.E(`curAssess().marks["${ben}"]`) && !app.E(`curAssess().pts["${ben}"]`), 'Löschen lässt Punkte stehen');
  // Aufgabe entfernen: Punkte dieser Aufgabe weg, Note neu
  app.klick('#a-tasks');
  app.klick(app.$$('#tk-list .iconbtn')[2]);
  app.sheetOk();
  erwarte(app.E('taskMax(curAssess())') === 20 && app.E(`studentPoints(curAssess(), "${anna}")`) === 20 && app.E(`curAssess().marks["${anna}"]`) === '1+', 'Nach dem Entfernen einer Aufgabe nicht neu berechnet: ' + app.E(`curAssess().marks["${anna}"]`));
  // Schnellbewertung auf einer Bewertung mit Punkten: die Punkte weichen, die Note bleibt
  app.E(`(() => { const a = curAssess(); a.auto = true; a.date = isoDay(new Date()); a.kind = "other"; })()`);
  const qb = app.w.document.createElement('div'); app.w.document.body.appendChild(qb);
  app.E('window.__qb = document.body.lastChild');
  app.E(`quickPad(window.__qb, curClass(), studentById(curClass(), "${cem}"), () => {}, isoDay(new Date()))`);
  const q4 = app.$$('#sheet button, body > div:last-child button').find(b => b.dataset.tok === '4');
  if(q4) q4.click();
  erwarte(!!q4 && app.E(`curAssess().marks["${cem}"]`) === '4' && !app.E(`(curAssess().pts || {})["${cem}"]`) && app.E(`sanitizeDB(JSON.parse(JSON.stringify(DB))).classes[0].assess[0].marks["${cem}"]`) === '4', 'Schnellnote wird beim Laden überschrieben');
  app.E(`(() => { const a = curAssess(); delete a.auto; a.kind = "written"; a.date = "2026-09-10"; a.pts["${cem}"] = { [a.tasks[0].id]: 9.5, [a.tasks[1].id]: 10 }; applyTaskMarks(a); })(); window.__qb.remove()`);
  // Speichern und Laden: Punkte bleiben, Note wird aus Punkten abgeleitet, Unsinn wird begrenzt
  const roh = app.E(`(() => { const d = JSON.parse(JSON.stringify(DB)); const a = d.classes[0].assess[0];
    a.marks["${anna}"] = "5"; a.pts["${anna}"][a.tasks[0].id] = 99; a.pts["fremd"] = { x: 1 }; a.key.th = [10, 20, 30, 40, 50];
    const o = sanitizeDB(d).classes[0].assess[0]; return JSON.stringify([o.marks["${anna}"], o.pts["${anna}"][o.tasks[0].id], !!o.pts.fremd, o.key.th[0]]); })()`);
  erwarte(roh === '["1+",10,false,92]', 'Prüfung beim Laden unvollständig: ' + roh);
  erwarte(app.E('JSON.stringify(sanitizeDB({ v: 2, classes: [{ name: "x", students: [], assess: [{ id: "a", subjectId: "ma", scale: "grade", marks: {} }] }] }).classes[0].assess[0]).indexOf("tasks")') < 0, 'Bewertungen ohne Aufgaben bekommen leere Felder');
  // Punkte nur zu einer entfernten Aufgabe (z. B. nach dem Abgleich): Note entfällt; „fehlt“ bleibt
  const weg = app.E(`(() => { const d = JSON.parse(JSON.stringify(DB)); const a = d.classes[0].assess[0];
    a.pts["${ben}"] = { alt: 3 }; a.marks["${ben}"] = "6"; a.pts["${dana}"] = { alt: 1 };
    const o = sanitizeDB(d).classes[0].assess[0]; return JSON.stringify([o.marks["${ben}"] || null, !!o.pts["${ben}"], o.marks["${dana}"]]); })()`);
  erwarte(weg === '[null,false,"x"]', 'Note ohne Punkte bleibt stehen: ' + weg);
  // „Mitarbeit heute“ (automatisch) bietet keine Aufgaben an
  app.E(`curClass().assess.push({ id: "auto1", subjectId: "ma", title: "Mitarbeit", date: "2026-09-11", kind: "other", scale: "grade", weight: 1, marks: {}, auto: true }); openAssess("auto1")`);
  erwarte(!app.$('#a-tasks'), 'Aufgaben bei automatischer Mitarbeitsnote angeboten');
  app.E('openAssess("w1")');
  // Auswertung als Excel
  const box = downloadAbfangen(app);
  app.E('renderAssess()'); app.klick('#a-xlsx');
  erwarte(box.blob && /KA_1\.xlsx$/.test(box.name), 'Auswertung nicht exportiert: ' + box.name);
  // Aufgaben ganz entfernen: Noten bleiben
  app.klick('#a-tasks'); app.klick('#tk-off'); app.sheetOk();
  erwarte(!app.E('hasTasks(curAssess())') && app.E(`curAssess().marks["${anna}"]`) === '1+' && !!app.$$('#assess-pad button').find(b => b.dataset.tok === '2'), 'Entfernen der Aufgaben falsch');
});

test('Klassenarbeit: Punkte im Sitzplan und Punkteskala', async app => {
  klassenarbeit(app);
  neuerPlan(app, 0);
  app.E(`(() => { const a = curClass().assess[0]; a.tasks = [{ id: "t1", name: "1", max: 10 }, { id: "t2", name: "2", max: 10 }]; a.key = defaultKey("grade"); })(); startGradeMode("w1")`);
  erwarte(!!app.$('#gb-pts') && !app.$$('#gb-pad button').some(b => b.dataset.tok === '1'), 'Im Plan kein Punkte-Knopf');
  const seats = app.E('JSON.stringify(curPlan().desks.filter(d => d.studentId).map(d => d.studentId))');
  const first = JSON.parse(seats)[0];
  app.E(`pickGradeSeat("${first}")`);
  erwarte(!!app.$('#pt-0'), 'Tipp auf Platz öffnet keine Punkte');
  feld(app, '#pt-0', '10'); feld(app, '#pt-1', '9');
  app.klick('#pt-next');
  erwarte(app.E(`curAssess() || gradeAssess()`) && app.E(`gradeAssess().marks["${first}"]`) === '1' && !!app.$('#pt-0') && app.E('gradeSel') !== first, 'Note im Plan nicht gesetzt oder nicht zum nächsten Platz');
  app.E('closeModal(); endGradeMode()');
  // Punkteskala (Oberstufe): Abitur-Raster
  app.E(`curClass().assess.push({ id: "w2", subjectId: "ma", title: "Klausur", date: "2026-09-12", kind: "written", scale: "points", weight: 1, marks: {},
    tasks: [{ id: "a", name: "1", max: 100 }], key: defaultKey("points"), pts: {} }); openAssess("w2")`);
  const P = v => app.E(`keyGrade(curAssess(), ${v})`);
  erwarte(P(95) === '15' && P(94.5) === '14' && P(50) === '6' && P(45) === '5' && P(20) === '1' && P(19.5) === '0', 'Abitur-Raster falsch: ' + [P(95), P(94.5), P(50), P(20), P(19.5)].join());
  app.klick('#a-tasks');
  erwarte(app.$$('#tk-key .tkrow').length === 15 && !app.$('#tk-tend'), 'Punkteskala: 15 Grenzen, keine Tendenz');
  app.E('closeModal()');
});

test('Kursheft: Thema, Hausaufgabe, letzte Stunde', async app => {
  bewertungsKlasse(app);
  neuerPlan(app, 0);
  app.E('DB.settings.lesson = true; setLesson(true)');
  app.klick('#lb-journal');
  erwarte(!!app.$('#j-topic') && !app.$('#j-prev'), 'Kursheft nicht geöffnet oder Vorschau ohne Eintrag');
  app.$('#j-subj').value = 'ma';
  app.$('#j-topic').value = 'Brüche erweitern'; app.$('#j-hw').value = 'S. 12 Nr. 3';
  app.$('#j-date').value = '2026-09-28';
  app.sheetOk();
  erwarte(app.E('curClass().journal.length') === 1 && app.E('curClass().journal[0].s') === 'ma' && app.E('curClass().journal[0].d') === '2026-09-28', 'Eintrag nicht gespeichert');
  app.klick('#lb-journal'); app.$('#j-subj').value = 'ma';
  app.E('closeModal(); openJournal(curClass(), null, "ma")');
  erwarte(!!app.$('#j-prev') && /S\. 12 Nr\. 3/.test(app.$('#j-prev').textContent), 'Hausaufgabe der letzten Stunde fehlt');
  app.$('#j-topic').value = '  '; app.$('#j-hw').value = '';
  app.sheetOk();
  erwarte(app.E('curClass().journal.length') === 1, 'Leerer Eintrag gespeichert');
  app.E('openJournalList(curClass(), "")');
  erwarte(app.$$('#j-list .jcard').length === 1 && /Brüche/.test(app.$('#j-list').textContent), 'Liste fehlt');
  const box = downloadAbfangen(app);
  app.klick('#j-xlsx');
  erwarte(box.blob && /Kursheft\.xlsx$/.test(box.name), 'Kursheft nicht exportiert: ' + box.name);
  // bearbeiten und löschen
  app.klick('#j-list .jcard');
  erwarte(app.$('#j-topic').value === 'Brüche erweitern', 'Bearbeiten zeigt den Eintrag nicht');
  app.$('#j-hw').value = 'S. 13 Nr. 1'; app.sheetOk();
  erwarte(app.E('curClass().journal.length') === 1 && app.E('curClass().journal[0].hw') === 'S. 13 Nr. 1', 'Bearbeiten legt neuen Eintrag an');
  app.E('openJournal(curClass(), curClass().journal[0])'); app.klick('#j-del'); app.sheetOk();
  erwarte(app.E('curClass().journal.length') === 0, 'Löschen geht nicht');
  // Sonntag (ttDays kennt nur Mo–Sa)
  erwarte(app.E('fmtDateLong("2026-10-04")') === 'So, 04.10.' && app.E('fmtDateLong("2026-10-05")') === 'Mo, 05.10.', 'Wochentag falsch: ' + app.E('fmtDateLong("2026-10-04")'));
  // Prüfung beim Laden
  const n = app.E(`sanitizeDB({ v: 2, classes: [{ name: "x", students: [], journal: [{ d: "2026-09-01", topic: "a" }, { d: "kaputt", topic: "b" }, { d: "2026-09-02", topic: " ", hw: "" }, { d: "2026-09-03", p: 99, hw: "h" }] }] }).classes[0].journal.map(e => e.d + ":" + e.p).join()`);
  erwarte(n === '2026-09-01:-1,2026-09-03:-1', 'Kursheft beim Laden: ' + n);
});

test('Fehlzeiten: Verspätung und entschuldigt', async app => {
  bewertungsKlasse(app);
  neuerPlan(app, 0);
  app.E('DB.settings.lesson = true; setLesson(true)');
  const anna = sid(app, 'Anna');
  app.E(`openLessonSheet(curPlan().desks.find(d => d.studentId === "${anna}"))`);
  app.klick('#lesson-late button[data-m="10"]');
  erwarte(app.$('#lesson-late button[data-m="10"]').classList.contains('on'), 'Minuten nicht gewählt');
  app.sheetOk();
  erwarte(app.E('curClass().late.length') === 1 && app.E('curClass().late[0].min') === 10, 'Verspätung nicht gespeichert');
  const seat = app.E(`curPlan().desks.find(d => d.studentId === "${anna}").id`);
  erwarte(app.$(`#stage .item[data-id="${seat}"] .latemark`) && app.$(`#stage .item[data-id="${seat}"] .latemark`).textContent === '+10', 'Platz zeigt die Verspätung nicht');
  erwarte(/10 Min\. zu spät/.test(app.$(`#stage .item[data-id="${seat}"]`).getAttribute('aria-label')), 'Vorlesen nennt die Verspätung nicht');
  app.E('setPresenting(true)');
  erwarte(!app.$(`#stage .item[data-id="${seat}"] .latemark`), 'Verspätung am Beamer sichtbar');
  app.E('setPresenting(false)');
  // abwesend nimmt die Verspätung weg
  app.E(`openLessonSheet(curPlan().desks.find(d => d.studentId === "${anna}"))`);
  erwarte(app.$('#lesson-late button[data-m="10"]').classList.contains('on'), 'Gespeicherte Minuten nicht gezeigt');
  app.klick('#sheet .tile.wide');
  erwarte(!app.$('#lesson-late button.on'), 'Abwesend lässt die Minuten markiert');
  app.sheetOk();
  erwarte(app.E('curClass().late.length') === 0 && app.E(`curClass().lesson.absent.indexOf("${anna}")`) >= 0, 'Abwesend und verspätet zugleich');
  // entschuldigen
  app.E(`curClass().absLog = [{ d: "2026-09-14", p: 0, n: 2, s: "ma", ids: ["${anna}"] }]; curClass().attendance = [{ date: "2026-09-14", absent: ["${anna}"] }]; curClass().lesson.absent = []`);
  app.E(`openAbsences(curClass(), studentById(curClass(), "${anna}"))`);
  erwarte(app.$$('#abs-days .setrow').length === 1, 'Fehltag fehlt');
  app.klick('#abs-days .setrow');
  erwarte(app.E(`isExcused(curClass(), "2026-09-14", "${anna}")`) === true && /2 entschuldigt/.test(app.$('#abs-sum').textContent), 'Entschuldigung nicht gespeichert: ' + app.$('#abs-sum').textContent);
  erwarte(app.E(`JSON.stringify(absenceSummary(curClass(), "${anna}"))`) === '{"days":1,"daysExc":1,"lessons":2,"lessonsExc":2,"late":0,"lateMin":0}', 'Summe falsch: ' + app.E(`JSON.stringify(absenceSummary(curClass(), "${anna}"))`));
  // Anwesenheitsblatt: Name antippen öffnet die Fehlzeiten
  app.E('closeModal()'); app.klick('#btn-attendance');
  app.klick(`#abs-missed [data-sid="${anna}"]`);
  erwarte(!!app.$('#abs-days'), 'Kein Weg zu den Fehlzeiten');
  // Prüfung beim Laden
  const r = app.E(`JSON.stringify((d => [d.exc, d.late.map(e => e.min)])(sanitizeDB({ v: 2, classes: [{ name: "x", students: [{ id: "s1", name: "A" }],
    exc: ["2026-09-14|s1", "2026-09-14|s1", "kaputt|s1", "2026-09-14|weg"], late: [{ d: "2026-09-14", sid: "s1", min: 5 }, { d: "2026-09-14", sid: "s1", min: 0 }, { d: "2026-09-14", sid: "s1", min: 999 }] }] }).classes[0]))`);
  erwarte(r === '[["2026-09-14|s1"],[5]]', 'Fehlzeiten beim Laden: ' + r);
});

test('Strichliste: Hausaufgaben vergessen', async app => {
  bewertungsKlasse(app);
  neuerPlan(app, 0);
  app.E('DB.settings.lesson = true; setLesson(true)');
  app.klick('#lb-check');
  const q = app.$$('#tl-quick button');
  erwarte(q.length === 2 && q[0].textContent === 'Hausaufgaben vergessen', 'Schnellwahl fehlt');
  app.klick(q[0]);
  erwarte(app.E('isTally(checkCur())') && app.E('checkCur().title') === 'Hausaufgaben vergessen', 'Strichliste nicht gestartet');
  const anna = sid(app, 'Anna'), ben = sid(app, 'Ben');
  app.E(`toggleCheck("${anna}"); toggleCheck("${anna}"); toggleCheck("${ben}")`);
  erwarte(app.E('checkCur().ticks.length') === 1 && /heute 1 · insgesamt 1/.test(app.$('#cb-meta').textContent), 'Tippen zählt falsch: ' + app.$('#cb-meta').textContent);
  app.E(`checkCur().ticks.push("2026-09-01|${ben}"); renderStage(false)`);
  const seat = app.E(`curPlan().desks.find(d => d.studentId === "${ben}").id`);
  const mk = app.$(`#stage .item[data-id="${seat}"] .tlmark`);
  erwarte(mk && mk.textContent === '2' && app.$(`#stage .item[data-id="${seat}"]`).classList.contains('tltoday'), 'Platz zeigt die Summe nicht');
  erwarte(!app.$(`#stage .item[data-id="${seat}"] .ckmark`), 'Strichliste zeigt Haken');
  app.klick('#cb-list');
  erwarte(!!app.$('#tl-names') && /2× · 01\.09\./.test(app.$('#tl-names').textContent), 'Liste zeigt Tage nicht');
  app.klick(`#tl-names [data-sid="${anna}"] .minibtn`);
  erwarte(app.E('checkCur().ticks.length') === 3, 'Heute-Knopf setzt keinen Strich');
  app.E('closeModal(); endCheckMode()');
  // Gesprächsblatt nennt die Strichliste, nicht als „offen“
  const txt = app.E(`talkSheetPages(curClass(), studentById(curClass(), "${ben}")).map(p => p.content).join("\\n")`);
  erwarte(/Strichlisten/.test(txt) && /Hausaufgaben vergessen: 2/.test(txt), 'Gesprächsblatt ohne Strichliste');
  erwarte(!/Hausaufgaben vergessen \(/.test(txt) && txt.indexOf(app.E('t("ckOpen")')) < 0, 'Strichliste erscheint als offene Abhakliste');
  // Prüfung beim Laden
  const r = app.E(`JSON.stringify(sanitizeDB({ v: 2, classes: [{ name: "x", students: [{ id: "s1", name: "A" }],
    checks: [{ id: "k", title: "HA", type: "tally", done: ["s1"], ticks: ["2026-09-01|s1", "2026-09-01|s1", "x|s1", "2026-09-02|zz"] }] }] }).classes[0].checks[0])`);
  erwarte(r === '{"id":"k","title":"HA","date":"","done":[],"type":"tally","ticks":["2026-09-01|s1"]}', 'Strichliste beim Laden: ' + r);
});

test('Abgleich: Punkte, Kursheft, Fehlzeiten, Strichlisten', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    const A_ = n => sid(app, n);
    app.E(`(() => { const a = curClass().assess[0]; a.tasks = [{ id: "t1", name: "1", max: 10 }, { id: "t2", name: "2", max: 10 }]; a.key = defaultKey("grade"); a.pts = {};
      curClass().checks.push({ id: "k2", title: "HA", date: "2026-09-01", done: [], type: "tally", ticks: [] }); })(); flushSave()`);
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    uhr(app, 2000);
    app.E(`(() => { const c = curClass(), a = c.assess[0]; a.pts["${A_('Anna')}"] = { t1: 10, t2: 9 }; applyTaskMarks(a);
      c.journal.push({ id: "j1", d: "2026-09-20", p: -1, s: "ma", topic: "Brüche", hw: "S. 3" }); c.exc.push("2026-09-14|${A_('Ben')}");
      c.checks[1].ticks.push("2026-09-20|${A_('Cem')}"); })(); flushSave()`);
    uhr(B, 3000);
    B.E(`(() => { const c = curClass(), a = c.assess[0]; a.pts["${A_('Ben')}"] = { t1: 2 }; applyTaskMarks(a);
      c.late.push({ d: "2026-09-21", p: 1, sid: "${A_('Dana')}", min: 5, s: "ma" }); c.checks[1].ticks.push("2026-09-21|${A_('Cem')}");
      c.journal.push({ id: "j2", d: "2026-09-21", p: -1, s: "ma", topic: "Kürzen", hw: "" }); a.key.th[0] = 96; applyTaskMarks(a); })(); flushSave()`);
    const fA = datei(app), fB = datei(B);
    uhr(app, 4000); await laden(app, fB, 'merge');
    uhr(B, 4000); await laden(B, fA, 'merge');
    erwarte(inhalt(B) === inhalt(app), 'Geräte kommen nicht zum selben Stand');
    const c = 'curClass()';
    erwarte(app.E(`Object.keys(${c}.assess[0].pts).length`) === 2 && app.E(`${c}.assess[0].key.th[0]`) === 96, 'Punkte oder Schlüssel nicht zusammengeführt');
    erwarte(app.E(`${c}.assess[0].marks["${A_('Anna')}"]`) === '2' && B.E(`${c}.assess[0].marks["${A_('Anna')}"]`) === '2', 'Note nicht aus Punkten und neuem Schlüssel: ' + app.E(`${c}.assess[0].marks["${A_('Anna')}"]`));
    erwarte(app.E(`${c}.journal.length`) === 2 && app.E(`${c}.exc.length`) === 1 && app.E(`${c}.late.length`) === 1 && app.E(`${c}.checks[1].ticks.length`) === 2, 'Kursheft, Fehlzeiten oder Striche fehlen');
    // Löschen eines Strichs und eines Kursheft-Eintrags auf A kommt bei B an
    uhr(app, 5000); app.E(`${c}.checks[1].ticks.shift(); ${c}.journal = ${c}.journal.filter(e => e.id !== "j2"); ${c}.exc = []; flushSave()`);
    uhr(B, 5100); await laden(B, datei(app), 'merge');
    erwarte(B.E(`${c}.checks[1].ticks.length`) === 1 && B.E(`${c}.journal.length`) === 1 && B.E(`${c}.exc.length`) === 0, 'Löschen wird nicht übertragen');
    erwarte(inhalt(B) === inhalt(app), 'Nach dem Löschen unterschiedlich');
    // Zeitstempel der neuen Arten überstehen das Laden
    erwarte(app.E('Object.keys(sanitizeDB(JSON.parse(localStorage.getItem(KEY))).stamps).filter(k => /^(tk|pt|kty|kt|j|ex|lt)\\|/.test(k)).length') >= 6, 'Zeitstempel für Punkte, Kursheft usw. gehen beim Laden verloren');
    // Eigene Einträge: Bewertungen ohne Aufgaben behalten ihr bisheriges Format
    erwarte(app.E(`syncEntities(DB).has("tk|" + idk(${c}.id) + "|w1")`) && app.E(`JSON.parse(syncEntities(DB).get("a|" + idk(${c}.id) + "|w1").v).tasks`) === undefined
      && app.E(`syncEntities(DB).has("kty|" + idk(${c}.id) + "|k2")`), 'Aufgaben oder Listentyp nicht als eigener Eintrag');
    // Datei eines älteren App-Stands (kennt Aufgaben und Strichlisten nicht), danach dort geändert: nichts geht verloren
    uhr(B, 6000);
    const alt = B.E(`(() => { const d = JSON.parse(JSON.stringify(DB)); d.stamps = Object.assign({}, d.stamps);
      Object.keys(d.stamps).forEach(k => { if(/^(tk|pt|kty|kt|j|ex|lt)\|/.test(k)) delete d.stamps[k]; });
      d.classes.forEach(c => { c.assess.forEach(a => { delete a.tasks; delete a.key; delete a.pts; }); c.checks.forEach(k => { delete k.type; delete k.ticks; k.title += "!"; }); delete c.journal; delete c.late; delete c.exc; c.name = "7b neu"; });
      d.stamps["c|" + idk(d.classes[0].id)] = 6000; d.stamps["k|" + idk(d.classes[0].id) + "|k2"] = 6000; d.mod = 6000;
      return JSON.stringify({ app: "fairseat", v: 2, exported: new Date(6000000).toISOString(), data: d }); })()`);
    uhr(app, 6100); await laden(app, alt, 'merge');
    erwarte(app.E(`${c}.checks[1].title`) === 'HA!', 'Neuerer Titel der Liste nicht übernommen');
    erwarte(app.E(`${c}.name`) === '7b neu' && app.E(`hasTasks(${c}.assess[0])`) && app.E(`Object.keys(${c}.assess[0].pts).length`) === 2
      && app.E(`isTally(${c}.checks[1])`) && app.E(`${c}.checks[1].ticks.length`) === 1 && app.E(`${c}.journal.length`) === 1, 'Älterer App-Stand löscht Aufgaben, Punkte oder Strichlisten');
    // Gerät ohne Aufgaben (z. B. noch nicht abgeglichen) setzt später direkt eine Note: sie gilt, die Punkte weichen
    const C = neueApp();
    try{
      uhr(C, 900); grundstand(C);
      const fC0 = C.E(`(() => { const d = JSON.parse(${JSON.stringify(datei(app))}); return JSON.stringify(d); })()`);
      uhr(C, 950); await laden(C, fC0, 'replace');
      C.E(`(() => { const c = curClass(), a = c.assess[0]; delete a.tasks; delete a.key; delete a.pts; })(); syncReset()`);
      uhr(C, 7000); C.E(`curClass().assess[0].marks["${A_('Anna')}"] = "4"; flushSave()`);
      uhr(app, 7100); await laden(app, datei(C), 'merge');
      erwarte(app.E(`${c}.assess[0].marks["${A_('Anna')}"]`) === '4' && !app.E(`(${c}.assess[0].pts || {})["${A_('Anna')}"]`) && app.E(`hasTasks(${c}.assess[0])`), 'Jüngere direkte Note geht verloren: ' + app.E(`${c}.assess[0].marks["${A_('Anna')}"]`));
    } finally { C.ende(); }
  } finally { B.ende(); }
});

test('Abgleich: Löschen gewinnt, wenn das Abhängige im selben Abgleich wegfällt', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1000); await laden(B, datei(app), 'replace');
    // A: Bewertung (verweist auf das Fach) neu; B: Fach gelöscht, danach die Bewertung von A gelöscht
    uhr(app, 1100); app.E('curClass().assess.push({ id: "w9", subjectId: "ma", title: "Neu", date: "2026-09-12", kind: "other", scale: "grade", weight: 1, marks: {} }); flushSave()');
    uhr(B, 1200); await laden(B, datei(app), 'merge');
    uhr(B, 1300); B.E('DB.subjects = []; DB.classes.forEach(c => { c.assess = c.assess.filter(a => a.id !== "w1"); }); flushSave()');
    uhr(B, 1400); B.E('curClass().assess = curClass().assess.filter(a => a.id !== "w9"); flushSave()');
    uhr(app, 1500); await laden(app, datei(B), 'merge');
    erwarte(app.E('DB.subjects.length') === 0 && app.E('curClass().assess.length') === 0, 'Fach bleibt, obwohl die einzige neuere Bewertung gelöscht wurde: ' + app.E('DB.subjects.length') + '/' + app.E('curClass().assess.length'));
  } finally { B.ende(); }
});

test('Abgleich: Löschungen unter einer Klasse, die nur hier existiert', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    const cid = app.E('curClass().id'), ben = sid(app, 'Ben');
    uhr(app, 1500); app.E('curClass().name = "7b neu"; flushSave()');
    /* B: Ben gelöscht (1450), Klasse gelöscht (1400), außerdem eine Bewertung, die das Fach am Leben hielte und dann gelöscht wurde */
    uhr(app, 1550); app.E('curClass().assess.push({ id: "w9", subjectId: "ma", title: "Neu", date: "2026-09-12", kind: "other", scale: "grade", weight: 1, marks: {} }); flushSave()');
    uhr(B, 1600); klasseMitNamen(B, '9c', ['Xaver']);
    B.E(`(() => { DB.subjects = []; DB.del = {}; DB.del[hk("c|${cid}")] = 1400; DB.del[hk("s|${cid}|${ben}")] = 1450;
      DB.del[hk("subj|ma")] = 1300; DB.del[hk("a|${cid}|w9")] = 1600; DB.mod = 1600; })()`);
    const fB = B.E('JSON.stringify({ app: "fairseat", v: 2, exported: new Date(1600000).toISOString(), data: (d => { d.del = packStamps(DB.del); return d; })(backupData()) })');
    uhr(app, 1700); await laden(app, fB, 'merge');
    app.E(`curClassId = "${cid}"`);
    erwarte(app.E('DB.classes.length') === 2 && app.E('curClass().name') === '7b neu', 'Neuere Klasse fehlt');
    erwarte(!app.E(`curClass().students.some(s => s.id === "${ben}")`), 'Löschung eines Schülers unter einer nur hier vorhandenen Klasse ignoriert');
    erwarte(app.E('DB.subjects.length') === 0 && !app.E('curClass().assess.some(a => a.id === "w9")'), 'Gelöschte Bewertung hält das gelöschte Fach am Leben');
  } finally { B.ende(); }
});

test('Abgleich: Löschungen in Ketten (Note → Bewertung → Fach)', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    const cid = app.E('curClass().id'), anna = sid(app, 'Anna');
    uhr(app, 1050); app.E('curClass().assess = []; flushSave()');
    uhr(app, 1200); app.E('curClass().assess.push({ id: "w8", subjectId: "ma", title: "Neu", date: "2026-09-12", kind: "other", scale: "grade", weight: 1, marks: {} }); flushSave()');
    uhr(app, 1300); app.E(`curClass().assess[0].marks["${anna}"] = "2"; flushSave()`);
    uhr(B, 1400); klasseMitNamen(B, '9c', ['Xaver']);
    B.E(`(() => { DB.subjects = []; DB.del = {}; DB.del[hk("subj|ma")] = 1100; DB.del[hk("a|${cid}|w8")] = 1250; DB.del[hk("m|${cid}|w8|${anna}")] = 1350; DB.mod = 1400; })()`);
    const fB = B.E('JSON.stringify({ app: "fairseat", v: 2, exported: new Date(1400000).toISOString(), data: (d => { d.del = packStamps(DB.del); return d; })(backupData()) })');
    uhr(app, 1500); await laden(app, fB, 'merge');
    app.E(`curClassId = "${cid}"`);
    erwarte(app.E('curClass().assess.length') === 0 && app.E('DB.subjects.length') === 0, 'Kette von Löschungen nicht vollständig: ' + app.E('curClass().assess.length') + '/' + app.E('DB.subjects.length'));
  } finally { B.ende(); }
});

test('Abgleich: Klasse gelöscht, Schüler darin anderswo geändert und gelöscht (4 Geräte)', async app => {
  const devs = [app, neueApp(), neueApp(), neueApp()];
  try{
    uhr(devs[0], 1000); grundstand(devs[0]); const f0 = datei(devs[0]);
    for(let i = 1; i < 4; i++){ uhr(devs[i], 1000); await laden(devs[i], f0, 'replace'); }
    uhr(devs[2], 1091); devs[2].E('trashPush("class", DB.classes[0].name, DB.classes[0]); DB.classes = []; flushSave()');
    uhr(devs[3], 1093); devs[3].E('DB.classes[0].students[1].level = 2; flushSave()');
    uhr(devs[0], 1101); devs[0].E('DB.classes[0].students.splice(1, 1); flushSave()');
    let T = 1130;
    for(let rep = 0; rep < 3; rep++) for(let i = 0; i < 4; i++){ const x = devs[i], y = devs[(i + 1) % 4]; uhr(y, ++T);
      y.E(`restoreParsed(${datei(x)})`); if(y.$('#sync-merge')) y.klick('#sync-merge'); else y.E('closeModal()'); await pause(1); }
    const n = devs.map(d => d.E('DB.classes.length')).join();
    erwarte(n === '0,0,0,0', 'Geräte kommen nicht zum selben Stand: ' + n);
  } finally { devs.slice(1).forEach(d => d.ende()); }
});

/* ------------------------------------------------------------------ */
alleTests().then(() => {
  console.log(bestanden + ' Prüfungen bestanden, ' + fehler + ' Fehler.');
  if(fehler){ fehlerliste.forEach(f => console.error('  ✗ ' + f)); process.exit(1); }
});

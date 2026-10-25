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
// Wartet, bis eine Bedingung gilt (höchstens max ms). Für Abläufe mit setTimeout in der App:
// feste Pausen sind auf langsamen CI-Läufern zu knapp.
const bis = async (fn, max = 3000) => { for(let i = 0; i <= max / 20; i++){ try { if(fn()) return true; } catch(e){} await pause(20); } return false; };   // zählt Runden statt Date.now – die Tests verstellen die Uhr
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
  // Excel mit Überschrift: Vorschau wie beim Datei-Import
  app.$('#student-input').value = 'Nr\tName\n1\tXaver\n2\tYara';
  app.klick('#btn-add-students');
  erwarte(app.$$('#nf-list .nfrow').length === 2 && !app.$('#nf-format'), 'Tabelle mit Überschrift nicht als Vorschau');
  app.klick('#nf-ok');
  erwarte(app.E('curClass().students.some(s => s.name === "Yara") && curClass().students.some(s => s.name === "Xaver")'), 'Namen aus der Tabelle nicht übernommen');
  // Excel ohne Überschrift: Spaltenauswahl
  app.$('#student-input').value = 'a1\tWilma\na2\tVera';
  app.klick('#btn-add-students');
  erwarte(!!app.$('#sheet select'), 'Mehrspaltiger Import zeigt keine Spaltenauswahl');
  const sel = app.$('#sheet select'); sel.value = '1'; sel.dispatchEvent(new app.w.Event('change'));
  app.sheetOk();
  erwarte(app.E('curClass().students.some(s => s.name === "Vera")'), 'Spalte 2 wurde nicht übernommen');
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
  const tiles = app.$$('#sheet .tile').map(b => b.textContent);
  erwarte(tiles.length === 6 && /Selbsteinschätzung/.test(tiles[5]) && /neuen Sitzplan/.test(tiles[3]) && /Timer/.test(tiles[4]), 'Menü zeigt nicht Vollbild, Auswahl, Spiegeln, Speichern, Timer und Selbsteinschätzung: ' + tiles.join(' | '));
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
    a.zn = [{ s: "ma", t: "y", sid: a.students[0].id, g: "2" }]; b.zn = [{ s: "ma", t: "y", sid: b.students[0].id, g: "3" }];
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
  erwarte(a && a.zn.length === 0 && app.E('DB.classes.find(c => c.name === "9a").zn.length') === 1, 'Zeugnisnoten beim Schuljahreswechsel nicht wie gewählt behandelt');
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
  app.E('gradeTerm = "year"'); app.klick('#g-tab-overview'); app.klick('#g-xlsx');
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

/* ---------- 33. PC-Plätze, Leiste, Speichern unter, letzte Stunde, Halbjahre, zieldifferent, Eltern, Timer, Listen ---------- */
const boxesOverlap = (app) => app.E(`(() => { const b = curPlan().desks.map(itemBox);
  for(let i = 0; i < b.length; i++) for(let j = i + 1; j < b.length; j++){ const p = b[i], q = b[j];
    if(p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1) return true; } return false; })()`);
const imRaum = app => app.E('curPlan().desks.every(d => { const b = itemBox(d); return b.x >= 0 && b.y >= 0 && b.x + b.w <= ROOM_W && b.y + b.h <= ROOM_H; })');
test('PC-Raum: Plätze mit Bildschirm', async app => {
  klasseMitNamen(app);                                  // 12 Namen
  neuerPlan(app, 8);                                    // PC-Raum (Wände)
  erwarte(app.E('curPlan().desks.length') === 12 && app.E('curPlan().desks.every(d => d.pc === true)'), 'Vorlage setzt keine PC-Plätze');
  const rots = app.E('JSON.stringify(Array.from(new Set(curPlan().desks.map(d => d.rot))).sort())');
  erwarte(rots === '[180,270,90]', 'PC-Plätze stehen nicht an drei Wänden: ' + rots);
  erwarte(!boxesOverlap(app) && imRaum(app), 'PC-Plätze überlappen oder ragen aus dem Raum');
  erwarte(app.$$('#stage .item .pcmon').length === 12, 'Bildschirme fehlen im Plan');
  erwarte(/PC-Platz/.test(app.$('#stage .item.t-desk').getAttribute('aria-label')), 'Vorlesen nennt den PC-Platz nicht');
  const pdf = app.E('pdfPlanPage(curClass(), curPlan(), curRoom(), "x", {})');
  erwarte((pdf.match(/0\.227 0\.275 0\.322 RG/g) || []).length === 12, 'PDF zeichnet die Bildschirme nicht');
  // große Klasse: Rest in der Mitte, nichts überlappt
  app.E(`(() => { const p = curPlan(); for(let i = 0; i < 26; i++) p.desks.push({ id: uid(), type: "desk", x: 0, y: 0, w: 90, h: 55, rot: 0 }); })(); layoutDesks("pcwall", true)`);
  erwarte(app.E('curPlan().desks.length') === 38 && !boxesOverlap(app) && imRaum(app), 'Große PC-Räume überlappen');
  // Reihen
  app.E('layoutDesks("pcrows", true)');
  erwarte(app.E('curPlan().desks.every(d => d.pc && d.rot === 0)') && !boxesOverlap(app), 'PC-Reihen falsch');
  // einzelner PC-Platz, umschalten
  const n0 = app.E('curPlan().desks.length');
  app.klick('#btn-pc-desk');
  erwarte(app.E('curPlan().desks.length') === n0 + 1 && app.E('curPlan().desks[curPlan().desks.length - 1].pc') === true, 'Knopf „PC-Platz“ legt keinen PC-Platz an');
  app.E('selected.clear(); selected.add(curPlan().desks[0].id); renderStage(false)');
  erwarte(app.$('#sb-pc').style.display !== 'none' && /Als Tisch/.test(app.$('#sb-pc').textContent), 'Umschalten in der Leiste fehlt');
  app.klick('#sb-pc');
  erwarte(!app.E('curPlan().desks[0].pc') && /Als PC-Platz/.test(app.$('#sb-pc').textContent), 'Umschalten geht nicht');
  app.E('undo()');
  erwarte(app.E('curPlan().desks[0].pc') === true, 'Umschalten nicht rückgängig zu machen');
  // Laden: nur Tische tragen das Merkmal
  erwarte(app.E('sanitizeItem({ type: "desk", pc: true }).pc') === true && app.E('sanitizeItem({ type: "window", pc: true }).pc') === undefined && app.E('sanitizeItem({ type: "desk", pc: "ja" }).pc') === undefined, 'Merkmal beim Laden falsch geprüft');
});

test('Auswahlleiste: Pfeil, wenn es rechts weitergeht', async app => {
  klasseMitNamen(app); neuerPlan(app, 0);
  const bar = app.$('#selbar');
  let sl = 0;
  Object.defineProperty(bar, 'scrollWidth', { configurable: true, get: () => 900 });
  Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => 300 });
  Object.defineProperty(bar, 'scrollLeft', { configurable: true, get: () => sl, set: v => { sl = Math.min(600, v); } });
  bar.scrollBy = undefined;
  app.E('selected.clear(); selected.add(curPlan().desks[0].id); renderStage(false)');
  erwarte(app.$('#selbar').classList.contains('on') && !app.$('#sb-more').hidden, 'Pfeil fehlt, obwohl die Leiste weitergeht');
  app.klick('#sb-more');
  erwarte(sl > 0, 'Pfeil schiebt die Leiste nicht weiter');
  sl = 600; bar.dispatchEvent(new app.w.Event('scroll'));
  erwarte(app.$('#sb-more').hidden, 'Pfeil bleibt am Ende stehen');
  app.E('selected.clear(); renderStage(false)');
  erwarte(app.$('#sb-more').hidden, 'Pfeil ohne Leiste sichtbar');
});

test('Sitzplan: als neuen speichern, Original zurücksetzen, wechseln', async app => {
  klasseMitNamen(app); neuerPlan(app, 0);
  const pid = app.E('curPlanId'), x0 = app.E('curPlan().desks[0].x');
  app.E('curPlan().desks[0].x += 120; save()');
  app.klick('#plan-title');
  erwarte(app.$$('#pm-list .grpcard').length === 1 && !!app.$('#pm-saveas'), 'Planmenü fehlt');
  app.klick('#pm-saveas'); await pause(90);
  erwarte(/Gruppenarbeit/.test(app.$('#sheet input').value), 'Vorschlag für den Namen fehlt');
  app.sheetOk();
  erwarte(app.$('#modal').classList.contains('on') && /zurücksetzen/.test(app.$('#sheet h3').textContent), 'Keine Frage zum Zurücksetzen');
  app.sheetOk();
  const c = 'curClass()';
  erwarte(app.E(`${c}.plans.length`) === 2 && app.E('curPlanId') !== pid, 'Neuer Plan nicht angelegt oder nicht geöffnet');
  erwarte(app.E('curPlan().desks[0].x') === x0 + 120 && app.E(`${c}.plans.find(p => p.id === "${pid}").desks[0].x`) === x0, 'Neuer Plan oder Original falsch');
  erwarte(app.E(`new Set(${c}.plans[0].desks.map(d => d.id).concat(${c}.plans[1].desks.map(d => d.id))).size`) === 24, 'Tisch-IDs doppelt');
  // unverändert: keine Rückfrage
  app.E('saveAsNewPlan()'); app.sheetOk();
  erwarte(app.E(`${c}.plans.length`) === 3 && !app.$('#modal').classList.contains('on'), 'Unveränderter Plan fragt nach dem Zurücksetzen');
  // „Nein, so lassen“: Original behält die Änderung
  app.E('curPlan().desks[1].x += 50; save()');
  const p3 = app.E('curPlanId'), x1 = app.E('curPlan().desks[1].x');
  app.E('saveAsNewPlan()'); app.sheetOk();
  erwarte(/so lassen/.test(app.$('#sheet .row .ghost').textContent), 'Knopf zum Behalten fehlt');
  app.klick('#sheet .row .ghost'); await pause(90);
  erwarte(app.E(`${c}.plans.length`) === 4 && app.E(`${c}.plans.find(p => p.id === "${p3}").desks[1].x`) === x1, '„So lassen“ setzt trotzdem zurück');
  // wechseln, Unterrichtsmodus bleibt
  app.E('DB.settings.lesson = true; setLesson(true)');
  app.klick('#plan-title');
  app.klick(`#pm-list .grpcard[data-pid="${pid}"]`);
  erwarte(app.E('curPlanId') === pid && app.E('lessonMode') === true, 'Wechsel des Plans fehlt oder beendet den Unterricht');
  // Selbsteinschätzung: kein Menü
  app.E('closeModal(); selfMode = "x"');
  app.klick('#plan-title');
  erwarte(!app.$('#modal').classList.contains('on'), 'Planmenü während der Selbsteinschätzung');
  app.E('selfMode = null');
});

test('Unterricht: Mitarbeit für die letzte Stunde nachtragen', async app => {
  bewertungsKlasse(app); neuerPlan(app, 0);
  const cid = app.E('curClass().id');
  app.E(`DB.lessons = [0, 1, 2, 3, 4].map(d => ({ id: "L" + d, day: d, period: 7, span: 1, week: "", subjectId: "ma", classId: "${cid}", roomId: "", planId: "" }))`);
  /* erwarteter Tag: der letzte Werktag vor heute */
  const exp = (() => { const n = new Date(); for(let k = 1; k < 10; k++){ const d = new Date(n.getFullYear(), n.getMonth(), n.getDate() - k); const w = (d.getDay() + 6) % 7; if(w < 5) return d; } })();
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  erwarte(app.E('lastLessonDate(curClass(), "ma")') === iso(exp), 'Letzte Stunde falsch: ' + app.E('lastLessonDate(curClass(), "ma")'));
  // Ausfall an diesem Tag: eine Stunde früher
  app.E(`setCancelled(DB.lessons[${(exp.getDay() + 6) % 7}], "${iso(exp)}", true)`);
  erwarte(app.E('lastLessonDate(curClass(), "ma")') < iso(exp), 'Ausgefallene Stunde zählt als letzte Stunde');
  app.E('DB.cancelled = []');
  const anna = sid(app, 'Anna');
  app.E(`DB.settings.lesson = true; setLesson(true); curClass().lesson.absent = ["${anna}"]`);
  app.E(`openLessonSheet(curPlan().desks.find(d => d.studentId === "${anna}"))`);
  const last = app.$('#lesson-qday button[data-v="last"]');
  erwarte(last && !last.disabled && last.textContent.indexOf(iso(exp).slice(8, 10) + '.') >= 0, 'Knopf „letzte Stunde“ fehlt');
  app.klick(last);
  erwarte(last.classList.contains('on'), 'Letzte Stunde nicht gewählt');
  app.klick(app.$$('#lesson-quickmark button').find(b => b.dataset.tok === '2'));
  erwarte(app.E(`curClass().assess.some(a => a.auto && a.date === "${iso(exp)}" && a.marks["${anna}"] === "2")`), 'Note nicht für die letzte Stunde gespeichert');
  erwarte(app.E(`curClass().lesson.absent.indexOf("${anna}")`) >= 0, 'Nachtragen ändert die heutige Anwesenheit');
  // ohne Stundenplan: Knopf gesperrt
  app.E('DB.lessons = []');
  app.E(`openLessonSheet(curPlan().desks.find(d => d.studentId === "${anna}"))`);
  erwarte(app.$('#lesson-qday button[data-v="last"]').disabled, 'Ohne Stundenplan trotzdem wählbar');
  app.E('closeModal()');
});

test('Bewertungen: Halbjahre', async app => {
  bewertungsKlasse(app);
  const [anna, ben] = [sid(app, 'Anna'), sid(app, 'Ben')];
  app.E(`DB.settings.termSplit = "2027-01-31"; curClass().assess = [
    { id: "a1", subjectId: "ma", title: "KA 1", date: "2026-10-10", kind: "written", scale: "grade", weight: 1, marks: { "${anna}": "1", "${ben}": "4" } },
    { id: "a2", subjectId: "ma", title: "KA 2", date: "2027-03-01", kind: "written", scale: "grade", weight: 1, marks: { "${anna}": "3", "${ben}": "2" } },
    { id: "a3", subjectId: "ma", title: "alt", date: "2025-12-01", kind: "written", scale: "grade", weight: 1, marks: { "${anna}": "6" } }]`);
  app.E('goGrades("ma")'); app.klick('#g-tab-overview');
  erwarte(app.$$('#g-term button').length === 3 && app.$('#g-term button.on').dataset.v === app.E('defaultGradeTerm()'), 'Halbjahr-Umschalter fehlt');
  app.klick('#g-term button[data-v="h1"]');
  erwarte(app.$$('#g-table tr')[0].querySelectorAll('th').length === 1 + 1 + 6 && /^1$/.test(app.$('#g-table .prop').textContent), '1. Halbjahr zeigt falsche Spalten oder Vorschlag: ' + app.$('#g-table .prop').textContent);
  app.klick('#g-term button[data-v="h2"]');
  erwarte(app.$('#g-table .prop').textContent === '3', '2. Halbjahr falsch: ' + app.$('#g-table .prop').textContent);
  erwarte(app.E(`studentAverages(curClass(), "ma", "${anna}", "year").total`) === 10 / 3, 'Schuljahr rechnet nicht alles');
  const box = downloadAbfangen(app);
  app.klick('#g-csv');
  erwarte(/2_Halbjahr\.csv$/.test(box.name), 'Datei nennt das Halbjahr nicht: ' + box.name);
  // Stichtag ändern
  erwarte(/2027/.test(app.$('#g-term-split').textContent), 'Stichtag ohne Jahr: ' + app.$('#g-term-split').textContent);
  app.klick('#g-term-split');
  app.$('#term-split').value = '2026-09-30'; app.sheetOk();
  // ungewöhnlicher Monat: Rückfrage; „Abbrechen“ führt mit dem getippten Tag zurück
  erwarte(app.$('#sheet').textContent.includes(app.E('t("termSplitOdd")')) && app.E('DB.settings.termSplit') === '2027-01-31', 'Keine Rückfrage beim ungewöhnlichen Stichtag');
  app.klick("#sheet .row .ghost"); await pause(100);
  erwarte(app.$('#term-split') && app.$('#term-split').value === '2026-09-30', 'Getippter Stichtag nach Abbrechen verloren');
  app.sheetOk(); app.sheetOk();
  erwarte(app.E('DB.settings.termSplit') === '2026-09-30' && app.$('#g-table .prop').textContent === '2', 'Stichtag nicht übernommen: ' + app.$('#g-table .prop').textContent);
  erwarte(app.E('courseAssess(curClass(), "ma", "h2").map(a => a.id).join()') === 'a1,a2', 'Nach dem Stichtag falsch zugeordnet');
  // Standard wiederherstellen
  app.klick('#g-term-split'); app.klick('#term-split-default');
  erwarte(app.E('DB.settings.termSplit') === undefined && /31/.test(app.$('#g-term-split').textContent), 'Standard-Stichtag nicht wiederhergestellt');
  // Bewertung ohne Datum: im Halbjahr ein Hinweis, im Schuljahr nicht
  app.E('curClass().assess.find(a => a.id === "a1").date = ""'); app.E('renderGrades()');
  erwarte(app.$('#g-undated') && /1/.test(app.$('#g-undated').textContent), 'Kein Hinweis auf Bewertungen ohne Datum');
  app.klick('#g-term button[data-v="year"]');
  erwarte(!app.$('#g-undated'), 'Hinweis ohne Datum auch im Schuljahr');
  // Laden: ungültiger Stichtag fällt weg, ältere Stände bleiben unverändert
  erwarte(app.E('sanitizeDB({ v: 2, settings: { termSplit: "kaputt" } }).settings.termSplit') === undefined && app.E('"termSplit" in sanitizeDB({ v: 2, settings: {} }).settings') === false, 'Stichtag beim Laden falsch geprüft');
  erwarte(app.E('defaultTermSplit(new Date(2026, 9, 8))') === '2027-01-31' && app.E('defaultTermSplit(new Date(2027, 4, 2))') === '2027-01-31', 'Standard-Stichtag falsch');
});

test('Bewertungen: zieldifferent zählt nicht bei der 30-%-Grenze', async app => {
  bewertungsKlasse(app);
  const [anna, ben, cem, dana] = ['Anna', 'Ben', 'Cem', 'Dana'].map(n => sid(app, n));
  app.E(`curClass().assess = [{ id: "w1", subjectId: "ma", title: "KA", date: "2026-10-01", kind: "written", scale: "grade", weight: 1,
    marks: { "${anna}": "5", "${ben}": "6", "${cem}": "2", "${dana}": "3" } }]; openAssess("w1")`);
  erwarte(!!app.$('#a-fail') && /50 %/.test(app.$('#a-fail').textContent), 'Warnung fehlt');
  app.E('goGrades("ma")'); app.klick('#g-tab-overview');
  app.klick(app.$$('#g-table .gname').find(b => b.textContent === 'Ben'));
  app.klick('#zd-switch');
  erwarte(app.E(`isZd(curClass(), "ma", "${ben}")`) === true, 'Merkmal nicht gesetzt');
  app.E('closeModal(); renderGrades()');
  erwarte(!!app.$('#g-table .zdtag'), 'Übersicht zeigt das Merkmal nicht');
  erwarte(app.E('JSON.stringify(failShare(curClass(), curClass().assess[0]))') === JSON.stringify({ bad: 1, n: 3, share: 1 / 3 }), 'Anteil rechnet zieldifferent mit');
  app.E(`setZd(curClass(), "ma", "${anna}", true)`);
  erwarte(app.E('failShare(curClass(), curClass().assess[0])') === null, 'Mit zwei zieldifferenten Arbeiten trotzdem gewertet');
  app.E(`setZd(curClass(), "de", "${cem}", true)`);
  erwarte(app.E(`isZd(curClass(), "ma", "${cem}")`) === false, 'Merkmal gilt fächerübergreifend');
  const z = app.E(`JSON.stringify(sanitizeDB({ v: 2, classes: [{ name: "x", students: [{ id: "s1", name: "A" }], zd: ["ma|s1", "ma|s1", "ma|weg", "kaputt", 3] }] }).classes[0].zd)`);
  erwarte(z === '["ma|s1"]', 'Merkmal beim Laden: ' + z);
});

test('Beobachtungen: Elternkontakte', async app => {
  bewertungsKlasse(app);
  const anna = sid(app, 'Anna');
  app.E(`openObservations(curClass(), studentById(curClass(), "${anna}"))`);
  erwarte(app.$('#obs-mode').style.display === 'none', 'Anlass sichtbar, obwohl Beobachtung gewählt');
  app.klick('#obs-kind button[data-v="parent"]');
  erwarte(app.$('#obs-mode').style.display !== 'none' && app.$('#obs-mode button.on').dataset.v === 'talk', 'Elternkontakt nicht wählbar');
  app.klick('#obs-mode button[data-v="phone"]');
  app.$('#obs-text').value = 'Absprache: wöchentliche Rückmeldung'; app.klick('#obs-add');
  erwarte(app.E('JSON.stringify(curClass().obs.map(o => [o.k, o.m]))') === '[["parent","phone"]]', 'Elternkontakt nicht gespeichert');
  erwarte(/Telefonat/.test(app.$('#obs-list').textContent) && app.$('#obs-mode button.on').dataset.v === 'phone', 'Liste zeigt die Art nicht oder Auswahl vergessen');
  app.klick('#obs-kind button[data-v="obs"]');
  app.$('#obs-text').value = 'arbeitet konzentriert'; app.klick('#obs-add');
  erwarte(app.E('curClass().obs.filter(o => !o.k).length') === 1, 'Normale Beobachtung wird Elternkontakt');
  const txt = app.E(`talkSheetPages(curClass(), studentById(curClass(), "${anna}")).map(p => p.content).join("\\n")`);
  erwarte(/Elternkontakte/.test(txt) && /Telefonat: Absprache/.test(txt), 'Gesprächsblatt ohne Elternkontakte');
  const m = app.E(`JSON.stringify(sanitizeDB({ v: 2, classes: [{ name: "x", students: [{ id: "s1", name: "A" }], obs: [{ sid: "s1", d: "2026-10-01", text: "t", k: "parent", m: "fax" }, { sid: "s1", d: "2026-10-01", text: "u", k: "x" }] }] }).classes[0].obs.map(o => [o.k || "", o.m || ""]))`);
  erwarte(m === '[["parent","talk"],["",""]]', 'Elternkontakt beim Laden: ' + m);
});

test('Timer für Gruppenarbeit', async app => {
  klasseMitNamen(app); neuerPlan(app, 0);
  app.E('DB.settings.lesson = true; setLesson(true)');
  app.klick('#lb-timer');
  app.$('#timer-min').value = '0'; app.klick('#timer-go');
  erwarte(/1 bis 180/.test(app.$('#toast').textContent) && app.$('#timerbox').hidden, 'Unsinnige Minuten angenommen');
  let now = 1000000;
  app.E(`Date.now = () => ${now}`);
  app.klick(app.$$('#timer-presets button').find(b => b.dataset.m === '5'));
  erwarte(!app.$('#timerbox').hidden && app.$('#tb-time').textContent === '5:00', 'Timer startet nicht');
  app.E(`Date.now = () => ${now + 61000}; paintTimer()`);
  erwarte(app.$('#tb-time').textContent === '3:59', 'Timer läuft falsch: ' + app.$('#tb-time').textContent);
  app.klick('#tb-pause');
  app.E(`Date.now = () => ${now + 121000}; paintTimer()`);
  erwarte(app.$('#timerbox').classList.contains('paused') && app.$('#tb-time').textContent === '3:59', 'Pause hält nicht an');
  app.klick('#tb-plus'); app.klick('#tb-pause');
  erwarte(app.$('#tb-time').textContent === '4:59', 'Minute dazu fehlt: ' + app.$('#tb-time').textContent);
  app.E(`Date.now = () => ${now + 121000 + 300000}; paintTimer()`);
  erwarte(app.$('#tb-time').textContent === 'Zeit!' && app.$('#timerbox').classList.contains('done'), 'Ende nicht angezeigt');
  app.klick('#tb-big');
  erwarte(app.E('presenting') === true && !app.$('#timerbox').hidden, 'Groß anzeigen geht nicht');
  app.E('setPresenting(false)');
  app.klick('#tb-stop');
  erwarte(app.$('#timerbox').hidden && app.E('timer') === null, 'Timer lässt sich nicht beenden');
});

test('Listen über „Klassen verwalten“ ohne Sitzplan', async app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben']);
  app.E('goNames()');
  app.klick('#btn-class-lists');
  erwarte(!!app.$('#ck-new') && app.$$('#tl-quick button').length === 2, 'Listen aus der Klasse nicht erreichbar');
  app.klick(app.$$('#tl-quick button')[0]); await pause(90);
  erwarte(!!app.$('#tl-names') && app.E('checkMode') === null && app.$('#screen-names').classList.contains('active'), 'Strichliste öffnet nicht ohne Sitzplan');
  app.klick(app.$$('#tl-names .minibtn')[0]);
  erwarte(app.E('curClass().checks[0].ticks.length') === 1, 'Strich für heute nicht gesetzt');
  erwarte(/Zurück/.test(app.$('#ck-ok').textContent), 'Kein Weg zurück zur Liste');
  app.klick('#ck-ok'); await pause(90);
  erwarte(!!app.$('#ck-new'), 'Zurück führt nicht zu den Listen');
  app.$('#ck-new-title').value = 'Elternbrief Ausflug'; app.klick('#ck-new'); await pause(90);
  erwarte(app.$$('#ck-names .setrow').length === 2, 'Abhakliste zeigt keine Namen');
  app.klick(app.$$('#ck-names .setrow')[1]);
  erwarte(app.E('curClass().checks[0].done.length') === 1, 'Haken nicht gesetzt');
  app.klick('#ck-delete'); app.sheetOk(); await pause(90);
  erwarte(app.E('curClass().checks.length') === 1 && !!app.$('#ck-new'), 'Löschen führt nicht zurück zur Liste');
});

test('PC-Raum: Wände halten die Kapazität auch in kleinen Räumen', async app => {
  klasseMitNamen(app);
  neuerPlan(app, 8);
  // viele Größen: nie Überlappung, nie außerhalb – auch nicht bei vollen Wänden
  const bad = app.E(`(() => { const keepW = ROOM_W, keepH = ROOM_H, out = [];
    for(const [w, h] of [[700, 520], [800, 600], [900, 650], [1000, 700], [1200, 800], [1400, 1000]]) for(const n of [4, 9, 14, 20, 30]){
      ROOM_W = w; ROOM_H = h;
      const pos = pPcWall(n), bx = pos.map(q => itemBox({ x: q.x, y: q.y, w: LW, h: LH, rot: q.rot || 0 }));
      let ov = false;
      for(let i = 0; i < bx.length; i++) for(let j = i + 1; j < bx.length; j++){ const p = bx[i], q = bx[j];
        if(p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1) ov = true; }
      const inside = bx.every(b => b.x >= -1 && b.y >= -1 && b.x + b.w <= w + 1 && b.y + b.h <= h + 1);
      if(pos.length !== n || ov || !inside) out.push(w + "x" + h + "/" + n + (ov ? " Überlappung" : "") + (!inside ? " außerhalb" : ""));
    }
    ROOM_W = keepW; ROOM_H = keepH; return out.join(", "); })()`);
  erwarte(bad === '', 'PC-Wände: ' + bad);
  // Überlappungsprüfung kennt gedrehte Tische
  erwarte(app.E('desksOverlap([{ x: 100, y: 100, w: 90, h: 55, rot: 90 }, { x: 100, y: 120, w: 90, h: 55, rot: 90 }])') === true, 'Gedrehte Tische übereinander nicht erkannt');
  erwarte(app.E('desksOverlap([{ x: 100, y: 100, w: 90, h: 55, rot: 90 }, { x: 170, y: 100, w: 90, h: 55, rot: 90 }])') === false, 'Gedrehte Tische nebeneinander als Überlappung');
  // andere Vorlage nimmt die Bildschirme weg
  app.E('layoutDesks("rows", true)');
  erwarte(app.E('curPlan().desks.every(d => !d.pc)'), 'Reihen behalten die PC-Bildschirme');
});

test('Nachbesserungen: Speichern unter, Fehlstunden je Halbjahr, Strichliste, Timer, Eltern, Fächer', async app => {
  klasseMitNamen(app); neuerPlan(app, 0);
  const c = 'curClass()';
  // Speichern unter im Unterricht: bleibt im Unterricht; Rückfrage per Hintergrund geschlossen = behalten
  app.E('DB.settings.lesson = true; setLesson(true)');
  app.E('curPlan().desks[0].x += 77; save()');
  const pid = app.E('curPlanId'), x = app.E('curPlan().desks[0].x');
  app.E('saveAsNewPlan()'); app.sheetOk();
  erwarte(/zurücksetzen/.test(app.$('#sheet h3').textContent), 'Rückfrage fehlt');
  app.$('#modal').dispatchEvent(new app.w.MouseEvent('click', { bubbles: true }));
  await pause(60);
  erwarte(app.E(`${c}.plans.length`) === 2 && app.E('curPlanId') !== pid && app.E(`${c}.plans.find(p => p.id === "${pid}").desks[0].x`) === x, 'Weggetippte Rückfrage: Plan nicht geöffnet oder Original verändert');
  erwarte(app.E('lessonMode') === true, 'Speichern unter beendet den Unterricht');
  app.E('setLesson(false)');
  // Fehlstunden nur im gewählten Halbjahr
  app.E(`DB.settings.termSplit = "2027-01-31"; ${c}.absLog = [{ d: "2026-10-05", p: 0, n: 2, s: "ma", ids: [${c}.students[0].id] }, { d: "2027-03-05", p: 0, n: 1, s: "ma", ids: [${c}.students[0].id] }]`);
  erwarte(app.E(`missedLessons(${c}, ${c}.students[0].id, "h1").total`) === 2 && app.E(`missedLessons(${c}, ${c}.students[0].id, "h2").total`) === 1 && app.E(`missedLessons(${c}, ${c}.students[0].id).total`) === 3, 'Fehlstunden ignorieren das Halbjahr');
  // Strichliste: Zeile an Ort und Stelle, Titel bleibt
  app.E('goNames()'); app.klick('#btn-class-lists');
  app.klick(app.$$('#tl-quick button')[0]); await pause(90);
  app.$('#ck-title').value = 'Neu getippt';
  const order = app.$$('#tl-names .obsrow').map(r => r.dataset.sid).join();
  app.klick(app.$$('#tl-names .minibtn')[3]);
  erwarte(app.$('#ck-title').value === 'Neu getippt' && app.$$('#tl-names .obsrow').map(r => r.dataset.sid).join() === order, 'Strichliste springt oder verliert den Titel');
  erwarte(app.$$('#tl-names .minibtn')[3].classList.contains('on') && /1×/.test(app.$$('#tl-names .obsm')[3].textContent), 'Zeile nicht aktualisiert');
  app.E('closeModal()');
  // Timer: Bildschirm wach, am Ende frei und Meldung
  app.E(`window.__wl = []; Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => { const l = { released: false, release(){ l.released = true; window.__wl.push("rel"); return Promise.resolve(); } }; window.__wl.push("req"); return Promise.resolve(l); } } })`);
  app.E('Date.now = () => 5000000; startTimer(60)'); await pause(20);
  erwarte(app.E('window.__wl.join()') === 'req' && !!app.E('timerWake'), 'Timer hält den Bildschirm nicht wach');
  app.E('Date.now = () => 5000000 + 61000; paintTimer()'); await pause(20);
  erwarte(app.E('window.__wl.join()') === 'req,rel' && app.$('#toast').textContent === app.E('t("timerDone")'), 'Timer-Ende gibt den Bildschirm nicht frei oder meldet nichts');
  app.E('Date.now = () => 6000000; startTimer(60)'); await pause(20);
  app.klick('#tb-pause'); await pause(20);
  erwarte(app.E('window.__wl.slice(-2).join()') === 'req,rel' && !app.E('timerWake'), 'Pause hält den Bildschirm wach');
  app.klick('#tb-pause'); await pause(20);
  erwarte(!!app.E('timerWake'), 'Weiter nach Pause hält den Bildschirm nicht wach');
  app.E('stopTimer()');
  // Excel: Fehlzeiten-Blatt im Halbjahr als Schuljahr gekennzeichnet
  erwarte(app.E(`gradesXlsxSheets(${c}, "h1").slice(-1)[0].name`) === 'Fehlzeiten (Schuljahr)' && app.E(`gradesXlsxSheets(${c}, "year").slice(-1)[0].name`) === 'Fehlzeiten', 'Fehlzeiten-Blatt ohne Hinweis aufs Schuljahr');
  // Stichtag: Rückfrage weggetippt = zurück mit dem getippten Tag
  app.E('editTermSplit()'); app.$('#term-split').value = '2026-06-30'; app.sheetOk();
  app.$('#modal').dispatchEvent(new app.w.MouseEvent('click', { bubbles: true })); await pause(30);
  erwarte(app.$('#term-split') && app.$('#term-split').value === '2026-06-30', 'Weggetippte Rückfrage verliert den Stichtag');
  app.E('closeModal()');
  // Elternkontakt: Knopf sagt, was gespeichert wird
  app.E(`openObservations(${c}, ${c}.students[0])`);
  erwarte(app.$('#obs-add').textContent === 'Beobachtung speichern', 'Knopf Beobachtung');
  app.klick('#obs-kind button[data-v="parent"]');
  erwarte(app.$('#obs-add').textContent === 'Elternkontakt speichern', 'Knopf sagt nicht „Elternkontakt“');
  app.E('closeModal()');
  // Fach löschen nimmt zieldifferent mit
  app.E(`DB.subjects.push({ id: "zz", name: "Kunst", color: "#123456" }); ${c}.zd = ["zz|" + ${c}.students[0].id, "ma|" + ${c}.students[0].id]`);
  app.E('editSubject(DB.subjects.find(s => s.id === "zz"))');
  const del = app.$$('#sheet button').find(b => /löschen/i.test(b.textContent) && b.className === 'ghost');
  if(del){ app.klick(del); app.sheetOk(); erwarte(app.E(`${c}.zd.join()`) === "ma|" + app.E(`${c}.students[0].id`), 'Gelöschtes Fach bleibt in zieldifferent'); }
  else erwarte(false, 'Fach-Dialog nicht gefunden');
});

test('Größe ändern: Dialog für Tische, Möbel, Wandgegenstände und Rundes', async app => {
  klasseMitNamen(app); neuerPlan(app, 0);
  const d0 = app.E('curPlan().desks[0].id');
  const sel = ids => app.E(`selected.clear(); ${JSON.stringify(ids)}.forEach(i => selected.add(i)); renderStage(false)`);
  // ein Tisch: Breite/Tiefe in cm, Mitte bleibt
  app.E(`curPlan().desks.forEach(d => { delete d.groupId; delete d.tbl; d.rot = 0; })`);
  sel([d0]);
  const c0 = app.E(`(() => { const d = curPlan().desks[0]; return [d.x + d.w / 2, d.y + d.h / 2]; })()`);
  app.klick('#sb-size');
  erwarte(/Tisch/.test(app.$('#sheet h3').textContent) && app.$('#size-w').value === '60' && app.$('#size-h').value === '37', 'Dialog zeigt nicht die Tischmaße in cm: ' + app.$('#size-w').value + '/' + (app.$('#size-h') || {}).value);
  app.klick(app.$$('#sheet .sizerow .stepbtn')[1]);                // Breite +10
  erwarte(app.$('#size-w').value === '70', 'Plus-Knopf rechnet falsch: ' + app.$('#size-w').value);
  app.$('#size-w').value = '120'; app.$('#size-h').value = '70'; app.sheetOk();
  const d = app.E('JSON.stringify((({ x, y, w, h }) => ({ x, y, w, h }))(curPlan().desks[0]))');
  const o = JSON.parse(d);
  erwarte(o.w === 180 && o.h === 105 && Math.abs(o.x + o.w / 2 - c0[0]) <= 1 && Math.abs(o.y + o.h / 2 - c0[1]) <= 1, 'Tischgröße oder Mitte falsch: ' + d);
  erwarte(app.E('curPlan().desks[1].w') === 90, 'Nicht ausgewählter Tisch mitgeändert');
  // größere Tische: größere Schrift
  erwarte(parseFloat(app.$(`#stage .item[data-id="${d0}"]`).style.fontSize) > parseFloat(app.$$('#stage .item.t-desk')[1].style.fontSize), 'Schrift wächst auf großen Tischen nicht');
  app.E('undo()');
  erwarte(app.E('curPlan().desks[0].w') === 90 && app.E('curPlan().desks[0].h') === 55, 'Rückgängig stellt die Größe nicht her');
  // Grenzen: zu klein / zu groß wird abgelehnt
  sel([d0]); app.klick('#sb-size');
  app.$('#size-w').value = '5'; app.sheetOk();
  erwarte(app.$('#modal').classList.contains('on') && /zwischen/.test(app.$('#toast').textContent) && app.E('curPlan().desks[0].w') === 90, 'Zu kleine Größe angenommen');
  app.$('#size-w').value = '99999'; app.sheetOk();
  erwarte(app.$('#modal').classList.contains('on') && app.E('curPlan().desks[0].w') === 90, 'Zu große Größe angenommen');
  app.E('closeModal()');
  // ± rundet krumme Werte erst auf den nächsten Zehner
  sel([d0]); app.klick('#sb-size');
  app.$('#size-w').value = '37'; app.klick(app.$$('#sheet .sizerow .stepbtn')[1]);
  erwarte(app.$('#size-w').value === '40', 'Plus nach krummem Wert: ' + app.$('#size-w').value);
  app.klick(app.$$('#sheet .sizerow .stepbtn')[0]);
  erwarte(app.$('#size-w').value === '30', 'Minus: ' + app.$('#size-w').value);
  // Tisch am Rand vergrößert: bleibt im Raum
  app.E('closeModal(); curPlan().desks[0].x = ROOM_W - 95; renderStage(false)'); sel([d0]); app.klick('#sb-size');
  app.$('#size-w').value = '300'; app.sheetOk();
  erwarte(app.E('(b => b.x + b.w <= ROOM_W + 1)(itemBox(curPlan().desks[0]))'), 'Vergrößerter Tisch ragt aus dem Raum');
  app.E('undo()');
  // ein Tisch wird nicht versehentlich zum runden Stuhl
  sel([d0]); app.klick('#sb-size'); app.$('#size-w').value = '40'; app.$('#size-h').value = '40'; app.sheetOk();
  erwarte(!app.E('isSeatDesk(curPlan().desks[0])') && !app.$(`#stage .item[data-id="${d0}"]`).classList.contains('seat'), 'Quadratischer kleiner Tisch wird zum Stuhl');
  app.E('undo()');
  // Weg zu „alle Tische“ aus der Auswahl heraus
  sel([d0]); app.klick('#sb-size'); app.klick('#size-all');
  erwarte(/alle 12 Tische/.test(app.$('#size-for').textContent), 'Link „alle Tische“ fehlt');
  app.E('closeModal()');
  // ohne Auswahl: alle Tische, Vorschläge setzen die Plangröße
  app.E('selected.clear(); renderStage(false); openSize()');
  erwarte(/alle 12 Tische/.test(app.$('#size-for').textContent) && app.$$('#size-presets button').length === 3, 'Alle Tische / Vorschläge fehlen');
  app.klick('#size-presets button[data-k="double"]');
  erwarte(app.E('curPlan().desks.every(d => d.w === 165 && d.h === 58)') && app.E('curPlan().deskSize') === 'double', 'Doppeltisch-Vorschlag gilt nicht für alle');
  app.E('undo()');
  // Möbel im Raum: Fenster nur Länge und bleibt an der Wand, Pflanze nur Durchmesser
  // Stühle und Tische getrennt; Stuhl bleibt rund und klein; Gruppen bleiben beisammen
  app.E('curPlan().desks[2].w = 64; curPlan().desks[2].h = 64; curPlan().desks[3].groupId = "gg"; curPlan().desks[4].groupId = "gg"; curPlan().desks[4].x = curPlan().desks[3].x + 90; curPlan().desks[4].y = curPlan().desks[3].y; renderStage(false)');
  sel(app.E('curPlan().desks.slice(2, 5).map(d => d.id)'));
  app.klick('#sb-size');
  erwarte(app.$$('#size-kind button').length === 2 && !!app.$('#size-kind button[data-v="seat"]'), 'Stühle nicht getrennt wählbar');
  app.klick('#size-kind button[data-v="seat"]');
  erwarte(/Durchmesser/.test(app.$('#sheet .sizerow span').textContent) && +app.$('#size-w').max <= 47, 'Stuhl ohne Durchmesser oder zu groß wählbar');
  app.$('#size-w').value = '40'; app.sheetOk();
  erwarte(app.E('(d => d.w === 60 && d.h === 60)(curPlan().desks[2])') && app.E('isSeatDesk(curPlan().desks[2])'), 'Stuhl nicht rund geblieben');
  sel(app.E('curPlan().desks.slice(3, 5).map(d => d.id)')); app.klick('#sb-size');
  app.$('#size-w').value = '90'; app.sheetOk();
  erwarte(app.E('(([a, b]) => a.w === 135 && b.w === 135 && Math.abs((b.x - a.x) - 135) <= 1)(curPlan().desks.slice(3, 5))'), 'Gruppentische überlappen oder klaffen: ' + app.E('JSON.stringify(curPlan().desks.slice(3, 5).map(d => [d.x, d.w]))'));
  app.E('undo(); undo()');
  // Stühle verschiedener Tische (ohne Gruppe, gleiche Tischform) rücken beim Ändern nicht zusammen
  app.E('const P = curPlan().desks; [5, 6].forEach(k => { P[k].w = 64; P[k].h = 64; P[k].tbl = "round"; delete P[k].groupId; }); P[5].x = 100; P[5].y = 300; P[6].x = 900; P[6].y = 300; renderStage(false)');
  sel(app.E('curPlan().desks.slice(5, 7).map(d => d.id)')); app.klick('#sb-size');
  app.$('#size-w').value = '30'; app.sheetOk();
  erwarte(app.E('(([a, b]) => Math.abs(a.x + a.w / 2 - 132) <= 1 && Math.abs(b.x + b.w / 2 - 932) <= 1)(curPlan().desks.slice(5, 7))'), 'Stühle verschiedener Tische rücken zusammen: ' + app.E('JSON.stringify(curPlan().desks.slice(5, 7).map(d => [d.x, d.w]))'));
  app.E('undo()');
  app.E('setEditMode("room")');
  const win = app.E('(() => { const w = curRoom().items.find(i => i.type === "window"); return w && w.id; })()');
  const plant = app.E('(() => { const w = curRoom().items.find(i => i.type === "plant"); return w && w.id; })()');
  erwarte(!!win && !!plant, 'Raum ohne Fenster/Pflanze');
  const w0 = app.E(`JSON.stringify(curRoom().items.find(i => i.id === "${win}"))`);
  sel([win, plant]);
  app.klick('#sb-size');
  erwarte(app.$$('#size-kind button').length === 2, 'Arten nicht wählbar');
  app.klick(`#size-kind button[data-v="window"]`);
  erwarte(!app.$('#size-h') && /Länge/.test(app.$('#sheet .sizerow span').textContent), 'Fenster zeigt Tiefe');
  app.$('#size-w').value = '200'; app.sheetOk();
  const w1 = JSON.parse(app.E(`JSON.stringify(curRoom().items.find(i => i.id === "${win}"))`)), wo = JSON.parse(w0);
  erwarte(w1.w === 300 && w1.h === wo.h && w1.rot === wo.rot && app.E(`isOnWall(curRoom().items.find(i => i.id === "${win}"))`), 'Fenster: Länge, Dicke oder Wand falsch: ' + JSON.stringify(w1));
  sel([plant]); app.klick('#sb-size');
  erwarte(/Durchmesser/.test(app.$('#sheet .sizerow span').textContent) && !app.$('#size-h'), 'Pflanze ohne Durchmesser');
  app.$('#size-w').value = '60'; app.sheetOk();
  erwarte(app.E(`(i => i.w === 90 && i.h === 90)(curRoom().items.find(i => i.id === "${plant}"))`), 'Pflanze nicht rund vergrößert');
  // Standardgröße
  sel([plant]); app.klick('#sb-size'); app.klick('#size-default');
  erwarte(app.E(`curRoom().items.find(i => i.id === "${plant}").w`) === app.E('ITEMS.plant.w'), 'Standardgröße nicht wiederhergestellt');
  // Fenster darf nicht länger als die Wand werden
  sel([win]); app.klick('#sb-size');
  erwarte(+app.$('#size-w').max <= app.E('pxToCm(Math.max(ROOM_W, ROOM_H))'), 'Fenster länger als der Raum erlaubt');
  app.E('closeModal()');
  // kleiner Raum: Fenster höchstens so lang wie die Wand
  app.E('curRoom().w = 600; curRoom().h = 600; useRoomSize(curRoom())');
  sel([win]); app.klick('#sb-size');
  app.$('#size-w').value = '9999'; app.sheetOk();
  erwarte(app.$('#modal').classList.contains('on') && +app.$('#size-w').max <= 400, 'Fenster länger als die Wand erlaubt: ' + app.$('#size-w').max);
  app.$('#size-w').value = app.$('#size-w').max; app.sheetOk();
  erwarte(app.E(`(b => b.x >= -1 && b.y >= -1 && b.x + b.w <= ROOM_W + 1 && b.y + b.h <= ROOM_H + 1)(itemBox(curRoom().items.find(i => i.id === "${win}")))`), 'Fenster ragt aus dem Raum');
  // Laden: Größen bleiben in sinnvollen Grenzen
  erwarte(app.E('sanitizeItem({ type: "window", w: 5000, h: 14 }).w') === 1000 && app.E('sanitizeItem({ type: "desk", w: 2, h: 55 }).w') === 10, 'Größen beim Laden nicht begrenzt');
  app.E('setEditMode("desks")');
});

test('Größe ändern: Ziehgriff an der Ecke', async app => {
  klasseMitNamen(app); neuerPlan(app, 0);
  app.E(`curPlan().desks.forEach(d => { delete d.groupId; delete d.tbl; d.rot = 0; })`);
  const d0 = app.E('curPlan().desks[0].id');
  const sel = ids => app.E(`selected.clear(); ${JSON.stringify(ids)}.forEach(i => selected.add(i)); renderStage(false)`);
  const pe = (type, x, y) => app.$('#sizehandle').dispatchEvent(new app.w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  // Aufsetzen genau auf der Ecke (der Griff selbst sitzt daneben – der Versatz wird abgezogen), dann die Ecke nach (rx, ry) ziehen
  const ziehe = (expr, rx, ry, len) => { const g = app.E(`(c => roomToScreen(c.x, c.y))(itemCorner(${expr}, 1, ${len ? 0 : 1}))`), s = app.E(`roomToScreen(${rx}, ${ry})`);
    pe('pointerdown', g.x, g.y); pe('pointermove', s.x, s.y); pe('pointerup', s.x, s.y); };
  const D0 = 'curPlan().desks[0]';
  sel([d0]);
  erwarte(app.$('#sizehandle').classList.contains('on'), 'Griff fehlt bei einem Tisch');
  // nach rechts unten ziehen: linke obere Ecke bleibt, 10-cm-Raster
  const a = JSON.parse(app.E('JSON.stringify(curPlan().desks[0])'));
  const und = app.E('undoStack.length');
  ziehe(D0, a.x + 182, a.y + 88);
  const b = JSON.parse(app.E('JSON.stringify(curPlan().desks[0])'));
  erwarte(b.w === 180 && b.h === 85 && b.x === a.x && b.y === a.y, 'Ziehen ändert falsch: ' + JSON.stringify([b.x, b.y, b.w, b.h]));
  erwarte(app.E('undoStack.length') === und + 1, 'Ziehen nicht rückgängig zu machen');
  app.E('undo()');
  erwarte(app.E('curPlan().desks[0].w') === 90, 'Rückgängig nach Ziehen geht nicht');
  // Antippen ohne Ziehen ändert nichts und hinterlässt keinen Rückgängig-Schritt
  sel([d0]);
  erwarte(app.$('#sizehandle').classList.contains('on'), 'Griff nach Rückgängig weg');
  pe('pointerdown', 0, 0); pe('pointerup', 0, 0);
  erwarte(app.E('undoStack.length') === und && app.E('curPlan().desks[0].w') === 90, 'Antippen des Griffs ändert etwas');
  // Antippen eines Tischs auf der Fläche lässt „Wiederholen“ stehen
  erwarte(app.E('redoStack.length') === 1, 'Wiederholen fehlt nach Rückgängig (1)');
  { const el = app.$(`#stage .item[data-id="${d0}"]`), c = app.E(`(d => roomToScreen(d.x + d.w / 2, d.y + d.h / 2))(${D0})`);
    const ev = (t, x, y) => el.dispatchEvent(new app.w.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    ev('pointerdown', c.x, c.y); ev('pointerup', c.x, c.y); }
  erwarte(app.E('redoStack.length') === 1 && app.E('undoStack.length') === und, 'Antippen eines Tischs löscht Wiederholen');
  // Verschieben auf der Fläche legt weiterhin einen Rückgängig-Schritt an
  { const el = app.$(`#stage .item[data-id="${d0}"]`), c = app.E(`(d => roomToScreen(d.x + d.w / 2, d.y + d.h / 2))(${D0})`), x0 = app.E(`${D0}.x`);
    const ev = (t, x, y) => el.dispatchEvent(new app.w.MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    ev('pointerdown', c.x, c.y); ev('pointermove', c.x + 40, c.y); ev('pointermove', c.x + 80, c.y); ev('pointerup', c.x + 80, c.y);
    erwarte(app.E(`${D0}.x`) !== x0 && app.E('undoStack.length') === und + 1, 'Verschieben ohne Rückgängig-Schritt: ' + app.E('undoStack.length') + ' ' + app.E(`${D0}.x`) + ' ' + x0);
    app.E('undo()');
    erwarte(app.E(`${D0}.x`) === x0, 'Rückgängig nach Verschieben geht nicht'); }
  sel([d0]);
  // Zittern beim Antippen (2 px) ändert nichts und lässt „Wiederholen“ stehen
  erwarte(app.E('redoStack.length') === 1, 'Wiederholen fehlt nach Rückgängig');
  pe('pointerdown', 100, 100); pe('pointermove', 102, 101); pe('pointerup', 102, 101);
  erwarte(app.E('curPlan().desks[0].w') === 90 && app.E('redoStack.length') === 1 && app.E('undoStack.length') === und, 'Zittern am Griff ändert die Größe oder löscht Wiederholen');
  // Aufsetzen neben der Ecke (wo der Griff ist): ohne Bewegung kein Sprung
  const gs = app.E(`(c => roomToScreen(c.x + 30, c.y + 30))(itemCorner(${D0}, 1, 1))`);
  pe('pointerdown', gs.x, gs.y); pe('pointermove', gs.x + 5, gs.y); pe('pointerup', gs.x + 5, gs.y);
  erwarte(app.E('curPlan().desks[0].h') === 55 && app.E('curPlan().desks[0].w') <= 105, 'Größe springt beim Aufsetzen: ' + app.E('JSON.stringify([curPlan().desks[0].w, curPlan().desks[0].h])'));
  app.E('undo()');
  sel([d0]);
  // kleiner Zug unter einem halben Rasterschritt: keine Änderung, kein leerer Rückgängig-Schritt
  app.E('zoom = 2; applyTransform()'); sel([d0]);
  { const g = app.E(`(c => roomToScreen(c.x, c.y))(itemCorner(${D0}, 1, 1))`), u0 = app.E('undoStack.length');
    pe('pointerdown', g.x, g.y); pe('pointermove', g.x + 10, g.y); pe('pointerup', g.x + 10, g.y);
    erwarte(app.E('undoStack.length') === u0 && app.E('curPlan().desks[0].w') === 90, 'Leerer Rückgängig-Schritt nach kleinem Zug'); }
  // gedreht: die gegenüberliegende Ecke bleibt stehen
  app.E('curPlan().desks[0].rot = 90'); sel([d0]);
  const anc = JSON.parse(app.E('JSON.stringify(itemCorner(curPlan().desks[0], -1, -1))'));
  ziehe(D0, anc.x - 70, anc.y + 150);                     // gedreht um 90°: Breite zeigt nach unten, Tiefe nach links
  const r = JSON.parse(app.E('JSON.stringify(curPlan().desks[0])')), anc2 = JSON.parse(app.E('JSON.stringify(itemCorner(curPlan().desks[0], -1, -1))'));
  erwarte(r.w === 150 && r.h === 70 && Math.abs(anc2.x - anc.x) <= 1.5 && Math.abs(anc2.y - anc.y) <= 1.5, 'Gedrehter Tisch: falsche Größe oder Ecke wandert: ' + JSON.stringify([r.w, r.h, anc, anc2]));
  // Gruppe, Vorführen, Unterricht: kein Griff
  app.E('curPlan().desks[0].groupId = "g1"; curPlan().desks[1].groupId = "g1"');
  sel([d0]);
  erwarte(!app.$('#sizehandle').classList.contains('on'), 'Griff bei einer Tischgruppe');
  app.E('delete curPlan().desks[0].groupId; delete curPlan().desks[1].groupId'); sel([d0]);
  app.E('setPresenting(true)'); sel([d0]);
  erwarte(!app.$('#sizehandle').classList.contains('on'), 'Griff im Vorführmodus');
  app.E('setPresenting(false)');
  // Pflanze: bleibt rund; Fenster: nur Länge, bleibt an der Wand
  app.E('setEditMode("room")');
  const plant = app.E('curRoom().items.find(i => i.type === "plant").id'), win = app.E('curRoom().items.find(i => i.type === "window").id');
  sel([plant]);
  const pa = JSON.parse(app.E(`JSON.stringify(itemCorner(curRoom().items.find(i => i.id === "${plant}"), -1, -1))`));
  ziehe(`curRoom().items.find(i => i.id === "${plant}")`, pa.x + 120, pa.y + 60);
  erwarte(app.E(`(i => i.w === i.h && i.w === 119)(curRoom().items.find(i => i.id === "${plant}"))`), 'Pflanze nicht rund: ' + app.E(`JSON.stringify(curRoom().items.find(i => i.id === "${plant}"))`));
  sel([win]);
  const wv = JSON.parse(app.E(`JSON.stringify(curRoom().items.find(i => i.id === "${win}"))`));
  const wa = JSON.parse(app.E(`JSON.stringify(itemCorner(curRoom().items.find(i => i.id === "${win}"), 1, 0))`));
  const s0 = app.E(`roomToScreen(${wa.x}, ${wa.y})`);
  pe('pointerdown', s0.x, s0.y);
  const tgt = app.E(`(() => { const it = curRoom().items.find(i => i.id === "${win}"), a = it.rot * Math.PI / 180; return roomToScreen(${wa.x} + Math.cos(a) * 60 - Math.sin(a) * 80, ${wa.y} + Math.sin(a) * 60 + Math.cos(a) * 80); })()`);
  pe('pointermove', tgt.x, tgt.y);
  erwarte(/^\d,\d\d m$/.test(app.$('#sizebadge').textContent) && app.$('#sizebadge').classList.contains('on'), 'Maßanzeige beim Ziehen fehlt: ' + app.$('#sizebadge').textContent);
  pe('pointerup', tgt.x, tgt.y);
  const wn = JSON.parse(app.E(`JSON.stringify(curRoom().items.find(i => i.id === "${win}"))`));
  erwarte(wn.h === wv.h && wn.w === wv.w + 60 && wn.rot === wv.rot && app.E(`isOnWall(curRoom().items.find(i => i.id === "${win}"))`), 'Fenster beim Ziehen falsch: ' + JSON.stringify([wv, wn]));
  // frei stehende Tafel stößt beim Verlängern an die Wand: dreht sich nicht und springt nicht an die Wand
  const bid = app.E(`(() => { const b = { id: uid(), type: "whiteboard", x: 0, y: 0, w: 240, h: 24, rot: 90 }; b.x = ROOM_W - 300; b.y = 300; curRoom().items.push(b); return b.id; })()`);
  sel([bid]);
  const bb = `curRoom().items.find(i => i.id === "${bid}")`;
  const bc = JSON.parse(app.E(`JSON.stringify(itemCorner(${bb}, 1, 0))`));
  ziehe(bb, bc.x + 400, bc.y + 600, true);
  const bn = JSON.parse(app.E(`JSON.stringify(${bb})`));
  erwarte(bn.rot === 90 && bn.w > 240 && bn.h === 24, 'Tafel dreht sich oder springt beim Ziehen: ' + JSON.stringify(bn));
  // waagerechte Tafel frei im Raum: beim Verlängern bis an die rechte Wand (zwei Züge) bleibt sie, wo sie steht
  const hid = app.E(`(() => { const b = { id: uid(), type: "whiteboard", x: ROOM_W - 400, y: 320, w: 240, h: 24, rot: 0 }; curRoom().items.push(b); return b.id; })()`);
  sel([hid]);
  const hb = `curRoom().items.find(i => i.id === "${hid}")`;
  const hg = app.E(`(c => roomToScreen(c.x, c.y))(itemCorner(${hb}, 1, 0))`);
  const h1 = app.E(`roomToScreen(ROOM_W + 50, 332)`), h2 = app.E(`roomToScreen(ROOM_W + 120, 332)`);
  pe('pointerdown', hg.x, hg.y); pe('pointermove', h1.x, h1.y); pe('pointermove', h2.x, h2.y); pe('pointerup', h2.x, h2.y);
  const hn = JSON.parse(app.E(`JSON.stringify(${hb})`));
  erwarte(hn.rot === 0 && hn.y === 320 && hn.w > 240, 'Tafel springt an eine Wand: ' + JSON.stringify(hn));
  erwarte(app.E(`isOnWall(${hb})`) === false && app.E(`isOnWall({ type: "whiteboard", x: 100, y: 0, w: 240, h: 24, rot: 0 })`) === true, 'Wandprüfung beachtet die Ausrichtung nicht');
  app.E('setEditMode("desks")');
});

test('Rechenweg: „Wie berechnet?“ stimmt mit Durchschnitt, Vorschlag und Fehlstunden überein', async app => {
  bewertungsKlasse(app);
  const anna = sid(app, 'Anna');
  app.E(`(() => { const c = curClass(); c.gradeW = { ma: 60 };
    c.assess = [
      { id: "a1", subjectId: "ma", title: "KA 1", date: "2026-09-20", kind: "written", scale: "grade", weight: 2, marks: { "${anna}": "2-" } },
      { id: "a2", subjectId: "ma", title: "Test", date: "2026-10-01", kind: "written", scale: "points", weight: 1, marks: { "${anna}": "11" } },
      { id: "a3", subjectId: "ma", title: "Mitarbeit", date: "2026-10-02", kind: "other", scale: "grade", weight: 1, marks: { "${anna}": "1" } },
      { id: "a4", subjectId: "ma", title: "Referat", date: "2026-10-03", kind: "other", scale: "grade", weight: 1, marks: { "${anna}": "x" } },
      { id: "a5", subjectId: "ma", title: "Stimmung", date: "2026-10-03", kind: "other", scale: "smiley", weight: 1, marks: { "${anna}": "s1" } }];
    c.absLog = [{ d: "2026-10-05", p: 0, n: 2, s: "ma", ids: ["${anna}"] }, { d: "2026-10-06", p: 1, n: 1, s: "ma", ids: ["${anna}"] },
      { d: "2026-10-07", p: 2, n: 4, s: "de", ids: ["${anna}"] }];
    c.exc = [excKey("2026-10-05", "${anna}")]; })()`);
  const calc = JSON.parse(app.E(`JSON.stringify(gradeCalc(curClass(), subjectById("ma"), "${anna}"))`));
  const av = JSON.parse(app.E(`JSON.stringify(studentAverages(curClass(), "ma", "${anna}"))`));
  const txt = calc.lines.map(l => l.a + ' ' + (l.b || '')).join('\n');
  erwarte(calc.proposal === app.E(`proposeGrade(curClass(), "ma", studentAverages(curClass(), "ma", "${anna}"))`) && calc.av.total === av.total, 'Rechenweg weicht vom Vorschlag ab');
  erwarte(/2- = 2,3 × 2/.test(txt) && /11 P\. → 2,0 × 1/.test(txt), 'Einzelwerte oder Umrechnung fehlen: ' + txt);
  erwarte(/fehlt – zählt nicht/.test(txt) && /Stimmung Smiley – zählt nicht/.test(txt), '„fehlt“ nicht erklärt oder Smiley-Bewertung mitgezählt');
  erwarte(txt.includes('Ø ' + app.E(`fmtNum(${av.written}, 2)`)) && txt.includes('60 % × ' + app.E(`fmtNum(${av.written}, 2)`) + ' + 40 % × ' + app.E(`fmtNum(${av.other}, 2)`) + ' = ' + app.E(`fmtNum(${av.total}, 2)`)), 'Gewichtung im Rechenweg falsch: ' + txt);
  erwarte(/umgerechnet/.test(txt) && /zugunsten/.test(txt) && txt.includes(app.E(`fmtNum(${av.total}, 2)`) + ' → ' + calc.proposal), 'Rundungsregel oder Ergebnis fehlt');
  erwarte(calc.missed === 3 && calc.excused === 2 && calc.missed === app.E(`missedLessons(curClass(), "${anna}").bySubject.ma`) && /Gesamt 3, davon entschuldigt 2/.test(txt), 'Fehlstunden im Rechenweg falsch');
  // ausgefallene Stunde zählt nicht – wie in der Übersicht
  app.E(`(() => { const c = curClass(); DB.lessons.push({ id: "L1", classId: c.id, subjectId: "ma", day: new Date(2026, 9, 6).getDay() - 1, period: 1, room: "" }); DB.cancelled = ["L1|2026-10-06"]; })()`);
  erwarte(app.E(`gradeCalc(curClass(), subjectById("ma"), "${anna}").missed`) === app.E(`missedLessons(curClass(), "${anna}").bySubject.ma || 0`), 'Rechenweg und Übersicht zählen ausgefallene Stunden verschieden');
  // 100 % schriftlich, andere Rundung
  app.E(`curClass().gradeW = { ma: 100 }; curClass().gradeRound = { ma: { fav: false, tend: true } }`);
  const c2 = JSON.parse(app.E(`JSON.stringify(gradeCalc(curClass(), subjectById("ma"), "${anna}"))`)), t2 = c2.lines.map(l => l.a).join('\n');
  erwarte(/mit 0 % gewichtet/.test(t2) && /Nur Schriftlich|Nur schriftlich/i.test(t2) && /Tendenz/.test(t2) && c2.proposal === app.E(`proposeGrade(curClass(), "ma", studentAverages(curClass(), "ma", "${anna}"))`), 'Sonderfälle im Rechenweg falsch: ' + t2);
  // Halbjahr: nur Bewertungen und Fehlstunden darin
  app.E('DB.settings.termSplit = "2026-09-30"');
  const c3 = JSON.parse(app.E(`JSON.stringify(gradeCalc(curClass(), subjectById("ma"), "${anna}", "h1"))`));
  erwarte(c3.lines.filter(l => l.k === 'row' && /KA 1/.test(l.a)).length === 1 && !c3.lines.some(l => /Test/.test(l.a)) && c3.missed === 0, 'Halbjahr im Rechenweg nicht beachtet');
  app.E('delete DB.settings.termSplit; curClass().gradeW = { ma: 60 }; curClass().gradeRound = {}');
  // Gesamtwert knapp unter ,5: genau genug zeigen, damit „→ 1“ stimmig ist
  app.E(`(() => { const c = curClass(); c.gradeW = { ma: 40 }; c.__a = c.assess; c.assess = [
    { id: "b1", subjectId: "ma", title: "A", date: "2026-09-20", kind: "written", scale: "grade", weight: 3, marks: { "${anna}": "1" } },
    { id: "b2", subjectId: "ma", title: "B", date: "2026-09-21", kind: "written", scale: "grade", weight: 0.5, marks: { "${anna}": "1-" } },
    { id: "b3", subjectId: "ma", title: "C", date: "2026-09-22", kind: "other", scale: "grade", weight: 2, marks: { "${anna}": "2+" } },
    { id: "b4", subjectId: "ma", title: "D", date: "2026-09-23", kind: "other", scale: "grade", weight: 1, marks: { "${anna}": "2" } }]; })()`);
  const c4 = JSON.parse(app.E(`JSON.stringify(gradeCalc(curClass(), subjectById("ma"), "${anna}"))`)), t4 = c4.lines.map(l => l.a).join('\n');
  erwarte(/1,497 → 1/.test(t4) && !/1,50 → 1/.test(t4), 'Gesamtwert gerundet angezeigt, Vorschlag wirkt falsch: ' + t4);
  // 0 % schriftlich, nur schriftliche Noten: Erklärung statt Widerspruch
  app.E('curClass().gradeW = { ma: 0 }; curClass().assess = curClass().assess.filter(a => a.kind === "written")');
  const t5 = app.E(`gradeCalc(curClass(), subjectById("ma"), "${anna}").lines.map(l => l.a).join("\\n")`);
  erwarte(/Schriftlich mit 0 % gewichtet|schriftlich mit 0 % gewichtet/i.test(t5), 'Fehlende Erklärung bei 0 % schriftlich: ' + t5);
  app.E('curClass().assess = curClass().__a; delete curClass().__a; curClass().gradeW = { ma: 60 }');
  // Fehlstunden ohne Fach: Hinweis; englische Einheit
  app.E(`curClass().absLog.push({ d: "2026-10-08", p: 3, n: 2, s: "", ids: ["${anna}"] })`);
  erwarte(/2 Fehlstunden ohne Fach/.test(app.E(`gradeCalc(curClass(), subjectById("ma"), "${anna}").lines.map(l => l.a).join(" ")`)), 'Fehlstunden ohne Fach nicht erwähnt');
  erwarte(/11 pts → 2\.0/.test(app.E(`(() => { const L0 = LANG; LANG = "en"; const r = gradeCalc(curClass(), subjectById("ma"), "${anna}").lines.map(l => l.b || "").join(" "); LANG = L0; return r; })()`)), 'Englisch zeigt „P.“');
  // Oberfläche: aus dem Namen heraus, zurück, PDF
  app.E('goGrades("ma")'); app.klick('#g-tab-overview');
  app.E(`studentDetail(curClass(), subjectById("ma"), studentById(curClass(), "${anna}"), "year")`);
  app.klick('#calc-open');
  erwarte(app.$$('#calc-lines .calc-h').length === 5 && app.$('#sheet').dataset.sens === '1', 'Rechenweg-Blatt fehlt oder ist nicht als sensibel markiert');
  const box = downloadAbfangen(app);
  app.klick('#calc-pdf');
  const pdf = await blobText(app, box.blob);
  erwarte(/^Rechenweg_Anna_Mathe/.test(box.name) && /-> /.test(pdf) && !/\?\d/.test(pdf.replace(/\\\d{3}/g, '')), 'PDF des Rechenwegs fehlt oder Zeichen falsch: ' + box.name);
  app.klick('#calc-back');
  erwarte(!!app.$('#zd-switch') && !!app.$('#calc-open'), 'Zurück führt nicht zum Namen');
  // Gesprächsblatt: nur auf Wunsch
  const talk = () => app.E(`talkSheetPages(curClass(), studentById(curClass(), "${anna}")).map(p => p.content).join("\\n")`);
  erwarte(!/Notenvorschlag/.test(talk()), 'Rechenweg ungefragt im Gesprächsblatt');
  app.klick('#calc-open'); app.klick('#calc-talk');
  erwarte(app.E('DB.settings.talkCalc') === true && /Notenvorschlag/.test(talk()), 'Rechenweg fehlt im Gesprächsblatt');
  erwarte(app.E('sanitizeDB({ v: 2, settings: { talkCalc: "ja" } }).settings.talkCalc') === undefined && app.E('sanitizeDB({ v: 2, settings: { talkCalc: true } }).settings.talkCalc') === true, 'Einstellung beim Laden falsch geprüft');
  app.E('closeModal()');
});

test('Schülermodus: Beenden nur mit Entsperren, Hinweis ohne Sperre', async app => {
  klasseMitNamen(app);
  neuerPlan(app, 0, 'Zufällig');
  app.E('DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }); DB.gradesAck = true; setLesson(true)');
  const m = bioMock(app);
  const body = app.w.document.body;
  // ohne Sperre: Hinweis mit Einschalten / Weiter
  app.klick('#lb-self'); app.sheetOk();
  erwarte(!!app.$('#self-guard-on') && !!app.$('#self-guard-skip') && !body.classList.contains('selfmode'), 'Kein Hinweis auf die Sperre vor dem Schülermodus');
  app.klick('#self-guard-skip');
  erwarte(body.classList.contains('selfmode') && app.E('DB.selfGuardSeen') === true, '„Ohne Sperre weiter“ startet nicht');
  app.$('#self-exit').dispatchEvent(new app.w.Event('pointerdown')); await pause(2150);
  erwarte(!body.classList.contains('selfmode') && m.calls === 0, 'Ohne Sperre wird beim Beenden entsperrt oder es endet nicht');
  // einmalig: beim nächsten Mal kein Hinweis
  app.klick('#lb-self'); app.sheetOk();
  erwarte(body.classList.contains('selfmode') && !app.$('#self-guard-on'), 'Hinweis erscheint jedes Mal');
  app.E('endSelfMode(true)');
  // „Sperre einschalten“ schaltet ein und startet
  app.E('delete DB.selfGuardSeen');
  app.klick('#lb-self'); app.sheetOk(); app.klick('#self-guard-on');
  erwarte(app.E('DB.settings.lock') === true && body.classList.contains('selfmode'), 'Einschalten aus dem Hinweis klappt nicht');
  // mit Sperre: Halten allein genügt nicht – Abbruch bleibt im Modus
  m.next = 'abbruch'; const c0 = m.calls;
  app.$('#self-exit').dispatchEvent(new app.w.Event('pointerdown')); await pause(2150);
  erwarte(body.classList.contains('selfmode') && m.calls === c0 + 1 && /Nicht entsperrt/.test(app.$('#toast').textContent), 'Schülermodus endet ohne Entsperren');
  // erfolgreich: beendet, Noten danach offen (Lehrkraft hat sich ausgewiesen)
  m.next = 'ok';
  app.$('#self-exit').dispatchEvent(new app.w.Event('pointerdown')); await pause(2150);
  erwarte(!body.classList.contains('selfmode') && app.E('lockOpen') === true, 'Entsperren beendet den Schülermodus nicht');
  // Gerät ohne nutzbare Entsperrung: nicht festsetzen, Noten bleiben zu
  app.klick('#lb-self'); app.sheetOk();
  erwarte(body.classList.contains('selfmode') && !app.$('#self-guard-on'), 'Mit Sperre trotzdem Hinweis');
  m.next = 'nobio';
  app.$('#self-exit').dispatchEvent(new app.w.Event('pointerdown')); await pause(2150);
  erwarte(!body.classList.contains('selfmode') && app.E('lockOpen') === false, 'Ohne nutzbare Entsperrung festgesetzt oder Noten offen');
  // danach darf das Gerät (vielleicht in Schülerhand) nicht anbieten, die Sperre auszuschalten
  app.E('lockError({ code: -106 })');
  erwarte(!app.$('#modal').classList.contains('on') && app.E('DB.settings.lock') === true, 'Nach dem Schülermodus lässt sich die Sperre ohne Entsperren ausschalten');
  app.E('lockBrokenAfterSelf = false');
  // Browser (keine App): wie bisher, kein Hinweis
  app.E('window.__c = window.cordova; delete window.cordova; delete DB.selfGuardSeen; DB.settings.lock = false');
  app.klick('#lb-self'); app.sheetOk();
  erwarte(body.classList.contains('selfmode') && !app.$('#self-guard-on'), 'Hinweis im Browser, obwohl es dort keine Sperre gibt');
  app.E('endSelfMode(true); window.cordova = window.__c');
  // Hilfe nennt den geführten Zugriff
  erwarte(app.E('I18N.de.info.some(s => /Geführten Zugriff|Geführter Zugriff/.test((s.p || []).join(" ")))') && app.E('I18N.en.info.some(s => /Guided Access/.test((s.p || []).join(" ")))'), 'Tipp „Geführter Zugriff“ fehlt in der Hilfe');
});

test('Daten & Datenschutz: Übersicht, Speicher, alte Klassen, Sicherung ohne Passwort', async app => {
  klasseMitNamen(app, '5a', ['Anna', 'Ben']);
  klasseMitNamen(app, '9c', ['Cem', 'Dana', 'Emil']);
  app.E('goHome()');
  app.klick('#btn-privacy');
  erwarte(!!app.$('#pv-backup .pvi.warn') && /Noch keine Sicherung/.test(app.$('#pv-backup').textContent), 'Fehlende Sicherung nicht gewarnt');
  erwarte(/nur in der App/.test(app.$('#pv-lock').textContent), 'Sperre im Browser falsch dargestellt');
  erwarte(/Klassen: 2 · Namen: 5/.test(app.$('#pv-counts').textContent), 'Anzahlen falsch: ' + app.$('#pv-counts').textContent);
  erwarte(!!app.$('#pv-storage .pvbar') && !app.$('#pv-storage-warn'), 'Speicheranzeige fehlt oder warnt grundlos');
  // Sicherung verschlüsselt und frisch: kein Warnzeichen
  app.E('closeModal(); DB.lastBackup = new Date().toISOString(); DB.lastBackupEnc = true'); app.klick('#btn-privacy');
  erwarte(!app.$('#pv-backup .pvi.warn') && /verschlüsselt/.test(app.$('#pv-backup').textContent), 'Verschlüsselte Sicherung nicht erkannt');
  erwarte(app.E('sanitizeDB({ v: 2, lastBackupEnc: true }).lastBackupEnc') === true && app.E('sanitizeDB({ v: 2, lastBackupEnc: "ja" }).lastBackupEnc') === undefined, 'Merkmal beim Laden falsch');
  // frisch, aber ohne Passwort: Warnzeichen
  app.E('closeModal(); delete DB.lastBackupEnc'); app.klick('#btn-privacy');
  erwarte(!!app.$('#pv-backup .pvi.warn') && /ohne Passwort/.test(app.$('#pv-backup').textContent) && /Achtung/.test(app.$('#pv-backup').textContent), 'Sicherung ohne Passwort nicht gewarnt');
  app.E('closeModal(); DB.lastBackupEnc = true; DB.selfGuardSeen = true'); app.klick('#btn-privacy');
  // Gerätebezogenes nicht in die Sicherung
  erwarte(app.E('backupData().lastBackupEnc') === undefined && app.E('backupData().selfGuardSeen') === undefined, 'Gerätebezogene Merkmale landen in der Sicherung');
  // Laden einer Sicherung behält die Merkmale dieses Geräts
  app.E('closeModal(); window.__lb = DB.lastBackup; applyRestore(sanitizeDB(Object.assign(backupData(), { lastBackup: "2020-01-01T00:00:00.000Z" })), "x")');
  erwarte(app.E('DB.lastBackupEnc') === true && app.E('DB.selfGuardSeen') === true && app.E('DB.lastBackup === window.__lb'), 'Laden überschreibt Sicherungsstand oder Hinweis dieses Geräts');
  app.klick('#btn-privacy');
  // alte Klasse löschen → Papierkorb
  const id5 = app.E('DB.classes.find(c => c.name === "5a").id');
  app.klick(`#pv-classes [data-cid="${id5}"]`);
  app.klick('#pv-delete'); app.sheetOk(); await pause(90);
  erwarte(app.E('DB.classes.length') === 1 && app.E('DB.trash.some(e => e.kind === "class" && e.name === "5a")') && !!app.$('#pv-status'), 'Klasse nicht in den Papierkorb oder Übersicht nicht wieder offen');
  app.klick('#pv-delete');
  erwarte(/mindestens eine/.test(app.$('#toast').textContent), 'Löschen ohne Auswahl nicht abgefangen');
  // Papierkorb leeren
  app.klick('#pv-trash'); app.sheetOk(); await pause(90);
  erwarte(app.E('DB.trash.length') === 0 && !app.$('#pv-trash'), 'Papierkorb nicht geleert');
  app.E('closeModal()');
  // Speicher knapp: Warnung in der Übersicht und einmal beim Start
  app.E('window.__get = Store.get; Store.get = k => k === KEY ? "x".repeat(2100000) : window.__get.call(Store, k); flushSave = () => true');
  app.E('openPrivacy()');
  erwarte(!!app.$('#pv-storage-warn') && /8\d %/.test(app.$('#pv-storage').textContent), 'Knapper Speicher nicht gewarnt: ' + app.$('#pv-storage').textContent);
  app.E('closeModal(); storageWarned = false; renderStart()'); await pause(1000);
  erwarte(/zu 8\d % belegt/.test(app.$('#toast').textContent), 'Keine Warnung beim Start');
  app.E('Store.get = window.__get');
  // Sicherung ohne Passwort: Rückfrage
  if(app.E('hasCrypto()')){
    const box = downloadAbfangen(app);
    app.klick('#btn-backup'); app.klick('#bk-plain');
    erwarte(/Ohne Passwort sichern\?/.test(app.$('#sheet h3').textContent) && !box.name, 'Keine Rückfrage vor unverschlüsselter Sicherung');
    app.sheetOk();
    erwarte(/fairseat-backup/.test(box.name || '') && app.E('DB.lastBackupEnc') === undefined, 'Sicherung ohne Passwort nach Rückfrage fehlt oder bleibt als verschlüsselt markiert');
  }
});

test('Namen aus Excel- und CSV-Datei, klügeres Einfügen', async app => {
  klasseMitNamen(app, '7b', ['Ida W.']);
  const fs = require('fs'), path = require('path');
  if(typeof app.w.DecompressionStream === 'undefined') app.w.DecompressionStream = DecompressionStream;
  if(typeof app.w.TextDecoder === 'undefined') app.w.TextDecoder = TextDecoder;
  const bytes = f => { const b = fs.readFileSync(path.join(__dirname, 'test', f)); return new app.w.Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
  // Excel: Überschrift in Zeile 3, „Name“ neben „Vorname“ = Nachname, Blatt über die Verknüpfung, Rich-Text, Inline-Text
  await app.w.importNameFile(bytes('namen.xlsx'), 'namen.xlsx');
  erwarte(!!app.$('#nf-list') && /5 Namen gefunden/.test(app.$('#nf-info').textContent) && /Vorname/.test(app.$('#nf-info').textContent), 'Excel-Datei nicht gelesen: ' + (app.$('#nf-info') || {}).textContent);
  const rows = () => app.$$('#nf-list .nfrow').map(r => r.querySelector('span').textContent + (r.querySelector('small') ? '|' + r.querySelector('small').textContent : ''));
  erwarte(JSON.stringify(rows()) === JSON.stringify(['Anna M.|doppelt – anderes Format wählen', 'Anna M.|doppelt – anderes Format wählen', 'Hasan Ö.', 'Ida W.|schon in der Klasse', 'Rosa L.']), 'Vorschau falsch: ' + JSON.stringify(rows()));
  erwarte(!/Falsches Blatt|Seite|Klassenliste|Geburtsdatum/.test(app.$('#nf-list').textContent), 'Kopfzeilen oder falsches Blatt übernommen');
  app.klick('#nf-format button[data-v="full"]');
  erwarte(JSON.stringify(rows()) === JSON.stringify(['Anna Müller', 'Anna Meyer', 'Hasan Öztürk', 'Ida Weiß', 'Rosa Lindqvist']) && app.$('#nf-ok').textContent === 'Übernehmen (5)', 'Format „Vorname Nachname“ falsch: ' + JSON.stringify(rows()));
  // abwählen
  const cb = app.$$('#nf-list input')[4]; cb.checked = false; cb.dispatchEvent(new app.w.Event('change'));
  erwarte(app.$('#nf-ok').textContent === 'Übernehmen (4)', 'Abwählen zählt nicht');
  app.klick('#nf-ok');
  erwarte(app.E('curClass().students.map(s => s.name).join()') === 'Ida W.,Anna Müller,Anna Meyer,Hasan Öztürk,Ida Weiß', 'Falsche Namen übernommen: ' + app.E('curClass().students.map(s => s.name).join()'));
  // CSV aus Excel unter Windows (Windows-1252, Semikolon, Anführungszeichen); Adressen bleiben außen vor
  await app.w.importNameFile(bytes('namen.csv'), 'namen.csv');
  app.klick('#nf-format button[data-v="first"]');
  erwarte(JSON.stringify(rows()) === JSON.stringify(['Uwe', 'Jörg']) && !/Haupt|Weg/.test(app.$('#nf-list').textContent), 'CSV falsch gelesen: ' + JSON.stringify(rows()));
  app.E('closeModal()');
  // „Nachname, Vorname“ zeilenweise ohne Überschrift; Excel „Unicode-Text“ (UTF-16)
  const enc = str => new app.w.Uint8Array(Array.from(Buffer.from(str, 'utf8')));
  await app.w.importNameFile(enc('Kowalski, Anna\nBerg, Tom\n'), 'l.csv');
  erwarte(JSON.stringify(rows()) === JSON.stringify(['Anna K.', 'Tom B.']), '„Nachname, Vorname“ verliert den Vornamen: ' + JSON.stringify(rows()));
  app.E('closeModal()');
  const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('Vorname\tNachname\r\nZoë\tÅberg\r\n', 'utf16le')]);
  await app.w.importNameFile(new app.w.Uint8Array(Array.from(u16)), 'u.txt');
  erwarte(JSON.stringify(rows()) === JSON.stringify(['Zoë Å.']), 'UTF-16 falsch gelesen: ' + JSON.stringify(rows()));
  app.E('closeModal()');
  // alte .xls und kaputte Dateien
  await app.w.importNameFile(new app.w.Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0, 0]), 'x.xls');
  erwarte(/\.xls/.test(app.$('#toast').textContent), 'Hinweis zu .xls fehlt');
  await app.w.importNameFile(new app.w.Uint8Array([0x50, 0x4B, 3, 4, 0, 0, 0]), 'x.xlsx');
  erwarte(/nicht lesen/.test(app.$('#toast').textContent), 'Kaputte Datei nicht abgefangen');
  const DS = app.w.DecompressionStream; delete app.w.DecompressionStream; app.w.DecompressionStream = undefined;
  await app.w.importNameFile(bytes('namen.xlsx'), 'namen.xlsx');
  erwarte(/als CSV speichern/.test(app.$('#toast').textContent), 'Ohne Entpacken kein Hinweis');
  app.w.DecompressionStream = DS;
  // Einfügen aus einer PDF: Nummern, Datum, Kopfzeilen
  const vorher = app.E('curClass().students.length');
  app.$('#student-input').value = 'Klassenliste 7b\nSchuljahr 2026/27\n1. Tom Berg 12.03.2013\n2) Lea Sommer\nSeite 1 von 2\n17\nKind 3\nBen Ott 2012-05-01\nPage Miller';
  app.klick('#btn-add-students');
  erwarte(app.E('curClass().students.slice(-5).map(s => s.name).join()') === 'Tom Berg,Lea Sommer,Kind 3,Ben Ott,Page Miller' && app.E('curClass().students.length') === vorher + 5, 'Einfügen räumt nicht auf: ' + app.E('curClass().students.slice(-4).map(s => s.name).join()'));
  // reine Hilfsfunktionen
  erwarte(app.E('JSON.stringify(parseCsvRows("a,b\\n\\"x, y\\",z"))') === '[["a","b"],["x, y","z"]]', 'CSV mit Komma in Anführungszeichen falsch');
  erwarte(app.E('JSON.stringify(rowsToNameEntries([["Schüler/in"],["Berg, Tom"],["Lea Sommer"]]).entries)') === '[{"first":"Tom","last":"Berg"},{"first":"Lea","last":"Sommer"}]', '„Nachname, Vorname“ nicht gedreht');
});

test('Abgleich: zieldifferent, Elternkontakte, PC-Plätze', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    const ben = sid(app, 'Ben'), anna = sid(app, 'Anna');
    uhr(app, 2000); app.E(`setZd(curClass(), "ma", "${ben}", true); addObs(curClass(), "${anna}", "Telefonat Mutter", "ma", "2026-10-01", "phone"); flushSave()`);
    uhr(B, 2100); B.E(`setZd(curClass(), "ma", "${anna}", true); flushSave()`);
    uhr(app, 3000); await laden(app, datei(B), 'merge');
    uhr(B, 3100); await laden(B, datei(app), 'merge');
    erwarte(inhalt(app) === inhalt(B), 'Geräte unterschiedlich');
    erwarte(app.E('curClass().zd.length') === 2 && B.E('curClass().obs.some(o => o.k === "parent" && o.m === "phone")'), 'Merkmal oder Elternkontakt nicht übertragen');
    uhr(app, 4000); app.E(`setZd(curClass(), "ma", "${ben}", false); flushSave()`);
    uhr(B, 4100); await laden(B, datei(app), 'merge');
    erwarte(B.E(`isZd(curClass(), "ma", "${ben}")`) === false, 'Entfernen des Merkmals nicht übertragen');
  } finally { B.ende(); }
});

test('Platz sperren und Regel-Meldung', async app => {
  klasseMitNamen(app);                                   // 12 Namen
  neuerPlan(app, 0, 'Zufällig');
  const sel = ids => app.E(`selected.clear(); ${JSON.stringify(ids)}.forEach(i => selected.add(i)); renderStage(false)`);
  app.E('while(curPlan().desks.length < 14) curPlan().desks.push({ id: uid(), type: "desk", x: 40 + curPlan().desks.length * 5, y: 600, w: 90, h: 55, rot: 0 }); renderStage(false)');
  const d0 = app.E('curPlan().desks[0].id'), d1 = app.E('curPlan().desks[1].id');
  sel([d0, d1]);
  erwarte(app.$('#sb-block').style.display !== 'none' && /Platz sperren/.test(app.$('#sb-block').textContent), 'Knopf „Platz sperren“ fehlt');
  app.klick('#sb-block');
  erwarte(app.E(`["${d0}","${d1}"].every(id => { const d = curPlan().desks.find(x => x.id === id); return d.blocked && !d.studentId; })`), 'Sperren leert die Plätze nicht');
  erwarte(app.$(`#stage .item[data-id="${d0}"]`).classList.contains('blocked') && /gesperrt/.test(app.$(`#stage .item[data-id="${d0}"]`).textContent), 'Gesperrter Platz nicht erkennbar');
  erwarte(/Platz freigeben/.test(app.$('#sb-block').textContent), 'Umschalten zeigt nicht „freigeben“');
  // automatisch setzen, mischen, Gruppen: nie auf gesperrte Plätze
  for(let i = 0; i < 5; i++){ app.E('autoSeat(true, true)'); erwarte(app.E('curPlan().desks.filter(d => d.blocked).every(d => !d.studentId)') && app.E('curPlan().desks.filter(d => d.studentId).length') === 12, 'Automatisch setzt auf gesperrte Plätze'); }
  app.klick('#btn-shuffle');
  erwarte(app.E('curPlan().desks.filter(d => d.blocked).every(d => !d.studentId)') && app.E('curPlan().desks.filter(d => d.studentId).length') === 12, 'Mischen setzt auf gesperrte Plätze');
  app.E('curClass().groups = [{ id: "g1", name: "G", members: curClass().students.slice(0, 4).map(s => s.id) }]; seatByGroups(true)');
  erwarte(app.E('curPlan().desks.filter(d => d.blocked).every(d => !d.studentId)'), 'Gruppen setzen auf gesperrte Plätze');
  // Ziehen auf gesperrten Platz wird abgelehnt
  const sidA = app.E('curClass().students[0].id');
  app.E(`placeStudent("${sidA}", curPlan().desks.find(d => d.id === "${d0}"), curPlan().desks.find(d => d.studentId === "${sidA}"))`);
  erwarte(!app.E(`curPlan().desks.find(d => d.id === "${d0}").studentId`) && /gesperrt/.test(app.$('#toast').textContent), 'Name lässt sich auf gesperrten Platz ziehen');
  // Klassenarbeit: keine Nummer, keine Gruppe
  app.E('curPlan().exam = true; assignExamGroups(curPlan()); renderStage(false)');
  erwarte(!app.E(`curPlan().desks.find(d => d.id === "${d0}").var`) && !app.E(`examNumbers(curPlan()).has("${d0}")`) && app.E('examNumbers(curPlan()).size') === 12, 'Gesperrter Platz bekommt Nummer oder Gruppe');
  app.E('curPlan().exam = false; curPlan().desks.forEach(d => delete d.var)');
  // Laden: Sperre nur bei leeren Tischen
  erwarte(app.E('sanitizeItem({ type: "desk", blocked: true }).blocked') === true && app.E('sanitizeItem({ type: "desk", blocked: true, studentId: "x" }).blocked') === undefined && app.E('sanitizeItem({ type: "window", blocked: true }).blocked') === undefined, 'Sperre beim Laden falsch geprüft');
  app.E('renderUnseated()');
  erwarte(/12 von 12 Plätzen belegt/.test(app.w.document.body.textContent), 'Gesperrte Plätze zählen bei „belegt“ mit');
  // neue Vorlage: Sperre fällt weg (der Platz „hinter der Säule“ wäre jetzt irgendwo)
  app.E('pushUndo(); layoutDesks("rows", true)');
  erwarte(app.E('curPlan().desks.every(d => !d.blocked)'), 'Sperre wandert mit der Vorlage');
  app.E('undo()');
  // freigeben
  sel([d0, d1]); app.klick('#sb-block');
  erwarte(app.E(`!curPlan().desks.find(d => d.id === "${d0}").blocked`), 'Freigeben geht nicht');
  // Regel-Meldung: „x von y Regeln erfüllt“
  const [a, b, c2] = app.E('curClass().students.slice(0, 3).map(s => s.id)');
  app.E(`curClass().rules = [{ id: "r1", a: "${a}", b: "${b}", type: "apart" }, { id: "r2", a: "${a}", b: "${c2}", type: "apart" }]; DB.settings.rules = true`);
  app.klick('#btn-auto');
  erwarte(/2 von 2 Regeln erfüllt/.test(app.$('#toast').textContent), 'Regel-Meldung fehlt: ' + app.$('#toast').textContent);
  app.E(`DB.settings.tags = true; curClass().students[5].tags = ["front"]`);
  app.klick('#btn-auto');
  erwarte(/\d von 3 Regeln/.test(app.$('#toast').textContent), 'Sitzwunsch „vorne“ nicht mitgezählt: ' + app.$('#toast').textContent);
  app.E('curClass().rules = []; curClass().students.forEach(s => s.tags = [])');
  app.klick('#btn-auto');
  erwarte(/^Namen gesetzt/.test(app.$('#toast').textContent), 'Ohne Regeln falsche Meldung: ' + app.$('#toast').textContent);
});

test('Größere Schrift und Knöpfe', app => {
  app.E('renderSettings(); show("settings")');
  erwarte(!!app.$('#set-big') && !app.w.document.body.classList.contains('big'), 'Einstellung fehlt');
  app.klick('#set-big');
  erwarte(app.E('DB.big') === true && app.w.document.body.classList.contains('big'), 'Größere Schrift lässt sich nicht einschalten');
  erwarte(app.E('backupData().big') === undefined && app.E('sanitizeDB({ v: 2, big: true }).big') === true && app.E('sanitizeDB({ v: 2, big: "ja" }).big') === undefined, 'Merkmal falsch gesichert oder geladen');
  app.klick('#set-big');
  erwarte(app.E('DB.big') === undefined && !app.w.document.body.classList.contains('big'), 'Ausschalten geht nicht');
});

test('Tagesübersicht: weitere Stunden und offene Aufgaben', app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem']);
  const now = new Date(), wd = (now.getDay() + 6) % 7;
  app.E(`(() => { const c = curClass(); DB.settings.timetable = true; DB.tt.days = 7; DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" });
    const T = periodTimes(); DB.lessons = [];
    for(let p = 0; p < T.length; p++) DB.lessons.push({ id: "L" + p, classId: c.id, subjectId: "ma", day: ${wd}, period: p, span: 1, room: "" });
    for(let d = 0; d < 7; d++) if(d !== ${wd}) DB.lessons.push({ id: "X" + d, classId: c.id, subjectId: "ma", day: d, period: 0, span: 1, room: "" });
    c.journal = [{ id: "j0", d: isoDay(new Date(Date.now() - 20 * 86400000)), p: 0, s: "ma", topic: "Brüche", hw: "" }]; })()`);
  // Uhr auf 23:59: alle heutigen Stunden sind vorbei
  const late = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59).getTime();
  app.E(`Date.now = () => ${late}; window.__D = Date; Date = class extends window.__D { constructor(...a){ if(a.length) super(...a); else super(${late}); } static now(){ return ${late}; } }`);
  const P = app.E('periodTimes().length');
  const gap = () => { const m = /(\d+) Stunden? ohne Kursheft/.exec(app.E('JSON.stringify(dayTasks(new Date()))')); return m ? +m[1] : 0; };
  // nur heute (Tage ohne jede Spur in der App, z. B. Ferien, zählen nicht)
  erwarte(gap() === P, 'Kursheft-Lücken heute falsch: ' + gap() + ' statt ' + P);
  // vor 7 Tagen gab es Fehlzeiten → dieser Tag zählt mit
  app.E(`curClass().absLog = [{ d: isoDay(new Date(Date.now() - 7 * 86400000)), p: 0, n: 1, s: "ma", ids: [curClass().students[0].id] }]`);
  erwarte(gap() === 2 * P, 'Tag mit Spuren nicht gezählt: ' + gap());
  // Eintrag ohne Stunde (p = -1), aber mit Fach: deckt die Stunden dieses Tages
  app.E('curClass().journal.push({ id: "j1", d: isoDay(new Date()), p: -1, s: "ma", topic: "x", hw: "" })');
  erwarte(gap() === P, 'Eintrag ohne Stunde nicht erkannt: ' + gap());
  // erster Eintrag erst gestern: davor nicht mahnen
  app.E('curClass().journal = [{ id: "j2", d: isoDay(new Date(Date.now() - 86400000)), p: 0, s: "ma", topic: "x", hw: "" }]');
  erwarte(gap() === P, 'Vor dem ersten Eintrag gemahnt: ' + gap());
  // anderes Fach ohne Kursheft: nie
  app.E('DB.subjects.push({ id: "de", name: "Deutsch", short: "De", color: "#20A464" }); DB.lessons.forEach(L => L.subjectId = "de")');
  erwarte(gap() === 0, 'Fach ohne Kursheft gemahnt');
  app.E('DB.lessons.forEach(L => L.subjectId = "ma")');
  // Klassen ohne Kursheft: keine Mahnung
  app.E('curClass().journal = []');
  erwarte(!/Kursheft/.test(app.E('JSON.stringify(dayTasks(new Date()))')), 'Mahnung, obwohl das Kursheft nicht genutzt wird');
  // offene Abhakliste
  app.E(`curClass().checks = [{ id: "k1", title: "Elternbrief", date: isoDay(new Date()), done: [curClass().students[0].id] }, { id: "k2", title: "Alt", date: "2020-01-01", done: [] },
    { id: "k3", title: "Unberührt", date: isoDay(new Date(Date.now() - 20 * 86400000)), done: [] }, { id: "k4", title: "Neu", date: isoDay(new Date()), done: [] }]`);
  app.E('Date = window.__D; goHome()');
  erwarte(/Elternbrief \(7b\): 2 fehlen noch/.test(app.$('#day-tasks').textContent) && !/Alt|Unberührt/.test(app.$('#day-tasks').textContent) && /Neu \(7b\): 3 fehlen/.test(app.$('#day-tasks').textContent), 'Offene Abhakliste falsch: ' + (app.$('#day-tasks') || {}).textContent);
  app.klick('#day-tasks .daytask[data-id="k-k1"]');
  erwarte(!!app.$('#ck-names'), 'Tipp öffnet die Abhakliste nicht');
  app.E('closeModal()');
});

test('Feedback-Zielscheibe: anonym sammeln, auswerten, schützen, abgleichen', async app => {
  klasseMitNamen(app, '7b', ['Anna', 'Ben']);
  app.E('goNames()');
  app.klick('#btn-class-targets');
  erwarte(app.$$('#tg-count button').length === 4 && app.$$('#tg-labels input').length === 4 && app.$('#tg-a0').value === 'Thema und Lerninhalte', 'Einrichten: Bereiche oder Vorgaben fehlen');
  app.klick('#tg-count button[data-v="2"]');
  erwarte(app.$$('#tg-labels input').length === 2 && app.$('#tg-a1').value === 'Methoden', 'Zwei Bereiche falsch');
  app.klick('#tg-count button[data-v="1"]');
  erwarte(app.$$('#tg-labels input').length === 0, 'Ohne Einteilung zeigt Bereichsfelder');
  app.klick('#tg-count button[data-v="4"]');
  app.klick('#tg-start');
  erwarte(/Thema/.test(app.$('#toast').textContent) && app.E('curClass().targets.length') === 0, 'Ohne Frage gestartet');
  app.$('#tg-question').value = 'Wie war die Einheit Brüche?';
  app.klick('#tg-start');
  const body = app.w.document.body;
  erwarte(app.$('#screen-target').classList.contains('active') && app.E('DB.targetLock.targetId') === app.E('curClass().targets[0].id'), 'Schülermodus der Zielscheibe startet nicht');
  erwarte(app.$('#tg-next').disabled && app.$$('#tg-svg path').length === 12, 'Zielscheibe falsch gezeichnet oder „Nächster“ zu früh aktiv');
  // Tippen: je Bereich ein Punkt (oben links, oben rechts, unten rechts, unten links)
  app.E('targetTap(-30, -30); targetTap(40, -10)');
  erwarte(/Noch offen: Lernklima in der Klasse, Meine Motivation/.test(app.$('#tg-hint').textContent) && app.$('#tg-next').disabled, 'Hinweis auf offene Bereiche fehlt: ' + app.$('#tg-hint').textContent);
  app.E('targetTap(20, 50); targetTap(-60, 30); targetTap(200, 0)');          // letzter Tipp daneben
  erwarte(!app.$('#tg-next').disabled && app.E('targetRun.cur.map(p => p.r).join()') === '0.42,0.41,0.54,0.67', 'Punkte falsch: ' + app.E('targetRun.cur.map(p => p && p.r).join()'));
  app.E('targetTap(-5, -5)');                                              // im selben Bereich: Punkt wandert
  erwarte(app.E('targetRun.cur[0].r') === 0.07 && app.E('targetRun.order.join()') === '1,2,3,0', 'Erneuter Tipp verschiebt nicht');
  app.klick('#tg-undo');
  erwarte(app.E('targetRun.cur[0]') === null && app.$('#tg-next').disabled, 'Rückgängig nimmt den letzten Punkt nicht weg');
  app.E('targetTap(-5, -5)'); app.klick('#tg-next');
  erwarte(app.E('curClass().targets[0].pts.length') === 4 && /1 Rückmeldung$/.test(app.$('#tg-n').textContent) && app.E('targetRun.cur.every(p => !p)'), '„Nächster“ speichert nicht oder leert nicht');
  erwarte(app.E('curClass().targets[0].pts.every(q => Object.keys(q).sort().join() === "a,id,k,r")'), 'Mehr als Punkte gespeichert');
  // Kennungen ohne Uhrzeit, Zeitstempel ohne Uhrzeit – sonst ließe sich die Reihenfolge rekonstruieren
  const t36 = Date.now().toString(36).slice(0, 5);
  erwarte(app.E(`curClass().targets[0].pts.every(q => q.id.slice(0, 5) !== "${t36}")`), 'Punkt-Kennungen enthalten die Uhrzeit');
  app.E('flushSave()');
  erwarte(app.E('Object.keys(DB.stamps).filter(k => k.startsWith("tp|")).every(k => DB.stamps[k] === 1)') && app.E('Object.keys(DB.stamps).some(k => k.startsWith("tp|"))'), 'Punkte tragen einen Zeitstempel');
  // ohne Zeigen bedienbar
  erwarte(app.$$('#tg-a11y button').length === 12 && /Meine Motivation: weniger gut/.test(app.$('#tg-a11y').textContent), 'Knöpfe für Bedienung ohne Zeigen fehlen');
  app.klick(app.$$('#tg-a11y button')[0]);
  erwarte(app.E('targetRun.cur[0].r') === 0.15, 'Knopf setzt keinen Punkt');
  app.klick('#tg-undo');
  app.E('targetTap(-90, -10); targetTap(10, -10); targetTap(10, 10); targetTap(-10, 10)'); app.klick('#tg-next');
  // Zurück-Taste und kurzer Tipp beenden nicht
  app.E('navBack()'); app.klick('#tg-exit');
  erwarte(app.$('#screen-target').classList.contains('active'), 'Zielscheibe lässt sich ohne Halten verlassen');
  app.$('#tg-exit').dispatchEvent(new app.w.Event('pointerdown')); await pause(1900); await bis(() => app.$('#screen-names').classList.contains('active') && !!app.$('#tg-means'));
  erwarte(app.$('#screen-names').classList.contains('active') && !app.E('DB.targetLock') && !!app.$('#tg-means'), 'Halten beendet nicht oder Auswertung fehlt');
  // Mittelwerte: Bereich 1 hat r = 0,07 und 0,91 → Ø 51 %
  erwarte(/Thema und Lerninhalte: Ø 51 % \(2 Punkte\)/.test(app.$('#tg-means').textContent), 'Mittelwert falsch: ' + app.$('#tg-means').textContent);
  // PDF
  const box = downloadAbfangen(app);
  app.klick('#tg-pdf');
  const pdf = await blobText(app, box.blob);
  erwarte(/^Zielscheibe_7b/.test(box.name) && /Wie war die Einheit/.test(pdf), 'PDF der Zielscheibe fehlt: ' + box.name);
  // groß zeigen und mit kurzem Tipp zurück
  app.klick('#tg-big');
  erwarte(app.$('#screen-target').classList.contains('result') && !app.E('DB.targetLock') && app.$$('#tg-svg circle').length >= 8 + 3, 'Große Ansicht fehlt');
  app.klick('#tg-exit'); await bis(() => app.$('#screen-names').classList.contains('active') && !!app.$('#tg-means'));
  erwarte(app.$('#screen-names').classList.contains('active') && !!app.$('#tg-means'), 'Große Ansicht lässt sich nicht schließen');
  // Liste: Runde mit Mittelwerten
  app.E('closeModal(); openTargets(curClass())');
  erwarte(app.$$('#tg-rounds .grpcard').length === 1 && /2 Rückmeldungen/.test(app.$('#tg-rounds').textContent) && app.$$('#tg-rounds .tgchips span').length === 4, 'Rundenliste falsch');
  app.E('closeModal()');
  // mit Sperre: Beenden nur nach Entsperren; Start sperrt die Noten wieder
  const m = bioMock(app);
  app.E('DB.settings.lock = true; DB.selfGuardSeen = true; lockOpen = true; startTarget(curClass(), curClass().targets[0])');
  erwarte(app.E('lockOpen') === false, 'Noten bleiben während der Zielscheibe entsperrt');
  m.next = 'abbruch';
  app.$('#tg-exit').dispatchEvent(new app.w.Event('pointerdown')); await pause(2150);
  erwarte(app.$('#screen-target').classList.contains('active'), 'Mit Sperre ohne Entsperren beendet');
  m.next = 'ok';
  app.$('#tg-exit').dispatchEvent(new app.w.Event('pointerdown')); await pause(1900); await bis(() => !app.$('#screen-target').classList.contains('active'));
  erwarte(!app.$('#screen-target').classList.contains('active') && app.E('lockOpen') === true, 'Mit Entsperren nicht beendet');
  app.E('closeModal(); DB.settings.lock = false');
  // nach einem Neustart weiter im Schülermodus
  app.E('DB.targetLock = { classId: curClass().id, targetId: curClass().targets[0].id }; show("start"); resumeTargetLock()');
  erwarte(app.$('#screen-target').classList.contains('active') && !app.$('#screen-target').classList.contains('result'), 'Nach Neustart nicht zurück in der Zielscheibe');
  app.E('endTarget()'); await pause(150); app.E('closeModal()');   // Auswertung öffnet verzögert – abwarten, sonst überdeckt sie spätere Blätter
  // Ohne Einteilung: ein Punkt
  app.E(`curClass().targets.push({ id: "one", title: "Verstanden?", date: isoDay(new Date()), areas: [""], pts: [] }); startTarget(curClass(), curClass().targets[1])`);
  erwarte(/einmal auf die Zielscheibe/.test(app.$('#tg-hint').textContent) && app.$$('#tg-svg line').length === 0 && app.$$('#tg-a11y button').length === 3, 'Ohne Einteilung falsch');
  app.E('targetTap(0, 50)'); app.klick('#tg-next');
  erwarte(app.E('curClass().targets[1].pts.length') === 1 && app.E('curClass().targets[1].pts[0].k') === 0, 'Ein Punkt nicht gespeichert');
  app.E('endTarget()'); await pause(150); app.E('closeModal()');   // Auswertung öffnet verzögert – abwarten, sonst überdeckt sie spätere Blätter
  // Laden prüft
  const san = app.E(`JSON.stringify(sanTargets([{ id: "t", title: "T", areas: ["a", "b"], pts: [{ id: "p1", k: 1, r: 1.7, a: 0.5 }, { id: "p2", k: 2, r: 0.3, a: 0.1 }, { id: "p1", k: 0, r: 0.2, a: 0 }, { k: 0, r: "x", a: 0 }] }, { title: 5 }]))`);
  erwarte(san === '[{"id":"t","title":"T","date":"' + app.E('isoDay(new Date())') + '","areas":["a","b"],"pts":[{"id":"p1","k":1,"r":1,"a":0.5}]}]', 'Laden prüft Zielscheiben falsch: ' + san);
  // inzwischen gelöscht: die verzögerte Auswertung darf kein anderes Blatt überdecken
  app.E(`curClass().targets.push({ id: "tmp", title: "Weg", date: isoDay(new Date()), areas: [""], pts: [] }); startTarget(curClass(), curClass().targets[2], true); endTarget(); closeModal(); curClass().targets.pop(); openTargets(curClass())`);
  await pause(150);
  erwarte(!!app.$('#tg-rounds') && !app.$('#tg-means'), 'Auswertung einer gelöschten Zielscheibe öffnet sich');
  app.E('closeModal()');
  // löschen
  app.E('openTargetResult(curClass(), curClass().targets[1])'); app.klick('#tg-delete'); app.sheetOk(); await bis(() => app.E('curClass().targets.length') === 1 && !!app.$('#tg-rounds')); await pause(150);   // nichts Verzögertes darf die Liste danach noch überdecken
  erwarte(app.E('curClass().targets.length') === 1 && !!app.$('#tg-rounds'), 'Löschen geht nicht');
  app.E('closeModal()');
  // Unterrichtsleiste
  erwarte(!!app.$('#lb-target'), 'Knopf in der Unterrichtsleiste fehlt');
});

test('Abgleich: Zielscheiben-Punkte von zwei Geräten', async app => {
  const B = neueApp();
  try{
    uhr(app, 1000); grundstand(app);
    app.E('curClass().targets = [{ id: "t1", title: "Feedback", date: "2026-10-10", areas: ["A", "B"], pts: [] }]; flushSave()');
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    uhr(app, 2000); app.E('curClass().targets[0].pts.push({ id: "p1", k: 0, r: 0.2, a: 0.5 }, { id: "p2", k: 1, r: 0.4, a: 0.5 }); flushSave()');
    uhr(B, 2100); B.E('curClass().targets[0].pts.push({ id: "p3", k: 0, r: 0.6, a: 0.5 }, { id: "p4", k: 1, r: 0.8, a: 0.5 }); flushSave()');
    uhr(app, 3000); await laden(app, datei(B), 'merge');
    uhr(B, 3100); await laden(B, datei(app), 'merge');
    erwarte(app.E('curClass().targets[0].pts.length') === 4 && B.E('curClass().targets[0].pts.length') === 4 && inhalt(app) === inhalt(B), 'Punkte zweier Geräte nicht zusammengeführt');
    uhr(app, 4000); app.E('curClass().targets = []; flushSave()');
    uhr(B, 4100); await laden(B, datei(app), 'merge');
    erwarte(B.E('curClass().targets.length') === 0, 'Gelöschte Zielscheibe kehrt zurück');
  } finally { B.ende(); }
});

test('Zeugnisnoten: festlegen, Vorschläge übernehmen, Notenliste, Abgleich', async app => {
  bewertungsKlasse(app);
  app.E(`(() => { const c = curClass(), s = c.students; DB.settings.termSplit = "2027-01-31";
    DB.subjects.push({ id: "de", name: "Deutsch", short: "De", color: "#E67E22" }); c.gradeSubjects = ["ma", "de"];
    c.assess = [{ id: "a1", subjectId: "ma", title: "KA 1", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { [s[0].id]: "2", [s[1].id]: "3", [s[2].id]: "5" } },
                { id: "a2", subjectId: "ma", title: "Mitarbeit", date: "2026-09-12", kind: "other", scale: "grade", weight: 1, marks: { [s[0].id]: "1", [s[1].id]: "3", [s[2].id]: "4" } },
                { id: "a3", subjectId: "ma", title: "KA 2", date: "2027-03-01", kind: "written", scale: "grade", weight: 1, marks: { [s[0].id]: "6" } },
                { id: "d1", subjectId: "de", title: "Aufsatz", date: "2026-09-20", kind: "written", scale: "points", weight: 1, marks: { [s[0].id]: "11" } }];
    c.absLog = [{ d: "2026-09-15", p: 0, n: 2, s: "ma", ids: [s[0].id] }]; c.exc = ["2026-09-15|" + s[0].id]; })(); save()`);
  app.E('gradeSubject = "ma"; gradeTab = "overview"; gradeTerm = "h1"; goGrades("ma")');
  erwarte(app.$$('#g-table .znbtn').length === 4 && app.$$('#g-table .znbtn.set').length === 0 && /0 von 4/.test(app.$('#zn-status').textContent) && /Halbjahreszeugnis/.test(app.$('#zn-status').textContent), 'Spalte Zeugnis oder Status fehlt');
  // einzeln festlegen: Anna (Ø 1,5 → Vorschlag 1) bekommt 2
  const anna = sid(app, 'Anna');
  app.klick(`#g-table .znbtn[data-sid="${anna}"]`);
  erwarte(/Vorschlag: 1/.test(app.$('#zn-info').textContent) && app.$$('#zn-pad button').length === 6 && app.$('#zn-pad button.prop').dataset.tok === '1', 'Auswahl zeigt Vorschlag oder Noten nicht');
  app.klick('#zn-pad button[data-tok="2"]');
  erwarte(app.E(`finalGrade(curClass(), "ma", "${anna}", "h1")`) === '2' && app.$(`#g-table .znbtn[data-sid="${anna}"]`).classList.contains('diff'), 'Zeugnisnote nicht gespeichert oder Abweichung nicht markiert');
  // Vorschläge übernehmen: nur leere, ganzzahlig; Dana ohne Bewertung bleibt leer, Cem (zieldifferent) auch
  app.E(`setZd(curClass(), "ma", "${sid(app, 'Cem')}", true); renderGrades()`);
  app.klick('#zn-all'); app.sheetOk();
  const g = n => app.E(`finalGrade(curClass(), "ma", "${sid(app, n)}", "h1")`);
  erwarte(g('Anna') === '2' && g('Ben') === '3' && g('Cem') === null && g('Dana') === null, 'Übernahme falsch: ' + [g('Anna'), g('Ben'), g('Cem'), g('Dana')].join());
  erwarte(/2 von 4/.test(app.$('#zn-status').textContent), 'Status nicht aktualisiert');
  app.E(`setZd(curClass(), "ma", "${sid(app, 'Cem')}", false); setFinalGrade(curClass(), "ma", "${sid(app, 'Cem')}", "h1", "4"); renderGrades()`);
  erwarte(app.E('gradeTerm = null; defaultGradeTerm()') === 'h1', 'Vor dem Stichtag nicht das 1. Halbjahr vorgewählt');
  app.E('gradeTerm = "h1"; renderGrades()');
  // Halbjahr und Jahr getrennt; das 2. Halbjahr gehört zum Jahreszeugnis – festgelegt wird in der Ansicht „Schuljahr“
  app.klick('#g-term button[data-v="h2"]');
  erwarte(app.$$('#g-table .znbtn').length === 0 && !app.$('#zn-all') && /Ansicht „Schuljahr“/.test(app.$('#zn-status').textContent), '2. Halbjahr bietet Zeugnisnoten mit unpassendem Vorschlag an');
  app.klick('#g-term button[data-v="year"]');
  erwarte(app.$$('#g-table .znbtn.set').length === 0 && /Jahreszeugnis: 0 von 4/.test(app.$('#zn-status').textContent), 'Jahreszeugnis nicht getrennt vom Halbjahr');
  app.klick(`#g-table .znbtn[data-sid="${anna}"]`);
  erwarte(/Vorschlag: 2 \(Ø 2,50\)/.test(app.$('#zn-info').textContent), 'Jahresvorschlag rechnet nicht mit dem ganzen Schuljahr: ' + app.$('#zn-info').textContent);
  app.klick('#zn-pad button[data-tok="3"]');
  erwarte(app.E(`finalGrade(curClass(), "ma", "${anna}", "year")`) === '3' && app.E(`finalGrade(curClass(), "ma", "${anna}", "h2")`) === '3' && app.E(`finalGrade(curClass(), "ma", "${anna}", "h1")`) === '2', 'Halbjahr und Jahr vermischt');
  // entfernen
  app.klick(`#g-table .znbtn[data-sid="${anna}"]`); app.klick('#zn-clear');
  erwarte(app.E(`finalGrade(curClass(), "ma", "${anna}", "year")`) === null, 'Entfernen geht nicht');
  // Punkte-Kurs: 0–15
  app.E('gradeSubject = "de"; gradeTerm = "h1"; renderGrades()');
  app.klick(`#g-table .znbtn[data-sid="${anna}"]`);
  erwarte(app.$$('#zn-pad button').length === 16 && app.$('#zn-pad').classList.contains('k-points') && /Vorschlag: 11/.test(app.$('#zn-info').textContent), 'Punkte-Kurs bietet nicht 0–15');
  app.klick('#zn-pad button[data-tok="12"]');
  // Kurs wechselt danach die Skala: Note bleibt erkennbar, Auswahl warnt
  app.E(`curClass().assess.push({ id: "d2", subjectId: "de", title: "Mitarbeit", date: "2026-09-25", kind: "other", scale: "grade", weight: 1, marks: { ["${anna}"]: "2" } }); renderGrades()`);
  erwarte(app.$(`#g-table .znbtn[data-sid="${anna}"]`).textContent === '12 P.', 'Punktenote nach Skalenwechsel nicht gekennzeichnet: ' + app.$(`#g-table .znbtn[data-sid="${anna}"]`).textContent);
  app.klick(`#g-table .znbtn[data-sid="${anna}"]`);
  erwarte(!!app.$('#zn-scale') && !app.$('#zn-pad button.on'), 'Skalenwechsel in der Auswahl nicht gemeldet');
  app.E('closeModal()');
  app.E('curClass().assess = curClass().assess.filter(a => a.id !== "d2"); save()');
  // Detailblatt
  app.E(`studentDetail(curClass(), subjectById("ma"), curClass().students[0], "h1")`);
  erwarte(/Zeugnis: 2/.test(app.$('#zn-detail').textContent), 'Detailblatt zeigt die Zeugnisnote nicht');
  app.klick('#zn-detail'); app.klick('#zn-pad button[data-tok="1"]');
  erwarte(app.E(`finalGrade(curClass(), "ma", "${anna}", "h1")`) === '1' && /Zeugnis: 1/.test(app.$('#zn-detail').textContent), 'Ändern im Detailblatt kehrt nicht zurück');
  app.E('closeModal()');
  // Notenliste als PDF und als erstes Excel-Blatt
  const box = downloadAbfangen(app);
  app.E('gradeSubject = "ma"; renderGrades()'); app.klick('#zn-list');
  const pdf = await blobText(app, box.blob);
  erwarte(/Notenliste/.test(box.name) && /Halbjahreszeugnis/.test(box.name) && /\(Anna\)/.test(pdf) && /\(Ma\)/.test(pdf) && /\(De\)/.test(pdf) && /\(12\)/.test(pdf) && /4 Noten noch offen/.test(pdf), 'Notenliste unvollständig: ' + box.name);
  const sh = app.E('JSON.stringify(gradesXlsxSheets(curClass(), "h1").find(x => /Zeugnisnoten/.test(x.name)))');
  const S0 = JSON.parse(sh);
  erwarte(/Zeugnisnoten/.test(S0.name) && S0.rows[0].join('|') === 'Name|Mathe|Deutsch|Fehlstd.|unentsch.' && S0.rows[1].join('|') === 'Anna|1|12|2|0' && S0.rows[4][1] === '', 'Excel-Blatt Zeugnisnoten falsch: ' + sh);
  // Laden prüft, Löschen eines Fachs räumt auf
  const san = app.E(`JSON.stringify(sanFinals([{ s: "ma", t: "h1", sid: "${anna}", g: "2" }, { s: "ma", t: "h1", sid: "${anna}", g: "3" }, { s: "ma", t: "h2", sid: "${anna}", g: "2" }, { s: "ma", t: "y", sid: "weg", g: "2" }, { s: "ma", t: "y", sid: "${anna}", g: "2+" }, { s: "ma", t: "y", sid: "${anna}", g: "16" }], new Set(["${anna}"])))`);
  erwarte(san === `[{"s":"ma","t":"h1","sid":"${anna}","g":"2","sc":"grade"}]`, 'Laden prüft Zeugnisnoten falsch: ' + san);
  erwarte(app.E(`JSON.stringify(sanFinals([{ s: "x", t: "y", sid: "${anna}", g: "9" }, { s: "z", t: "y", sid: "${anna}", g: "9", sc: "grade" }], new Set(["${anna}"])))`) === `[{"s":"x","t":"y","sid":"${anna}","g":"9","sc":"points"}]`, 'Skala beim Laden falsch erkannt');
  // Abgleich: zwei Geräte, unterschiedliche Noten – die spätere gilt; Löschen kommt an
  uhr(app, 1000); app.E('flushSave()');
  const B = neueApp();
  try{
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    erwarte(B.E(`finalGrade(curClass() || DB.classes[0], "ma", "${anna}", "h1")`) === '1', 'Zeugnisnote nicht übertragen');
    uhr(B, 2000); B.E(`setFinalGrade(DB.classes[0], "ma", "${anna}", "h1", "2"); flushSave()`);
    uhr(app, 2100); app.E(`setFinalGrade(curClass(), "ma", "${sid(app, 'Ben')}", "h1", null); flushSave()`);
    uhr(app, 2200); await laden(app, datei(B), 'merge');
    erwarte(app.E(`finalGrade(curClass(), "ma", "${anna}", "h1")`) === '2' && app.E(`finalGrade(curClass(), "ma", "${sid(app, 'Ben')}", "h1")`) === null, 'Abgleich der Zeugnisnoten falsch');
    uhr(B, 2300); await laden(B, datei(app), 'merge');
    erwarte(inhalt(app) === inhalt(B), 'Geräte nach dem Abgleich nicht gleich');
  } finally { B.ende(); }
  app.E(`editSubject(subjectById("ma"))`);
  const delBtn = app.$$('#sheet button').find(b => /Fach löschen/.test(b.textContent));
  if(delBtn){ app.klick(delBtn); app.sheetOk(); }
  erwarte(!!delBtn && app.E('curClass().zn.every(x => x.s !== "ma") && curClass().zn.some(x => x.s === "de")'), 'Zeugnisnoten eines gelöschten Fachs bleiben (oder andere verschwinden)');
});

test('Kategorien: eigene Anteile, Zuordnung, Rechenweg, Ausgaben, Abgleich', async app => {
  bewertungsKlasse(app);
  app.E('gradeSubject = "ma"; gradeTab = "list"; goGrades("ma")');
  // Gewichtung: Kategorie hinzufügen
  app.klick('#g-weight'); app.klick('#g-cat-add');
  let rows = app.$$('#g-cats .catrow');
  erwarte(rows.length === 3 && !app.$('#g-weight-range') && /Zusammen: 100 %/.test(app.$('#g-cat-sum').textContent), 'Kategorien-Liste fehlt');
  const setRow = (i, name, w) => { const r = app.$$('#g-cats .catrow')[i]; const f = r.querySelectorAll('input');
    if(name !== null){ f[0].value = name; f[0].dispatchEvent(new app.w.Event('input')); } f[1].value = String(w); f[1].dispatchEvent(new app.w.Event('input')); };
  setRow(0, 'Klassenarbeiten', 50); setRow(1, null, 30);
  app.sheetOk();
  erwarte(/Kategorie benennen/.test(app.$('#toast').textContent) || /100 %/.test(app.$('#toast').textContent), 'Unvollständige Kategorien gespeichert');
  setRow(2, 'Tests', 20);
  erwarte(/Zusammen: 100 %/.test(app.$('#g-cat-sum').textContent), 'Summe nicht aktualisiert');
  app.sheetOk();
  erwarte(app.E('JSON.stringify(curClass().gcat.ma.map(x => [x.n, x.w]))') === '[["Klassenarbeiten",50],["",30],["Tests",20]]' && app.E('curClass().gradeW.ma') === 50, 'Kategorien nicht gespeichert');
  erwarte(/Klassenarbeiten 50 %/.test(app.$('#g-weight').textContent) && /Tests 20 %/.test(app.$('#g-weight').textContent), 'Zusammenfassung zeigt die Kategorien nicht');
  // Bewertung in eigener Kategorie
  app.klick('#g-new');
  erwarte(app.$$('#a-kind button').length === 3 && app.$$('#a-kind button')[2].textContent === 'Tests', 'Kategorie-Auswahl fehlt');
  app.klick(app.$$('#a-kind button')[2]); app.sheetOk();
  const tid = app.E('curAssess().id');
  erwarte(app.E('curAssess().cat') !== undefined && app.E('curAssess().kind') === 'other' && /Tests/.test(app.$('#assess-head').textContent), 'Kategorie nicht zugeordnet');
  app.klick('#btn-assess-back');
  const [anna, ben] = [sid(app, 'Anna'), sid(app, 'Ben')];
  app.E(`(() => { const c = curClass(); c.assess.find(a => a.id === "${tid}").marks = { "${anna}": "1" };
    c.assess.push({ id: "k1", subjectId: "ma", title: "KA", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: { "${anna}": "2", "${ben}": "3" } },
                  { id: "m1", subjectId: "ma", title: "MA", date: "2026-09-11", kind: "other", scale: "grade", weight: 1, marks: { "${anna}": "4" } }); })(); save()`);
  const av = app.E(`studentAverages(curClass(), "ma", "${anna}", "year")`);
  erwarte(Math.abs(av.total - (0.5 * 2 + 0.3 * 4 + 0.2 * 1)) < 1e-9 && av.parts.length === 3, 'Gesamt mit Kategorien falsch: ' + av.total);
  erwarte(app.E(`studentAverages(curClass(), "ma", "${ben}", "year").total`) === 3, 'Leere Kategorien zählen mit');
  // Übersicht, Rechenweg, Ausgaben
  app.E('gradeTab = "overview"; gradeTerm = "year"; renderGrades()');
  const ths = app.$$('#g-table tr')[0].querySelectorAll('th');
  erwarte(Array.from(ths).map(x => x.childNodes[0].textContent).filter(x => /^Ø/.test(x)).join('|') === 'Ø Klassena.|Ø münd.|Ø Tests', 'Spalten je Kategorie fehlen: ' + Array.from(ths).map(x => x.textContent).join('|'));
  const calc = app.E(`JSON.stringify(gradeCalc(curClass(), subjectById("ma"), "${anna}", "year").lines)`);
  erwarte(/Tests – Gewichtung 20 %/.test(calc) && /\(50 % × 2,00 \+ 30 % × 4,00 \+ 20 % × 1,00\) ÷ 100 % = 2,40/.test(calc), 'Rechenweg mit Kategorien falsch: ' + calc);
  const calcB = app.E(`JSON.stringify(gradeCalc(curClass(), subjectById("ma"), "${ben}", "year").lines)`);
  erwarte(/Tests \(20 %\) hat noch keine Note/.test(calcB), 'Rechenweg nennt leere Kategorie nicht');
  const box = downloadAbfangen(app); app.klick('#g-csv');
  const csv = await blobText(app, box.blob);
  erwarte(/Ø Klassenarbeiten;Ø mündlich & sonstige;Ø Tests;Gesamt/.test(csv) && /\(Tests\)/.test(csv), 'CSV ohne Kategorien: ' + csv.split('\n')[0]);
  const sh = JSON.parse(app.E('JSON.stringify(gradesXlsxSheets(curClass(), "year")[0])'));
  erwarte(sh.rows[0].slice(-6).join('|') === 'Ø Klassenarbeiten|Ø mündlich & sonstige|Ø Tests|Gesamt|Vorschlag|Fehlst.' && sh.num['4'] && sh.num['7'] && sh.num['9'] === 3, 'Excel ohne Kategorien: ' + sh.rows[0].join('|') + ' ' + JSON.stringify(sh.num));
  // Laden prüft
  erwarte(app.E('JSON.stringify(sanCats({ ma: [{ id: "written", n: "", w: 50 }, { id: "other", n: "", w: 40 }], de: [{ id: "written", n: "", w: 50 }, { id: "x1", n: "", w: 50 }], en: [{ id: "written", n: "", w: 60 }, { id: "other", n: "", w: 20 }, { id: "t1", n: "Tests", w: 20 }] }))')
    === '{"en":[{"id":"written","n":"","w":60},{"id":"other","n":"","w":20},{"id":"t1","n":"Tests","w":20}]}', 'Laden prüft Kategorien falsch');
  // Abgleich
  uhr(app, 1000); app.E('flushSave()');
  const B = neueApp();
  try{
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    erwarte(B.E('DB.classes[0].gcat.ma.length') === 3 && B.E(`DB.classes[0].assess.find(a => a.id === "${tid}").cat`) === app.E(`curClass().assess.find(a => a.id === "${tid}").cat`), 'Kategorien nicht übertragen');
    uhr(B, 2000); B.E('DB.classes[0].gcat.ma[2].w = 10; DB.classes[0].gcat.ma[1].w = 40; flushSave()');
    uhr(app, 2100); await laden(app, datei(B), 'merge');
    erwarte(app.E('curClass().gcat.ma[2].w') === 10, 'Geänderte Anteile nicht abgeglichen');
  } finally { B.ende(); }
  // Kategorie entfernen: Bewertungen zählen wieder zu ihrer Grundart
  app.E('renderGrades()'); app.klick('#g-weight');
  app.klick(app.$$('#g-cats .catrow')[2].querySelector('button'));
  erwarte(app.$$('#g-cats .catrow').length === 2, 'Kategorie lässt sich nicht entfernen');
  app.sheetOk();
  erwarte(/100 %/.test(app.$('#toast').textContent) && app.E('curClass().gcat.ma.length') === 3, 'Summe ≠ 100 gespeichert');
  setRow(1, null, 50); app.sheetOk();
  erwarte(!!app.E('curClass().gcat.ma') && app.E(`curClass().assess.find(a => a.id === "${tid}").cat`) === undefined, 'Zuordnung bleibt nach dem Entfernen');
  // Namen der festen Kategorien zurücksetzen → wieder einfache Gewichtung
  app.klick('#g-weight');
  const f0 = app.$$('#g-cats .catrow')[0].querySelector('input'); f0.value = ''; f0.dispatchEvent(new app.w.Event('input'));
  app.sheetOk();
  erwarte(app.E('curClass().gcat.ma') === undefined && app.E('curClass().gradeW.ma') === 50 && (app.klick('#g-weight'), !!app.$('#g-weight-range')), 'Einfache Gewichtung nicht wieder erreichbar');
  app.E('closeModal()');
});

test('Notenskalen: Drittelnoten, Prozent, eigene Skala', async app => {
  bewertungsKlasse(app);
  const [anna, ben, cem] = [sid(app, 'Anna'), sid(app, 'Ben'), sid(app, 'Cem')];
  erwarte(Math.abs(app.E('tokNum("2-", "third")') - 7 / 3) < 1e-9 && Math.abs(app.E('tokNum("2+", "third")') - 5 / 3) < 1e-9 && app.E('tokNum("2", "third")') === 2, 'Drittelnoten falsch');
  app.E('gradeSubject = "ma"; gradeTab = "list"; goGrades("ma")');
  // Drittelnoten über die Oberfläche
  app.klick('#g-new');
  erwarte(app.$$('#a-scale button').map(b => b.textContent).join('|') === 'Noten 1–6|Punkte 0–15|Smileys|Drittelnoten|Prozent', 'Skalen-Auswahl falsch: ' + app.$$('#a-scale button').map(b => b.textContent).join('|'));
  app.klick(app.$$('#a-scale button')[3]); app.sheetOk();
  erwarte(app.E('curAssess().scale') === 'third' && app.$$('#assess-pad button').length === 16 + 2 && !app.$('#a-tasks'), 'Tastenfeld Drittelnoten falsch');
  app.klick('#assess-pad button[data-tok="2-"]');
  erwarte(app.E(`curAssess().marks["${anna}"]`) === '2-' && Math.abs(app.E(`valIn(curAssess(), "2-", "grade")`) - 7 / 3) < 1e-9, 'Drittelnote nicht gespeichert');
  app.E(`curClass().gradeRound = { ma: { fav: true, tend: true } }`);
  erwarte(app.E(`proposeGrade(curClass(), "ma", studentAverages(curClass(), "ma", "${anna}"))`) === '2-', 'Vorschlag mit Drittelnoten falsch');
  erwarte(app.E(`proposeGrade(curClass(), "ma", { total: 13 / 6, scale: "grade", third: true })`) === '2' && app.E(`proposeGrade(curClass(), "ma", { total: 13 / 6, scale: "grade", third: false })`) === '2-', 'Tendenz-Vorschlag rechnet nicht in Dritteln');
  app.klick('#btn-assess-back');
  // Prozent mit Schlüssel 40 %
  app.klick('#g-new'); app.klick(app.$$('#a-scale button')[4]);
  erwarte(app.$$('#a-pctkey button').length === 2 && app.$('#a-pctkey button.on').dataset.v === 'ihk', 'Schlüssel für Prozent fehlt');
  app.klick(app.$$('#a-pctkey button')[1]); app.$('#a-kind button').click(); app.sheetOk();
  erwarte(app.E('curAssess().scale') === 'pct' && app.E('curAssess().key.th.join()') === '85,70,55,40,20' && !!app.$('#pct-in'), 'Prozent-Bewertung falsch angelegt');
  app.E(`assessSel = "${anna}"; renderAssess()`);
  app.$('#pct-in').value = '120'; app.klick('#pct-ok');
  erwarte(!app.E(`curAssess().marks["${anna}"]`) && /0 bis 100/.test(app.$('#toast').textContent), 'Ungültige Prozentzahl angenommen');
  app.$('#pct-in').value = '55'; app.klick('#pct-ok');
  erwarte(app.E(`curAssess().marks["${anna}"]`) === '55' && app.E('assessSel') === ben, 'Prozent nicht gespeichert oder nicht weiter');
  app.$('#pct-in').value = '30'; app.klick('#pct-ok');
  app.$('#pct-in').value = '19'; app.klick('#pct-ok');
  erwarte(app.E(`valIn(curAssess(), "55", "grade")`) === 3 && app.E(`valIn(curAssess(), "19", "grade")`) === 6 && /Ø 35 %/.test(app.$('#assess-stats').textContent), 'Prozent → Note falsch: ' + app.$('#assess-stats').textContent);
  erwarte(app.E('JSON.stringify(failShare(curClass(), curAssess()))') === '{"bad":2,"n":3,"share":0.6666666666666666}', 'Klassenarbeit in Prozent: 30-%-Regel falsch');
  app.klick('#btn-assess-back');
  // eigene Skala
  app.E('show("settings"); renderSettings()'); app.klick('#set-scales'); app.klick('#us-new');
  app.$('#us-name').value = 'Kompetenz';
  erwarte(app.$$('#us-steps .usrow').length === 4, 'Vorlage mit vier Stufen fehlt');
  app.sheetOk(); await pause(90);
  const us = app.E('DB.scales[0] && DB.scales[0].id');
  erwarte(!!us && app.E('DB.scales[0].steps.map(x => x.l + "=" + x.v).join()') === 'sehr sicher=1,sicher=2.5,teilweise=4,noch nicht=5.5' && !!app.$('#us-list .grpcard'), 'Eigene Skala nicht gespeichert');
  app.E('closeModal(); goGrades("ma")'); app.klick('#g-new');
  erwarte(app.$$('#a-scale button').some(b => b.textContent === 'Kompetenz'), 'Eigene Skala nicht wählbar');
  app.klick(app.$$('#a-scale button').find(b => b.textContent === 'Kompetenz')); app.sheetOk();
  erwarte(app.E('curAssess().scale') === 'u:' + us && app.$$('#assess-pad button').map(b => b.textContent).slice(0, 4).join('|') === 'sehr sicher|sicher|teilweise|noch nicht' && app.$('#assess-pad').classList.contains('k-user'), 'Tastenfeld eigene Skala falsch');
  app.E(`assessSel = "${anna}"; renderAssess()`); app.klick('#assess-pad button[data-tok="sicher"]');
  erwarte(app.E(`curAssess().marks["${anna}"]`) === 'sicher' && app.E(`valIn(curAssess(), "sicher", "grade")`) === 2.5 && /sicher/.test(app.$('#assess-list').textContent), 'Eintrag eigene Skala falsch');
  const uaid = app.E('curAssess().id');
  app.klick('#btn-assess-back');
  // umbenennen zieht Einträge mit; benutzte Stufe nicht löschbar; benutzte Skala nicht löschbar
  app.E('openScales()'); app.klick('#us-list .grpcard');
  const r1 = app.$$('#us-steps .usrow')[1].querySelector('input'); r1.value = 'gut'; r1.dispatchEvent(new app.w.Event('input'));
  app.sheetOk(); await pause(90);
  erwarte(app.E(`curClass().assess.find(a => a.id === "${uaid}").marks["${anna}"]`) === 'gut', 'Umbenennen zieht die Einträge nicht mit');
  app.E('closeModal(); openScales()'); app.klick('#us-list .grpcard');
  app.klick(app.$$('#us-steps .usrow')[1].querySelector('button')); app.sheetOk();
  erwarte(/noch eingetragen/.test(app.$('#toast').textContent) && app.E('DB.scales[0].steps.length') === 4, 'Benutzte Stufe gelöscht');
  app.E('closeModal(); openScales()'); app.klick('#us-list .grpcard'); app.klick('#us-delete');
  erwarte(/nicht löschbar/.test(app.$('#toast').textContent) && app.E('DB.scales.length') === 1, 'Benutzte Skala gelöscht');
  app.E('closeModal()');
  // Laden prüft
  erwarte(app.E('JSON.stringify(sanScales([{ id: "a1", name: "S", steps: [{ l: "x", v: 1 }, { l: "a", v: 1 }, { l: "a", v: 2 }, { l: "b", v: 7 }, { l: "c", v: 3 }] }, { id: "a2", name: "", steps: [] }]).map(u => u.steps.map(x => x.l)))') === '[["a","c"]]', 'Laden prüft eigene Skalen falsch');
  erwarte(app.E('JSON.stringify(sanitizeDB({ v: 2, classes: [{ id: "c", name: "K", students: [{ id: "s1", name: "A" }], assess: [{ id: "p", subjectId: "ma", scale: "pct", marks: { s1: "101" }, key: { th: [90, 80, 70, 60, 50] } }, { id: "q", subjectId: "ma", scale: "pct", marks: { s1: "77" } }, { id: "u", subjectId: "ma", scale: "u:zz", marks: { s1: "gut" } }, { id: "v", subjectId: "ma", scale: "quatsch", marks: {} }] }] }).classes[0].assess.map(a => [a.id, a.marks.s1 || "", a.key ? a.key.th.join() : ""]))')
    === '[["p","","90,80,70,60,50"],["q","77",""],["u","gut",""]]', 'Laden prüft Prozent/eigene Skalen falsch');
  // Übersicht und Excel: Durchschnitt mit allen Skalen
  app.E('gradeTab = "overview"; gradeTerm = "year"; renderGrades()');
  const tot = app.E(`studentAverages(curClass(), "ma", "${anna}", "year").total`);
  erwarte(Math.abs(tot - (7 / 3 + 3 + 2.5) / 3) < 1e-9, 'Durchschnitt über mehrere Skalen falsch: ' + tot);
  const sh = JSON.parse(app.E('JSON.stringify(gradesXlsxSheets(curClass(), "year")[0])'));
  erwarte(sh.rows[1].slice(1, 4).join('|') === '2-|55|gut', 'Excel-Werte der Skalen falsch: ' + sh.rows[1].join('|'));
  // Abgleich: Skala reist mit
  uhr(app, 1000); app.E('flushSave()');
  const B = neueApp();
  try{
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    erwarte(B.E('DB.scales.length') === 1 && B.E(`DB.classes[0].assess.find(a => a.id === "${uaid}").marks["${anna}"]`) === 'gut', 'Eigene Skala nicht übertragen');
  } finally { B.ende(); }
  // Zusammenführen auf einem Gerät mit eigenen Daten: die Skala kommt über den Abgleich
  const C = neueApp();
  try{
    uhr(C, 1200); grundstand(C); uhr(C, 1300); await laden(C, datei(app), 'merge');
    erwarte(C.E('DB.scales.length') === 1 && C.E('DB.scales[0].name') === 'Kompetenz', 'Eigene Skala beim Zusammenführen verloren');
  } finally { C.ende(); }
});

test('Kategorien und Skalen im Abgleich: ältere App, Prozent-Schlüssel, gelöschte Skala, Skalenwechsel', async app => {
  uhr(app, 1000); grundstand(app);
  const [anna, ben] = [sid(app, 'Anna'), sid(app, 'Ben')];
  app.E(`(() => { const c = curClass(); c.gcat = { ma: [{ id: "written", n: "", w: 50 }, { id: "other", n: "", w: 30 }, { id: "t1", n: "Tests", w: 20 }] }; c.gradeW = Object.assign({}, c.gradeW, { ma: 50 });
    c.assess.push({ id: "t9", subjectId: "ma", title: "Test", date: "2026-09-20", kind: "other", cat: "t1", scale: "grade", weight: 1, marks: { "${anna}": "1" } },
                  { id: "p9", subjectId: "ma", title: "Prozent", date: "2026-09-21", kind: "written", scale: "pct", weight: 1, key: { th: [85, 70, 55, 40, 20] }, marks: { "${anna}": "80" } });
    DB.scales = [{ id: "ks", name: "Kompetenz", steps: [{ k: "a", l: "gut", v: 2 }, { k: "b", l: "schwach", v: 5 }] }];
    c.assess.push({ id: "u9", subjectId: "ma", title: "Kompetenz", date: "2026-09-22", kind: "other", scale: "u:ks", weight: 1, marks: { "${anna}": "gut" } }); })(); flushSave()`);
  // Älteres Gerät: kennt Kategorien, Prozent und eigene Skalen nicht, ändert eine Note und gibt die Datei zurück
  uhr(app, 2000);
  const alt = app.E(`(() => { const d = backupData(); d.stamps = unpackStamps(d.stamps); d.del = unpackStamps(d.del);
    Object.keys(d.stamps).forEach(k => { if(/^(gc|ac|us|zn)\\|/.test(k)) delete d.stamps[k]; });
    d.classes.forEach(c => { delete c.gcat; delete c.zn; c.assess = c.assess.filter(a => ["grade", "points", "smiley"].indexOf(a.scale) >= 0); c.assess.forEach(a => { delete a.cat; }); });
    delete d.scales;
    const c = d.classes[0], w1 = c.assess.find(a => a.id === "w1"); w1.marks["${ben}"] = "1";
    d.stamps["m|" + idk(c.id) + "|" + idk("w1") + "|" + idk("${ben}")] = 2000; d.mod = 2000;
    d.stamps = packStamps(d.stamps); d.del = packStamps(d.del);
    return JSON.stringify({ app: "fairseat", v: 2, data: d }); })()`);
  uhr(app, 2100); await laden(app, alt, 'merge');
  erwarte(app.E('curClass().gcat.ma && curClass().gcat.ma.length') === 3 && app.E('curClass().assess.find(a => a.id === "t9").cat') === 't1', 'Ältere App löscht Kategorien oder Zuordnung');
  erwarte(app.E('curClass().assess.some(a => a.id === "p9") && curClass().assess.some(a => a.id === "u9") && DB.scales.length === 1', ''), 'Ältere App löscht Prozent- oder Skalenbewertungen');
  erwarte(app.E(`curClass().assess.find(a => a.id === "w1").marks["${ben}"]`) === '1', 'Änderung des älteren Geräts fehlt');
  // Prozent-Schlüssel zwischen zwei neuen Geräten
  const B = neueApp();
  try{
    uhr(B, 2200); await laden(B, datei(app), 'replace');
    uhr(B, 3000); B.E(`DB.classes[0].assess.find(a => a.id === "p9").marks["${ben}"] = "50"; flushSave()`);
    uhr(app, 3100); await laden(app, datei(B), 'merge');
    erwarte(app.E('curClass().assess.find(a => a.id === "p9").key && curClass().assess.find(a => a.id === "p9").key.th.join()') === '85,70,55,40,20', 'Prozent-Schlüssel geht beim Abgleich verloren');
    uhr(B, 3200); B.E('DB.classes[0].assess.find(a => a.id === "p9").key = { th: [92, 81, 67, 50, 30], tend: false }; flushSave()');
    uhr(app, 3300); await laden(app, datei(B), 'merge');
    erwarte(app.E('curClass().assess.find(a => a.id === "p9").key.th.join()') === '92,81,67,50,30', 'Geänderter Prozent-Schlüssel kommt nicht an');
    // Skala auf B gelöscht (dort unbenutzt), auf A danach noch benutzt: bleibt
    uhr(B, 3400); B.E('DB.classes[0].assess = DB.classes[0].assess.filter(a => a.id !== "u9"); DB.scales = []; flushSave()');
    uhr(app, 3500); app.E(`curClass().assess.find(a => a.id === "u9").marks["${ben}"] = "schwach"; flushSave()`);
    uhr(app, 3600); await laden(app, datei(B), 'merge');
    erwarte(app.E('DB.scales.length') === 1 && app.E('curClass().assess.some(a => a.id === "u9")'), 'Benutzte Skala durch den Abgleich gelöscht');
  } finally { B.ende(); }
  // Skalenwechsel einer leeren Bewertung auf Prozent: neue Kennung
  app.E(`curClass().assess.push({ id: "e9", subjectId: "ma", title: "Leer", date: "2026-09-25", kind: "written", scale: "grade", weight: 1, marks: {} }); flushSave(); openAssess("e9"); editAssessMeta()`);
  app.klick(app.$$('#a-scale button')[4]); app.sheetOk();
  erwarte(app.E('curAssess().scale') === 'pct' && app.E('curAssess().id') !== 'e9' && !app.E('curClass().assess.some(a => a.id === "e9")'), 'Skalenwechsel behält die alte Kennung');
});

test('Kriterienraster: Vorlage, Bewerten, Note, Rückmeldebogen, Abgleich', async app => {
  bewertungsKlasse(app);
  const [anna, ben] = [sid(app, 'Anna'), sid(app, 'Ben')];
  app.E('gradeSubject = "ma"; gradeTab = "list"; goGrades("ma")');
  app.klick('#g-new'); app.$('#a-title').value = 'Referat'; app.klick(app.$$('#a-kind button')[1]); app.sheetOk();
  erwarte(!!app.$('#a-crit') && !!app.$('#a-tasks'), 'Knöpfe für Raster und Aufgaben fehlen');
  app.klick('#a-crit');
  erwarte(app.$$('#cr-tpl button').length === 2 && app.$$('#cr-lv .crlvrow input').length === 4, 'Vorlagen oder Stufen fehlen');
  app.sheetOk();
  erwarte(/mindestens ein Kriterium/.test(app.$('#toast').textContent), 'Leeres Raster gespeichert');
  app.klick('#cr-tpl button[data-id="b-pres"]');
  erwarte(app.$$('#cr-list .critem').length === 5 && /Gliederung/.test(app.$('#cr-e-1').value), 'Vorlage Präsentation nicht übernommen');
  app.klick(app.$$('#cr-list .critem')[0].querySelectorAll('.crw button')[1]);   // Inhalt ×2
  app.klick('#cr-savetpl');
  erwarte(app.E('DB.critTpl.length') === 1 && app.E('DB.critTpl[0].name') === 'Referat' && app.E('DB.critTpl[0].items[0].w') === 2, 'Eigene Vorlage nicht gespeichert');
  app.sheetOk();
  erwarte(app.E('hasCrit(curAssess())') && app.E('curAssess().crit.items.length') === 5 && app.E('curAssess().crit.items[0].w') === 2 && !app.$('#a-tasks') && /5 Kriterien · 4 Stufen/.test(app.$('#a-crit').textContent), 'Raster nicht gespeichert');
  // Anna bewerten
  app.klick(app.$$('#assess-list .arow')[0]);
  erwarte(!!app.$('#cr-r-0') && app.$$('#cr-r-0 button').length === 4, 'Bewertungsblatt fehlt');
  const stufe = (i, k) => app.klick(app.$$('#cr-r-' + i + ' button')[k]);
  stufe(0, 3); stufe(1, 2); stufe(2, 1);
  erwarte(/3 von 5 Kriterien/.test(app.$('#cr-res').textContent), 'Teilergebnis fehlt');
  stufe(3, 3); stufe(4, 3);
  erwarte(/83,3 % · Note 2/.test(app.$('#cr-res').textContent), 'Ergebnis falsch: ' + app.$('#cr-res').textContent);
  app.$('#cr-comment').value = 'Sehr klarer Vortrag.'; app.$('#cr-comment').dispatchEvent(new app.w.Event('input'));
  app.klick('#cr-next');
  erwarte(app.E(`curAssess().marks["${anna}"]`) === '2' && app.E(`curAssess().cr["${anna}"].c`) === 'Sehr klarer Vortrag.' && /Ben/.test(app.$('#sheet h3').textContent), 'Bewertung nicht gespeichert oder nicht weiter');
  stufe(0, 1); app.klick('#cr-save');
  erwarte(!app.E(`curAssess().marks["${ben}"]`) && /1\/5/.test(app.$$('#assess-list .arow')[1].textContent) && /83,3 %/.test(app.$$('#assess-list .arow')[0].textContent), 'Teilbewertung falsch angezeigt');
  erwarte(app.$$('#cr-stats .tkbar').length === 5 && /100 %/.test(app.$$('#cr-stats .tkbar')[3].textContent), 'Klassenüberblick je Kriterium fehlt');
  // Tendenz im Schlüssel
  app.klick('#a-crit'); app.klick('#cr-tend'); app.sheetOk();
  erwarte(app.E(`curAssess().marks["${anna}"]`) === '2-', 'Tendenz nicht übernommen: ' + app.E(`curAssess().marks["${anna}"]`));
  // Rückmeldebögen
  const box = downloadAbfangen(app); app.klick('#a-crit-pdf');
  const pdf = await blobText(app, box.blob);
  erwarte(/Referat/.test(box.name) && /\(Anna\)/.test(pdf) && /Sehr klarer Vortrag/.test(pdf) && /Klare Gliederung/.test(pdf) && (pdf.match(/\/Type \/Page /g) || []).length === 2, 'Rückmeldebögen unvollständig: ' + box.name);
  // Kriterium entfernen: Note neu
  app.klick('#a-crit'); app.klick(app.$$('#cr-list .critem')[2].querySelector('.minibtn')); app.sheetOk();
  erwarte(app.E('curAssess().crit.items.length') === 4 && app.E(`curAssess().marks["${anna}"]`) === '1-', 'Note nach Entfernen eines Kriteriums falsch: ' + app.E(`curAssess().marks["${anna}"]`));
  // Laden prüft und rechnet
  const san = app.E(`JSON.stringify(sanitizeDB({ v: 2, classes: [{ id: "c", name: "K", students: [{ id: "s1", name: "A" }, { id: "s2", name: "B" }], assess: [{ id: "a", subjectId: "ma", scale: "grade", kind: "other",
    crit: { lv: ["a", "b", "c"], items: [{ id: "i1", n: "X", w: 9 }, { id: "i1", n: "Y" }, { id: "i2", n: "" }, { id: "i3", n: "Z", e: 5 }] }, key: { th: [90, 80, 70, 60, 50] },
    cr: { s1: { v: { i1: 2, i3: 2 }, c: "ok" }, s2: { v: { i1: 7 } }, zz: { v: { i1: 0 } } }, marks: { s1: "6", s2: "1" } }] }] }).classes[0].assess[0])`);
  const S = JSON.parse(san);
  erwarte(S.crit.items.length === 2 && S.crit.items[0].w === 1 && S.crit.items[1].e === '' && S.marks.s1 === '1' && S.marks.s2 === '1' && !S.cr.zz && !S.cr.s2 && S.cr.s1.c === 'ok', 'Laden prüft Raster falsch: ' + san);
  // Abgleich: zwei Geräte bewerten verschiedene Schüler
  uhr(app, 1000); app.E('flushSave()');
  const B = neueApp();
  try{
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    const aid = app.E('curAssess().id');
    uhr(B, 2000); B.E(`(() => { const a = DB.classes[0].assess.find(x => x.id === "${aid}"); a.cr["${ben}"] = { v: Object.fromEntries(a.crit.items.map(x => [x.id, 3])) }; applyCritMarks(a); })(); flushSave()`);
    uhr(app, 2100); app.E(`(() => { const a = curAssess(); a.cr["${anna}"].c = "geändert"; })(); flushSave()`);
    uhr(app, 2200); await laden(app, datei(B), 'merge');
    erwarte(app.E(`curAssess().marks["${ben}"]`) === '1+' && app.E(`curAssess().cr["${anna}"].c`) === 'geändert' && app.E('DB.critTpl.length') === 1, 'Raster-Bewertungen nicht zusammengeführt');
    uhr(B, 2300); B.E(`(() => { const a = DB.classes[0].assess.find(x => x.id === "${aid}"); a.key = { th: [95, 90, 85, 80, 75], tend: false }; applyCritMarks(a); })(); flushSave()`);
    uhr(app, 2400); await laden(app, datei(B), 'merge');
    erwarte(app.E('curAssess().key.th[0]') === 95 && app.E(`curAssess().marks["${anna}"]`) === '2', 'Geänderter Schlüssel nicht abgeglichen: ' + app.E(`curAssess().marks["${anna}"]`));
  } finally { B.ende(); }
  // eigene Vorlage beim nächsten Mal wählbar; Aufgaben-Knopf weg, wenn Raster da
  app.klick('#btn-assess-back'); app.klick('#g-new'); app.sheetOk(); app.klick('#a-crit');
  erwarte(app.$$('#cr-tpl button').length === 3 && app.$$('#cr-tpl button')[2].textContent === 'Referat', 'Eigene Vorlage nicht wählbar');
  app.E('closeModal()');
  app.klick('#a-tasks'); app.E('closeModal()');
});

test('Kriterienraster: Prüfbericht – Direktnote, ältere App, Stufenzahl, Aufgaben gegen Raster, Vorlagen, PDF', async app => {
  uhr(app, 1000); grundstand(app);
  const [anna, ben, cem] = [sid(app, 'Anna'), sid(app, 'Ben'), sid(app, 'Cem')];
  app.E(`(() => { const c = curClass(); c.assess.push({ id: "r1", subjectId: "ma", title: "Referat", date: "2026-09-20", kind: "other", scale: "grade", weight: 1, marks: {},
    crit: { lv: ["a", "b", "c", "d"], items: [{ id: "i1", n: "Inhalt", e: "", w: 1 }, { id: "i2", n: "Vortrag", e: "", w: 1 }] }, key: { th: [95, 80, 65, 50, 25], tend: false },
    cr: { "${anna}": { v: { i1: 3, i2: 3 }, n: 4 }, "${ben}": { v: { i1: 0, i2: 0 }, n: 4 } } }); applyCritMarks(c.assess[1]); })(); flushSave()`);
  const r1 = x => app.E(`(() => { const a = curClass().assess.find(a => a.id === "r1"); return ${x}; })()`);
  erwarte(r1(`a.marks["${anna}"]`) === '1' && r1(`a.marks["${ben}"]`) === '6' && r1(`a.cr["${anna}"].n`) === 4, 'Ausgangsstand falsch');
  // Prozentanzeige wie in der Note gerundet
  erwarte(app.E('fmtPct(49.96)') === '50' && app.E('fmtPct(83.333)') === '83,3' && app.E('fmtPct(100)') === '100', 'fmtPct falsch: ' + app.E('fmtPct(83.333)'));
  // Direkt gesetzte Note („fehlt“) ersetzt die Raster-Bewertung – auch nach dem Laden
  app.E(`openAssess("r1"); assessSel = "${anna}"; setMark("x")`);
  erwarte(r1(`a.marks["${anna}"]`) === 'x' && r1(`a.cr["${anna}"] === undefined`), 'Direktnote lässt Raster-Bewertung stehen');
  erwarte(app.E(`sanitizeDB(clone(DB)).classes[0].assess.find(a => a.id === "r1").marks["${anna}"]`) === 'x', 'Raster-Note kommt beim Laden zurück');
  // Älteres Gerät ohne Raster setzt Ben später direkt eine Note: sie gilt, das Raster bleibt
  uhr(app, 2000);
  const alt = app.E(`(() => { const d = backupData(); d.stamps = unpackStamps(d.stamps); d.del = unpackStamps(d.del);
    Object.keys(d.stamps).forEach(k => { if(/^(cr|cp|ct)\\|/.test(k)) delete d.stamps[k]; });
    d.classes.forEach(c => c.assess.forEach(a => { delete a.crit; delete a.cr; delete a.key; }));
    const c = d.classes[0], a = c.assess.find(a => a.id === "r1"); a.marks["${ben}"] = "3";
    d.stamps["m|" + idk(c.id) + "|" + idk("r1") + "|" + idk("${ben}")] = 2000; d.mod = 2000;
    d.stamps = packStamps(d.stamps); d.del = packStamps(d.del);
    return JSON.stringify({ app: "fairseat", v: 2, data: d }); })()`);
  uhr(app, 2100); await laden(app, alt, 'merge');
  erwarte(r1(`a.marks["${ben}"]`) === '3' && r1(`a.cr["${ben}"] === undefined`) && r1('a.crit.items.length') === 2, 'Direktnote des älteren Geräts verloren oder Raster gelöscht: ' + r1(`a.marks["${ben}"]`));
  // Bewertung unter anderer Stufenzahl (anderes Gerät) gilt nicht; Kommentar bleibt
  const S = JSON.parse(app.E(`JSON.stringify(sanitizeDB({ v: 2, classes: [{ id: "c", name: "K", students: [{ id: "s1", name: "A" }, { id: "constructor", name: "B" }], assess: [
    { id: "a", subjectId: "ma", scale: "grade", kind: "other", crit: { lv: ["a", "b", "c", "d"], items: [{ id: "i1", n: "X" }, { id: "constructor", n: "Y" }, { id: "hasOwnProperty", n: "Z" }] },
      cr: { s1: { v: { i1: 2 }, c: "ok", n: 3 }, constructor: { v: { i1: 3 }, n: 4 } }, marks: {} },
    { id: "b", subjectId: "ma", scale: "grade", kind: "other", auto: true, crit: { lv: ["a", "b", "c"], items: [{ id: "i1", n: "X" }] }, marks: {} }] }] }).classes[0].assess)`));
  erwarte(S[0].crit.items.length === 1 && JSON.stringify(S[0].cr.s1) === '{"v":{},"c":"ok","n":4}' && !S[0].marks.s1, 'Stufenzahl oder Prototyp-Kennungen falsch geprüft: ' + JSON.stringify(S[0]));
  erwarte(!S[1].crit, '„Mitarbeit heute“ bekommt ein Raster');
  // Nur kommentiert: Vorlagen bleiben wählbar; Vorlage gleichen Namens wird aktualisiert, verwalten und löschen
  app.E(`(() => { const c = curClass(); c.assess.push({ id: "r2", subjectId: "ma", title: "Plakat", date: "2026-09-21", kind: "other", scale: "grade", weight: 1, marks: {},
    crit: { lv: ["a", "b", "c"], items: [{ id: "i1", n: "Gestaltung", e: "", w: 1 }] }, key: { th: [95, 80, 65, 50, 25], tend: false }, cr: { "${cem}": { v: {}, c: "Notiz", n: 3 } } }); })(); flushSave(); openAssess("r2")`);
  app.klick('#a-crit');
  erwarte(!!app.$('#cr-tpl') && app.$('#cr-tpl-manage').hidden, 'Nur Kommentar sperrt Vorlagen oder Verwalten sichtbar ohne Vorlagen');
  app.klick('#cr-savetpl'); app.klick('#cr-savetpl');
  erwarte(app.E('DB.critTpl.length') === 1 && /aktualisiert/.test(app.$('#toast').textContent) && !app.$('#cr-tpl-manage').hidden, 'Vorlage gleichen Namens doppelt');
  app.klick('#cr-tpl-manage');
  erwarte(app.$$('#cr-tpl-list .usrow').length === 1, 'Vorlagenliste fehlt');
  app.klick(app.$('#cr-tpl-list .minibtn'));
  erwarte(app.E('DB.critTpl.length') === 0 && /gelöscht/.test(app.$('#toast').textContent) && /Keine eigenen/.test(app.$('#cr-tpl-list').textContent), 'Vorlage nicht gelöscht');
  app.klick(app.$('#sheet button.primary'));
  erwarte(!!app.$('#cr-list') && app.$$('#cr-tpl button').length === 2, 'Zurück zum Raster fehlt');
  app.E('closeModal()');
  // Rückmeldebogen über mehrere Seiten: Fortsetzungskopf, lange Wörter umbrochen
  const pdf = app.E(`(() => { const c = curClass(), a = c.assess.find(a => a.id === "r2");
    a.crit.items = Array.from({ length: 20 }, (_, i) => ({ id: "k" + i, n: "Kriterium " + i, e: "Erwartung mit etwas mehr Text, damit es umbricht und Platz braucht. " + "Donaudampfschifffahrtsgesellschaftskapitän".repeat(i === 3 ? 4 : 1), w: 1 }));
    return critPdfPages(c, a, ["${cem}"]).map(p => p.content); })()`);
  erwarte(pdf.length >= 2 && /Fortsetzung/.test(pdf[1]) && !/Fortsetzung/.test(pdf[0]), 'Fortsetzungskopf fehlt: ' + pdf.length);
  // Aufgaben und Raster auf zwei Geräten für dieselbe (zuvor leere) Bewertung: der jüngere Eintrag gilt, mit seinem Schlüssel
  uhr(app, 2500); app.E(`(() => { const c = curClass(); ["r3", "r4"].forEach((id, i) => c.assess.push({ id, subjectId: "ma", title: "T" + i, date: "2026-09-22", kind: "written", scale: "grade", weight: 1, marks: {} })); })(); flushSave()`);
  const B = neueApp();
  try{
    uhr(B, 2600); await laden(B, datei(app), 'replace');
    const raster = id => `(() => { const a = curClass().assess.find(a => a.id === "${id}"); a.crit = { lv: ["a", "b", "c"], items: [{ id: "i1", n: "X", e: "", w: 1 }] };
      a.key = { th: [95, 80, 65, 50, 25], tend: false }; a.cr = { "${cem}": { v: { i1: 2 }, n: 3 } }; applyCritMarks(a); })(); flushSave()`;
    const aufgaben = id => `(() => { const a = DB.classes[0].assess.find(a => a.id === "${id}"); a.tasks = [{ id: "t1", name: "1", max: 10 }]; a.key = { th: [90, 75, 60, 45, 20], tend: false }; a.pts = {}; })(); flushSave()`;
    uhr(app, 3000); app.E(raster('r3')); uhr(B, 3100); B.E(aufgaben('r3'));     // r3: Aufgaben jünger
    uhr(B, 3200); B.E(aufgaben('r4')); uhr(app, 3300); app.E(raster('r4'));     // r4: Raster jünger
    uhr(app, 3400); await laden(app, datei(B), 'merge');
    const a = id => JSON.parse(app.E(`JSON.stringify(curClass().assess.find(a => a.id === "${id}"))`));
    const r3 = a('r3'), r4 = a('r4');
    erwarte(r3.tasks && r3.tasks.length === 1 && !r3.crit && !r3.cr && r3.key.th[0] === 90, 'Jüngere Aufgaben verlieren gegen das Raster: ' + JSON.stringify(r3));
    erwarte(r4.crit && !r4.tasks && r4.key.th[0] === 95 && r4.marks[cem] === '1', 'Jüngeres Raster verliert gegen Aufgaben: ' + JSON.stringify(r4));
  } finally { B.ende(); }
});

/* ---------- Termine, Ferien und Unterrichtsplanung ---------- */
function planStand(app){
  klasseMitNamen(app, '7b', ['Anna', 'Ben', 'Cem']);
  app.E(`(() => { DB.subjects.push({ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }, { id: "de", name: "Deutsch", short: "De", color: "#E0533D" });
    const c = curClass();
    DB.lessons.push({ id: "L1", day: 0, period: 0, span: 2, week: "", subjectId: "ma", classId: c.id, roomId: "", planId: "" },
      { id: "L3", day: 2, period: 4, span: 1, week: "", subjectId: "ma", classId: c.id, roomId: "", planId: "" },
      { id: "L4", day: 3, period: 1, span: 1, week: "", subjectId: "ma", classId: c.id, roomId: "", planId: "" },
      { id: "L5", day: 4, period: 3, span: 1, week: "", subjectId: "de", classId: c.id, roomId: "", planId: "" });
    save(); })()`);
}
/* Woche mit diesem Montag anzeigen */
const zeigeWoche = (app, montag) => app.E(`ttWeekOff = Math.round((new Date("${montag}T00:00:00") - ttRefMonday()) / 6048e5); show("timetable"); renderTimetable()`);

test('Termine: Feiertage und Ferien', app => {
  planStand(app);
  erwarte(app.E('easter(2026)') === '2026-04-05' && app.E('easter(2027)') === '2027-03-28' && app.E('easter(2028)') === '2028-04-16', 'Osterdatum falsch');
  const ph = (y, st) => JSON.parse(app.E(`JSON.stringify(Array.from(pubHolidays(${y}, "${st}").keys()).sort())`));
  const ni = ph(2026, 'NI');
  erwarte(ni.length === 10 && ni.indexOf('2026-10-31') >= 0 && ni.indexOf('2026-11-01') < 0 && ni.indexOf('2026-05-14') >= 0 && ni.indexOf('2026-05-25') >= 0, 'Feiertage Niedersachsen falsch: ' + ni);
  const by = ph(2026, 'BY'), sn = ph(2026, 'SN'), be = ph(2026, 'BE'), mv22 = ph(2022, 'MV');
  erwarte(by.indexOf('2026-06-04') >= 0 && by.indexOf('2026-11-01') >= 0 && by.indexOf('2026-01-06') >= 0 && by.indexOf('2026-10-31') < 0, 'Feiertage Bayern falsch');
  erwarte(sn.indexOf('2026-11-18') >= 0 && ph(2027, 'SN').indexOf('2027-11-17') >= 0, 'Buß- und Bettag falsch');
  erwarte(be.indexOf('2026-03-08') >= 0 && mv22.indexOf('2022-03-08') < 0 && ph(2017, 'NI').indexOf('2017-10-31') < 0, 'Frauentag/Reformationstag nach Jahr falsch');
  erwarte(ph(2026, '').length === 0, 'Ohne Bundesland Feiertage');
  // Ferien und Feiertage: keine Stunden, keine laufende Stunde
  app.E('DB.hst = "NI"; DB.holidays = [{ id: "h1", a: "2026-11-09", b: "2026-11-10", n: "Brückentage" }]; save()');
  erwarte(app.E('freeInfo("2026-11-10")') === 'Brückentage' && app.E('freeInfo("2026-10-31")') === 'Reformationstag' && app.E('freeInfo("2026-11-11")') === '', 'freeInfo falsch');
  erwarte(app.E('lessonsOnDate(new Date("2026-11-09T12:00:00")).length') === 0 && app.E('lessonsOnDate(new Date("2026-11-16T12:00:00")).length') === 1, 'Stunden in den Ferien');
  erwarte(app.E('nowLessons(new Date("2026-11-09T08:10:00")).now') === null && !!app.E('nowLessons(new Date("2026-11-16T08:10:00")).now'), 'Laufende Stunde in den Ferien');
  erwarte(app.E('currentLessonFor(curClass(), new Date("2026-11-09T08:10:00"))') === null, 'Fehlzeiten zählen in den Ferien');
  // Oberfläche: Bundesland, Vorlage Niedersachsen, eigener Zeitraum, löschen
  app.E('DB.hst = ""; DB.holidays = []; save(); openHolidays()');
  erwarte(/Ohne Bundesland/.test(app.$('#hol-pub').textContent) && /Noch keine Ferien/.test(app.$('#hol-list').textContent), 'Leerer Ferienstand falsch angezeigt');
  app.klick('#hol-tpl');
  const n0 = app.E('DB.holidays.length');
  erwarte(n0 >= 1 && app.E('DB.hst') === 'NI' && app.E('DB.holidays.every(h => h.b >= isoDay(new Date()))') && app.E('DB.holidays.some(h => h.a === "2027-05-18")') === (app.E('isoDay(new Date())') <= '2027-05-18'), 'Ferienvorlage nicht übernommen');
  app.klick('#hol-tpl');
  erwarte(app.E('DB.holidays.length') === n0 && /Schon alles/.test(app.$('#toast').textContent), 'Vorlage doppelt übernommen');
  erwarte(/Nächster Feiertag/.test(app.$('#hol-pub').textContent), 'Nächster Feiertag fehlt');
  app.$('#hol-n').value = 'Projekttag'; app.$('#hol-a').value = '2030-02-05'; app.$('#hol-b').value = '2030-02-01'; app.klick('#hol-add');
  erwarte(/vor dem Beginn/.test(app.$('#toast').textContent), 'Falscher Zeitraum angenommen');
  app.$('#hol-b').value = ''; app.klick('#hol-add');
  erwarte(app.E('DB.holidays.some(h => h.n === "Projekttag" && h.a === "2030-02-05" && h.b === "2030-02-05")'), 'Eigener freier Tag fehlt');
  const rows = app.$$('#hol-list .holrow').length;
  app.klick(app.$$('#hol-list .holrow').find(r => /Projekttag/.test(r.textContent)).querySelector('.minibtn'));
  erwarte(app.$$('#hol-list .holrow').length === rows - 1 && !app.E('DB.holidays.some(h => h.n === "Projekttag")'), 'Freier Tag nicht gelöscht');
  app.$('#hol-state').value = 'BY'; app.$('#hol-state').dispatchEvent(new app.w.Event('change'));
  erwarte(app.E('DB.hst') === 'BY', 'Bundesland nicht gespeichert');
});

test('Termine: Wochenansicht, Klassenarbeiten, Warnungen, Bewertung', async app => {
  planStand(app);
  const cid = app.E('curClass().id');
  app.E('goTimetable()');
  erwarte(!!app.$('#tt-hol-setup') && /KW \d+/.test(app.$('#tt-week').textContent) && app.$('#tt-week').disabled, 'Wochenkopf oder Ferienhinweis fehlt');
  const d0 = app.E('ttDateFor(DB.lessons[0])');
  app.klick('#tt-next');
  erwarte(app.E('ttDateFor(DB.lessons[0])') === app.E(`isoAdd("${d0}", 7)`) && !app.$('#tt-week').disabled && /zurück zu heute/.test(app.$('#tt-week').textContent), 'Blättern verschiebt das Datum nicht');
  app.klick('#tt-week');
  erwarte(app.E('ttWeekOff') === 0 && app.E('ttDateFor(DB.lessons[0])') === d0, 'Zurück zu heute geht nicht');
  // Woche vom 2.11.2026: Klassenarbeit eintragen über das Stundenblatt
  zeigeWoche(app, '2026-11-02');
  erwarte(app.$$('#tt-grid .tt-day small')[0].textContent === '02.11.', 'Datum im Tageskopf fehlt');
  app.klick(app.$$('#tt-grid .tt-cell').find(x => /Do 05\.11\./.test(x.getAttribute('aria-label'))));
  erwarte(!!app.$('#tt-dayinfo') && /Do, 05\.11\./.test(app.$('#tt-dayinfo').textContent) && !!app.$('#tt-ka-add') && !!app.$('#tt-cancel'), 'Tageskasten im Stundenblatt fehlt');
  app.klick('#tt-ka-add');
  erwarte(app.$('#ev-kind button.on').dataset.k === 'ka' && app.$('#ev-date').value === '2026-11-05' && app.$('#ev-class').value === cid && app.$('#ev-subj').value === 'ma' && app.$('#ev-per').value === '1', 'Klassenarbeit nicht vorbelegt');
  app.$('#ev-title').value = 'Brüche'; app.sheetOk();
  erwarte(app.E('DB.events.length') === 1 && app.E('DB.events[0].p') === 1 && app.E('DB.events[0].t') === 'Brüche' && !!app.$('#tt-dayinfo'), 'Klassenarbeit nicht gespeichert oder Stundenblatt nicht zurück');
  app.E('closeModal(); renderTimetable()');
  const cell = app.$$('#tt-grid .tt-cell').find(x => /Do 05\.11\./.test(x.getAttribute('aria-label')));
  erwarte(cell.querySelector('.ttka') && /Klassenarbeit: Brüche/.test(cell.getAttribute('aria-label')) && /Brüche/.test(app.$('#tt-wlist').textContent) && app.$$('#tt-grid .ttdot.ex').length === 1, 'Klassenarbeit nicht in der Woche sichtbar');
  app.E(`DB.events.push({ id: "p4", k: "test", d: "2026-11-12", p: 4, t: "Kopf", c: "${cid}", s: "ma" }); save(); ttWeekOff++; renderTimetable()`);
  erwarte(!app.$$('#tt-grid .tt-cell').find(x => /Do 12\.11\./.test(x.getAttribute('aria-label'))).querySelector('.ttka'), 'Test in anderer Stunde an der falschen Stunde gezeigt');
  app.E('DB.events = DB.events.filter(e => e.id !== "p4"); save(); ttWeekOff--; renderTimetable()');
  // zweite Arbeit am selben Tag: Warnung; vierte in der Woche: Warnung
  app.klick('#tt-ev-add'); app.klick('#ev-kind button[data-k="ka"]');
  app.$('#ev-date').value = '2026-11-05'; app.$('#ev-class').value = cid; app.$('#ev-subj').value = 'ma'; app.$('#ev-subj').dispatchEvent(new app.w.Event('change'));
  erwarte(app.$('#ev-per').value === '1', 'Stunde nicht aus dem Stundenplan vorgeschlagen');
  app.$('#ev-subj').value = 'de'; app.$('#ev-class').dispatchEvent(new app.w.Event('change'));
  erwarte(/schon eine Klassenarbeit/.test(app.$('#ev-warn').textContent) && app.$('#ev-per').value === '', 'Warnung zweite Arbeit fehlt oder Stunde erfunden');
  app.sheetOk();
  app.E(`DB.events.push({ id: "x3", k: "ka", d: "2026-11-03", t: "", c: "${cid}", s: "de" }); save()`);
  app.klick('#tt-ev-add'); app.klick('#ev-kind button[data-k="ka"]');
  app.$('#ev-date').value = '2026-11-06'; app.$('#ev-class').value = cid; app.$('#ev-date').dispatchEvent(new app.w.Event('change'));
  erwarte(/4\. Klassenarbeit/.test(app.$('#ev-warn').textContent) && !/schon eine/.test(app.$('#ev-warn').textContent), 'Warnung Woche fehlt: ' + app.$('#ev-warn').textContent);
  app.klick('#ev-kind button[data-k="test"]');
  erwarte(!/Klassenarbeit/.test(app.$('#ev-warn').textContent), 'Tests zählen als Klassenarbeiten');
  app.E('closeModal()');
  // Termin ohne Titel nicht speichern; mehrtägig; Ferien-Warnung
  app.klick('#tt-ev-add'); app.$('#ev-date').value = '2026-11-04'; app.sheetOk();
  erwarte(/Titel/.test(app.$('#toast').textContent) && app.E('DB.events.length') === 3, 'Termin ohne Titel gespeichert');
  app.$('#ev-title').value = 'Klassenfahrt'; app.$('#ev-end').value = '2026-11-06'; app.$('#ev-time').value = '07:30'; app.sheetOk();
  const kf = JSON.parse(app.E('JSON.stringify(DB.events.find(e => e.t === "Klassenfahrt"))'));
  erwarte(kf.e === '2026-11-06' && kf.tm === '07:30' && !kf.c && app.$$('#tt-grid .ttdot').length === 4, 'Mehrtägiger Termin falsch: ' + JSON.stringify(kf));
  app.E('DB.holidays = [{ id: "h", a: "2026-11-05", b: "2026-11-05", n: "Studientag" }]; save()');
  erwarte(JSON.stringify(app.E('examWarn(DB.events.find(e => e.t === "Brüche"))')).indexOf('Studientag') >= 0, 'Warnung Ferien fehlt');
  app.E('renderTimetable()');
  const fc = app.$$('#tt-grid .tt-cell').find(x => /Do 05\.11\./.test(x.getAttribute('aria-label')));
  erwarte(fc.classList.contains('free') && !fc.querySelector('.ttka') && /Studientag/.test(fc.getAttribute('aria-label')) && app.$$('#tt-grid .tt-day.free').length === 1 && /Studientag/.test(app.$('#tt-wlist').textContent), 'Freier Tag nicht markiert');
  app.klick(fc);
  erwarte(/Frei: Studientag/.test(app.$('#tt-freeinfo').textContent) && !app.$('#tt-ka-add'), 'Stundenblatt am freien Tag falsch');
  app.E('closeModal(); DB.holidays = []; save()');
  // Als Bewertung anlegen, danach öffnen statt doppeln
  app.E('DB.gradesAck = true; editEvent(DB.events.find(e => e.t === "Brüche"))');
  erwarte(app.$('#ev-assess').textContent === 'Als Bewertung anlegen', 'Knopf Bewertung fehlt');
  app.klick('#ev-assess');
  const a = JSON.parse(app.E('JSON.stringify(curClass().assess[0])'));
  erwarte(a && a.title === 'Brüche' && a.date === '2026-11-05' && a.kind === 'written' && a.subjectId === 'ma' && app.E('DB.events.find(e => e.t === "Brüche").aid') === a.id && app.E('curAssessId') === a.id, 'Bewertung nicht angelegt oder verknüpft');
  app.E('editEvent(DB.events.find(e => e.t === "Brüche"))');
  erwarte(app.$('#ev-assess').textContent === 'Bewertung öffnen', 'Verknüpfte Bewertung nicht erkannt');
  app.klick('#ev-assess');
  erwarte(app.E('curClass().assess.length') === 1, 'Bewertung doppelt angelegt');
  // Termin löschen, Terminliste, vergangene
  app.E('openEvents()');
  erwarte(app.$$('#ev-list .evrow').length === app.E(`DB.events.filter(e => evEnd(e) >= isoDay(new Date())).length`), 'Terminliste unvollständig');
  app.E(`DB.events.push({ id: "alt", k: "due", d: "2020-01-10", t: "Alte Frist" }); save(); openEvents()`);
  erwarte(!/Alte Frist/.test(app.$('#ev-list').textContent), 'Vergangene Frist unter „anstehend“');
  app.klick('#ev-past');
  erwarte(/Alte Frist/.test(app.$('#ev-list').textContent), 'Vergangene Termine fehlen');
  app.klick(app.$$('#ev-list .evrow')[0]); app.klick('#ev-del');
  erwarte(!app.E('DB.events.some(e => e.id === "alt")') && !!app.$('#ev-list'), 'Termin nicht gelöscht oder Liste nicht zurück');
});

test('Termine: Kalender-Export (.ics)', async app => {
  planStand(app);
  const cid = app.E('curClass().id');
  app.E(`DB.events = [{ id: "a1", k: "ev", d: "2026-11-04", e: "2026-11-06", t: "Fahrt; Harz, mit Übernachtung", c: "${cid}", n: "Zeile 1\\nZeile 2" },
    { id: "a2", k: "ka", d: "2026-11-05", p: 1, t: "Brüche", c: "${cid}", s: "ma", rem: 1440 },
    { id: "a3", k: "due", d: "2026-11-09", tm: "23:30", t: "Ä".repeat(60) }]; save()`);
  const ics = app.E('icsText(DB.events)');
  const lines = ics.split('\r\n');
  erwarte(ics.indexOf('\n') === ics.indexOf('\r\n') + 1 && /^BEGIN:VCALENDAR\r\nVERSION:2.0/.test(ics) && /END:VCALENDAR\r\n$/.test(ics), 'Rahmen oder Zeilenenden falsch');
  erwarte(lines.every(l => Buffer.byteLength(l, 'utf8') <= 75), 'Zeile länger als 75 Byte');
  const un = ics.replace(/\r\n /g, '');
  erwarte(un.indexOf('DTSTART;VALUE=DATE:20261104\r\nDTEND;VALUE=DATE:20261107') >= 0, 'Mehrtägiger Termin falsch');
  erwarte(un.indexOf('SUMMARY:Fahrt\\; Harz\\, mit Übernachtung · 7b') >= 0 && un.indexOf('DESCRIPTION:Zeile 1\\nZeile 2') >= 0, 'Sonderzeichen nicht maskiert');
  const st = app.E('fmtHM(periodTimes()[1].start)').replace(':', ''), en = app.E('fmtHM(periodTimes()[1].end)').replace(':', '');
  erwarte(un.indexOf('DTSTART:20261105T' + st + '00\r\nDTEND:20261105T' + en + '00') >= 0 && un.indexOf('TRIGGER:-PT1440M') >= 0 && un.indexOf('SUMMARY:Klassenarbeit: Brüche · Ma 7b') >= 0, 'Klassenarbeit mit Stunde/Erinnerung falsch');
  erwarte(un.indexOf('DTSTART:20261109T233000\r\nDTEND:20261109T235900') >= 0 && un.indexOf('Frist: ' + 'Ä'.repeat(60)) >= 0, 'Spätes Ende oder Umlaut-Umbruch falsch');
  erwarte((un.match(/BEGIN:VEVENT/g) || []).length === 3 && (un.match(/BEGIN:VALARM/g) || []).length === 1 && un.indexOf('UID:a1@fairseat') >= 0, 'Einträge fehlen');
  const box = downloadAbfangen(app);
  app.E('openEvents()'); app.klick('#ev-ics');
  erwarte(box.name === 'FairSeat-Termine.ics' && /BEGIN:VEVENT/.test(await blobText(app, box.blob)), 'Export über die Terminliste fehlt: ' + box.name);
  app.E('editEvent(DB.events[1])'); app.klick('#ev-ics1');
  const one = await blobText(app, box.blob);
  erwarte((one.match(/BEGIN:VEVENT/g) || []).length === 1 && /Brüche/.test(box.name), 'Einzelexport falsch');
});

test('Unterrichtsplanung: Reihen verteilen, Ausfall, Ferien, Auslassen, Kursheft', async app => {
  planStand(app);
  const c = 'curClass()';
  app.E(`curClass().units = [{ id: "u1", s: "ma", t: "Brüche", a: "2026-11-02", items: [
    { id: "A", t: "Darstellen", hw: "S. 4", n: 1 }, { id: "B", t: "Erweitern", hw: "S. 8", n: 2 }, { id: "C", t: "Vergleichen", hw: "", n: 1 }, { id: "D", t: "Übung", hw: "", n: 1 }] }]; save()`);
  const plan = () => app.E(`Array.from(unitPlan(${c}, "ma").slots).map(([k, v]) => k.slice(5, 10) + ":" + v.it.id + (v.n > 1 ? v.k : "")).join(" ")`);
  erwarte(plan() === '11-02:A 11-04:B0 11-05:B1 11-09:C 11-11:D', 'Verteilung falsch: ' + plan());
  app.E('setCancelled(DB.lessons.find(L => L.id === "L3"), "2026-11-04", true); save()');
  erwarte(plan() === '11-02:A 11-05:B0 11-09:B1 11-11:C 11-12:D', 'Ausfall verschiebt nicht: ' + plan());
  app.E('DB.holidays = [{ id: "h", a: "2026-11-09", b: "2026-11-09", n: "frei" }]; save()');
  erwarte(plan() === '11-02:A 11-05:B0 11-11:B1 11-12:C 11-16:D', 'Ferien verschieben nicht: ' + plan());
  app.E(`curClass().uskip = ["2026-11-05|L4"]; save()`);
  erwarte(plan() === '11-02:A 11-11:B0 11-12:B1 11-16:C 11-18:D', 'Auslassen verschiebt nicht: ' + plan());
  // zweite Reihe beginnt (früher eingetragen) erst nach der ersten
  app.E(`curClass().units.push({ id: "u2", s: "ma", t: "Dezimalzahlen", a: "2026-11-01", items: [{ id: "E", t: "Einführung", hw: "", n: 1 }] }); save()`);
  erwarte(/11-02:E/.test(plan()) && !/11-02:A/.test(plan()), 'Reihen nach Beginn sortiert: zweite zuerst erwartet');
  app.E(`curClass().units.find(u => u.id === "u2").a = "2026-11-17"; save()`);
  erwarte(plan() === '11-02:A 11-11:B0 11-12:B1 11-16:C 11-18:D 11-19:E', 'Folgereihe nicht angehängt: ' + plan());
  const info = JSON.parse(app.E(`JSON.stringify(Array.from(unitPlan(${c}, "ma").info))`));
  erwarte(info[0][1].from === '2026-11-02' && info[0][1].to === '2026-11-18' && info[0][1].total === 5 && info[0][1].done === 5, 'Reihenbereich falsch: ' + JSON.stringify(info));
  app.E(`DB.lessons.push({ id: "L6", day: 0, period: 5, span: 1, week: "", subjectId: "ma", classId: curClass().id, roomId: "", planId: "" });
    curClass().units.push({ id: "x1", s: "ma", t: "X", a: "2026-12-07", items: [{ id: "X", t: "x", hw: "", n: 1 }] }, { id: "y1", s: "ma", t: "Y", a: "2026-12-14", items: [{ id: "Y", t: "y", hw: "", n: 1 }] }); save()`);
  const xy = app.E(`Array.from(unitPlan(${c}, "ma").slots).filter(([k, v]) => v.u.id === "x1" || v.u.id === "y1").map(([k, v]) => k.slice(5) + ":" + v.it.id).join(" ")`);
  erwarte(xy === '12-07|L1:X 12-14|L1:Y', 'Folgereihe beginnt vor ihrem Beginn: ' + xy);
  app.E(`DB.lessons = DB.lessons.filter(L => L.id !== "L6"); curClass().units = curClass().units.filter(u => u.id !== "x1" && u.id !== "y1"); save()`);
  erwarte(app.E(`unitNextStart(${c}, "ma")`) === (app.E('isoDay(new Date())') <= '2026-11-19' ? '2026-11-20' : app.E('isoDay(new Date())')), 'Beginn der nächsten Reihe falsch');
  // Wochenansicht zeigt geplante und gehaltene Themen
  zeigeWoche(app, '2026-11-09');
  const zelle = d => app.$$('#tt-grid .tt-cell').find(x => x.getAttribute('aria-label').indexOf(d) >= 0);
  erwarte(zelle('Mi 11.11.').querySelector('.tt-topic.plan').textContent === 'Erweitern' && zelle('Mo 09.11.').classList.contains('free'), 'Geplantes Thema fehlt in der Woche');
  app.E(`curClass().journal = [{ id: "j1", d: "2026-11-12", p: 1, s: "ma", topic: "Erweitern geübt", hw: "" }]; save(); renderTimetable()`);
  erwarte(zelle('Do 12.11.').querySelector('.tt-topic').textContent === 'Erweitern geübt' && !zelle('Do 12.11.').querySelector('.tt-topic.plan'), 'Gehaltenes Thema nicht bevorzugt');
  app.E('curClass().journal = []; save()');
  // Stundenblatt: +1 Stunde, Auslassen zurücknehmen, Reihe öffnen
  app.klick(zelle('Mi 11.11.'));
  erwarte(/Thema 2 von 4: Erweitern \(1\/2\)/.test(app.$('#tt-plan').textContent), 'Planung im Stundenblatt fehlt: ' + (app.$('#tt-plan') || {}).textContent);
  app.klick('#tt-u-more');
  erwarte(app.E('curClass().units[0].items[1].n') === 3 && /\(1\/3\)/.test(app.$('#tt-plan').textContent), '+1 Stunde wirkt nicht');
  app.klick('#tt-u-skip');
  erwarte(app.E('curClass().uskip.indexOf("2026-11-11|L3") >= 0') && !app.$('#tt-plan') && /wieder einplanen/.test(app.$('#tt-u-skip').textContent), 'Auslassen über das Stundenblatt geht nicht');
  app.klick('#tt-u-skip');
  erwarte(app.E('curClass().uskip.indexOf("2026-11-11|L3") < 0') && !!app.$('#tt-plan'), 'Auslassen nicht zurücknehmbar');
  app.E('curClass().units[0].items[1].n = 6; save(); closeModal()'); app.klick(zelle('Mi 11.11.'));
  erwarte(!app.$('#tt-u-more') && /\(1\/6\)/.test(app.$('#tt-plan').textContent), '+1 über 6 Stunden möglich');
  app.E('curClass().units[0].items[1].n = 3; save(); closeModal()'); app.klick(zelle('Mi 11.11.'));
  // Kursheft: Vorschlag aus der Planung, Hausaufgabe erst in der letzten Stunde des Themas
  app.klick('#tt-journal');
  erwarte(app.$('#j-topic').value === 'Erweitern' && app.$('#j-hw').value === '' && !!app.$('#j-planned') && app.$('#j-date').value === '2026-11-11', 'Kursheft ohne Vorschlag: ' + app.$('#j-topic').value);
  app.sheetOk();
  erwarte(app.E('curClass().journal.length') === 1 && app.E('curClass().journal[0].p') === 4 && app.E('curClass().journal[0].d') === '2026-11-11', 'Kursheft-Eintrag falsch: ' + app.E('JSON.stringify(curClass().journal)'));
  app.E(`openJournal(curClass(), null, "ma", { d: "2026-11-16", L: DB.lessons.find(L => L.id === "L1") })`);
  erwarte(app.$('#j-topic').value === 'Erweitern' && app.$('#j-hw').value === 'S. 8', 'Hausaufgabe in der letzten Stunde fehlt: ' + app.$('#j-hw').value);
  app.E('closeModal()');
  app.E(`openJournal(curClass(), null, "ma", { d: "2026-11-11", L: DB.lessons.find(L => L.id === "L3") })`);
  erwarte(app.$('#j-topic').value === 'Erweitern' && !app.$('#j-planned'), 'Vorhandener Eintrag durch Planung überschrieben');
  app.E('closeModal()');
});

test('Unterrichtsplanung: Reihe anlegen, Liste einfügen, kopieren, löschen', async app => {
  planStand(app);
  klasseMitNamen(app, '7c', ['Dora']);
  app.E('setCurClass(DB.classes.find(c => c.name === "7b").id); goTimetable()');
  app.klick('#tt-units');
  erwarte(/Noch keine Reihen/.test(app.$('#un-overview').textContent), 'Leere Übersicht falsch');
  app.klick('#un-new');
  erwarte(app.$('#un-class').value === app.E('curClass().id') && app.$('#un-subj').value === 'ma' && app.$('#un-start').value === app.E('isoDay(new Date())'), 'Neue Reihe nicht vorbelegt');
  app.$('#un-subj').value = 'de'; app.$('#un-subj').dispatchEvent(new app.w.Event('change'));
  app.sheetOk();
  erwarte(/Titel/.test(app.$('#toast').textContent), 'Reihe ohne Titel gespeichert');
  app.$('#un-title').value = 'Balladen';
  app.klick('#un-paste');
  app.$('#un-paste-t').value = '1. Der Erlkönig | Strophe 1 lesen\n- John Maynard\n\n• Balladenmerkmale\tTabelle';
  app.klick('#un-paste-ok');
  erwarte(app.$$('#un-list .unitem').length === 3 && app.$('#un-t-0').value === 'Der Erlkönig' && app.$('#un-h-0').value === 'Strophe 1 lesen' && app.$('#un-h-2').value === 'Tabelle' && app.$('#un-t-1').value === 'John Maynard', 'Liste falsch übernommen');
  erwarte(/3 Stunden/.test(app.$('#un-sum').textContent) && app.$('#un-d-0').textContent.length > 0, 'Vorschau fehlt: ' + app.$('#un-sum').textContent);
  app.klick(app.$$('#un-n-1 button')[1]);
  erwarte(/4 Stunden/.test(app.$('#un-sum').textContent) && app.$('#un-d-1').textContent.split(',').length === 2, 'Stundenzahl ändert die Vorschau nicht');
  app.klick(app.$$('#un-list .unitem')[2].querySelectorAll('.unctl .minibtn')[0]);   // nach oben
  erwarte(app.$('#un-t-1').value === 'Balladenmerkmale', 'Verschieben geht nicht');
  app.klick('#un-add'); app.sheetOk();
  const u = JSON.parse(app.E('JSON.stringify(curClass().units[0])'));
  erwarte(u.t === 'Balladen' && u.s === 'de' && u.items.length === 3 && u.items[2].n === 2, 'Reihe falsch gespeichert: ' + JSON.stringify(u));
  erwarte(/Balladen/.test(app.$('#un-overview').textContent) && /4 Std\./.test(app.$('#un-overview').textContent), 'Übersicht zeigt die Reihe nicht');
  // Fach ohne Stunden: Hinweis
  app.klick(app.$('#un-overview .unrow'));
  app.$('#un-subj').value = 'ma'; app.$('#un-subj').dispatchEvent(new app.w.Event('change'));
  app.$('#un-subj').value = 'de'; app.$('#un-subj').dispatchEvent(new app.w.Event('change'));
  // kopieren in 7c (dort keine Stunden)
  app.klick('#un-copy'); app.klick('#un-copy-ok');
  const c7 = JSON.parse(app.E('JSON.stringify(DB.classes.find(c => c.name === "7c").units)'));
  erwarte(c7.length === 1 && c7[0].items.length === 3 && c7[0].id !== u.id && c7[0].items[0].id !== u.items[0].id && /nach 7c kopiert/.test(app.$('#toast').textContent), 'Kopieren falsch');
  app.E(`editUnit(DB.classes.find(c => c.name === "7c"), DB.classes.find(c => c.name === "7c").units[0])`);
  erwarte(/noch keine Stunde für 7c in Deutsch/.test(app.$('#un-sum').textContent), 'Hinweis ohne Stunden fehlt: ' + app.$('#un-sum').textContent);
  app.klick('#un-del'); app.sheetOk();
  erwarte(app.E('DB.classes.find(c => c.name === "7c").units.length') === 0, 'Reihe nicht gelöscht');
  // Stundenblatt ohne Reihe: Reihe planen mit Fach und Datum
  zeigeWoche(app, '2026-11-02');
  app.klick(app.$$('#tt-grid .tt-cell').find(x => /Do 05\.11\./.test(x.getAttribute('aria-label'))));
  app.klick('#tt-u-new');
  erwarte(app.$('#un-subj').value === 'ma' && app.$('#un-start').value === '2026-11-05' && !app.$('#un-class'), 'Reihe planen aus der Stunde nicht vorbelegt');
  app.E('closeModal()');
});

test('Termine und Planung: Laden prüft, Abgleich, ältere App, Startseite, Schuljahr', async app => {
  uhr(app, 1000); planStand(app);
  const cid = app.E('curClass().id');
  const S = JSON.parse(app.E(`JSON.stringify(sanitizeDB({ v: 2, hst: "XX", classes: [{ id: "c", name: "K", students: [],
    units: [{ id: "u", s: "ma", t: "R", a: "2026-02-30", items: [{ id: "i", t: "x" }] }, { id: "u2", s: "ma", t: " R2 ", a: "2026-03-02", items: [{ id: "i", t: "a", n: 9 }, { id: "i", t: "b" }, { id: "j", t: "" }] },
      { id: "constructor", s: "ma", t: "P", a: "2026-03-02", items: [{ id: "i", t: "a" }] }],
    uskip: ["2026-03-02|L1", "2026-03-02|L1", "kaputt"] }],
    events: [{ id: "e1", k: "ka", d: "2026-11-05", p: 1, tm: "08:00", e: "2026-11-09", c: "c", s: "ma", rem: 5 }, { id: "e2", k: "ev", d: "2026-11-05", e: "2027-11-05", t: "", tm: "25:00" },
      { id: "e3", k: "ev", d: "2026-11-05", e: "2026-11-07", t: "  Fahrt ", tm: "07:30", p: 3, s: "ma", rem: 60 }, { id: "e3", k: "due", d: "2026-11-06", t: "doppelt" }, { id: "e4", k: "zz", d: "2026-11-05", t: "x" }],
    holidays: [{ id: "h1", a: "2026-11-02", b: "2026-11-01" }, { id: "h2", a: "2026-11-02", b: "2026-11-03", n: "Ok" }, { id: "h3", a: "2026-01-01", b: "2026-12-31" }] }))`));
  const c0 = S.classes[0];
  erwarte(S.hst === '' && c0.units.length === 1 && c0.units[0].t === 'R2' && c0.units[0].items.length === 1 && c0.units[0].items[0].n === 1 && JSON.stringify(c0.uskip) === '[]', 'Reihen falsch geprüft: ' + JSON.stringify(c0));
  const evOf = id => JSON.stringify(S.events.find(e => e.id === id));
  erwarte(S.events.length === 2 && evOf('e1') === '{"id":"e1","k":"ka","d":"2026-11-05","t":"","p":1,"c":"c","s":"ma"}'
    && evOf('e3') === '{"id":"e3","k":"ev","d":"2026-11-05","t":"Fahrt","e":"2026-11-07","tm":"07:30","rem":60}', 'Termine falsch geprüft: ' + JSON.stringify(S.events));
  erwarte(S.holidays.length === 1 && S.holidays[0].n === 'Ok', 'Ferien falsch geprüft');
  // Verweise mit älteren ID-Formaten bleiben; ausgelassene Stunden nur zu vorhandenen Stunden
  const S2 = JSON.parse(app.E(`JSON.stringify(sanitizeDB({ v: 2, subjects: [{ id: "fach.alt mit leer", name: "Alt" }],
    lessons: [{ id: "Lx", day: 0, period: 0, subjectId: "fach.alt mit leer", classId: "klasse.7b" }],
    classes: [{ id: "klasse.7b", name: "7b", students: [], units: [{ id: "u", s: "fach.alt mit leer", t: "R", a: "2026-03-02", items: [{ id: "i", t: "a" }] }],
      uskip: ["2026-03-02|Lx", "2026-03-09|weg"] }],
    events: [{ id: "e", k: "ka", d: "2026-03-02", c: "klasse.7b", s: "fach.alt mit leer", aid: "a.1" }] }))`));
  erwarte(S2.classes[0].units.length === 1 && S2.events[0].c === 'klasse.7b' && S2.events[0].s === 'fach.alt mit leer' && S2.events[0].aid === 'a.1'
    && JSON.stringify(S2.classes[0].uskip) === '["2026-03-02|Lx"]', 'Ältere ID-Formate verworfen oder verwaiste Auslassungen behalten: ' + JSON.stringify(S2.classes[0]));
  // Abgleich zwischen zwei Geräten
  app.E(`DB.events = [{ id: "e1", k: "ka", d: "2026-11-05", p: 1, t: "Brüche", c: "${cid}", s: "ma" }]; DB.holidays = [{ id: "h1", a: "2026-11-09", b: "2026-11-09", n: "frei" }]; DB.hst = "NI";
    curClass().units = [{ id: "u1", s: "ma", t: "Brüche", a: "2026-11-02", items: [{ id: "A", t: "Darstellen", hw: "", n: 1 }] }]; curClass().uskip = ["2026-11-02|L1"]; flushSave()`);
  const B = neueApp();
  try{
    uhr(B, 1100); await laden(B, datei(app), 'replace');
    erwarte(B.E('DB.events.length') === 1 && B.E('DB.hst') === 'NI' && B.E('DB.classes[0].units.length') === 1 && B.E('DB.classes[0].uskip.length') === 1, 'Ersetzen verliert Termine/Planung');
    uhr(B, 2000); B.E(`DB.events.push({ id: "e2", k: "ev", d: "2026-11-10", t: "Konferenz" }); DB.classes[0].units[0].items.push({ id: "B", t: "Kürzen", hw: "", n: 1 }); DB.hst = "HB"; DB.classes[0].uskip = []; flushSave()`);
    uhr(app, 2100); app.E('DB.events[0].t = "Bruchrechnung"; DB.holidays.push({ id: "h2", a: "2026-12-21", b: "2026-12-22", n: "Brücke" }); flushSave()');
    uhr(app, 2200); await laden(app, datei(B), 'merge');
    erwarte(app.E('DB.events.length') === 2 && app.E('DB.events.find(e => e.id === "e1").t') === 'Bruchrechnung' && app.E('DB.holidays.length') === 2 && app.E('DB.hst') === 'HB'
      && app.E('curClass().units[0].items.length') === 2 && app.E('curClass().uskip.length') === 0, 'Abgleich führt Termine/Planung nicht zusammen');
    uhr(B, 2300); B.E('DB.events = DB.events.filter(e => e.id !== "e2"); DB.holidays = []; flushSave()');
    uhr(app, 2400); await laden(app, datei(B), 'merge');
    erwarte(app.E('DB.events.length') === 1 && app.E('DB.holidays.length') === 1 && app.E('DB.holidays[0].id') === 'h2', 'Löschen kommt nicht an oder löscht Neueres: ' + app.E('JSON.stringify(DB.holidays)'));
  } finally { B.ende(); }
  // ältere App kennt Termine/Ferien/Reihen nicht: nichts geht verloren
  uhr(app, 3000);
  const alt = app.E(`(() => { const d = backupData(); d.stamps = unpackStamps(d.stamps); d.del = unpackStamps(d.del);
    Object.keys(d.stamps).forEach(k => { if(/^(ev|hol|hst|un|uk)(\\||$)/.test(k)) delete d.stamps[k]; });
    delete d.events; delete d.holidays; delete d.hst; d.classes.forEach(c => { delete c.units; delete c.uskip; });
    d.classes[0].name = "7b neu"; d.stamps["c|" + idk(d.classes[0].id)] = 3000; d.mod = 3000;
    d.stamps = packStamps(d.stamps); d.del = packStamps(d.del);
    return JSON.stringify({ app: "fairseat", v: 2, data: d }); })()`);
  uhr(app, 3100); await laden(app, alt, 'merge');
  erwarte(app.E('curClass().name') === '7b neu' && app.E('DB.events.length') === 1 && app.E('DB.holidays.length') === 1 && app.E('DB.hst') === 'HB' && app.E('curClass().units.length') === 1, 'Ältere App löscht Termine oder Planung');
  // Startseite: Demnächst
  app.E(`DB.events.push({ id: "s1", k: "ka", d: isoAdd(isoDay(new Date()), 2), t: "Bald", c: "${cid}", s: "ma" }, { id: "s2", k: "ev", d: isoAdd(isoDay(new Date()), 30), t: "Später" });
    DB.holidays.push({ id: "s3", a: isoAdd(isoDay(new Date()), 5), b: isoAdd(isoDay(new Date()), 6), n: "Brückentage" }); save(); goHome()`);
  const soon = app.$('#day-soon') ? app.$('#day-soon').textContent : '';
  erwarte(/Klassenarbeit: Bald/.test(soon) && /Brückentage ab/.test(soon) && !/Später/.test(soon) && !!app.$('#day-soon .daytask.ex'), 'Demnächst unvollständig: ' + soon);
  app.klick(app.$$('#day-soon .daytask').find(b => /Bald/.test(b.textContent)));
  erwarte(app.$('#ev-title').value === 'Bald', 'Tipp öffnet den Termin nicht');
  app.E('closeModal()');
  app.E(`DB.holidays.push({ id: "s4", a: isoDay(new Date()), b: isoDay(new Date()), n: "Heute zu" }); save(); renderNowCard()`);
  erwarte(/Heute frei: Heute zu/.test(app.$('#day-soon').textContent), 'Heute frei fehlt');
  // Schuljahreswechsel: vergangene Termine weg, Reihen mit dem Stundenplan
  app.E(`DB.events.push({ id: "old", k: "due", d: "2020-01-01", t: "alt" }); save(); openNewYear()`);
  app.sheetOk(); app.sheetOk();
  erwarte(!app.E('DB.events.some(e => e.id === "old")') && app.E('DB.events.some(e => e.id === "s1")') && app.E('DB.classes.every(c => !(c.units || []).length && !(c.uskip || []).length)'), 'Schuljahreswechsel räumt Termine/Reihen nicht auf');
});

/* WebDAV-Server zum Testen: hält Dateien im Speicher, prüft Anmeldung, ETag (If-Match / If-None-Match) und Ordner */
function davServer(){
  const S = { files: new Map(), log: [], user: 'simon.m', pw: 'iserv-geheim', dir: 'https://kgs-test.de/webdav/Files/', n: 0, vorPut: null, aus: false,
    verz: 5, umleiten: false, schwach: false, kekse: 0, optionen: [] };
  S.installiere = app => {
    app.w.FairSeatHttp = { sendRequest(url, o, ok, fail){
      S.optionen.push(o);
      const h = o.headers || {}, m = String(o.method).toUpperCase();
      S.log.push(m + ' ' + url + (h['If-Match'] ? ' if-match ' + h['If-Match'] : '') + (h['If-None-Match'] ? ' if-none ' + h['If-None-Match'] : ''));
      const antwort = (status, data, etag) => setTimeout(() => {
        const r = { status, headers: etag ? { ETag: etag } : {}, data: data || '' };
        if(status >= 200 && status < 300) ok(r); else fail(Object.assign(r, { error: data || '' }));
      }, S.verz);
      if(S.aus) return antwort(-1, 'offline');
      if(S.umleiten) return antwort(302, '<html>Anmeldung</html>');
      const erwartet = 'Basic ' + Buffer.from(S.user + ':' + S.pw, 'utf8').toString('base64');
      if(h.Authorization !== erwartet) return antwort(401, 'Unauthorized');
      if(url.indexOf(S.dir) !== 0) return antwort(409, 'Conflict');
      const f = S.files.get(url);
      if(m === 'GET'){
        if(!f) return antwort(404, 'Not Found');
        if(h['If-None-Match'] && h['If-None-Match'] === f.etag) return antwort(304, '', f.etag);
        return antwort(200, f.data, f.etag);
      }
      if(m === 'PUT'){
        if(S.vorPut){ const v = S.vorPut; S.vorPut = null; v(); }
        const g = S.files.get(url);
        if(h['If-Match'] && (!g || g.etag !== h['If-Match'])) return antwort(412, 'Precondition Failed');
        if(h['If-None-Match'] === '*' && g) return antwort(412, 'Precondition Failed');
        if(typeof o.data !== 'string') return antwort(400, 'Bad Request');
        const etag = (S.schwach ? 'W/' : '') + '"e' + (++S.n) + '"';
        S.files.set(url, { data: o.data, etag });
        return antwort(g ? 204 : 201, '', etag);
      }
      return antwort(405, 'Method Not Allowed');
    } };
  };
  S.datei = () => S.files.get(S.dir + 'FairSeat-Abgleich.json');
  S.puts = () => S.log.filter(x => x.indexOf('PUT') === 0).length;
  return S;
}
/* Einrichten über die Oberfläche */
async function davEinrichten(app, S, key, opt){
  opt = opt || {};
  app.E('goHome()'); app.klick('#btn-settings'); app.klick('#set-dav');
  app.$('#dav-url').value = opt.url || 'kgs-test.de';
  app.$('#dav-user').value = opt.user || S.user;
  app.$('#dav-pw').value = opt.pw || S.pw;
  app.$$('#sheet input[autocomplete="new-password"]').forEach(f => { f.value = key; });
  const knopf = app.$('#dav-connect');
  knopf.click();
  await bis(() => !knopf.disabled, 15000);
}
const davLauf = (app, why) => app.E(`davSync("${why || 'test'}")`);

test('WebDAV: eigenes Plugin – Schnittstelle', app => {
  /* www/fairseat-http.js mit einem nachgebauten cordova/exec */
  const code = fs.readFileSync(require('path').join(__dirname, 'plugins-src', 'cordova-plugin-fairseat-http', 'www', 'fairseat-http.js'), 'utf8');
  let aufruf = null, antwort = null;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(n => n === 'cordova/exec' ? (ok, fail, svc, act, args) => { aufruf = { svc, act, args }; antwort(ok, fail); } : null, module, module.exports);
  const H = module.exports, erg = [];
  antwort = ok => ok({ status: 201, headers: { etag: '"a"' }, data: '' });
  H.sendRequest('https://x.de/f', { method: 'put', headers: { 'If-Match': '"z"' }, data: 'abc', connectTimeout: 15, readTimeout: 60 }, r => erg.push(['ok', r]), r => erg.push(['fail', r]));
  erwarte(aufruf.svc === 'FairSeatHttp' && aufruf.act === 'request' && JSON.stringify(aufruf.args) === '["PUT","https://x.de/f",{"If-Match":"\\"z\\""},"abc",15,60]', 'Plugin bekommt falsche Argumente: ' + JSON.stringify(aufruf));
  erwarte(erg[0][0] === 'ok' && erg[0][1].status === 201 && erg[0][1].headers.etag === '"a"', '2xx nicht als Erfolg gemeldet');
  antwort = ok => ok({ status: 412, headers: {}, data: 'Precondition' });
  H.sendRequest('https://x.de/f', { method: 'get' }, r => erg.push(['ok', r]), r => erg.push(['fail', r]));
  erwarte(erg[1][0] === 'fail' && erg[1][1].status === 412 && aufruf.args[3] === null && aufruf.args[4] === 15, 'Status außerhalb 2xx nicht als Fehler gemeldet');
  antwort = (ok, fail) => fail({ status: -4, error: 'timeout' });
  H.sendRequest('https://x.de/f', {}, r => erg.push(['ok', r]), r => erg.push(['fail', r]));
  erwarte(erg[2][0] === 'fail' && erg[2][1].status === -4 && aufruf.args[0] === 'GET', 'Netzfehler nicht durchgereicht');
  antwort = (ok, fail) => fail('kaputt');
  H.sendRequest('https://x.de/f', {}, r => erg.push(['ok', r]), r => erg.push(['fail', r]));
  erwarte(erg[3][0] === 'fail' && erg[3][1].status === -1, 'Unerwartete Fehlerform nicht abgefangen');
  // native Quellen: nur https, keine Weiterleitungen, keine Cookies
  const sw = fs.readFileSync(require('path').join(__dirname, 'plugins-src', 'cordova-plugin-fairseat-http', 'src', 'ios', 'FairSeatHttp.swift'), 'utf8');
  const jv = fs.readFileSync(require('path').join(__dirname, 'plugins-src', 'cordova-plugin-fairseat-http', 'src', 'android', 'FairSeatHttp.java'), 'utf8');
  erwarte(/completionHandler\(nil\)/.test(sw) && /httpCookieStorage = nil/.test(sw) && /urlCache = nil/.test(sw) && /scheme\?\.lowercased\(\) == "https"/.test(sw), 'iOS-Plugin: Weiterleitung, Cookies, Cache oder https-Prüfung fehlt');
  erwarte(/setInstanceFollowRedirects\(false\)/.test(jv) && /setUseCaches\(false\)/.test(jv) && /"https"\.equalsIgnoreCase/.test(jv), 'Android-Plugin: Weiterleitung, Cache oder https-Prüfung fehlt');
});

test('WebDAV: Adresse prüfen', app => {
  const n = u => { const r = app.E(`JSON.stringify(davNormUrl(${JSON.stringify(u)}))`); return r === undefined ? 'null' : r; };
  erwarte(n('kgs-kirchweyhe.eu') === '{"url":"https://kgs-kirchweyhe.eu/webdav/Files/"}', 'IServ-Adresse nicht ergänzt: ' + n('kgs-kirchweyhe.eu'));
  erwarte(n(' https://kgs-kirchweyhe.eu/webdav ') === '{"url":"https://kgs-kirchweyhe.eu/webdav/Files/"}', '„/webdav“ ohne Files: ' + n('https://kgs-kirchweyhe.eu/webdav'));
  erwarte(n('https://kgs-kirchweyhe.eu/webdav/Files/FairSeat-Abgleich.json') === '{"url":"https://kgs-kirchweyhe.eu/webdav/Files/"}', 'Dateiname nicht abgetrennt');
  erwarte(n('https://cloud.x.de/remote.php/dav/files/simon') === '{"url":"https://cloud.x.de/remote.php/dav/files/simon/"}', 'Nextcloud-Pfad verändert');
  erwarte(n('https://kgs-kirchweyhe.eu/webdav/Groups/Mathe/') === '{"url":"https://kgs-kirchweyhe.eu/webdav/Groups/Mathe/"}', 'Gruppenordner verändert');
  erwarte(n('http://x.de') === '{"err":"davEHttp"}' && n('ftp://x.de') === 'null' && n('localhost') === 'null' && n('https://a:b@x.de') === 'null' && n('') === 'null', 'Unsichere oder ungültige Adressen angenommen');
});

test('WebDAV: einrichten, verschlüsselt ablegen, zweites Gerät übernimmt', async app => {
  const S = davServer(), B = neueApp();
  try{
    S.installiere(app); S.installiere(B);
    uhr(app, 1000); grundstand(app);
    // ohne Plugin (Browser): nur Hinweis
    const C = neueApp();
    try{ C.E('openDavSetup()'); erwarte(!!C.$('#dav-noapp') && !C.$('#dav-connect'), 'Ohne App kein Hinweis'); } finally { C.ende(); }
    // falsches Abgleich-Passwort zu kurz
    app.E('goHome()'); app.klick('#btn-settings'); app.klick('#set-dav');
    erwarte(/Aus/.test(app.$('#set-dav-status') ? app.$('#set-dav-status').textContent : 'Aus'), 'Status ohne Abgleich nicht „Aus“');
    app.$('#dav-url').value = 'kgs-test.de'; app.$('#dav-user').value = S.user; app.$('#dav-pw').value = S.pw;
    app.$$('#sheet input[autocomplete="new-password"]').forEach(f => { f.value = 'kurz'; });
    app.klick('#dav-connect'); await pause(60);
    erwarte(S.log.length === 0 && app.E('davCfg()') === null, 'Zu kurzes Abgleich-Passwort angenommen');
    app.E('closeModal()');
    await davEinrichten(app, S, 'abgleich-123');
    erwarte(!!S.datei() && S.puts() === 1, 'Datei nicht hochgeladen: ' + S.log.join(' | '));
    const roh = S.datei().data;
    erwarte(!/Anna|Dana|KA 1|Mathe/.test(roh) && /"enc"/.test(roh), 'Datei auf dem Server nicht verschlüsselt');
    erwarte(!app.$('#modal').classList.contains('on') && /eingerichtet/.test(app.$('#toast').textContent), 'Einrichten ohne Abschluss: ' + app.$('#toast').textContent);
    // Passwörter: nicht im Klartext gespeichert, nie in einer Sicherung
    const alles = app.E('JSON.stringify(Object.keys(localStorage).map(k => localStorage.getItem(k)))');
    erwarte(alles.indexOf(S.pw) < 0 && alles.indexOf('abgleich-123') < 0, 'Passwort steht im Speicher');
    erwarte(app.E('JSON.stringify(backupData())').indexOf('webdav') < 0 && app.E('JSON.stringify(DB)').indexOf('kgs-test') < 0, 'Abgleich-Einstellungen landen in der Sicherung');
    erwarte(/Zuletzt abgeglichen: heute/.test(app.$('#set-dav-status').textContent), 'Status in den Einstellungen fehlt: ' + app.$('#set-dav-status').textContent);
    // Datei lässt sich auch als Sicherung einlesen
    erwarte(app.E(`(async () => JSON.parse(await decryptBackup(${roh}.enc, "abgleich-123")).data.classes[0].name)()`) !== undefined, 'Entschlüsseln nicht möglich');
    const nameAusDatei = await app.E(`(async () => JSON.parse(await decryptBackup(${roh}.enc, "abgleich-123")).data.classes[0].name)()`);
    erwarte(nameAusDatei === '7b', 'Datei ist keine gültige Sicherung: ' + nameAusDatei);
    // Nichts geändert: kein erneutes Hochladen (304)
    await davLauf(app);
    erwarte(S.puts() === 1 && /if-none "e1"/.test(S.log[S.log.length - 1]), 'Ohne Änderung hochgeladen oder ohne ETag gefragt: ' + S.log.join(' | '));
    // zweites Gerät, leer: übernimmt den Stand, ohne zurückzuschicken
    uhr(B, 1500);
    await davEinrichten(B, S, 'abgleich-123');
    erwarte(B.E('DB.classes.length') === 1 && B.E('curClass() ? 1 : DB.classes[0].students.length') && inhalt(B) === inhalt(app), 'Zweites Gerät hat den Stand nicht');
    erwarte(S.puts() === 1, 'Leeres Gerät hat zurückgeschickt');
    // Gerät B ändert, A holt
    uhr(B, 2000); B.E('DB.classes[0].assess[0].marks[DB.classes[0].students[1].id] = "1"; flushSave()');
    await davLauf(B);
    erwarte(S.puts() === 2, 'Änderung nicht hochgeladen');
    uhr(app, 2100); await davLauf(app, 'resume');
    erwarte(app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[1].id]') === '1', 'Änderung kommt nicht an');
    erwarte(S.puts() === 2, 'Nur geholt, trotzdem hochgeladen');
    uhr(app, 2150); await davLauf(app);
    erwarte(S.puts() === 2, 'Nach dem Holen beim nächsten Mal hochgeladen');
    // gerade getippt (Speichern wartet noch): wird mit Zeitstempel mitgenommen
    uhr(B, 2160); B.E('DB.classes[0].assess[0].marks[DB.classes[0].students[2].id] = "5"; save()');
    await davLauf(B);
    uhr(app, 2170); await davLauf(app);
    erwarte(app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[2].id]') === '5', 'Ungespeicherte Änderung nicht mitgenommen');
    // Datenschutz-Cockpit zeigt den Abgleich
    app.E('openPrivacy()');
    erwarte(!!app.$('#pv-sync') && /Zuletzt abgeglichen/.test(app.$('#pv-sync').textContent) && !app.$('#pv-sync .pvi.warn'), 'Cockpit zeigt den Abgleich nicht');
    erwarte(/eigenen Speicher/.test(app.$('#sheet .hint').textContent), 'Cockpit behauptet bei Abgleich, nichts ins Internet zu senden');
    app.E('closeModal()');
  } finally { B.ende(); }
});

test('WebDAV: gleichzeitig ändern, Fehler, Warten auf offene Fenster, ausschalten', async app => {
  const S = davServer(), B = neueApp(), C = neueApp();
  try{
    S.installiere(app); S.installiere(B); S.installiere(C);
    uhr(app, 1000); grundstand(app);
    await davEinrichten(app, S, 'abgleich-123');
    uhr(B, 1100); await davEinrichten(B, S, 'abgleich-123');
    // beide ändern; A schiebt sich zwischen Lesen und Schreiben von B → 412, B holt neu und führt zusammen
    uhr(app, 2000); app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[1].id] = "3"; flushSave()');
    uhr(B, 2050); B.E('DB.classes[0].obs = [{ id: "o1", sid: DB.classes[0].students[2].id, d: "2026-10-01", text: "arbeitet mit" }]; flushSave()');
    uhr(app, 2100); await davLauf(app);
    uhr(B, 2200);
    S.vorPut = () => { const f = S.datei(); S.files.set(S.dir + 'FairSeat-Abgleich.json', { data: f.data, etag: '"fremd"' }); };
    const r = await B.E('davSync("test")');
    erwarte(r && r.ok && S.log.filter(x => /PUT/.test(x)).length >= 4, 'Konflikt nicht neu versucht: ' + JSON.stringify(r) + ' ' + S.log.join(' | '));
    uhr(app, 2300); await davLauf(app);
    erwarte(app.E('DB.classes[0].obs.length') === 1 && B.E('DB.classes[0].assess[0].marks[DB.classes[0].students[1].id]') === '3' && inhalt(app) === inhalt(B), 'Gleichzeitige Änderungen nicht zusammengeführt');
    // falsches Abgleich-Passwort: nichts verändert
    const vorher = S.datei().data, putsVorher = S.puts();
    uhr(C, 2400);
    await davEinrichten(C, S, 'anderes-pw-9');
    erwarte(S.datei().data === vorher && S.puts() === putsVorher && C.E('DB.classes.length') === 0, 'Falsches Abgleich-Passwort hat etwas verändert');
    erwarte(/passt nicht/.test(C.$('#toast').textContent) && C.$('#modal').classList.contains('on'), 'Falsches Abgleich-Passwort nicht gemeldet: ' + C.$('#toast').textContent);
    C.E('closeModal()');
    // falsches Server-Passwort
    C.E('davCfgSet(null)');
    await davEinrichten(C, S, 'abgleich-123', { pw: 'falsch' });
    erwarte(/Anmeldung abgelehnt/.test(C.$('#toast').textContent) && C.E('DB.classes.length') === 0, '401 nicht gemeldet');
    C.E('closeModal()');
    // fremde Datei wird nicht überschrieben
    S.files.set(S.dir + 'FairSeat-Abgleich.json', { data: '{"hallo":1}', etag: '"x"' });
    const rf = await davLauf(app);
    erwarte(rf.err === 'davEForeign' && S.datei().data === '{"hallo":1}' && /keine verschlüsselte FairSeat-Datei/.test(app.E('davStatusText()')), 'Fremde Datei überschrieben oder nicht gemeldet');
    S.files.set(S.dir + 'FairSeat-Abgleich.json', { data: vorher, etag: '"zurück"' });
    // kein Netz
    S.aus = true; const rn = await davLauf(app); S.aus = false;
    erwarte(rn.err === -1 && /nicht erreichbar/.test(app.E('davStatusText()')), 'Ohne Netz nicht gemeldet');
    app.E('openPrivacy()');
    erwarte(!!app.$('#pv-sync .pvi.warn') && !!app.$('#pv-sync .davstatus.warn'), 'Cockpit warnt nicht bei Fehler');
    app.E('closeModal()');
    await davLauf(app);
    erwarte(app.E('davCfg().err') === null, 'Fehler bleibt nach erfolgreichem Abgleich stehen');
    // offenes Fenster: Eingehendes wartet, bis es geschlossen ist
    uhr(B, 3000); B.E('DB.classes[0].assess[0].marks[DB.classes[0].students[0].id] = "1"; flushSave()'); await davLauf(B);
    uhr(app, 3100); app.E('openPrivacy()');
    const rp = await davLauf(app);
    erwarte(rp.postponed && app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[0].id]') === '2', 'Abgleich griff in ein offenes Fenster ein');
    app.E('closeModal()');
    await bis(() => app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[0].id]') === '1', 6000);
    erwarte(app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[0].id]') === '1' && !app.E('davPending'), 'Abgleich nach dem Schließen nicht nachgeholt');
    // nach einer Änderung von selbst
    app.E('DAV_CHANGE_DELAY = 40');
    const p0 = S.puts();
    uhr(app, 3200); app.E('DB.classes[0].assess[0].title = "KA 1 neu"; save()');
    await bis(() => S.puts() > p0, 6000);
    erwarte(S.puts() === p0 + 1, 'Änderung nicht von selbst abgeglichen');
    // ausschalten
    app.E('openDavSetup()'); app.klick('#dav-off'); app.sheetOk(); await pause(60);
    erwarte(app.E('davCfg()') === null && app.E('localStorage.getItem("fairseat-dav-sec")') === null && /ausgeschaltet/.test(app.$('#toast').textContent) && app.E('DB.classes.length') === 1, 'Ausschalten unvollständig');
    const rz = await davLauf(app);
    erwarte(rz.skip === true, 'Nach dem Ausschalten noch abgeglichen');
  } finally { B.ende(); C.ende(); }
});

test('WebDAV: Prüfbericht – Eingaben während des Abgleichs, Einrichten während eines Laufs, Sperren', async app => {
  const S = davServer(), B = neueApp();
  try{
    S.installiere(app); S.installiere(B);
    erwarte(app.E('JSON.stringify(davNormUrl("https://kgs-test.de/webdav/Files/Meine Dateien"))') === '{"url":"https://kgs-test.de/webdav/Files/Meine%20Dateien/"}' && app.E('davNormUrl("kgs test.de")') === null, 'Leerzeichen im Pfad falsch behandelt');
    uhr(app, 1000); grundstand(app);
    await davEinrichten(app, S, 'abgleich-123');
    erwarte(S.optionen.every(o => o.connectTimeout === 15 && o.readTimeout === 60 && /^(get|put)$/.test(o.method)), 'Zeitlimits oder Methode falsch übergeben');
    uhr(B, 1100); await davEinrichten(B, S, 'abgleich-123');
    // Eingabe, während B entschlüsselt: muss trotzdem hochgehen
    uhr(app, 2000); app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[1].id] = "3"; flushSave()'); await davLauf(app);
    uhr(B, 2100);
    B.E(`window.__dec = decryptBackup; decryptBackup = async (e, k) => { const r = await window.__dec(e, k); DB.classes[0].assess[0].marks[DB.classes[0].students[2].id] = "6"; save(); return r; }`);
    const p0 = S.puts();
    await davLauf(B);
    B.E('decryptBackup = window.__dec');
    erwarte(S.puts() === p0 + 1 && B.E('DB.classes[0].assess[0].marks[DB.classes[0].students[1].id]') === '3', 'Eingabe während des Entschlüsselns nicht hochgeladen: ' + (S.puts() - p0));
    uhr(app, 2200); await davLauf(app);
    erwarte(app.E('DB.classes[0].assess[0].marks[DB.classes[0].students[2].id]') === '6', 'Eingabe während des Entschlüsselns kommt nicht an');
    // Design wechseln ist keine Änderung für den Abgleich
    const p1 = S.puts(); uhr(app, 2300); app.E('DB.theme = DB.theme === "dark" ? "light" : "dark"; DB.lastBackup = new Date().toISOString(); flushSave()'); await davLauf(app);
    erwarte(S.puts() === p1, 'Design oder Sicherungsdatum lösen einen Upload aus');
    // Einrichten, während ein Abgleich läuft: neue (falsche) Angaben werden wirklich geprüft
    S.verz = 300; const lauf = app.E('davSync("resume")');
    app.E('openDavSetup()'); app.$('#dav-pw').value = 'falsch-falsch';
    const knopf = app.$('#dav-connect'); knopf.click();
    await bis(() => !knopf.disabled, 15000); await lauf; S.verz = 5;
    erwarte(/Anmeldung abgelehnt/.test(app.$('#toast').textContent), 'Einrichten während eines Laufs meldet Erfolg: ' + app.$('#toast').textContent);
    erwarte(app.E('davCfg().on') === true && app.E('davCfg().err') === null, 'Gescheitertes Einrichten zerstört die bisherige Einrichtung');
    const r0 = await davLauf(app); erwarte(r0.ok, 'Alte Zugangsdaten nach gescheitertem Einrichten verloren');
    app.E('closeModal()');
    // Nach 401 nicht automatisch weiterprobieren
    S.pw = 'neu-am-server'; await davLauf(app);
    const n401 = S.log.length;
    await app.E('davAuto("resume")'); await app.E('davAuto("change")');
    erwarte(S.log.length === n401 && /Anmeldung abgelehnt/.test(app.E('davStatusText()')), 'Nach abgelehnter Anmeldung automatisch weiterprobiert');
    S.pw = 'iserv-geheim';
    await davLauf(app);
    erwarte(app.E('davCfg().err') === null, '„Jetzt abgleichen“ hebt die Pause nicht auf');
    // Weiterleitung auf eine Anmeldeseite
    S.umleiten = true; const ru = await davLauf(app); S.umleiten = false;
    erwarte(ru.err === 'davERedirect' && /leitet/.test(app.E('davStatusText()')), 'Weiterleitung nicht als Fehler erkannt');
    await davLauf(app);
    // schwache ETags: ohne If-Match schreiben statt dauerhaft 412
    S.schwach = true; uhr(app, 2400); app.E('DB.classes[0].assess[0].title = "KA 1b"; flushSave()'); await davLauf(app);
    uhr(app, 2500); app.E('DB.classes[0].assess[0].title = "KA 1c"; flushSave()'); const rw = await davLauf(app); S.schwach = false;
    erwarte(rw.ok && rw.sent && !/PUT.*if-match W\//.test(S.log.join('|')), 'Schwaches ETag als If-Match benutzt');
    // Alles gelöscht: kein „leeres Gerät“ – die Löschung geht an die anderen
    uhr(B, 2600); await davLauf(B);
    uhr(app, 2650); app.E('DB.classes[0].assess[0].title = "KA 1d"; flushSave()'); await davLauf(app);   // Server hat Neues, B weiß es noch nicht
    uhr(B, 2700); B.E('DB.classes = []; DB.subjects = []; DB.rooms = []; DB.lessons = []; flushSave()'); await davLauf(B);
    uhr(app, 2800); await davLauf(app);
    erwarte(app.E('DB.classes.length') === 0 && B.E('DB.classes.length') === 0 && app.E('DB.subjects.length') === 0, 'Gelöschte Klassen kehren zurück');
    // Neues Abgleich-Passwort: Datei ersetzen
    const C = neueApp();
    try{
      S.installiere(C); uhr(C, 2900); grundstand(C);
      await davEinrichten(C, S, 'ganz-neues-pw');
      erwarte(!!C.$('#dav-replace') && C.E('davCfg()') === null, 'Ersetzen nicht angeboten oder halbe Einrichtung bleibt');
      C.klick('#dav-replace'); C.sheetOk();
      await bis(() => /ersetzt/.test(C.$('#toast').textContent), 15000);
      const neu = await C.E(`(async () => JSON.parse(await decryptBackup(${S.datei().data}.enc, "ganz-neues-pw")).data.classes.length)()`);
      erwarte(neu === 1 && C.E('davCfg().on') === true, 'Datei nicht mit neuem Passwort ersetzt');
    } finally { C.ende(); }
  } finally { B.ende(); }
});

/* ---- Vollversion (In-App-Kauf): kostenlos eine Klasse ---- */
/* Nachgebautes Kauf-Plugin (window.FairSeatStore). Antworten kommen sofort. */
function kaufPlugin(app, o){
  const S = Object.assign({ owned: false, next: 'purchased', restoreOwned: false, restoreErr: '', fail: false, kaeufe: 0, cb: null }, o || {});
  Object.assign(S, {
    status(id, ok, fail){ if(S.statusFail) return fail({ error: 'offline' }); ok({ owned: S.owned }); },
    product(id, ok, fail){ S.produkt = id; if(S.ohnePreis) return fail({ error: 'not found' }); ok({ id, price: '3,99 €' }); },
    buy(id, ok, fail){ S.kaeufe++; S.produkt = id; if(S.fail) return fail({ error: 'x' }); if(S.next === 'purchased') S.owned = true; ok({ result: S.next }); },
    restore(id, ok){ if(S.restoreOwned) S.owned = true; ok({ owned: S.owned, error: S.restoreErr, cancelled: !!S.restoreAbbruch }); },
    watch(cb){ S.cb = cb; }
  });
  app.w.FairSeatStore = S;
  return S;
}
const proBlatt = app => !!app.$('#pro-buy') && app.$('#modal').classList.contains('on');

test('Vollversion: ohne Kauf-Plugin keine Grenze', app => {
  klasseMitNamen(app, '7a'); klasseMitNamen(app, '7b'); klasseMitNamen(app, '7c');
  erwarte(app.E('DB.classes.length') === 3, 'Ohne Plugin begrenzt');
  erwarte(app.E('isPro()') === true, 'Ohne Plugin nicht frei');
  app.E('renderSettings(); show("settings")');
  erwarte(!app.$('#set-pro-status'), 'Vollversion-Abschnitt ohne Plugin sichtbar');
});

test('Vollversion: zweite Klasse öffnet das Kaufblatt, Kauf schaltet frei', app => {
  const S = kaufPlugin(app);
  klasseMitNamen(app, '7a');
  erwarte(app.E('DB.classes.length') === 1, 'Erste Klasse nicht angelegt');
  app.klick('#btn-add-class');
  erwarte(proBlatt(app), 'Kaufblatt fehlt bei der zweiten Klasse');
  erwarte(app.E('DB.classes.length') === 1, 'Zweite Klasse trotz Grenze angelegt');
  erwarte(/3,99 €/.test(app.$('#pro-buy').textContent), 'Preis fehlt auf dem Knopf: ' + app.$('#pro-buy').textContent);
  erwarte(!!app.$('#pro-restore'), 'Wiederherstellen fehlt im Kaufblatt');
  erwarte(/Daten bleiben/.test(app.$('#sheet').textContent), 'Hinweis zu den Daten fehlt');
  app.klick('#pro-buy');
  erwarte(S.kaeufe === 1 && S.produkt === 'de.fairseat.app.vollversion', 'Falsches Produkt oder kein Kauf');
  erwarte(app.E('Pro.owned') === true && app.w.localStorage.getItem('fairseat.pro') === '1', 'Kauf nicht gemerkt');
  erwarte(/Danke/.test(app.$('#toast').textContent), 'Dank fehlt');
  return bis(() => !!app.$('#sheet input')).then(ok => {
    erwarte(ok, 'Nach dem Kauf geht es nicht mit „Klasse anlegen“ weiter');
    app.askText('7b');
    erwarte(app.E('DB.classes.length') === 2, 'Zweite Klasse nach dem Kauf nicht angelegt');
    app.klick('#btn-add-class'); app.askText('7c');
    erwarte(app.E('DB.classes.length') === 3, 'Dritte Klasse nach dem Kauf nicht angelegt');
    app.E('renderSettings(); show("settings")');
    erwarte(/Vollversion aktiv/.test(app.$('#set-pro-status').textContent) && !app.$('#set-pro'), 'Einstellungen zeigen den Kauf nicht');
    // Kaufstatus wandert nicht mit der Sicherung (fremde Apple-ID)
    erwarte(!/fairseat\.pro|"pro"/.test(app.E('JSON.stringify(backupData())')), 'Kaufstatus steckt in der Sicherung');
  });
});

test('Vollversion: abbrechen, warten, Fehler, wiederherstellen', app => {
  const S = kaufPlugin(app, { next: 'cancelled' });
  app.w.document.dispatchEvent(new app.w.Event('deviceready'));     // meldet watch an und holt Stand und Preis
  erwarte(typeof S.cb === 'function' && app.E('Pro.price') === '3,99 €', 'Beim Start nicht angemeldet oder kein Preis');
  klasseMitNamen(app, '7a');
  app.klick('#btn-add-class');
  app.klick('#pro-buy');
  erwarte(proBlatt(app) && !app.$('#pro-buy').disabled && app.E('Pro.owned') === false, 'Abbruch: Blatt zu, Knopf gesperrt oder freigeschaltet');
  S.next = 'pending'; app.klick('#pro-buy');
  erwarte(!app.$('#modal').classList.contains('on') && /Zustimmung/.test(app.$('#toast').textContent) && app.E('Pro.owned') === false, 'Wartender Kauf falsch behandelt');
  // „Kaufen anfragen“ wird später genehmigt: Meldung über watch
  S.owned = true; S.cb({ productId: 'de.fairseat.app.vollversion' });
  erwarte(app.E('Pro.owned') === true && /Danke/.test(app.$('#toast').textContent), 'Genehmigter Kauf kommt nicht an');
  // Erstattung: Status sagt nein → Grenze gilt wieder
  S.owned = false; app.E('proRefresh()');
  erwarte(app.E('Pro.owned') === false && app.w.localStorage.getItem('fairseat.pro') === '0', 'Erstattung nicht übernommen');
  // Status nicht erreichbar: letzter Stand bleibt
  app.E('Pro.owned = true'); S.statusFail = true; app.E('proRefresh()');
  erwarte(app.E('Pro.owned') === true, 'Offline wurde die Vollversion entzogen');
  app.E('Pro.owned = false'); S.statusFail = false;
  // Fehler beim Kauf
  S.fail = true; app.klick('#btn-add-class'); app.klick('#pro-buy');
  erwarte(proBlatt(app) && !app.$('#pro-buy').disabled && /nicht erreichbar/.test(app.$('#toast').textContent), 'Kauffehler falsch behandelt');
  // Wiederherstellen ohne Kauf
  S.fail = false; app.klick('#pro-restore');
  erwarte(/kein Kauf gefunden/.test(app.$('#toast').textContent) && app.E('Pro.owned') === false, 'Wiederherstellen ohne Kauf falsch');
  S.restoreErr = 'abgebrochen'; app.klick('#pro-restore');
  erwarte(/nicht erreichbar/.test(app.$('#toast').textContent), 'Abgebrochene Anmeldung als „kein Kauf“ gemeldet');
  S.restoreErr = ''; S.restoreOwned = true; app.klick('#pro-restore');
  erwarte(app.E('Pro.owned') === true && /wiederhergestellt/.test(app.$('#toast').textContent), 'Wiederherstellen schaltet nicht frei');
  return bis(() => !!app.$('#sheet input')).then(ok => {
    erwarte(ok, 'Nach dem Wiederherstellen geht es nicht weiter');
    app.askText('7b');
    erwarte(app.E('DB.classes.length') === 2, 'Klasse nach Wiederherstellen nicht angelegt');
  });
});

test('Vollversion: Archiv, Papierkorb, vorhandene Klassen', app => {
  kaufPlugin(app);
  klasseMitNamen(app, '7a');
  app.E('DB.classes[0].archived = true; save()');
  app.klick('#btn-add-class');
  erwarte(proBlatt(app) && app.E('DB.classes.length') === 1, 'Archivieren umgeht die Grenze');
  app.E('closeModal(); DB.classes[0].archived = false; trashPush("class", DB.classes[0].name, DB.classes[0]); DB.classes = []; save()');
  app.klick('#btn-add-class'); app.askText('8b');
  erwarte(app.E('DB.classes.length') === 1, 'Nach dem Löschen keine neue Klasse möglich');
  app.E('trashRestore(DB.trash[0].id)');
  erwarte(proBlatt(app) && app.E('DB.classes.length') === 1 && app.E('DB.trash.length') === 1, 'Papierkorb umgeht die Grenze');
  app.E('closeModal()');
  // Klassen aus Sicherung oder Abgleich bleiben vollständig nutzbar
  app.E('DB.classes.push(newClassObj("9a"), newClassObj("9b")); save()');
  erwarte(app.E('DB.classes.length') === 3, 'Vorhandene Klassen verschwunden');
  app.E(`setCurClass(DB.classes[2].id); goNames()`);
  app.$('#student-input').value = 'Zoe\nYusuf'; app.klick('#btn-add-students');
  erwarte(app.E('DB.classes[2].students.length') === 2, 'Vorhandene Klasse lässt sich nicht bearbeiten');
  app.klick('#btn-add-class');
  erwarte(proBlatt(app) && app.E('DB.classes.length') === 3, 'Weitere Klasse über der Grenze angelegt');
});

test('Vollversion: Beispielklasse belegt den freien Platz', app => {
  kaufPlugin(app);
  app.klick('#tile-names'); app.klick('#btn-demo');
  erwarte(app.E('DB.classes.length') === 1, 'Beispielklasse fehlt');
  app.E('goNames()');
  app.klick('#btn-add-class');
  erwarte(proBlatt(app) && !!app.$('#pro-demo-del'), 'Löschen der Beispielklasse nicht angeboten');
  app.klick('#pro-demo-del');
  erwarte(app.E('DB.classes.length') === 0 && app.E('DB.trash.some(e => e.kind === "class")'), 'Beispielklasse nicht im Papierkorb');
  return bis(() => !!app.$('#sheet input')).then(ok => {
    erwarte(ok, 'Nach dem Löschen geht es nicht mit „Klasse anlegen“ weiter');
    app.askText('5c');
    erwarte(app.E('DB.classes.length') === 1 && app.E('DB.classes[0].name') === '5c', 'Eigene Klasse nicht angelegt');
    // eigene Klasse ist keine Beispielklasse: kein Löschangebot
    app.klick('#btn-add-class');
    erwarte(proBlatt(app) && !app.$('#pro-demo-del'), 'Eigene Klasse als Beispielklasse behandelt');
  });
});

test('Vollversion: FairMix-Import zählt nur neue Klassen', app => {
  kaufPlugin(app);
  klasseMitNamen(app, '7b');                   // heißt wie die aktive FairMix-Klasse → wird zusammengeführt
  app.w.__FM = FAIRMIX;
  app.E('openFairMixImport(parseFairMix(window.__FM))');
  app.sheetOk();
  erwarte(app.E('DB.classes.length') === 1 && !proBlatt(app), 'Zusammenführen fälschlich gesperrt');
  app.E('openFairMixImport(parseFairMix(window.__FM))');
  const zweite = app.$$('#sheet button.choice').find(b => /8a/.test(b.textContent));
  zweite.click();                              // 8a dazu → wäre neu
  app.sheetOk();
  erwarte(proBlatt(app) && app.E('DB.classes.length') === 1, 'Neue Klasse aus FairMix trotz Grenze angelegt');
  app.klick('#pro-buy');
  return bis(() => app.E('DB.classes.length') === 2).then(ok => erwarte(ok, 'Import läuft nach dem Kauf nicht weiter'));
});

test('Vollversion: Grenzfälle aus dem Audit', app => {
  const S = kaufPlugin(app, { ohnePreis: true });
  // Beispielklasse löschen hebelt den FairMix-Import mit zwei neuen Klassen nicht aus
  app.klick('#tile-names'); app.klick('#btn-demo'); app.E('goNames()');
  app.w.__FM = FAIRMIX;
  app.E('openFairMixImport(parseFairMix(window.__FM))');
  app.$$('#sheet button.choice').filter(b => !b.classList.contains('on')).forEach(b => b.click());   // 7b und 8a
  app.sheetOk();
  erwarte(proBlatt(app) && !app.$('#pro-demo-del'), 'Bei zwei neuen Klassen Löschen der Beispielklasse angeboten');
  erwarte(app.E('DB.classes.length') === 1, 'Import trotz Grenze');
  // ohne Produkt (Preis nicht ladbar): Kauf nicht auslösbar, aber neuer Versuch
  erwarte(/erneut versuchen/.test(app.$('#pro-buy').textContent) && !app.$('#pro-buy').disabled, 'Kein neuer Versuch ohne Preis: ' + app.$('#pro-buy').textContent);
  app.klick('#pro-buy');
  erwarte(S.kaeufe === 0, 'Kauf ohne geladenes Produkt ausgelöst');
  S.ohnePreis = false; app.klick('#pro-buy');
  erwarte(/3,99 €/.test(app.$('#pro-buy').textContent) && S.kaeufe === 0, 'Preis nach neuem Versuch nicht da');
  // Blatt während des Kaufs geschlossen: späte Antwort schließt kein anderes Blatt
  let spaet = null;
  S.buy = (id, ok) => { S.kaeufe++; spaet = () => { S.owned = true; ok({ result: 'purchased' }); }; };
  app.klick('#pro-buy');
  app.E('closeModal()');
  app.E('askConfirm("Andere Frage", "x", "OK", () => {})');
  spaet();
  erwarte(app.$('#modal').classList.contains('on') && /Andere Frage/.test(app.$('#sheet').textContent), 'Späte Kaufantwort hat ein anderes Blatt geschlossen');
  erwarte(app.E('Pro.owned') === true && app.E('Pro.busy') === false, 'Späte Kaufantwort nicht übernommen');
  // abgebrochene Anmeldung beim Wiederherstellen: keine Fehlermeldung
  app.E('closeModal(); Pro.owned = false'); S.owned = false; S.restoreAbbruch = true;
  app.E('openPro(null)'); app.$('#toast').textContent = '';
  app.klick('#pro-restore');
  erwarte(!/nicht erreichbar|kein Kauf/.test(app.$('#toast').textContent), 'Abgebrochene Anmeldung als Fehler gemeldet');
  // umbenannte Beispielklasse gilt als eigene
  app.E('closeModal(); DB.classes[0].name = "6d"');
  app.klick('#btn-add-class');
  erwarte(proBlatt(app) && !app.$('#pro-demo-del'), 'Umbenannte Beispielklasse zum Löschen angeboten');
});

test('Vollversion: englische Texte', app => {
  kaufPlugin(app);
  app.E('LANG = "en"; DB.lang = "en"');
  klasseMitNamen(app, '7a');
  app.klick('#btn-add-class');
  erwarte(/Unlock for 3,99 €/.test(app.$('#pro-buy').textContent) && /Restore purchase/.test(app.$('#pro-restore').textContent), 'Englische Texte fehlen');
});

/* ------------------------------------------------------------------ */
alleTests().then(() => {
  console.log(bestanden + ' Prüfungen bestanden, ' + fehler + ' Fehler.');
  if(fehler){ fehlerliste.forEach(f => console.error('  ✗ ' + f)); process.exit(1); }
});

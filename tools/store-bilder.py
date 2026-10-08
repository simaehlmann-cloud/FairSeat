# Store-Screenshots fuer FairSeat.
#   python3 tools/store-bilder.py
# Braucht: pip install playwright && playwright install chromium
#
# Erzeugt je Geraet eine Reihe Bilder in store-bilder/<geraet>/:
#   ipad-13   2048 x 2732  (App Store, 13-Zoll-iPad – Pflicht fuer universelle Apps)
#   iphone-69 1290 x 2796  (App Store, 6,9-Zoll-iPhone)
# Fuer Google Play passen die iPhone-Bilder (Seitenverhaeltnis 9:19,5 ist erlaubt).
import asyncio, os
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = "file://" + os.path.join(ROOT, "index.html")
FM = os.path.join(ROOT, "test", "fairmix-backup.json")
HIDE = "#toast,.stagehint{display:none!important}"
GERAETE = {"ipad-13": (1024, 1366, 2), "iphone-69": (430, 932, 3)}

async def oeffnen(b, w, h, sc):
    pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=sc, has_touch=True)
    fehler = []; pg.on("pageerror", lambda e: fehler.append(str(e)))
    pg.fehler = fehler
    await pg.goto(APP); await pg.wait_for_timeout(450)
    await pg.add_style_tag(content=HIDE)
    if await pg.query_selector("#welcome-ok"): await pg.click("#welcome-ok"); await pg.wait_for_timeout(300)
    if await pg.query_selector("#priv-ok"): await pg.click("#priv-ok"); await pg.wait_for_timeout(150)
    return pg

# Beispieldaten fuer Bewertungen, Unterricht, Abhaken und Stundenplan (nur erfundene Namen aus der FairMix-Testdatei)
DATEN = r"""(() => {
  DB.gradesAck = true; DB.tipsDone = true;
  DB.subjects = [{ id: "ma", name: "Mathe", short: "Ma", color: "#2E86DE" }, { id: "de", name: "Deutsch", short: "De", color: "#C0392B" },
                 { id: "bi", name: "Biologie", short: "Bi", color: "#27AE60" }];
  const c = curClass(), ids = c.students.map(s => s.id);
  c.gradeSubjects = ["ma"];
  const reihen = [["2", "3+", "1-", "4", "2-", "3", "2+", "3-", "1", "3", "4+", "3"],     // je Bewertung eigene Reihe,
                  ["3", "3-", "2", "4-", "3+", "4", "2-", "3", "2", "3-", "5", "3"],     // damit der Verlauf nicht flach ist
                  ["2+", "2", "1-", "3", "2", "2-", "1", "2", "1-", "2+", "3", "2-"],
                  ["2", "2-", "1", "3+", "2+", "2", "1-", "2-", "1", "2", "3-", "2"]];
  const marks = r => Object.fromEntries(ids.map((id, i) => [id, reihen[r][i % 12]]));
  c.assess = [
    { id: "w1", subjectId: "ma", title: "KA 1 Bruchrechnung", date: "2026-09-10", kind: "written", scale: "grade", weight: 1, marks: marks(0) },
    { id: "w2", subjectId: "ma", title: "KA 2 Prozente", date: "2026-09-29", kind: "written", scale: "grade", weight: 1, marks: marks(1) },
    { id: "o1", subjectId: "ma", title: "Mitarbeit", date: "2026-09-18", kind: "other", scale: "grade", weight: 1, marks: marks(2) },
    { id: "o2", subjectId: "ma", title: "Hausaufgaben", date: "2026-09-25", kind: "other", scale: "grade", weight: 1, marks: marks(3) } ];
  c.absLog = [{ d: "2026-09-14", p: 0, n: 2, s: "ma", ids: [ids[1], ids[4]] }, { d: "2026-09-21", p: 2, n: 1, s: "ma", ids: [ids[4]] }];
  c.attendance = [{ date: "2026-09-14", absent: [ids[1], ids[4]] }, { date: "2026-09-21", absent: [ids[4]] }];
  DB.lessons = [
    { id: "L1", day: 0, period: 0, span: 2, week: "", subjectId: "ma", classId: c.id, roomId: "", planId: "" },
    { id: "L2", day: 1, period: 2, span: 1, week: "", subjectId: "de", classId: c.id, roomId: "", planId: "" },
    { id: "L3", day: 2, period: 3, span: 1, week: "", subjectId: "ma", classId: c.id, roomId: "", planId: "" },
    { id: "L4", day: 3, period: 1, span: 2, week: "", subjectId: "bi", classId: c.id, roomId: "", planId: "" },
    { id: "L5", day: 4, period: 4, span: 1, week: "", subjectId: "ma", classId: c.id, roomId: "", planId: "" } ];
  setCancelled(DB.lessons[1], ttDateFor(DB.lessons[1]), true);
  flushSave();
})()"""

# Zoomt auf die Tische, damit die Namen auch auf dem Telefon lesbar sind
NAH = """(() => { const wrap = document.querySelector('#stage-wrap'), w = wrap.clientWidth, h = wrap.clientHeight;
  const bs = planDesks().map(itemBox), pad = 50;
  const x0 = Math.min(...bs.map(b => b.x)) - pad, y0 = Math.min(...bs.map(b => b.y)) - pad;
  const x1 = Math.max(...bs.map(b => b.x + b.w)) + pad, y1 = Math.max(...bs.map(b => b.y + b.h)) + pad;
  zoom = Math.min(w / (x1 - x0), h / (y1 - y0), 2.2);
  panX = (w - (x1 - x0) * zoom) / 2 - x0 * zoom; panY = (h - (y1 - y0) * zoom) / 2 - y0 * zoom; applyTransform(); })()"""

async def tippen(pg, sid):
    box = await pg.locator('#stage .item[data-id="%s"]' % sid).bounding_box()
    await pg.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2); await pg.wait_for_timeout(300)

async def schule(b, out, w, h, sc):
    pg = await oeffnen(b, w, h, sc)
    await pg.click("#tile-names")
    await pg.set_input_files("#fmpick", FM); await pg.wait_for_timeout(300)
    await pg.click("#sheet .row button.primary"); await pg.wait_for_timeout(300)
    await pg.evaluate("DB.lastBackup = new Date().toISOString(); DB.tipsDone = true; goHome()"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "1-start.png")
    await pg.evaluate("goNames()"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "2-namen.png")
    await pg.evaluate("goPlans()"); await pg.click("#btn-add-plan"); await pg.wait_for_timeout(300)
    await pg.evaluate("document.activeElement.blur(); getSelection().removeAllRanges()")
    await pg.screenshot(path=out + "3-neuer-sitzplan.png")
    await pg.click("#sheet .row button.primary"); await pg.wait_for_timeout(600)
    await pg.evaluate(NAH); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "4-sitzplan-gruppen.png")
    # 5: Notenuebersicht mit Zeugnisvorschlag
    await pg.evaluate(DATEN)
    await pg.evaluate('goGrades("ma")'); await pg.wait_for_timeout(300)
    await pg.click("#g-tab-overview"); await pg.wait_for_timeout(300)
    await pg.screenshot(path=out + "5-bewertungen.png")
    # 6: Unterricht – Anwesenheit und Schnellbewertung direkt am Platz
    await pg.evaluate('goPlans(); openPlan(curClass().plans[0].id)'); await pg.wait_for_timeout(500)
    await pg.evaluate("setLesson(true)"); await pg.wait_for_timeout(200); await pg.evaluate(NAH); await pg.wait_for_timeout(300)
    sitze = await pg.evaluate("curPlan().desks.filter(d => d.studentId).map(d => d.id)")
    await tippen(pg, sitze[2])
    await pg.screenshot(path=out + "6-unterricht.png")
    await pg.evaluate("closeModal()"); await pg.wait_for_timeout(200)
    # 7: Abhaken im Sitzplan
    await pg.click("#lb-check"); await pg.wait_for_timeout(300)
    await pg.fill("#ck-new-title", "Einverständnis Ausflug"); await pg.click("#ck-new"); await pg.wait_for_timeout(500)
    await pg.evaluate(NAH); await pg.wait_for_timeout(200)
    for i in (0, 1, 3, 4, 6, 7, 9):
        if i < len(sitze): await tippen(pg, sitze[i])
    await pg.screenshot(path=out + "7-abhaken.png")
    await pg.evaluate("endCheckMode(); setLesson(false)"); await pg.wait_for_timeout(200)
    # 8: Stundenplan mit Ausfall
    await pg.evaluate("goTimetable()"); await pg.wait_for_timeout(300)
    await pg.screenshot(path=out + "8-stundenplan.png")
    if pg.fehler: raise SystemExit("Fehler in der App: " + "; ".join(pg.fehler))
    await pg.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, (w, h, sc) in GERAETE.items():
            out = os.path.join(ROOT, "store-bilder", name) + "/"
            os.makedirs(out, exist_ok=True)
            for alt in ("5-hochzeit.png", "6-tisch.png", "7-raum-palette.png", "8-raumvorlagen.png"):
                if os.path.exists(out + alt): os.remove(out + alt)   # Bilder des frueheren Veranstaltungsmodus
            await schule(b, out, w, h, sc)
            print(name, sorted(os.listdir(out)))
        await b.close()

asyncio.run(main())

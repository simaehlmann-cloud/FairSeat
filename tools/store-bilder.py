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

async def oeffnen(b, w, h, sc, modus):
    pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=sc, has_touch=True)
    await pg.goto(APP); await pg.wait_for_timeout(450)
    await pg.add_style_tag(content=HIDE)
    await pg.click('#sheet .choice[data-mode="%s"]' % modus); await pg.wait_for_timeout(300)
    if await pg.query_selector("#priv-ok"): await pg.click("#priv-ok"); await pg.wait_for_timeout(150)
    return pg

async def schule(b, out, w, h, sc):
    pg = await oeffnen(b, w, h, sc, "school")
    await pg.click("#tile-names")
    await pg.set_input_files("#fmpick", FM); await pg.wait_for_timeout(300)
    await pg.click("#sheet .row button.primary"); await pg.wait_for_timeout(300)
    await pg.evaluate("DB.lastBackup = new Date().toISOString(); goHome()"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "1-start.png")
    await pg.evaluate("goNames()"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "2-namen.png")
    await pg.evaluate("goPlans()"); await pg.click("#btn-add-plan"); await pg.wait_for_timeout(300)
    await pg.evaluate("document.activeElement.blur(); getSelection().removeAllRanges()")
    await pg.screenshot(path=out + "3-neuer-sitzplan.png")
    await pg.click("#sheet .row button.primary"); await pg.wait_for_timeout(600)
    await pg.evaluate("fitToScreen()"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "4-sitzplan-gruppen.png")
    await pg.close()

async def feier(b, out, w, h, sc):
    pg = await oeffnen(b, w, h, sc, "event")
    await pg.click("#tile-names"); await pg.click("#btn-demo"); await pg.wait_for_timeout(900)
    await pg.evaluate("fitToScreen()"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "5-hochzeit.png")
    await pg.evaluate("""(() => { zoom = Math.min(1.1, zoom * 3.2); const all = tableShapes(planDesks()); const sh = all[Math.floor(all.length / 2)];
        const w = document.querySelector('#stage-wrap'); panX = w.clientWidth / 2 - sh.cx * zoom;
        panY = w.clientHeight / 2 - sh.cy * zoom; applyTransform(); })()""")
    await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "6-tisch.png")
    await pg.evaluate("fitToScreen(); switchPanel('panel-room')"); await pg.wait_for_timeout(200)
    await pg.screenshot(path=out + "7-raum-palette.png")
    await pg.click("#btn-room-tpl"); await pg.wait_for_timeout(300)
    await pg.screenshot(path=out + "8-raumvorlagen.png")
    await pg.close()

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, (w, h, sc) in GERAETE.items():
            out = os.path.join(ROOT, "store-bilder", name) + "/"
            os.makedirs(out, exist_ok=True)
            await schule(b, out, w, h, sc)
            await feier(b, out, w, h, sc)
            print(name, sorted(os.listdir(out)))
        await b.close()

asyncio.run(main())

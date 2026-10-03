import asyncio, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from art import svg
from playwright.async_api import async_playwright
from PIL import Image
OUTDIR = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUTDIR+"/res/android", exist_ok=True)
async def shot(pg, markup, path, size, transparent):
    await pg.set_viewport_size({"width":size,"height":size})
    await pg.set_content(f'<html><body style="margin:0;background:transparent">{markup}</body></html>')
    await pg.screenshot(path=path, omit_background=transparent, clip={"x":0,"y":0,"width":size,"height":size})
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        tmp = OUTDIR+"/_full.png"
        await shot(pg, svg(1.0, True, 1024), tmp, 1024, False)
        full = Image.open(tmp).convert("RGB")
        full.save(OUTDIR+"/icon-1024.png")
        full.resize((512,512), Image.LANCZOS).save(OUTDIR+"/icon.png")
        full.resize((192,192), Image.LANCZOS).save(OUTDIR+"/icon-192.png")
        for d, n in [("ldpi",36),("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)]:
            full.resize((n,n), Image.LANCZOS).save(f"{OUTDIR}/res/android/icon_{d}.png")
        # maskable: Inhalt in der sicheren Zone (80 %)
        await shot(pg, svg(0.78, True, 1024), tmp, 1024, False)
        Image.open(tmp).convert("RGB").resize((512,512), Image.LANCZOS).save(OUTDIR+"/icon-maskable-512.png")
        # adaptiver Vordergrund: transparent, Inhalt in 72/108 der Fläche
        await shot(pg, svg(0.64, False, 1024), tmp, 1024, True)
        fg = Image.open(tmp).convert("RGBA")
        for d, n in [("ldpi",81),("mdpi",108),("hdpi",162),("xhdpi",216),("xxhdpi",324),("xxxhdpi",432)]:
            fg.resize((n,n), Image.LANCZOS).save(f"{OUTDIR}/res/android/icon_fg_{d}.png")
        os.remove(tmp)
        open(OUTDIR+"/icon.svg","w").write(svg(1.0, True, 1024))
        await b.close()
asyncio.run(main())

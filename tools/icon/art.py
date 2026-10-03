# FairSeat-Icon: vorne die Tafel, davor vier Plätze mit Personen in den
# FairMix-Farben. Gleiche Kontur, gleicher heller Grund wie das FairMix-Icon.
OUT = "#1f2d3d"
def person(cx, by, main, light):
    # Schultern als Kuppel, Kopf darüber – wie die Figuren in FairMix
    dome = f'M{cx-105} {by} v-22 a105 74 0 0 1 210 0 v22 z'
    return f'''
  <defs><linearGradient id="g{cx}{by}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="{light}"/><stop offset="1" stop-color="{main}"/></linearGradient></defs>
  <path d="{dome}" fill="url(#g{cx}{by})" stroke="{OUT}" stroke-width="14" stroke-linejoin="round"/>
  <circle cx="{cx}" cy="{by-148}" r="50" fill="url(#g{cx}{by})" stroke="{OUT}" stroke-width="14"/>
  <ellipse cx="{cx-16}" cy="{by-166}" rx="14" ry="10" fill="#fff" opacity=".5"/>'''
def desk(cx, y):
    return f'<rect x="{cx-125}" y="{y}" width="250" height="66" rx="16" fill="#fff3d6" stroke="{OUT}" stroke-width="14"/>'
def art():
    s = []
    # Tafel mit Ablage
    s.append(f'<rect x="202" y="168" width="620" height="100" rx="22" fill="#003366" stroke="{OUT}" stroke-width="14"/>')
    s.append('<path d="M262 206 h170 M262 236 h110" stroke="#fff" stroke-width="13" stroke-linecap="round" opacity=".9"/>')
    s.append('<path d="M640 238 l34-40 l34 40 z" fill="none" stroke="#fff" stroke-width="11" stroke-linejoin="round" opacity=".9"/>')
    s.append(f'<rect x="402" y="262" width="220" height="24" rx="12" fill="#c9a97a" stroke="{OUT}" stroke-width="12"/>')
    # zwei Reihen mit je zwei Plätzen
    L, R = 322, 702
    s.append(desk(L, 352)); s.append(desk(R, 352))
    s.append(person(L, 575, "#16a05c", "#4fd38c"))
    s.append(person(R, 575, "#7c4ddb", "#a98bff"))
    s.append(desk(L, 612)); s.append(desk(R, 612))
    s.append(person(L, 835, "#d93636", "#ff7b7b"))
    s.append(person(R, 835, "#e08b00", "#ffc24a"))
    return "\n".join(s)
def svg(scale=1.0, bg=True, size=1024):
    t = f'translate({512*(1-scale)} {512*(1-scale)}) scale({scale})'
    b = '<rect width="1024" height="1024" fill="#f4f8fc"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="{size}" height="{size}">{b}<g transform="{t}">{art()}</g></svg>'

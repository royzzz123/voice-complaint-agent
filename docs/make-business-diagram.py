"""Builds business-overview.drawio: one-page, non-technical view for business readers.
Edit the text below and re-run: python3 docs/make-business-diagram.py"""
from xml.sax.saxutils import escape
from pathlib import Path

cells = []
def _v(t): return escape(t.replace("\n", "<br>"), {'"': "&quot;"})
def box(id, x, y, w, h, label, style):
    cells.append(f'<mxCell id="{id}" value="{_v(label)}" style="{style}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
def arrow(id, s, t):
    cells.append(f'<mxCell id="{id}" style="endArrow=block;endFill=1;html=1;strokeWidth=3;strokeColor=#9AA5B1;" edge="1" parent="1" source="{s}" target="{t}"><mxGeometry relative="1" as="geometry"/></mxCell>')

FONT = "fontFamily=Helvetica;"
CARD = FONT + "rounded=1;whiteSpace=wrap;html=1;arcSize=8;strokeWidth=2;verticalAlign=top;spacingTop=14;spacingLeft=10;spacingRight=10;fontSize=13;fontColor=#33414E;"

# title
box("title", 40, 20, 1400, 50, "<b>SwarComplaint</b> — an investor files a SEBI complaint with one phone call",
    FONT + "text;html=1;fontSize=26;fontColor=#1B2A3A;align=left;verticalAlign=middle;")
box("sub", 40, 68, 1400, 30, "No app, no forms, no typing. The investor speaks; the assistant prepares a complete, SCORES-ready complaint.",
    FONT + "text;html=1;fontSize=15;fontColor=#5B6B7B;align=left;verticalAlign=middle;")

# journey
steps = [
    ("s1", "📞", "Investor calls", "Dials the helpline\n<b>080 6426 1747</b>\nfrom any phone\n\nHindi, Hinglish or English", "#E8F1FF", "#3B7BDB"),
    ("s2", "🛡️", "Caller is checked", "Blocked and repeat\ncallers are stopped\n<b>before the call\nis answered</b>", "#FFF4E5", "#E8912D"),
    ("s3", "💬", "Natural conversation", "The assistant listens\nand asks <b>only for the\ndetails that are missing</b>", "#EAF7EE", "#2E9E5B"),
    ("s4", "✅", "Details confirmed", "The complaint is\nread back; the investor\n<b>confirms it is correct</b>", "#F3ECFF", "#7B4FD6"),
    ("s5", "📄", "Complaint registered", "A <b>reference number</b>\nis given on the call\n\nReady to file on SCORES", "#E8F1FF", "#1F5FBF"),
]
x = 40
for i, (id, icon, head, body, fill, stroke) in enumerate(steps):
    box(id, x, 130, 250, 250, f'<font style="font-size:40px">{icon}</font><br><br><b><font style="font-size:18px" color="{stroke}">{i+1}. {head}</font></b><br><br>{body}',
        CARD + f"fillColor={fill};strokeColor={stroke};align=center;")
    x += 290
for i in range(len(steps) - 1):
    arrow(f"a{i}", steps[i][0], steps[i + 1][0])

# protection band
box("prot_head", 40, 420, 600, 34, "<b>Built-in protection on every call</b>", FONT + "text;html=1;fontSize=18;fontColor=#1B2A3A;align=left;")
prot = [
    ("🚫", "Abuse, pranks and\noff-topic calls are\nwarned, then ended"),
    ("🔒", "Spam numbers are\nblocked automatically\n(e.g. 4 calls in 1 hour)"),
    ("🙅", "No investment advice;\nnever asks for OTP,\nPIN or password"),
    ("🧾", "Every call is recorded,\nwith a transcript and\nan audit trail"),
]
x = 40
for i, (icon, text) in enumerate(prot):
    box(f"p{i}", x, 460, 335, 110, f'<font style="font-size:26px">{icon}</font><br>{text}',
        CARD + "fillColor=#FFFFFF;strokeColor=#D5DCE3;align=center;spacingTop=8;fontSize=13;")
    x += 355

# outcomes strip
box("out_head", 40, 600, 600, 34, "<b>What it delivers</b>", FONT + "text;html=1;fontSize=18;fontColor=#1B2A3A;align=left;")
kpis = [
    ("1–5 min", "to register a complaint"),
    ("≈ 2 sec", "for the assistant to reply"),
    ("≈ ₹14", "running cost of a\n3-minute complaint"),
    ("Live", "dashboard for the team:\ncalls, transcripts, complaints"),
]
x = 40
for i, (big, small) in enumerate(kpis):
    box(f"k{i}", x, 640, 335, 100, f'<b><font style="font-size:28px" color="#1F5FBF">{big}</font></b><br>{small}',
        CARD + "fillColor=#F5F8FC;strokeColor=#F5F8FC;align=center;spacingTop=12;fontSize=13;")
    x += 355

box("foot", 40, 760, 1400, 26, "SwarComplaint prepares the complaint. It does not replace the official SEBI SCORES portal.",
    FONT + "text;html=1;fontSize=12;fontColor=#8A97A5;align=left;")

xml = ('<mxfile host="app.diagrams.net"><diagram id="biz" name="SwarComplaint — business overview">'
       '<mxGraphModel dx="1500" dy="820" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" '
       'pageScale="1" pageWidth="1480" pageHeight="810" background="#FFFFFF" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
       + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>")
out = Path(__file__).with_name("business-overview.drawio")
out.write_text(xml)
print(f"wrote {out} ({len(cells)} cells)")

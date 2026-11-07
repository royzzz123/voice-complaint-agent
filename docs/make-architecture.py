"""Generates docs/architecture.drawio: product-level view of the SwarComplaint phone line
(no vendors, no hosting). Open in app.diagrams.net. Edit and re-run: python3 docs/make-architecture.py"""
from xml.sax.saxutils import escape
from pathlib import Path

cells = []

def _v(label):
    return escape(label.replace("\n", "<br>"), {'"': "&quot;"})

def box(id, x, y, w, h, label, style):
    cells.append(f'<mxCell id="{id}" value="{_v(label)}" style="{style}" vertex="1" parent="1">'
                 f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')

def edge(id, s, t, label="", style=""):
    cells.append(f'<mxCell id="{id}" value="{_v(label)}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;'
                 f'strokeWidth=2;fontSize=11;labelBackgroundColor=#FFFFFF;{style}" edge="1" parent="1" source="{s}" target="{t}">'
                 f'<mxGeometry relative="1" as="geometry"/></mxCell>')

GROUP = "rounded=1;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=12;spacingTop=8;fontStyle=1;fontSize=14;arcSize=3;"
NODE = "rounded=1;whiteSpace=wrap;html=1;fontSize=12;arcSize=8;fillColor=#FFFFFF;"
LIST = NODE + "align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;"

# ---- caller side
box("caller", 20, 250, 140, 90, "📞 Investor\nany Indian mobile,\nHindi / Hinglish / English", NODE + "strokeColor=#333333;fontStyle=1;")
box("line", 200, 250, 160, 90, "Complaint helpline\n080 6426 1747", NODE + "strokeColor=#666666;fontStyle=1;")

# ---- voice layer
box("g_voice", 400, 110, 230, 380, "Voice layer", GROUP + "fillColor=#EEF3FF;strokeColor=#5B7BD5;")
box("stt", 415, 160, 200, 70, "Speech → text\n(Hindi model, handles\nHinglish + English)", NODE + "strokeColor=#5B7BD5;")
box("tts", 415, 255, 200, 70, "Text → speech\n(female Hindi voice)", NODE + "strokeColor=#5B7BD5;")
box("ctrl", 415, 350, 200, 120, "Call control\n• welcome + recording notice\n• ends call on final line\n• 15 s silence hang-up\n• 10-minute limit", LIST + "strokeColor=#5B7BD5;")

# ---- engine
box("g_engine", 670, 40, 560, 560, "SwarComplaint engine", GROUP + "fillColor=#EAF7EE;strokeColor=#2E8B57;")
box("screen", 690, 90, 520, 105,
    "① Caller screening (before the call is answered)\n"
    "• blocked numbers rejected   • more than 3 calls in 1 hour → blocked 24 h\n"
    "• more than 6 calls in a day → blocked   • 2 misuse calls in a day → blocked 7 days\n"
    "• hidden caller ID and non-Indian numbers rejected   • repeat blocks double in length",
    LIST + "strokeColor=#2E8B57;")
box("guard", 690, 210, 250, 205,
    "② Conversation guardrails\n(every turn)\n"
    "• abuse: warning, then call ends\n"
    "• off-topic / prank: redirect,\n  warning, then call ends\n"
    "• threat: call ends + block\n"
    "• prompt injection refused\n"
    "• distress: helpline, no penalty\n"
    "• no advice, no OTP / PIN",
    LIST + "strokeColor=#2E8B57;")
box("ai", 960, 210, 250, 205,
    "③ Understanding (language model)\n"
    "• classifies each turn\n"
    "• extracts SCORES fields:\n  name, entity, issue, amount,\n  date, prior complaint, refs\n"
    "• writes the next question\n"
    "• safety check on every reply\n"
    "• backup model + keyword fallback",
    LIST + "strokeColor=#2E8B57;")
box("register", 690, 430, 520, 150,
    "④ Complaint registration\n"
    "• entity checked against SEBI-regulated list\n"
    "• caller-ID mobile confirmed, not re-typed\n"
    "• details read back, caller says yes\n"
    "• reference number SWR-xxxxxx spoken to the caller\n"
    "• same entity from the same number within 24 h → duplicate, not filed again\n"
    "• maximum 3 complaints per number per day",
    LIST + "strokeColor=#2E8B57;")

# ---- data + ops
box("db", 1280, 120, 200, 150, "Complaint store\n\ncalls + transcripts\nblocked numbers\ncomplaints\naudit log (masked)",
    "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=14;fontSize=12;fillColor=#FFF8D6;strokeColor=#B8860B;fontStyle=0;")
box("admin", 1280, 320, 200, 120, "Admin dashboard\n• live calls + transcripts\n• block / unblock numbers\n• registered complaints\n• test console", LIST + "strokeColor=#333333;")
box("officer", 1280, 490, 200, 70, "👤 Grievance officer", NODE + "strokeColor=#333333;fontStyle=1;")
box("scores", 1280, 600, 200, 70, "SCORES filing\n(complaint + reference)", NODE + "strokeColor=#999999;dashed=1;fontColor=#555555;")

# ---- legend
box("legend", 20, 630, 1210, 110,
    "HOW ONE CALL FLOWS\n"
    "1. The investor dials the helpline. Before the call is answered, the engine screens the number (①).   "
    "2. The voice layer plays the welcome message and changes each answer into text.   "
    "3. For each turn, the engine applies the guardrails (②), understands the answer and finds the missing details (③).   "
    "4. When all details are known, the engine reads them back. After the caller says yes, it registers the complaint and gives the reference number (④).   "
    "5. Everything is saved in the complaint store and shows live in the admin dashboard.",
    "rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fontSize=12;strokeColor=#CCCCCC;fillColor=#FFFFFF;")

# ---- edges
edge("e1", "caller", "line", "dial")
edge("e2", "line", "stt", "voice")
edge("e3", "stt", "guard", "caller's words")
edge("e4", "line", "screen", "caller number", "dashed=1;")
edge("e5", "guard", "ai", "")
edge("e6", "ai", "register", "")
edge("e7", "ai", "tts", "next question", "")
edge("e8", "register", "tts", "read-back + reference")
edge("e9", "tts", "caller", "agent voice", "")
edge("e10", "register", "db", "save")
edge("e11", "screen", "db", "check / block")
edge("e12", "db", "admin", "")
edge("e13", "admin", "officer", "")
edge("e14", "officer", "scores", "", "dashed=1;strokeColor=#999999;")

xml = ('<mxfile host="app.diagrams.net"><diagram id="arch" name="SwarComplaint phone line">'
       '<mxGraphModel dx="1600" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" '
       'pageScale="1" pageWidth="1520" pageHeight="770" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
       + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>")
out = Path(__file__).with_name("architecture.drawio")
out.write_text(xml)
print(f"wrote {out} ({len(cells)} cells)")

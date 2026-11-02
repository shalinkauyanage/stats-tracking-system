#!/usr/bin/env python3
"""
Reads data/original/F1.xlsx in READ-ONLY mode and writes a JSON snapshot
(server/test/fixtures/f1-workbook-snapshot.json) that the automated tests use.

* The workbook is never modified. Its SHA-256 fingerprint is checked before
  and after reading, and stored inside the snapshot.
* Values are kept exactly as they appear in the sheet ("raw"). Cleaning and
  validation happen later, in JavaScript (server/src/logic/legacyBuilder.js).
* You do NOT need Python to run the app or the tests; the snapshot is already
  included. This script is only for regenerating it.
"""
import hashlib
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "original" / "F1.xlsx"
OUT = ROOT / "server" / "test" / "fixtures" / "f1-workbook-snapshot.json"

M = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
R = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ns = {"m": M, "rd": R}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def col_letter(i):
    s = ""
    while i:
        i, rem = divmod(i - 1, 26)
        s = chr(65 + rem) + s
    return s


def sheet_xml_path(zf, sheet_name):
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid = None
    for s in wb.find(f"{{{M}}}sheets"):
        if s.get("name") == sheet_name:
            rid = s.get(f"{{{REL}}}id")
    for r in rels:
        if r.get("Id") == rid:
            return "xl/" + r.get("Target").lstrip("/").replace("xl/", "")
    raise RuntimeError(f"sheet {sheet_name} not found")


def linked_entity_cells(zf, sheet_name):
    """Excel 'linked data type' cells (e.g. Geography) look like #VALUE! to most
    readers. Their real text lives in xl/richData. Returns {cell_ref: (kind, text)}."""
    structs = []
    for s in ET.fromstring(zf.read("xl/richData/rdrichvaluestructure.xml")).findall("rd:s", ns):
        structs.append((s.get("t"), [k.get("n") for k in s.findall("rd:k", ns)]))
    rvs = []
    for r in ET.fromstring(zf.read("xl/richData/rdrichvalue.xml")).findall("rd:rv", ns):
        rvs.append((int(r.get("s")), [v.text or "" for v in r.findall("rd:v", ns)]))
    md = ET.fromstring(zf.read("xl/metadata.xml"))
    fut = md.find('m:futureMetadata[@name="XLRICHVALUE"]', ns)
    rvb = [int(b.find(".//rd:rvb", ns).get("i")) for b in fut.findall("m:bk", ns)]
    vmap = [int(bk.find("m:rc", ns).get("v")) for bk in md.find("m:valueMetadata", ns).findall("m:bk", ns)]
    out = {}
    sheet = ET.fromstring(zf.read(sheet_xml_path(zf, sheet_name)))
    for c in sheet.iter(f"{{{M}}}c"):
        vm = c.get("vm")
        if not vm:
            continue
        s_idx, vals = rvs[rvb[vmap[int(vm) - 1]]]
        kind, keys = structs[s_idx]
        d = dict(zip(keys, vals))
        out[c.get("r")] = (kind, d.get("_DisplayString") or d.get("Text"))
    return out


def main():
    before = sha256(XLSX)
    expected = (ROOT / "data" / "original" / "F1.xlsx.sha256").read_text().strip()
    assert before == expected, "Workbook does not match the stored fingerprint"

    wb = openpyxl.load_workbook(XLSX, data_only=True)
    zf = zipfile.ZipFile(XLSX, "r")

    # ---------------- Track Records ----------------
    ws = wb["Track Records"]
    entities = linked_entity_cells(zf, "Track Records")
    columns = []
    for c in range(2, ws.max_column + 1):
        L = col_letter(c)
        label_kind, label = None, None
        if f"{L}2" in entities:
            label_kind, label = "linked_entity", entities[f"{L}2"][1]
        elif isinstance(ws.cell(2, c).value, str) and not ws.cell(2, c).value.startswith("#"):
            label_kind, label = "plain_text", ws.cell(2, c).value
        flag = entities.get(f"{L}1", (None, None))[1]
        winners = []
        for r in range(3, 8):
            v = ws.cell(r, c).value
            if v is not None:
                winners.append({"row": r, "raw": v})
        columns.append({
            "column": L,
            "label": label,
            "label_kind": label_kind,
            "flag_text": flag,
            "winners": winners,
            "most_wins_raw": ws.cell(22, c).value,
            "fastest_lap_raw": ws.cell(24, c).value,
            "pole_time_raw": ws.cell(26, c).value,
        })
    error_cells = sum(
        1 for row in ws.iter_rows(min_row=1, max_row=2) for cell in row
        if isinstance(cell.value, str) and cell.value.startswith("#")
    )

    # ---------------- Driver Stats ----------------
    ws = wb["Driver Stats"]
    headers = [ws.cell(1, c).value for c in range(1, 14)]
    keys = ["wins", "second_places", "third_places", "podiums", "poles", "p1_fl_gp",
            "fastest_laps", "dnfs", "mps", "points", "drivers_titles", "constructors_titles"]
    driver_rows = []
    for r in range(3, ws.max_row + 1):
        raw = ws.cell(r, 1).value
        if raw is None:
            continue
        row = {"row": r, "name_raw": raw}
        for i, k in enumerate(keys):
            row[k] = ws.cell(r, 2 + i).value
        row["team_history_raw"] = [ws.cell(r, c).value for c in (14, 15, 16) if ws.cell(r, c).value is not None]
        driver_rows.append(row)

    # ---------------- Team Stats ----------------
    ws = wb["Team Stats"]
    team_headers = [ws.cell(1, c).value for c in range(1, 9)]
    tkeys = ["wins", "podiums", "poles", "mps", "points", "drivers_titles", "constructors_titles"]
    team_rows = []
    for r in range(3, ws.max_row + 1):
        raw = ws.cell(r, 1).value
        if raw is None:
            continue
        row = {"row": r, "team_raw": raw}
        for i, k in enumerate(tkeys):
            row[k] = ws.cell(r, 2 + i).value
        row["top_drivers_raw"] = [ws.cell(r, c).value for c in (9, 10, 11) if ws.cell(r, c).value is not None]
        team_rows.append(row)

    after = sha256(XLSX)
    assert before == after, "Workbook changed while reading - this must never happen"

    snapshot = {
        "source": {
            "file": "F1.xlsx",
            "sha256": before,
            "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "note": "Raw values copied from the workbook. Nothing has been corrected.",
        },
        "track_records": {"columns": columns, "excel_error_cells_in_header_rows": error_cells},
        "driver_stats": {"headers": headers, "rows": driver_rows},
        "team_stats": {"headers": team_headers, "rows": team_rows},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"  GP columns: {len(columns)} | drivers: {len(driver_rows)} | teams: {len(team_rows)}")
    print(f"  Workbook fingerprint unchanged: {before}")


if __name__ == "__main__":
    sys.exit(main())

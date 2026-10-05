#!/usr/bin/env python3
"""
Descarga los casos de prueba reales de una Suite de Azure DevOps a test-cases.json:
mapeo caso -> Test Point, título, pasos (acción / resultado esperado) y tabla de parámetros.

Uso:
  ADO_PAT=<pat> python ado_fetch_cases.py --org <ORG> --project <PROJECT> --plan <PLAN_ID> --suite <SUITE_ID> \
      [--out test-cases.json] [--md test-cases.md] [--cases 1001,1002]

El PAT se lee de la variable de entorno ADO_PAT o de un archivo `env` en el directorio actual
(nunca se pasa por línea de comandos para que no quede en el historial).
Requiere: pip install requests
"""

import argparse
import base64
import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")


def read_pat():
    pat = os.getenv("ADO_PAT")
    if not pat and Path("env").exists():
        for line in Path("env").read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("ADO_PAT="):
                pat = line.split("=", 1)[1].strip()
    if not pat or pat.startswith("<"):
        sys.exit("❌ Falta ADO_PAT (variable de entorno o archivo env).")
    return pat


def strip_html(text):
    """Los pasos vienen como HTML escapado dentro de XML: se dejan en texto plano."""
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r"<br\s*/?>|</p>|</div>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(re.sub(r"\n{2,}", "\n", text)).strip()


def parse_steps(xml_text):
    """Microsoft.VSTS.TCM.Steps → [{action, expected}] (incluye pasos compartidos como referencia)."""
    if not xml_text:
        return []
    steps = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return [{"action": strip_html(xml_text), "expected": ""}]
    for node in root.iter():
        if node.tag == "step":
            ps = node.findall("parameterizedString")
            steps.append({
                "action": strip_html(ps[0].text if len(ps) > 0 else ""),
                "expected": strip_html(ps[1].text if len(ps) > 1 else ""),
            })
        elif node.tag == "compref":
            steps.append({"action": f"[Pasos compartidos #{node.get('ref')}]", "expected": ""})
    return steps


def parse_parameters(xml_text):
    """Microsoft.VSTS.TCM.LocalDataSource (NewDataSet/Table1) → [{param: valor}]."""
    if not xml_text or not xml_text.strip().startswith("<"):
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    rows = []
    for table in root:
        if table.tag.lower().startswith("table"):
            rows.append({c.tag: (c.text or "") for c in table})
    return rows


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--org", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--plan", type=int, required=True)
    p.add_argument("--suite", type=int, required=True)
    p.add_argument("--cases", default="", help="Lista de IDs a incluir (por defecto todos los de la suite)")
    p.add_argument("--suite-name", default="", help="Nombre corto para el resumen (resumen-<nombre>.json)")
    p.add_argument("--out", default="test-cases.json")
    p.add_argument("--md", default="", help="Además escribe un .md legible con pasos y parámetros")
    args = p.parse_args()

    pat = read_pat()
    headers = {"Authorization": "Basic " + base64.b64encode(f":{pat}".encode()).decode()}
    base = f"https://dev.azure.com/{args.org}/{args.project}/_apis"

    points, token = [], None
    while True:
        url = f"{base}/testplan/Plans/{args.plan}/Suites/{args.suite}/TestPoint?api-version=7.0"
        r = requests.get(url, headers={**headers, **({"x-ms-continuationtoken": token} if token else {})}, timeout=30)
        if r.status_code != 200:
            sys.exit(f"❌ TestPoint HTTP {r.status_code}: {r.text[:300]}")
        points += r.json().get("value", [])
        token = r.headers.get("x-ms-continuationtoken")
        if not token:
            break

    wanted = {c.strip() for c in args.cases.split(",") if c.strip()}
    mapping = {}
    for pt in points:
        case_id = str(pt.get("testCaseReference", {}).get("id"))
        if wanted and case_id not in wanted:
            continue
        mapping[case_id] = {"point_id": pt["id"], "name": pt.get("testCaseReference", {}).get("name", ""),
                            "configuration": pt.get("configuration", {}).get("name", "")}

    ids = list(mapping)
    fields = "System.Title,Microsoft.VSTS.TCM.Steps,Microsoft.VSTS.TCM.LocalDataSource,Microsoft.VSTS.TCM.Parameters"
    for i in range(0, len(ids), 200):
        r = requests.get(f"{base}/wit/workitems?ids={','.join(ids[i:i + 200])}&fields={fields}&api-version=7.1",
                         headers=headers, timeout=30)
        if r.status_code != 200:
            sys.exit(f"❌ WorkItems HTTP {r.status_code}: {r.text[:300]}")
        for wi in r.json().get("value", []):
            f = wi.get("fields", {})
            entry = mapping[str(wi["id"])]
            entry["name"] = f.get("System.Title", entry["name"])
            entry["steps"] = parse_steps(f.get("Microsoft.VSTS.TCM.Steps"))
            entry["parameters"] = parse_parameters(f.get("Microsoft.VSTS.TCM.LocalDataSource"))

    out = {
        "organization": args.org, "project": args.project, "plan_id": args.plan, "suite_id": args.suite,
        "suite_name": args.suite_name, "cases": dict(sorted(mapping.items())),
    }
    Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✅ {len(mapping)} caso(s) → {args.out}")

    if args.md:
        lines = [f"# Casos de prueba — Plan {args.plan} / Suite {args.suite}", ""]
        for cid, c in out["cases"].items():
            lines += [f"## TC-{cid} (Point {c['point_id']}): {c['name']}", ""]
            for n, s in enumerate(c.get("steps", []), 1):
                lines.append(f"{n}. {s['action']}" + (f"  \n   → *Esperado:* {s['expected']}" if s["expected"] else ""))
            if c.get("parameters"):
                cols = list(c["parameters"][0])
                lines += ["", "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
                lines += ["| " + " | ".join(r.get(k, "") for k in cols) + " |" for r in c["parameters"]]
            lines.append("")
        Path(args.md).write_text("\n".join(lines), encoding="utf-8")
        print(f"✅ Resumen legible → {args.md}")


if __name__ == "__main__":
    main()

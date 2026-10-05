#!/usr/bin/env python3
"""
QA Validator — ejecuta la suite Playwright, decide el outcome de cada caso de prueba y marca
los Test Points de Azure DevOps adjuntando la evidencia.

Lee los casos de `test-cases.json` (generado con ado_fetch_cases.py o armado a mano).

Uso:
  python qa-validate.py                    # ambiente test: ejecuta Playwright y marca ADO
  python qa-validate.py --dry-run          # ejecuta y resume, sin tocar ADO
  python qa-validate.py --skip-playwright  # reutiliza la última corrida
  python qa-validate.py --upload-only      # solo sube a ADO lo ya ejecutado
  python qa-validate.py --env qa           # usa env.qa y rutas propias; no marca ADO...
  python qa-validate.py --env qa --ado     # ...salvo que se pida explícitamente

Outcome (fuente: reporter JSON de Playwright, último intento de cada test):
  algún subtest failed/timedOut/interrupted -> Failed
    ...salvo que TODOS esos fallos sean de infraestructura (DNS, conexión rechazada,
    timeout de red) -> Blocked: no se llegó a probar nada, no es un defecto del sistema
  todos skipped o sin datos                 -> NotExecuted
  en otro caso                              -> Passed

Evidencia visual: la controla EVIDENCE_CAPTURE (always | on-failure | off) en env; ver
playwright-tests/lib/evidence.js. Este script adjunta lo que exista y lo indica en el comentario.
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
CASES_FILE = ROOT / "test-cases.json"
MAX_COMMENT_CHARS = 3500  # ADO trunca comentarios más largos

# Rutas por ambiente (se ajustan en configure_environment).
TEST_ENV = "test"
EVIDENCE_CAPTURE = "on-failure"
ENV_FILE = ROOT / "env"
EVIDENCE_DIR = ROOT / "evidence-validacion"
TEST_RESULTS = ROOT / "test-results"
PLAYWRIGHT_REPORT = ROOT / "playwright-report"

# Fallos que indican que el ambiente no estaba disponible (no un defecto de lo que se prueba).
INFRA_RE = re.compile(
    r"ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|getaddrinfo|socket hang up"
    r"|net::ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_TIMED_OUT|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE)",
    re.I,
)

# <ts>-TC-<id>[-<variante>]-<tipo>.<ext>  (ver playwright-tests/lib/evidence.js)
EVIDENCE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)-TC-(?P<tc>\d+)"
    r"(?:-(?!swagger-\d)(?P<var>.+?))?"
    r"-(?P<tipo>swagger-\d+-[a-z]+|[a-z]+)\.(?P<ext>[A-Za-z0-9]+)$"
)


def configure_environment(name):
    global TEST_ENV, ENV_FILE, EVIDENCE_DIR, TEST_RESULTS, PLAYWRIGHT_REPORT
    TEST_ENV = (name or "test").strip().lower()
    if TEST_ENV != "test":
        ENV_FILE = ROOT / f"env.{TEST_ENV}"
        EVIDENCE_DIR = ROOT / "evidence-validacion" / TEST_ENV
        TEST_RESULTS = ROOT / f"test-results-{TEST_ENV}"
        PLAYWRIGHT_REPORT = ROOT / f"playwright-report-{TEST_ENV}"


def load_env(path):
    values = {}
    if not Path(path).exists():
        return values
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def load_cases():
    if not CASES_FILE.exists():
        sys.exit(f"❌ No existe {CASES_FILE.name}. Genéralo con ado_fetch_cases.py o créalo desde test-cases.example.json.")
    return json.loads(CASES_FILE.read_text(encoding="utf-8"))


def slugify(text, max_len=60):
    text = re.sub(r"^TC-\d+:\s*", "", text)
    text = unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:max_len].strip("-")


# ─── Playwright ────────────────────────────────────────────────────────────────

def run_playwright():
    print("\n🎭 Ejecutando pruebas Playwright...")
    try:
        result = subprocess.run(
            "npx playwright test", cwd=ROOT, shell=True, text=True, encoding="utf-8", errors="replace",
            capture_output=True, env={**os.environ, "TEST_ENV": TEST_ENV},
        )
    except FileNotFoundError:
        print("❌ npx no encontrado. ¿Node/npm está instalado?")
        return False
    print(result.stdout)
    if result.stderr:
        print("⚠️ ", result.stderr[-2000:])
    if result.returncode != 0:
        print(f"⚠️  Playwright terminó con código {result.returncode} (hay fallos u omitidos; ver detalle abajo)")
    return True


def load_playwright_outcomes():
    """{tc_id: {"statuses": [estado último intento por test], "subtests": [...]}}"""
    results_file = TEST_RESULTS / "playwright-results.json"
    if not results_file.exists():
        return {}
    data = json.loads(results_file.read_text(encoding="utf-8"))
    outcomes = {}

    def walk(suite):
        for spec in suite.get("specs", []):
            m = re.search(r"TC-(\d+)", spec.get("title", ""))
            if not m:
                continue
            entry = outcomes.setdefault(m.group(1), {"statuses": [], "subtests": []})
            for t in spec.get("tests", []):
                skip_reason = next((a.get("description") for a in t.get("annotations") or [] if a.get("type") == "skip"), None)
                runs = t.get("results", [])
                # Con retries, solo el ÚLTIMO intento define el resultado; los previos quedan en el detalle.
                if runs:
                    last = runs[-1]
                    last_error = " ".join(
                        e.get("message", "") for e in (last.get("errors") or [last.get("error") or {}])
                    )
                    entry["statuses"].append(last.get("status"))
                    entry.setdefault("infra", []).append(
                        last.get("status") in ("failed", "timedOut") and bool(INFRA_RE.search(last_error))
                    )
                for idx, r in enumerate(runs):
                    error = (r.get("error") or {}).get("message")
                    entry["subtests"].append({
                        "title": spec.get("title", ""),
                        "attempt": idx + 1,
                        "total_attempts": len(runs),
                        "status": r.get("status"),
                        "duration_ms": r.get("duration"),
                        "skip_reason": skip_reason,
                        "error": re.sub(r"\x1b\[[0-9;]*m", "", error.split("\n")[0])[:300] if error else None,
                        "videos": [a["path"] for a in r.get("attachments") or [] if a.get("name") == "video" and a.get("path")],
                    })
        for s in suite.get("suites", []):
            walk(s)

    for s in data.get("suites", []):
        walk(s)
    return outcomes


def combine_statuses(statuses, infra=None):
    if not statuses:
        return "NotExecuted"
    infra = infra or [False] * len(statuses)
    failed = [i for i, s in enumerate(statuses) if s in ("failed", "timedOut", "interrupted")]
    if failed:
        # Si nada falló por el sistema sino porque el ambiente no respondía, no es un Failed.
        return "Blocked" if all(infra[i] for i in failed) else "Failed"
    if all(s == "skipped" for s in statuses):
        return "NotExecuted"
    return "Passed"


# ─── Evidencia ─────────────────────────────────────────────────────────────────

def find_executions():
    """{tc_id: {clave_ejecucion: {tipo: ruta}}}; clave = <ts>-TC-<id>[-<variante>]."""
    executions = {}
    if not EVIDENCE_DIR.exists():
        return executions
    for f in sorted(EVIDENCE_DIR.iterdir()):
        m = EVIDENCE_RE.match(f.name)
        if not f.is_file() or not m:
            continue
        key = f"{m['ts']}-TC-{m['tc']}" + (f"-{m['var']}" if m["var"] else "")
        executions.setdefault(m["tc"], {}).setdefault(key, {})[f"{m['tipo']}.{m['ext']}"] = f
    return executions


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def summarize_execution(key, files):
    """Una línea legible por ejecución: qué se hizo y qué se obtuvo."""
    parts = [key]
    req = read_json(files["request.json"]) if "request.json" in files else None
    # Lote = lista de objetos (en la raíz o en una clave como "items"/"viajes").
    batches = [req] if isinstance(req, list) else [
        v for v in (req or {}).values() if isinstance(v, list) and v and isinstance(v[0], dict)
    ] if isinstance(req, dict) else []
    if batches:
        parts.append(f"Se hizo: request con {len(batches[0])} ítem(s)")
    elif req is not None:
        parts.append(f"Se hizo: request {json.dumps(req, ensure_ascii=False)[:120]}")
    res = read_json(files["response.json"]) if "response.json" in files else None
    if isinstance(res, dict):
        txt = f"Se obtuvo: HTTP {res.get('status')} en {res.get('duration')} ms"
        body = res.get("body")
        data = body.get("data") if isinstance(body, dict) else None
        if isinstance(data, dict):
            counters = {k: v for k, v in data.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
            if counters:
                txt += " | " + ", ".join(f"{k}={v}" for k, v in counters.items())
        elif isinstance(body, dict):
            msg = body.get("message") or body.get("Message") or body.get("errors") or body.get("Errors")
            if msg:
                txt += f" | {json.dumps(msg, ensure_ascii=False)[:200]}"
        parts.append(txt)
    out = read_json(files["resultado.json"]) if "resultado.json" in files else None
    if isinstance(out, dict):
        if out.get("aviso"):
            parts.append(f"Aviso: [{out['aviso'].get('title')}] {out['aviso'].get('text')}")
        elif out.get("resultado"):
            parts.append("Resultado: " + ", ".join(f"{k}={v}" for k, v in out["resultado"].items()))
        else:
            parts.append("Sin aviso de validación (aceptado)")
    images = sum(1 for k in files if k.endswith(".png"))
    if images:
        parts.append(f"{images} captura(s)")
    return " | ".join(parts)


def subtests_summary(subtests):
    icons = {"passed": "✅", "failed": "❌", "skipped": "⏭️", "timedOut": "⏱️", "interrupted": "⛔"}
    lines = []
    for st in subtests:
        attempt = f" [intento {st['attempt']}/{st['total_attempts']}]" if st["total_attempts"] > 1 else ""
        dur = f" ({round(st['duration_ms'] / 1000, 1)}s)" if st.get("duration_ms") else ""
        lines.append(f"{icons.get(st['status'], '•')} {st['title']}{attempt}{dur}")
        if st.get("skip_reason"):
            lines.append(f"    Motivo (no ejecutado): {st['skip_reason']}")
        if st.get("error"):
            lines.append(f"    Error: {st['error']}")
    return "\n".join(lines)


def collect_results(config):
    print("\n📊 Recolectando resultados...")
    executions = find_executions()
    outcomes = load_playwright_outcomes()
    if not outcomes:
        print(f"  ⚠️  No hay {TEST_RESULTS.name}/playwright-results.json: los casos quedarán NotExecuted.")

    results = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": TEST_ENV,
        "plan_id": config.get("plan_id"),
        "suite_id": config.get("suite_id"),
        "test_cases": [],
    }
    for tc_id, meta in config["cases"].items():
        pw = outcomes.get(tc_id, {"statuses": [], "subtests": []})
        outcome = combine_statuses(pw["statuses"], pw.get("infra"))
        if outcome == "Blocked":
            print(f"  ⛔ TC-{tc_id}: fallos de conectividad/infraestructura; se reporta Blocked, no Failed")
        tc_execs = executions.get(tc_id, {})
        evidence = [str(p) for files in tc_execs.values() for p in files.values()]
        names = {}
        for st in pw["subtests"]:
            for v in st["videos"]:
                if Path(v).exists():
                    evidence.append(v)
                    suffix = f"-intento{st['attempt']}" if st["total_attempts"] > 1 else ""
                    names[v] = f"TC-{tc_id}-{slugify(st['title'])}{suffix}.webm"
        summary = "\n\n".join(p for p in [
            subtests_summary(pw["subtests"]),
            "\n".join(summarize_execution(k, f) for k, f in tc_execs.items()),
        ] if p)
        if outcome == "Passed" and not tc_execs:
            # Un Passed sin evidencia no le sirve a nadie para auditar: se avisa.
            print(f"  ⚠️  TC-{tc_id}: Passed sin evidencia en {EVIDENCE_DIR.name}/ (revisa startEvidence en el test)")
        results["test_cases"].append({
            "tcId": tc_id, "name": meta.get("name", ""), "point_id": meta.get("point_id"),
            "outcome": outcome, "executions": len(tc_execs), "evidence_files": evidence,
            "evidence_names": names, "summary": summary,
        })
        print(f"  {'✓' if outcome == 'Passed' else '•'} TC-{tc_id}: {outcome} ({len(tc_execs)} ejecución(es), {len(evidence)} archivo(s))")
    return results


def save_summary(results, suite_name):
    TEST_RESULTS.mkdir(parents=True, exist_ok=True)
    out = TEST_RESULTS / f"resumen-{suite_name}.json"
    out.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  📄 Resumen: {out.relative_to(ROOT)}")
    return out


# ─── Azure DevOps ──────────────────────────────────────────────────────────────

class Ado:
    def __init__(self, pat, config):
        import requests  # solo se necesita si se sube a ADO
        self.http = requests
        self.plan, self.suite = config["plan_id"], config["suite_id"]
        base = f"https://dev.azure.com/{config['organization']}/{config['project']}/_apis"
        self.test, self.testplan = f"{base}/test", f"{base}/testplan"
        self.headers = {
            "Authorization": "Basic " + base64.b64encode(f":{pat}".encode()).decode(),
            "Content-Type": "application/json",
        }

    def points_url(self):
        return f"{self.testplan}/Plans/{self.plan}/Suites/{self.suite}/TestPoint?api-version=7.0-preview.2"

    def mark(self, tc):
        outcome = {"Passed": "passed", "Failed": "failed", "Blocked": "blocked", "NotExecuted": "notExecuted"}[tc["outcome"]]
        resp = self.http.patch(self.points_url(), headers=self.headers, timeout=30,
                               json=[{"id": tc["point_id"], "results": {"outcome": outcome, "state": "completed"}}])
        if resp.status_code not in (200, 204):
            print(f"  ❌ TC-{tc['tcId']} (point {tc['point_id']}): HTTP {resp.status_code} {resp.text[:200]}")
            return False
        print(f"  ✓ TC-{tc['tcId']} (point {tc['point_id']}): {outcome}")

        points = self.http.get(self.points_url(), headers=self.headers, timeout=30).json().get("value", [])
        point = next((p for p in points if p.get("id") == tc["point_id"]), None)
        run_id = (point or {}).get("results", {}).get("lastTestRunId")
        result_id = (point or {}).get("results", {}).get("lastResultId")
        if not (run_id and result_id):
            print("      ⚠️  No se encontró el run/result del point para comentar y adjuntar")
            return True
        self.http.patch(f"{self.test}/runs/{run_id}/results?api-version=7.1", headers=self.headers, timeout=30,
                        json=[{"id": result_id, "comment": build_comment(tc)}])
        ok = 0
        for path in tc["evidence_files"]:
            name = tc["evidence_names"].get(path) or Path(path).name
            r = self.http.post(
                f"{self.test}/runs/{run_id}/results/{result_id}/attachments?api-version=7.1-preview.1",
                headers=self.headers, timeout=120,
                json={"stream": base64.b64encode(Path(path).read_bytes()).decode("ascii"),
                      "fileName": name, "attachmentType": "GeneralAttachment"},
            )
            ok += r.status_code in (200, 201)
        if tc["evidence_files"]:
            print(f"      📎 {ok}/{len(tc['evidence_files'])} evidencias adjuntadas")
        return True


def build_comment(tc):
    header = (
        f"TC-{tc['tcId']} | {tc['name']} | {tc['outcome']}\n"
        f"Ambiente: {TEST_ENV}\n"
        f"Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
        f"Evidencia adjunta: {len(tc['evidence_files'])} archivo(s) | captura visual: {EVIDENCE_CAPTURE}\n\n"
    )
    comment = header + (tc.get("summary") or "(sin ejecuciones registradas)")
    if len(comment) > MAX_COMMENT_CHARS:
        comment = comment[:MAX_COMMENT_CHARS - 20] + "\n... (truncado)"
    return comment


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="QA Validator (Playwright + Azure DevOps)")
    p.add_argument("--env", default=os.getenv("TEST_ENV", "test"), help="Ambiente (por defecto test; otro lee env.<nombre>)")
    p.add_argument("--skip-playwright", action="store_true", help="Usa la última corrida existente")
    p.add_argument("--upload-only", action="store_true", help="Solo sube a ADO resultados existentes")
    p.add_argument("--ado", action="store_true", help="En un ambiente distinto de test, marcar igualmente ADO")
    p.add_argument("--dry-run", action="store_true", help="No contacta ADO; solo ejecuta y resume")
    args = p.parse_args()
    configure_environment(args.env)
    config = load_cases()
    global EVIDENCE_CAPTURE
    EVIDENCE_CAPTURE = (os.getenv("EVIDENCE_CAPTURE") or load_env(ENV_FILE).get("EVIDENCE_CAPTURE") or "on-failure").strip().lower()
    suite_name = config.get("suite_name") or slugify(ROOT.name)

    print("=" * 70)
    print(f"🚀 QA VALIDATOR - {suite_name} | ambiente: {TEST_ENV} ({ENV_FILE.name}) | evidencia visual: {EVIDENCE_CAPTURE}")
    print("=" * 70)
    if TEST_ENV != "test" and not ENV_FILE.exists():
        print(f"❌ No existe {ENV_FILE.name}. Créalo a partir de env.example.")
        return 1

    if not (args.upload_only or args.skip_playwright) and not run_playwright():
        return 1

    results = collect_results(config)
    summary_file = save_summary(results, suite_name)

    if args.dry_run:
        print("\nℹ️  --dry-run: no se contacta Azure DevOps.")
    elif TEST_ENV != "test" and not args.ado:
        print(f"\nℹ️  Ambiente {TEST_ENV}: no se marca ADO (usa --ado para hacerlo).")
    else:
        merged = {**load_env(ROOT / "env"), **{k: v for k, v in load_env(ENV_FILE).items() if v}}
        pat = os.getenv("ADO_PAT") or merged.get("ADO_PAT")
        if not pat or pat.startswith("<"):
            print("\n⚠️  Sin ADO_PAT válido: resultados no subidos a ADO.")
        else:
            print("\n📤 Marcando Test Points en Azure DevOps...")
            ado = Ado(pat, config)
            for tc in results["test_cases"]:
                ado.mark(tc)

    counts = {}
    for tc in results["test_cases"]:
        counts[tc["outcome"]] = counts.get(tc["outcome"], 0) + 1
    print("\n" + "=" * 70)
    print("✅ VALIDACIÓN COMPLETADA | " + ", ".join(f"{k}: {v}" for k, v in counts.items()))
    print(f"📁 Evidencia: {EVIDENCE_DIR.relative_to(ROOT)}/")
    print(f"📄 Resumen:   {summary_file.relative_to(ROOT)}")
    print(f"📊 Reporte:   {PLAYWRIGHT_REPORT.relative_to(ROOT)}/index.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())

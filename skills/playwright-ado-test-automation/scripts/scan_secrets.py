#!/usr/bin/env python3
"""
Busca información sensible en un proyecto de validación antes de compartirlo, hacer commit o
publicarlo: JWT, cabeceras Bearer, contraseñas/PAT escritos en código, correos reales,
claves privadas, archivos env versionables y dominios/nombres internos que indiques.

Uso:
  python scan_secrets.py <dir> [--deny midominio.com --deny NombreEmpresa] [--allow-email-domain example.com]
                               [--include-generated]

Por defecto omite node_modules/.git y las carpetas generadas que ya deben estar en .gitignore
(evidence-validacion, test-results*, playwright-report*), pero comprueba que ese .gitignore
exista y las cubra. Con --include-generated revisa también esas carpetas (útil antes de
adjuntar evidencia fuera de ADO).

Sale con código 1 si hay hallazgos.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv"}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
GENERATED = re.compile(r"^(evidence-validacion|test-results.*|playwright-report.*|blob-report)$")
TEXT_EXT = {".js", ".mjs", ".cjs", ".ts", ".py", ".json", ".md", ".txt", ".html", ".csv", ".yml", ".yaml",
            ".env", ".example", ".xml", ".ps1", ".sh", ".cfg", ".ini", ".toml", ""}

PATTERNS = [
    ("JWT", re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("Cabecera Bearer con token", re.compile(r"Bearer\s+[A-Za-z0-9._~+/-]{20,}=*")),
    ("Basic auth", re.compile(r"Basic\s+[A-Za-z0-9+/]{20,}={0,2}")),
    ("Clave privada", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("PAT de Azure DevOps", re.compile(r"(?<![A-Za-z0-9])[a-z2-7]{52}(?![A-Za-z0-9])")),
    # Formato nuevo: 84 caracteres con la firma "AZDO" (evita confundir hashes base64 de lockfiles).
    ("PAT de Azure DevOps (nuevo formato)", re.compile(r"(?<![A-Za-z0-9])(?=[A-Za-z0-9]{84}(?![A-Za-z0-9]))[A-Za-z0-9]{52,}AZDO[A-Za-z0-9]{4,}")),
    ("Token de GitHub", re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("Contraseña escrita en código",
     re.compile(r"""(?i)(pass(word)?|pwd|contrase(n|ñ)a|secret|api[_-]?key|token)\s*["']?\s*[:=]\s*["']([^"'\s<>{}$\[\]()=]{4,})["']""")),
]
# Solo para plantillas tipo env.example / .env versionables.
ENV_ASSIGN = re.compile(r"""(?m)^\s*[A-Z0-9_]*(PASSWORD|PAT|SECRET|TOKEN)\s*=\s*([^<\s#][^\s#]{3,})\s*$""")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
# Valores que son marcadores evidentes y no secretos.
PLACEHOLDER = re.compile(r"(?i)^(<.*>|\*+|x+|changeme|example|redacted|\$\{.*\}|process\.env.*|cfg\(.*\))$")


def iter_files(root, include_generated):
    for path in root.rglob("*"):
        rel = path.relative_to(root).parts
        if any(p in SKIP_DIRS for p in rel):
            continue
        if not include_generated and any(GENERATED.match(p) for p in rel):
            continue
        if path.is_file() and path.name not in SKIP_FILES:
            yield path


def check_gitignore(root):
    issues = []
    gi = root / ".gitignore" if (root / ".gitignore").exists() else root / "gitignore.txt"
    content = gi.read_text(encoding="utf-8") if gi.exists() else ""
    for needed in ("env", "evidence-validacion", "test-results", "playwright-report"):
        if needed not in content:
            issues.append(f".gitignore no cubre '{needed}'")
    for env_file in list(root.glob("env")) + list(root.glob("env.*")):
        if env_file.name == "env.example":
            continue
        try:
            tracked = subprocess.run(["git", "ls-files", "--error-unmatch", env_file.name], cwd=root,
                                     capture_output=True).returncode == 0
        except FileNotFoundError:
            tracked = False
        if tracked:
            issues.append(f"{env_file.name} está versionado en git (debe estar ignorado)")
    return issues


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("path")
    p.add_argument("--deny", action="append", default=[], help="Texto prohibido (dominio, empresa, proyecto). Repetible.")
    p.add_argument("--allow-email-domain", action="append", default=["example.com", "example.org", "test.com", "noreply.github.com"])
    p.add_argument("--include-generated", action="store_true")
    args = p.parse_args()

    root = Path(args.path).resolve()
    findings = []
    deny = [re.compile(re.escape(d), re.I) for d in args.deny]

    for f in iter_files(root, args.include_generated):
        rel = f.relative_to(root)
        if f.name.startswith("env") and f.name != "env.example":
            continue  # los env locales SÍ tienen secretos; lo importante es que no se versionen
        if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webm", ".zip"}:
            continue
        if f.suffix.lower() not in TEXT_EXT:
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for label, rx in PATTERNS:
                for m in rx.finditer(line):
                    value = m.groups()[-1] if m.groups() else m.group(0)
                    if PLACEHOLDER.match(value.strip()):
                        continue
                    findings.append((rel, n, label, value))
            if f.name == "env.example" or f.suffix == ".env":
                for m in ENV_ASSIGN.finditer(line):
                    if not PLACEHOLDER.match(m.group(2)):
                        findings.append((rel, n, "Secreto en plantilla env", m.group(2)))
            for m in EMAIL.finditer(line):
                if not any(m.group(1).lower().endswith(d) for d in args.allow_email_domain):
                    findings.append((rel, n, "Correo electrónico real", m.group(0)))
            for rx in deny:
                if rx.search(line):
                    findings.append((rel, n, f"Texto prohibido '{rx.pattern}'", line.strip()[:80]))
        if f.name == "error-context.md":
            findings.append((rel, 0, "error-context.md de Playwright (suele incluir tokens)", "eliminar o ignorar"))

    issues = check_gitignore(root)

    def mask(v):
        v = str(v)
        # Nunca se imprime el valor completo: solo lo justo para ubicarlo.
        return f"{v[:2]}… ({len(v)} car.)"

    for rel, n, label, value in findings:
        print(f"❌ {rel}:{n}  {label}: {mask(value)}")
    for i in issues:
        print(f"⚠️  {i}")
    if findings or issues:
        print(f"\n{len(findings)} hallazgo(s), {len(issues)} advertencia(s). Revisa references/security.md.")
        return 1
    print("✅ Sin hallazgos de información sensible.")
    print("   Recuerda revisar a ojo las capturas (.png) y videos antes de compartirlos fuera de ADO.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

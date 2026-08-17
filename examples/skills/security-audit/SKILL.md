---
name: security-audit
description: Security-focused audit of code, dependencies, or config. Use when the user mentions security, vulnerabilities, OWASP, secrets, or hardening.
allowed-tools: readFile, listDirectory, glob, grep, bash
---

# Security Audit

Work through these surfaces:

1. **Secrets** — grep for API keys, tokens, private keys, passwords in source and config (`AKIA`, `sk-`, `-----BEGIN`, `password\s*=`). Check .gitignore covers .env files.
2. **Injection** — SQL string concatenation, shell command interpolation, unsanitized template rendering, `eval`/`exec`.
3. **Web surface** — missing auth middleware on routes, CORS wildcards, missing rate limits, open redirects, SSRF in URL fetchers.
4. **Dependencies** — run the ecosystem audit (`npm audit`, `pip audit`, …) via bash if available.
5. **Data** — PII in logs, unencrypted sensitive storage, overly verbose error responses.

Severity-rank every finding (CVSS-style: critical/high/medium/low) with file:line evidence and a concrete remediation. Never exfiltrate or "demonstrate" a vulnerability against a live system — report, don't exploit.

#!/usr/bin/env node
'use strict';

/**
 * audit-report.js — cc-baseline audit & review HTML report generator
 *
 * Usage:
 *   node ~/.claude/scripts/audit-report.js <audit-dir>
 *
 * <audit-dir> example:
 *   /path/to/project/.cc-audits/my-plan-slug
 *
 * Output:
 *   <audit-dir>/report.html  (overwrites existing file)
 */

const fs = require('fs');
const path = require('path');

// ── HTML escape ────────────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Load JSON files ────────────────────────────────────────────────────────
function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`[warn] Failed to read ${filePath}: ${e.message}`);
    return null;
  }
}

// ── Collect report files ───────────────────────────────────────────────────
function collectReports(auditDir) {
  const files = fs.readdirSync(auditDir).filter(f => f.endsWith('.json'));

  const secIters = [];
  const codeIters = [];

  for (const f of files) {
    const m = f.match(/^iter-(\d+)\.json$/);
    if (m) { secIters.push({ n: +m[1], file: path.join(auditDir, f) }); continue; }
    const m2 = f.match(/^code-review-iter-(\d+)\.json$/);
    if (m2) { codeIters.push({ n: +m2[1], file: path.join(auditDir, f) }); }
  }

  secIters.sort((a, b) => a.n - b.n);
  codeIters.sort((a, b) => a.n - b.n);

  return { secIters, codeIters };
}

// ── Severity colors ────────────────────────────────────────────────────────
const SEV_COLOR = {
  CRITICAL: '#dc2626',
  HIGH:     '#ea580c',
  MEDIUM:   '#ca8a04',
  LOW:      '#6b7280',
};
const SEV_BG = {
  CRITICAL: '#fee2e2',
  HIGH:     '#ffedd5',
  MEDIUM:   '#fef9c3',
  LOW:      '#f3f4f6',
};

function sevBadge(sev) {
  const s = (sev || '').toUpperCase();
  const color = SEV_COLOR[s] || '#6b7280';
  const bg = SEV_BG[s] || '#f3f4f6';
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">${esc(s)}</span>`;
}

// ── decision_type badges ───────────────────────────────────────────────────
const DT_COLOR = { auto: '#1d4ed8', design: '#7c3aed', business: '#15803d' };
const DT_BG    = { auto: '#dbeafe', design: '#ede9fe', business: '#dcfce7' };

function dtBadge(dt) {
  const d = (dt || '').toLowerCase();
  const color = DT_COLOR[d] || '#6b7280';
  const bg = DT_BG[d] || '#f3f4f6';
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-size:11px">${esc(dt)}</span>`;
}

// ── Summary cards ──────────────────────────────────────────────────────────
function summaryCard(label, summary) {
  if (!summary) return '';
  const { critical = 0, high = 0, medium = 0, low = 0 } = summary;
  const cells = [
    ['CRITICAL', critical, '#fee2e2', '#dc2626'],
    ['HIGH',     high,     '#ffedd5', '#ea580c'],
    ['MEDIUM',   medium,   '#fef9c3', '#ca8a04'],
    ['LOW',      low,      '#f3f4f6', '#6b7280'],
  ];
  const cards = cells.map(([name, count, bg, color]) =>
    `<div style="background:${bg};border-radius:8px;padding:12px 20px;text-align:center;min-width:80px">
      <div style="font-size:28px;font-weight:700;color:${color}">${count}</div>
      <div style="font-size:11px;color:${color};font-weight:600">${name}</div>
    </div>`
  ).join('');
  return `
    <div style="margin-bottom:16px">
      <h3 style="margin:0 0 8px;font-size:14px;color:#374151">${esc(label)}</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${cards}</div>
    </div>`;
}

// ── Issues table ───────────────────────────────────────────────────────────
const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function issuesTable(issues, title) {
  if (!issues || issues.length === 0) return `<p style="color:#6b7280;font-style:italic">No issues</p>`;

  const sorted = [...issues].sort((a, b) =>
    (SEV_ORDER[(a.severity || '').toUpperCase()] ?? 9) -
    (SEV_ORDER[(b.severity || '').toUpperCase()] ?? 9)
  );

  const rows = sorted.map(issue => {
    const ev = issue.evidence || {};
    const location = ev.file ? `${esc(ev.file)}${ev.line ? ':' + ev.line : ''}` : '—';
    const snippet = ev.snippet
      ? `<pre style="background:#f8f8f8;border:1px solid #e5e7eb;border-radius:4px;padding:6px;font-size:11px;white-space:pre-wrap;word-break:break-all;max-width:300px;overflow:hidden">${esc(ev.snippet)}</pre>`
      : '';

    return `<tr>
      <td style="padding:8px;white-space:nowrap;font-weight:600;width:90px">${esc(issue.id)}</td>
      <td style="padding:8px;width:80px">${sevBadge(issue.severity)}</td>
      <td style="padding:8px;color:#6b7280;font-size:12px;width:90px">${esc(issue.category)}</td>
      <td style="padding:8px;width:35%">
        <strong>${esc(issue.title)}</strong><br>
        <span style="color:#6b7280;font-size:12px">${esc(issue.description)}</span>
      </td>
      <td style="padding:8px;font-size:12px;font-family:monospace;width:15%">
        ${location}${snippet}
      </td>
      <td style="padding:8px;width:70px">${dtBadge(issue.decision_type)}</td>
      <td style="padding:8px;font-size:12px;color:#374151;width:18%;word-break:break-word">${esc(issue.fix_suggestion)}</td>
    </tr>`;
  }).join('');

  return `
    <h3 style="margin:24px 0 8px">${esc(title)}</h3>
    <div style="overflow-x:auto">
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead>
        <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
          <th style="padding:8px;text-align:left;width:90px">ID</th>
          <th style="padding:8px;text-align:left;width:80px">Severity</th>
          <th style="padding:8px;text-align:left;width:90px">Category</th>
          <th style="padding:8px;text-align:left;width:35%">Title / Description</th>
          <th style="padding:8px;text-align:left;width:15%">File:Line</th>
          <th style="padding:8px;text-align:left;width:70px">Decision</th>
          <th style="padding:8px;text-align:left;width:18%">Fix</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

// ── passed_checks section ──────────────────────────────────────────────────
function passedSection(checks) {
  if (!checks || checks.length === 0) return '';
  const items = checks.map(c =>
    `<li style="padding:2px 0">✅ ${esc(c)}</li>`
  ).join('');
  return `<ul style="margin:0;padding-left:20px;list-style:none">${items}</ul>`;
}

// ── intentional_residuals section ─────────────────────────────────────────
function residualsSection(residuals) {
  if (!residuals || residuals.length === 0) return '';
  const items = residuals.map(r =>
    `<li style="padding:2px 0">⚠️ <strong>${esc(r.id)}</strong>: ${esc(r.reason)}</li>`
  ).join('');
  return `<ul style="margin:0;padding-left:20px;list-style:none">${items}</ul>`;
}

// ── verification section (security-auditor) ───────────────────────────────
function verificationSection(verification) {
  if (!verification || Object.keys(verification).length === 0) return '';
  const items = Object.entries(verification).map(([id, status]) => {
    const color = status === 'PASS' ? '#15803d' : status === 'PARTIAL_FAIL' ? '#ca8a04' : '#dc2626';
    const icon = status === 'PASS' ? '✅' : status === 'PARTIAL_FAIL' ? '⚠️' : '❌';
    return `<li style="padding:2px 0">${icon} <strong>${esc(id)}</strong>: <span style="color:${color}">${esc(status)}</span></li>`;
  }).join('');
  return `<ul style="margin:0;padding-left:20px;list-style:none">${items}</ul>`;
}

// ── Previous iter summary (collapsible) ───────────────────────────────────
function prevIterSummary(iters, label) {
  if (iters.length === 0) return '';
  const rows = iters.map(({ n, data }) => {
    if (!data) return `<tr><td colspan="5" style="padding:6px">iter-${n}: parse error</td></tr>`;
    const s = data.summary || {};
    const term = data.termination || {};
    const ts = (data.scan_metadata || {}).timestamp || '';
    return `<tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:6px">iter-${n}</td>
      <td style="padding:6px">${esc(ts.slice(0, 10))}</td>
      <td style="padding:6px">${sevBadge('CRITICAL')} ${s.critical ?? 0} &nbsp; ${sevBadge('HIGH')} ${s.high ?? 0} &nbsp; ${sevBadge('MEDIUM')} ${s.medium ?? 0} &nbsp; ${sevBadge('LOW')} ${s.low ?? 0}</td>
      <td style="padding:6px">${esc(term.next_action)}</td>
    </tr>`;
  });
  return `
    <details style="margin-top:16px;border:1px solid #e5e7eb;border-radius:6px;padding:8px">
      <summary style="cursor:pointer;font-weight:600;color:#374151">Previous ${esc(label)} history (${iters.length})</summary>
      <table style="border-collapse:collapse;width:100%;font-size:12px;margin-top:8px">
        <thead><tr style="background:#f9fafb">
          <th style="padding:6px;text-align:left">Iter</th>
          <th style="padding:6px;text-align:left">Date</th>
          <th style="padding:6px;text-align:left">Summary</th>
          <th style="padding:6px;text-align:left">Next action</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </details>`;
}

// ── Main HTML render ───────────────────────────────────────────────────────
function renderHtml({ auditDir, secIters, codeIters }) {
  const planSlug = path.basename(auditDir);
  const generatedAt = new Date().toLocaleString('en-US');

  const latestSec = secIters.length > 0 ? loadJson(secIters[secIters.length - 1].file) : null;
  const latestCode = codeIters.length > 0 ? loadJson(codeIters[codeIters.length - 1].file) : null;

  const secMeta = (latestSec || {}).scan_metadata || {};
  const targetDir = secMeta.target_dir || (latestCode || {}).scan_metadata?.target_dir || auditDir;

  // previous iters (exclude last)
  const prevSecIters = secIters.slice(0, -1).map(({ n, file }) => ({ n, data: loadJson(file) }));
  const prevCodeIters = codeIters.slice(0, -1).map(({ n, file }) => ({ n, data: loadJson(file) }));

  // termination badges
  const secTerm = (latestSec || {}).termination || {};
  const codeTerm = (latestCode || {}).termination || {};
  const termColor = (reason) => reason === 'critical_high_zero' ? '#15803d' : '#ca8a04';
  const termText = (reason) => reason === 'critical_high_zero' ? '✅ Done (C/H=0)' : reason === 'limit_reached' ? '⚠️ Limit reached' : reason || '-';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Audit Report — ${esc(planSlug)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #f9fafb; color: #111827; }
    .header { background: #1e293b; color: #f8fafc; padding: 24px 32px; }
    .header h1 { margin: 0 0 4px; font-size: 22px; }
    .header .meta { font-size: 13px; color: #94a3b8; margin-top: 6px; }
    .content { max-width: 1400px; margin: 0 auto; padding: 24px 32px; }
    .section { background: white; border-radius: 8px; border: 1px solid #e5e7eb; padding: 20px; margin-bottom: 20px; }
    .section h2 { margin: 0 0 16px; font-size: 16px; color: #1e293b; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    tr:nth-child(even) { background: #f9fafb; }
    th { color: #374151; font-weight: 600; }
    details summary::-webkit-details-marker { color: #6b7280; }
  </style>
</head>
<body>

<div class="header">
  <h1>🔍 Audit &amp; Review Report</h1>
  <div class="meta">
    <strong>Plan:</strong> ${esc(planSlug)} &nbsp;|&nbsp;
    <strong>Target:</strong> ${esc(targetDir)} &nbsp;|&nbsp;
    <strong>Generated:</strong> ${esc(generatedAt)}
  </div>
</div>

<div class="content">

  <!-- ── Summary cards ────────────────── -->
  <div class="section">
    <h2>Summary</h2>
    <div style="display:flex;gap:32px;flex-wrap:wrap">
      ${summaryCard('Security Audit (iter-' + (secIters.length > 0 ? secIters[secIters.length-1].n : '-') + ')', (latestSec || {}).summary)}
      ${summaryCard('Code Review (iter-' + (codeIters.length > 0 ? codeIters[codeIters.length-1].n : '-') + ')', (latestCode || {}).summary)}
    </div>
    <div style="margin-top:12px;display:flex;gap:24px;font-size:13px;flex-wrap:wrap">
      ${latestSec ? `<span>Security termination: <strong style="color:${termColor(secTerm.reason)}">${termText(secTerm.reason)}</strong></span>` : ''}
      ${latestCode ? `<span>Code Review termination: <strong style="color:${termColor(codeTerm.reason)}">${termText(codeTerm.reason)}</strong></span>` : ''}
    </div>
  </div>

  <!-- ── Security issues ─────────────── -->
  ${latestSec ? `
  <div class="section">
    <h2>Security Audit Issues (iter-${secIters[secIters.length-1].n})</h2>
    ${issuesTable((latestSec || {}).issues || [], 'Issues')}

    ${(latestSec || {}).verification ? `
    <h3 style="margin:24px 0 8px">Fix Verification</h3>
    ${verificationSection(latestSec.verification)}` : ''}

    ${(latestSec || {}).passed_checks?.length ? `
    <h3 style="margin:24px 0 8px">Passed Checks</h3>
    ${passedSection(latestSec.passed_checks)}` : ''}

    ${(latestSec || {}).intentional_residuals?.length ? `
    <h3 style="margin:24px 0 8px">Intentional Residuals (user decision)</h3>
    ${residualsSection(latestSec.intentional_residuals)}` : ''}

    ${prevSecIters.length ? prevIterSummary(prevSecIters, 'Security Audit') : ''}
  </div>` : '<div class="section"><h2>Security Audit</h2><p style="color:#6b7280">No report</p></div>'}

  <!-- ── Code Review issues ──────────── -->
  ${latestCode ? `
  <div class="section">
    <h2>Code Review Issues (iter-${codeIters[codeIters.length-1].n})</h2>
    ${(latestCode || {}).scan_metadata?.changed_files?.length ? `
    <p style="font-size:12px;color:#6b7280">Changed files: ${((latestCode.scan_metadata || {}).changed_files || []).map(esc).join(', ')}</p>` : ''}

    ${issuesTable((latestCode || {}).issues || [], 'Issues')}

    ${(latestCode || {}).passed_checks?.length ? `
    <h3 style="margin:24px 0 8px">Passed Checks</h3>
    ${passedSection(latestCode.passed_checks)}` : ''}

    ${prevCodeIters.length ? prevIterSummary(prevCodeIters, 'Code Review') : ''}
  </div>` : '<div class="section"><h2>Code Review</h2><p style="color:#6b7280">No report</p></div>'}

</div>
</body>
</html>`;
}

// ── Entry point ────────────────────────────────────────────────────────────
function main() {
  const auditDir = process.argv[2];
  if (!auditDir) {
    console.error('Usage: node audit-report.js <audit-dir>');
    process.exit(1);
  }
  if (!fs.existsSync(auditDir)) {
    console.error(`Directory not found: ${auditDir}`);
    process.exit(1);
  }

  const { secIters, codeIters } = collectReports(auditDir);
  if (secIters.length === 0 && codeIters.length === 0) {
    console.error('No JSON report files found (iter-*.json / code-review-iter-*.json)');
    process.exit(1);
  }

  const html = renderHtml({ auditDir, secIters, codeIters });
  const outPath = path.join(auditDir, 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`✅ Report generated: ${outPath}`);
}

main();

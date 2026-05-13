#!/usr/bin/env node

const DEFAULT_GATEWAY_URL = process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642/v1';
const DASHBOARD_URL = process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119/';

async function checkJson(url, label) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, label, detail: `${response.status} ${response.statusText}` };
    }
    await response.json();
    return { ok: true, label, detail: 'ok' };
  } catch (error) {
    return { ok: false, label, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkHtml(url, label) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, label, detail: `${response.status} ${response.statusText}` };
    }
    const body = await response.text();
    return { ok: body.length > 0, label, detail: body.length > 0 ? 'ok' : 'empty response' };
  } catch (error) {
    return { ok: false, label, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const checks = await Promise.all([
    checkJson(`${DEFAULT_GATEWAY_URL.replace(/\/+$/, '')}/models`, 'gateway /models'),
    checkHtml(DASHBOARD_URL, 'dashboard /'),
  ]);

  for (const check of checks) {
    const icon = check.ok ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${check.label} -> ${check.detail}`);
  }

  const failed = checks.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    console.error('\nHermes doctor failed. Verify hermes gateway/dashboard processes and configured URLs.');
    process.exit(1);
  }

  console.log('\nHermes doctor passed.');
}

await main();


#!/usr/bin/env node
/**
 * proxy.js — Proxy local para a API Anthropic
 * ─────────────────────────────────────────────
 * Uso:
 *   Windows CMD:   set ANTHROPIC_API_KEY=sk-ant-... && node proxy.js
 *   Windows PS:    $env:ANTHROPIC_API_KEY="sk-ant-..."; node proxy.js
 *   Linux/macOS:   ANTHROPIC_API_KEY=sk-ant-... node proxy.js
 *
 *   Porta alternativa:  PORT=3002 node proxy.js
 *
 * Não requer npm install. Usa apenas módulos nativos do Node.js (≥ 18).
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

/* ── Configuração ──────────────────────────────────────────── */
const PORT    = parseInt(process.env.PORT || '3001', 10);
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ROOT    = __dirname;

if (!API_KEY) {
  console.error('\n╔══════════════════════════════════════════════════════╗');
  console.error('║  ⚠  ANTHROPIC_API_KEY não definida                  ║');
  console.error('╠══════════════════════════════════════════════════════╣');
  console.error('║  Windows CMD:                                        ║');
  console.error('║    set ANTHROPIC_API_KEY=sk-ant-SuaChaveAqui        ║');
  console.error('║    node proxy.js                                     ║');
  console.error('║                                                      ║');
  console.error('║  Windows PowerShell:                                 ║');
  console.error('║    $env:ANTHROPIC_API_KEY="sk-ant-SuaChaveAqui"    ║');
  console.error('║    node proxy.js                                     ║');
  console.error('║                                                      ║');
  console.error('║  Linux / macOS:                                      ║');
  console.error('║    export ANTHROPIC_API_KEY=sk-ant-SuaChaveAqui    ║');
  console.error('║    node proxy.js                                     ║');
  console.error('║                                                      ║');
  console.error('║  Obtenha sua chave em: https://console.anthropic.com║');
  console.error('╚══════════════════════════════════════════════════════╝\n');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.csv':  'text/csv',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

/* ── Helpers ───────────────────────────────────────────────── */
function jsonError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message } }));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ── Servidor ──────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname } = url.parse(req.url);

  /* ── POST /api/analyze ─────────────────────────────────── */
  if (req.method === 'POST' && pathname === '/api/analyze') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();

      let payload;
      try { payload = JSON.parse(raw); }
      catch { return jsonError(res, 400, 'JSON inválido no corpo da requisição.'); }

      // Garante max_tokens razoável
      if (!payload.max_tokens || payload.max_tokens < 1000) payload.max_tokens = 4000;

      const bodyStr = JSON.stringify(payload);

      const opts = {
        hostname: 'api.anthropic.com',
        port:     443,
        path:     '/v1/messages',
        method:   'POST',
        timeout:  120000, // 2 min
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(bodyStr),
          'x-api-key':         API_KEY,
          'anthropic-version': '2023-06-01',
        },
      };

      console.log(`[${new Date().toLocaleTimeString()}] → Anthropic API  model=${payload.model}  max_tokens=${payload.max_tokens}`);

      const proxyReq = https.request(opts, proxyRes => {
        const parts = [];
        proxyRes.on('data', c => parts.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.concat(parts).toString();
          console.log(`[${new Date().toLocaleTimeString()}] ← Status ${proxyRes.statusCode}  bytes=${body.length}`);
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(body);
        });
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        jsonError(res, 504, 'Tempo limite excedido ao chamar a API Anthropic (2 min).');
      });

      proxyReq.on('error', err => {
        console.error(`[ERRO] ${err.message}`);
        jsonError(res, 502, `Falha ao conectar à API Anthropic: ${err.message}`);
      });

      proxyReq.write(bodyStr);
      proxyReq.end();
    });
    return;
  }

  /* ── Arquivos estáticos ────────────────────────────────── */
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT, filePath.replace(/\.\./g, '')); // bloqueia traversal

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Proibido'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Arquivo não encontrado: ${pathname}`);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ✅  Proxy iniciado com sucesso!                     ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Abra no navegador:  http://localhost:${PORT}           ║`);
  console.log('║                                                      ║');
  console.log('║  NÃO abra index.html diretamente — use o link acima ║');
  console.log('║  Pressione Ctrl+C para encerrar                     ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Porta ${PORT} já está em uso.`);
    console.error(`  Tente:  PORT=3002 node proxy.js\n`);
  } else {
    console.error('\n✗ Erro no servidor:', err.message);
  }
  process.exit(1);
});

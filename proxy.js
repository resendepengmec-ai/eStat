#!/usr/bin/env node
/**
 * proxy.js — Proxy local para a API Anthropic
 * ─────────────────────────────────────────────
 * Uso:
 *   ANTHROPIC_API_KEY=sk-ant-... node proxy.js
 *
 * O servidor escuta em http://localhost:3001
 *   POST /api/analyze  →  repassa para api.anthropic.com/v1/messages
 *   GET  /             →  serve index.html (e arquivos estáticos)
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
const ANTHROPIC_HOST = 'api.anthropic.com';
const ANTHROPIC_PATH = '/v1/messages';
const ROOT   = __dirname;   // pasta onde está o proxy.js

if (!API_KEY) {
  console.error('\n⚠  ANTHROPIC_API_KEY não definida.');
  console.error('   Defina antes de iniciar:');
  console.error('   Windows:  set ANTHROPIC_API_KEY=sk-ant-...');
  console.error('   Linux/Mac: export ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}

/* ── Mapa de tipos MIME para arquivos estáticos ────────────── */
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

/* ── Servidor HTTP ─────────────────────────────────────────── */
const server = http.createServer((req, res) => {

  // Cabeçalhos CORS — permite chamadas do próprio localhost em qualquer porta
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url);

  /* ── POST /api/analyze → proxy para Anthropic ───────────── */
  if (req.method === 'POST' && parsed.pathname === '/api/analyze') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Valida JSON básico
      let payload;
      try { payload = JSON.parse(body); }
      catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Payload inválido' } }));
        return;
      }

      const bodyStr = JSON.stringify(payload);

      const options = {
        hostname: ANTHROPIC_HOST,
        port:     443,
        path:     ANTHROPIC_PATH,
        method:   'POST',
        headers: {
          'Content-Type':       'application/json',
          'Content-Length':     Buffer.byteLength(bodyStr),
          'x-api-key':          API_KEY,
          'anthropic-version':  '2023-06-01',
        },
      };

      const proxyReq = https.request(options, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => { data += chunk; });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });

      proxyReq.on('error', err => {
        console.error('Erro ao conectar à API Anthropic:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Proxy: erro de conexão com a API.' } }));
      });

      proxyReq.write(bodyStr);
      proxyReq.end();
    });
    return;
  }

  /* ── GET arquivos estáticos ──────────────────────────────── */
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(ROOT, filePath);

  // Segurança: impede path traversal (../)
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Proibido'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Arquivo não encontrado: ' + parsed.pathname);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n✅ Proxy local iniciado com sucesso!');
  console.log(`   Abra no navegador: http://localhost:${PORT}`);
  console.log('\n   Pressione Ctrl+C para encerrar.\n');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✗ Porta ${PORT} já está em uso.`);
    console.error(`  Encerre o processo que usa a porta ou defina outra:  PORT=3002 node proxy.js\n`);
  } else {
    console.error('\n✗ Erro no servidor:', err.message);
  }
  process.exit(1);
});

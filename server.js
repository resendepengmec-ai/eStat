#!/usr/bin/env node
/**
 * server.js — Servidor para deploy em nuvem (Cloud Run, Render, Railway, Fly.io)
 *
 * Diferente do proxy.js local, este servidor:
 *   - Escuta na porta definida pela variável PORT (obrigatória em nuvem)
 *   - Aceita conexões de qualquer origem (0.0.0.0)
 *   - Lê ANTHROPIC_API_KEY do ambiente (variável de ambiente do serviço)
 *   - Serve os arquivos estáticos do próprio diretório
 *   - Repassa POST /api/analyze para api.anthropic.com
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

/* ── Configuração ──────────────────────────────────────────── */
const PORT    = parseInt(process.env.PORT || '8080', 10);
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ROOT    = __dirname;

if (!API_KEY) {
  console.error('ERRO FATAL: variável de ambiente ANTHROPIC_API_KEY não definida.');
  console.error('Configure-a no painel do serviço de nuvem antes de fazer deploy.');
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
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function jsonError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message } }));
}

/* ── Servidor ──────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  setCors(res);

  // Preflight CORS
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname } = url.parse(req.url);

  /* ── POST /api/analyze ─── proxy para Anthropic ─────────── */
  if (req.method === 'POST' && pathname === '/api/analyze') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();

      let payload;
      try { payload = JSON.parse(raw); }
      catch { return jsonError(res, 400, 'JSON inválido no corpo da requisição.'); }

      const bodyStr = JSON.stringify(payload);

      const opts = {
        hostname: 'api.anthropic.com',
        port:     443,
        path:     '/v1/messages',
        method:   'POST',
        timeout:  120000,
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(bodyStr),
          'x-api-key':         API_KEY,
          'anthropic-version': '2023-06-01',
        },
      };

      console.log(`[${new Date().toISOString()}] → API  model=${payload.model}  tokens=${payload.max_tokens}`);

      const proxyReq = https.request(opts, proxyRes => {
        const parts = [];
        proxyRes.on('data', c => parts.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.concat(parts).toString();
          console.log(`[${new Date().toISOString()}] ← ${proxyRes.statusCode}  bytes=${body.length}`);
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(body);
        });
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        jsonError(res, 504, 'Tempo limite excedido (2 min).');
      });

      proxyReq.on('error', err => {
        console.error(`[ERRO API] ${err.message}`);
        jsonError(res, 502, `Erro ao chamar API Anthropic: ${err.message}`);
      });

      proxyReq.write(bodyStr);
      proxyReq.end();
    });
    return;
  }

  /* ── GET arquivos estáticos ──────────────────────────────── */
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT, filePath.replace(/\.\./g, ''));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Proibido'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback para index.html (SPA)
      fs.readFile(path.join(ROOT, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Não encontrado'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);
});

server.on('error', err => {
  console.error(`[ERRO] ${err.message}`);
  process.exit(1);
});

/* ═══════════════════════════════════════════════════════════
   Análise Estatística de Experimentos — app.js
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ── Configuração da API ─────────────────────────────────────
   Em produção, substitua a chamada direta por um proxy
   backend que injete a chave server-side.
   ──────────────────────────────────────────────────────────── */
const API_URL   = 'https://api.anthropic.com/v1/messages';
const API_MODEL = 'claude-sonnet-4-6';

/* ── Estado global ──────────────────────────────────────────── */
const state = {
  type:       'anova1',   // anova1 | anova2 | fat2k | ccd
  k:          2,           // número de fatores (2–6)
  csvText:    '',
  headers:    [],          // nomes das colunas
  rows:       [],          // linhas como arrays de strings
  colRoles:   {},          // { colName: 'entrada' | 'saida' | 'ignorar' }
  result:     null,        // JSON retornado pela API
  reportText: '',          // texto do relatório para exportação
};

/* ── Descrições por tipo ────────────────────────────────────── */
const TYPE_INFO = {
  anova1: 'ANOVA univariado: analisa se há diferença significativa entre as médias de grupos. Insira colunas de fator (entrada) e uma coluna de resposta (saída).',
  anova2: 'ANOVA multivariado (MANOVA): múltiplas variáveis de resposta analisadas simultaneamente. Insira fatores (entrada) e 2+ colunas de resposta (saída).',
  fat2k:  'Planejamento 2k: experimento fatorial com k fatores em 2 níveis (−1 e +1). Insira exatamente k colunas de entrada e uma ou mais de saída.',
  ccd:    'Composto central (CCD): planejamento de superfície de resposta. Combina pontos fatoriais, axiais e centrais. Insira fatores (entrada) e respostas (saída).',
};

const TYPE_LABEL = {
  anova1: 'ANOVA Univariado',
  anova2: 'ANOVA Multivariado (MANOVA)',
  fat2k:  'Planejamento Fatorial 2^k',
  ccd:    'Planejamento Composto Central (CCD)',
};

/* ── Inicialização ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindTypeCards();
  bindKButtons();
  bindUpload();
});

/* ════════════════════════════════════════════════════════════
   NAVEGAÇÃO ENTRE ETAPAS
   ════════════════════════════════════════════════════════════ */

function goTo(n) {
  if (n === 3 && !state.headers.length) return;

  if (n === 4) {
    const warn = validateVars();
    const warnEl = document.getElementById('var-warning');
    if (warn) {
      warnEl.style.display = '';
      document.getElementById('var-warn-text').textContent = warn;
      return;
    }
    warnEl.style.display = 'none';
    renderStep(4);
    runAnalysis();
    return;
  }

  renderStep(n);
  if (n === 3) buildColConfig();
}

function renderStep(n) {
  for (let i = 1; i <= 5; i++) {
    document.getElementById(`sec${i}`).classList.toggle('visible', i === n);

    const ind = document.getElementById(`step${i}-ind`);
    ind.classList.remove('active', 'done');
    const dot = ind.querySelector('.dot');

    if (i < n) {
      ind.classList.add('done');
      ind.removeAttribute('aria-current');
      dot.innerHTML = '<i class="ti ti-check" style="font-size:10px" aria-hidden="true"></i>';
    } else if (i === n) {
      ind.classList.add('active');
      ind.setAttribute('aria-current', 'step');
      dot.textContent = i;
    } else {
      ind.removeAttribute('aria-current');
      dot.textContent = i;
    }
  }
}

/* ════════════════════════════════════════════════════════════
   STEP 1 — TIPO DE EXPERIMENTO
   ════════════════════════════════════════════════════════════ */

function bindTypeCards() {
  document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click',   () => selectType(card));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectType(card); }
    });
  });
}

function selectType(card) {
  document.querySelectorAll('.type-card').forEach(c => {
    c.classList.remove('selected');
    c.setAttribute('aria-pressed', 'false');
  });
  card.classList.add('selected');
  card.setAttribute('aria-pressed', 'true');

  state.type = card.dataset.type;
  document.getElementById('type-info-text').textContent = TYPE_INFO[state.type];
  document.getElementById('k-field').style.display =
    (state.type === 'fat2k' || state.type === 'ccd') ? '' : 'none';
}

function bindKButtons() {
  document.querySelectorAll('.k-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.k-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.k = parseInt(btn.dataset.k, 10);
    });
  });
}

/* ════════════════════════════════════════════════════════════
   STEP 2 — UPLOAD DO CSV
   ════════════════════════════════════════════════════════════ */

function bindUpload() {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');

  input.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    state.csvText = ev.target.result;
    parseCSV(state.csvText);

    document.getElementById('file-name-text').textContent = file.name;
    document.getElementById('file-rows-text').textContent = `${state.rows.length} linhas`;
    document.getElementById('file-name-display').style.display = 'flex';
    document.getElementById('btn-to-3').disabled = false;
    renderPreview();
  };
  reader.readAsText(file);
}

/* ── CSV parsing ─────────────────────────────────────────── */
function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  state.headers = parseCSVLine(lines[0]);
  state.rows    = lines.slice(1).map(parseCSVLine);

  // padrão: tudo menos a última coluna → entrada; última → saída
  state.colRoles = {};
  state.headers.forEach((h, i) => {
    state.colRoles[h] = i < state.headers.length - 1 ? 'entrada' : 'saida';
  });
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"')              { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else                         { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function renderPreview() {
  const preview = state.rows.slice(0, 5);
  let html = '<table class="data-table"><thead><tr>';
  state.headers.forEach(h => { html += `<th>${esc(h)}</th>`; });
  html += '</tr></thead><tbody>';
  preview.forEach(row => {
    html += '<tr>';
    row.forEach(cell => { html += `<td>${esc(cell)}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';

  document.getElementById('preview-wrap').innerHTML = html;
  document.getElementById('preview-area').style.display = '';
}

/* ════════════════════════════════════════════════════════════
   STEP 3 — CLASSIFICAÇÃO DE VARIÁVEIS
   ════════════════════════════════════════════════════════════ */

function buildColConfig() {
  document.getElementById('col-config').innerHTML = state.headers.map(h => {
    const role = state.colRoles[h];
    return `
    <div class="col-row">
      <span class="col-name" title="${esc(h)}">${esc(h)}</span>
      <div class="col-role">
        <button class="role-btn ${role === 'entrada' ? 'entrada' : ''}"
          onclick="setRole('${escAttr(h)}','entrada')">Entrada</button>
        <button class="role-btn ${role === 'saida' ? 'saida' : ''}"
          onclick="setRole('${escAttr(h)}','saida')">Saída</button>
        <button class="role-btn ${role === 'ignorar' ? 'ignorar' : ''}"
          onclick="setRole('${escAttr(h)}','ignorar')">Ignorar</button>
      </div>
    </div>`;
  }).join('');
}

function setRole(col, role) {
  state.colRoles[col] = role;
  buildColConfig();
}

function validateVars() {
  const inputs  = activeInputs();
  const outputs = activeOutputs();

  if (!inputs.length)  return 'Defina pelo menos uma coluna de entrada (variável independente).';
  if (!outputs.length) return 'Defina pelo menos uma coluna de saída (variável dependente).';

  if (state.type === 'anova1' && outputs.length > 1)
    return 'ANOVA univariado aceita apenas uma variável de saída. Remova as extras ou use ANOVA multivariado.';

  if ((state.type === 'fat2k' || state.type === 'ccd') && inputs.length !== state.k)
    return `Para k=${state.k}, são necessárias exatamente ${state.k} colunas de entrada. Você definiu ${inputs.length}.`;

  return '';
}

function activeInputs()  { return state.headers.filter(h => state.colRoles[h] === 'entrada'); }
function activeOutputs() { return state.headers.filter(h => state.colRoles[h] === 'saida'); }

/* ════════════════════════════════════════════════════════════
   STEP 4 — ANÁLISE VIA API
   ════════════════════════════════════════════════════════════ */

function logProc(msg) {
  const log = document.getElementById('proc-log');
  log.textContent += msg + '\n';
  log.scrollTop = log.scrollHeight;
}

async function runAnalysis() {
  document.getElementById('proc-log').textContent = '';
  document.getElementById('proc-msg').textContent = 'Preparando dados...';
  document.getElementById('spinner').style.borderTopColor = '';
  document.getElementById('spinner').style.display = '';

  const inputs  = activeInputs();
  const outputs = activeOutputs();
  const label   = TYPE_LABEL[state.type]
    + (state.type === 'fat2k' ? ` com k=${state.k}` : '');

  logProc(`> Tipo: ${label}`);
  logProc(`> Entradas: ${inputs.join(', ')}`);
  logProc(`> Saídas: ${outputs.join(', ')}`);
  logProc(`> Linhas de dados: ${state.rows.length}`);
  logProc('> Chamando API de análise...');
  document.getElementById('proc-msg').textContent = 'Analisando com IA...';

  const csvSubset = buildSubsetCSV([...inputs, ...outputs]);
  const prompt    = buildPrompt(csvSubset, inputs, outputs, label);

  try {
    const resp = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      API_MODEL,
        max_tokens: 4000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`HTTP ${resp.status}: ${err?.error?.message || resp.statusText}`);
    }

    const data = await resp.json();
    logProc('> Resposta recebida. Processando...');

    let text = (data.content || []).map(i => i.text || '').join('');
    text = text.replace(/```json|```/g, '').trim();
    const first = text.indexOf('{');
    const last  = text.lastIndexOf('}');
    if (first === -1) throw new Error('JSON não encontrado na resposta da API.');
    text = text.slice(first, last + 1);

    state.result     = JSON.parse(text);
    state.reportText = buildReportText(state.result, label, inputs, outputs);

    logProc('> Análise concluída com sucesso!');
    document.getElementById('proc-msg').textContent = 'Concluído!';
    document.getElementById('spinner').style.borderTopColor = 'var(--success)';

    setTimeout(() => renderResults(state.result, label), 700);

  } catch (err) {
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('proc-msg').textContent  = 'Erro na análise.';
    logProc(`> ERRO: ${err.message}`);
    logProc('> Verifique o formato do CSV e tente novamente.');
    document.getElementById('proc-log').style.borderColor = 'var(--danger-border)';
  }
}

/* ── Monta CSV apenas com colunas ativas ─────────────────── */
function buildSubsetCSV(cols) {
  const idxMap = cols.map(c => state.headers.indexOf(c));
  const header = cols.join(',');
  const rows   = state.rows.map(r => idxMap.map(i => r[i] ?? '').join(','));
  return [header, ...rows].join('\n');
}

/* ── Prompt enviado à API ────────────────────────────────── */
function buildPrompt(csv, inputs, outputs, label) {
  return `Você é um estatístico especializado em planejamento de experimentos. Analise os dados abaixo usando ${label}.

Dados CSV:
${csv}

Variáveis de entrada (fatores): ${inputs.join(', ')}
Variáveis de saída (respostas): ${outputs.join(', ')}
Tipo de análise: ${label}
${state.type === 'fat2k' || state.type === 'ccd' ? `k = ${state.k}` : ''}

Faça a análise completa e retorne SOMENTE um objeto JSON válido com esta estrutura (sem markdown, sem texto fora do JSON):
{
  "resumo": "Texto em português com resumo executivo da análise (2-3 parágrafos)",
  "estatisticas_descritivas": {
    "por_variavel": [
      {"variavel":"nome","n":0,"media":0.0,"dp":0.0,"min":0.0,"max":0.0,"mediana":0.0,"cv":0.0}
    ]
  },
  "tabela_anova": [
    {"fonte":"nome","gl":0,"sq":0.0,"qm":0.0,"f":0.0,"p_valor":0.0,"significativo":true}
  ],
  "efeitos": [
    {"nome":"nome","estimativa":0.0,"erro_padrao":0.0,"t":0.0,"p_valor":0.0}
  ],
  "r2": 0.0,
  "r2_ajustado": 0.0,
  "conclusao": "Texto detalhado com conclusões, interpretações e recomendações em português",
  "dados_graficos": {
    "medias_por_grupo": [{"grupo":"nome","media":0.0,"ic_inf":0.0,"ic_sup":0.0}],
    "residuos": [0.0],
    "valores_ajustados": [0.0],
    "efeitos_principais": [{"fator":"nome","nivel_baixo":0.0,"nivel_alto":0.0}]
  }
}

Calcule todos os valores numericamente com base nos dados fornecidos. Use valores reais, não exemplos.`;
}

/* ════════════════════════════════════════════════════════════
   STEP 5 — RENDERIZAÇÃO DOS RESULTADOS
   ════════════════════════════════════════════════════════════ */

function renderResults(r, label) {
  renderStep(5);

  const r2pct  = r.r2          != null ? (r.r2 * 100).toFixed(1) + '%' : '—';
  const r2apct = r.r2_ajustado != null ? (r.r2_ajustado * 100).toFixed(1) + '%' : '—';

  document.getElementById('result-container').innerHTML = `
    <div class="result-section">
      <h3>
        <i class="ti ti-info-circle" aria-hidden="true"></i>
        Resumo — ${esc(label)}
        <span class="badge blue" style="margin-left:auto">R² = ${r2pct}</span>
        <span class="badge green" style="margin-left:4px">R² aj. = ${r2apct}</span>
      </h3>
      <div class="result-text">${esc(r.resumo || '—')}</div>
    </div>

    <div class="result-section">
      <h3><i class="ti ti-table" aria-hidden="true"></i> Estatísticas descritivas</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Variável</th><th>n</th><th>Média</th><th>DP</th>
            <th>Mín</th><th>Mediana</th><th>Máx</th><th>CV%</th>
          </tr></thead>
          <tbody id="desc-tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="result-section">
      <h3><i class="ti ti-math" aria-hidden="true"></i> Tabela ANOVA</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Fonte</th><th>GL</th><th>SQ</th><th>QM</th><th>F</th><th>p-valor</th><th>Sig.</th>
          </tr></thead>
          <tbody id="anova-tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="result-section">
      <h3><i class="ti ti-arrows-shuffle" aria-hidden="true"></i> Estimativas dos efeitos</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Efeito</th><th>Estimativa</th><th>Erro padrão</th><th>t</th><th>p-valor</th>
          </tr></thead>
          <tbody id="eff-tbody"></tbody>
        </table>
      </div>
    </div>

    <div class="result-section">
      <h3><i class="ti ti-chart-area" aria-hidden="true"></i> Gráficos</h3>
      <div class="charts-grid">
        <div class="chart-wrap">
          <div class="chart-title">Médias por grupo com IC 95%</div>
          <canvas id="ch-means"></canvas>
        </div>
        <div class="chart-wrap">
          <div class="chart-title">Efeitos principais</div>
          <canvas id="ch-effects"></canvas>
        </div>
        <div class="chart-wrap">
          <div class="chart-title">Resíduos vs. valores ajustados</div>
          <canvas id="ch-resid"></canvas>
        </div>
        <div class="chart-wrap">
          <div class="chart-title">Distribuição dos resíduos</div>
          <canvas id="ch-hist"></canvas>
        </div>
      </div>
    </div>

    <div class="result-section">
      <h3><i class="ti ti-notes" aria-hidden="true"></i> Conclusões e recomendações</h3>
      <div class="result-text">${esc(r.conclusao || '—')}</div>
    </div>
  `;

  fillDescTable(r);
  fillAnovaTable(r);
  fillEffectsTable(r);
  setTimeout(() => drawCharts(r), 80);
}

/* ── Preenchimento das tabelas ───────────────────────────── */
function fillDescTable(r) {
  const tbody = document.getElementById('desc-tbody');
  (r.estatisticas_descritivas?.por_variavel || []).forEach(v => {
    tbody.innerHTML += `<tr>
      <td>${esc(v.variavel)}</td>
      <td>${v.n}</td>
      <td>${fmt(v.media)}</td><td>${fmt(v.dp)}</td>
      <td>${fmt(v.min)}</td><td>${fmt(v.mediana)}</td>
      <td>${fmt(v.max)}</td><td>${fmt(v.cv)}%</td>
    </tr>`;
  });
}

function fillAnovaTable(r) {
  const tbody = document.getElementById('anova-tbody');
  (r.tabela_anova || []).forEach(row => {
    const sig = row.significativo;
    tbody.innerHTML += `<tr>
      <td><strong>${esc(row.fonte)}</strong></td>
      <td>${row.gl}</td>
      <td>${fmt(row.sq)}</td><td>${fmt(row.qm)}</td><td>${fmt(row.f)}</td>
      <td style="color:${sig ? 'var(--success-text)' : 'var(--text-muted)'}">
        ${row.p_valor?.toFixed(4) ?? '—'}
      </td>
      <td>
        ${sig
          ? '<span class="badge green">*</span>'
          : '<span style="color:var(--text-muted);font-size:12px">ns</span>'}
      </td>
    </tr>`;
  });
}

function fillEffectsTable(r) {
  const tbody = document.getElementById('eff-tbody');
  (r.efeitos || []).forEach(e => {
    const sig = e.p_valor < 0.05;
    tbody.innerHTML += `<tr>
      <td>${esc(e.nome)}</td>
      <td>${fmt(e.estimativa)}</td>
      <td>${fmt(e.erro_padrao)}</td>
      <td>${fmt(e.t)}</td>
      <td style="color:${sig ? 'var(--success-text)' : 'var(--text-muted)'}">
        ${e.p_valor?.toFixed(4) ?? '—'}
      </td>
    </tr>`;
  });
}

/* ── Gráficos (Chart.js) ─────────────────────────────────── */
const PALETTE = ['#378ADD', '#1D9E75', '#D85A30', '#D4537E', '#BA7517', '#7F77DD'];

function drawCharts(r) {
  const gd = r.dados_graficos || {};
  drawMeans(gd.medias_por_grupo    || []);
  drawEffects(gd.efeitos_principais || []);
  drawResid(gd.residuos || [], gd.valores_ajustados || []);
  drawHist(gd.residuos  || []);
}

function chartDefaults() {
  return {
    plugins: { legend: { labels: { color: getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#666' } } },
    scales: {
      x: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#888' } },
      y: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#888' } },
    },
  };
}

function drawMeans(means) {
  const el = document.getElementById('ch-means');
  if (!el || !means.length) return;
  new Chart(el, {
    type: 'bar',
    data: {
      labels:   means.map(m => m.grupo),
      datasets: [{
        label:           'Média',
        data:            means.map(m => m.media),
        backgroundColor: 'rgba(55,138,221,0.65)',
        borderColor:     'rgba(24,95,165,0.9)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales:  { y: { beginAtZero: false } },
    },
  });
}

function drawEffects(ef) {
  const el = document.getElementById('ch-effects');
  if (!el || !ef.length) return;
  new Chart(el, {
    type: 'line',
    data: {
      labels:   ['Nível −1', 'Nível +1'],
      datasets: ef.map((e, i) => ({
        label:           e.fator,
        data:            [e.nivel_baixo, e.nivel_alto],
        borderColor:     PALETTE[i % PALETTE.length],
        backgroundColor: 'transparent',
        tension:         0.1,
        pointRadius:     5,
      })),
    },
    options: { responsive: true, scales: { y: { beginAtZero: false } } },
  });
}

function drawResid(residuos, ajustados) {
  const el = document.getElementById('ch-resid');
  if (!el || !residuos.length || !ajustados.length) return;
  new Chart(el, {
    type: 'scatter',
    data: {
      datasets: [{
        label:           'Resíduos',
        data:            ajustados.map((f, i) => ({
          x: parseFloat(f),
          y: parseFloat(residuos[i] ?? 0),
        })),
        backgroundColor: 'rgba(55,138,221,0.55)',
        pointRadius:     5,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Valores ajustados' } },
        y: { title: { display: true, text: 'Resíduos' } },
      },
    },
  });
}

function drawHist(residuos) {
  const el = document.getElementById('ch-hist');
  if (!el || !residuos.length) return;

  const BINS = 8;
  const min  = Math.min(...residuos);
  const max  = Math.max(...residuos);
  const step = (max - min) / BINS || 1;
  const counts = new Array(BINS).fill(0);
  residuos.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / step), BINS - 1);
    counts[idx]++;
  });

  new Chart(el, {
    type: 'bar',
    data: {
      labels:   counts.map((_, i) => (min + i * step).toFixed(2)),
      datasets: [{
        label:           'Frequência',
        data:            counts,
        backgroundColor: 'rgba(29,158,117,0.6)',
        borderColor:     'rgba(15,110,86,0.9)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { title: { display: true, text: 'Resíduo' } },
        y: { title: { display: true, text: 'Frequência' }, ticks: { stepSize: 1 } },
      },
    },
  });
}

/* ════════════════════════════════════════════════════════════
   EXPORTAÇÃO DO RELATÓRIO
   ════════════════════════════════════════════════════════════ */

function buildReportText(r, label, inputs, outputs) {
  const SEP  = '='.repeat(52);
  const sep2 = '-'.repeat(32);
  const r2pct  = r.r2          != null ? (r.r2 * 100).toFixed(2) + '%' : '—';
  const r2apct = r.r2_ajustado != null ? (r.r2_ajustado * 100).toFixed(2) + '%' : '—';

  let t = `RELATÓRIO DE ANÁLISE ESTATÍSTICA\n${SEP}\n\n`;
  t += `Tipo de análise  : ${label}\n`;
  t += `Variáveis entrada: ${inputs.join(', ')}\n`;
  t += `Variáveis saída  : ${outputs.join(', ')}\n`;
  t += `Data             : ${new Date().toLocaleString('pt-BR')}\n\n`;

  t += `RESUMO EXECUTIVO\n${sep2}\n${r.resumo || '—'}\n\n`;
  t += `R² = ${r2pct}   R² ajustado = ${r2apct}\n\n`;

  t += `ESTATÍSTICAS DESCRITIVAS\n${sep2}\n`;
  (r.estatisticas_descritivas?.por_variavel || []).forEach(v => {
    t += `${v.variavel}: n=${v.n}, média=${fmt(v.media)}, DP=${fmt(v.dp)}, `;
    t += `mín=${fmt(v.min)}, mediana=${fmt(v.mediana)}, máx=${fmt(v.max)}, CV=${fmt(v.cv)}%\n`;
  });

  t += `\nTABELA ANOVA\n${sep2}\n`;
  (r.tabela_anova || []).forEach(row => {
    t += `${row.fonte}: GL=${row.gl}, SQ=${fmt(row.sq)}, QM=${fmt(row.qm)}, `;
    t += `F=${fmt(row.f)}, p=${row.p_valor?.toFixed(4)} ${row.significativo ? '(*)' : '(ns)'}\n`;
  });

  t += `\nESTIMATIVAS DOS EFEITOS\n${sep2}\n`;
  (r.efeitos || []).forEach(e => {
    t += `${e.nome}: Est=${fmt(e.estimativa)}, EP=${fmt(e.erro_padrao)}, `;
    t += `t=${fmt(e.t)}, p=${e.p_valor?.toFixed(4)}\n`;
  });

  t += `\nCONCLUSÕES E RECOMENDAÇÕES\n${sep2}\n${r.conclusao || '—'}\n`;
  return t;
}

function exportReport() {
  if (!state.reportText) { alert('Nenhum relatório disponível. Execute a análise primeiro.'); return; }
  const blob = new Blob([state.reportText], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `relatorio_experimento_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ════════════════════════════════════════════════════════════
   REINICIAR / FINALIZAR
   ════════════════════════════════════════════════════════════ */

function restart() {
  if (!confirm('Reiniciar apagará os dados e resultados atuais. Confirma?')) return;

  Object.assign(state, {
    type: 'anova1', k: 2,
    csvText: '', headers: [], rows: [], colRoles: {},
    result: null, reportText: '',
  });

  // reset tipo
  document.querySelectorAll('.type-card').forEach(c => {
    c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false');
  });
  document.querySelector('[data-type="anova1"]').classList.add('selected');
  document.querySelector('[data-type="anova1"]').setAttribute('aria-pressed', 'true');

  // reset k
  document.querySelectorAll('.k-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector('[data-k="2"]').classList.add('selected');

  // reset upload
  document.getElementById('file-name-display').style.display = 'none';
  document.getElementById('preview-area').style.display      = 'none';
  document.getElementById('btn-to-3').disabled               = true;
  document.getElementById('file-input').value                = '';

  // reset info
  document.getElementById('k-field').style.display      = 'none';
  document.getElementById('type-info-text').textContent  = TYPE_INFO.anova1;
  document.getElementById('var-warning').style.display   = 'none';
  document.getElementById('proc-log').style.borderColor  = '';

  renderStep(1);
}

function finish() {
  if (confirm('Deseja encerrar a análise? A página será recarregada.')) {
    window.location.reload();
  }
}

/* ════════════════════════════════════════════════════════════
   UTILITÁRIOS
   ════════════════════════════════════════════════════════════ */

/** Formata número para 3 casas decimais */
function fmt(v) {
  if (v == null || v === '') return '—';
  return parseFloat(v).toFixed(3);
}

/** Escapa HTML */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escapa aspas simples para uso em atributos onclick */
function escAttr(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

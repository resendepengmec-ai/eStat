/* ═══════════════════════════════════════════════════════════
   Análise Estatística de Experimentos — app.js
   ═══════════════════════════════════════════════════════════ */

'use strict';

const API_URL   = 'https://api.anthropic.com/v1/messages';
const API_MODEL = 'claude-sonnet-4-6';

/* ── Estado global ─────────────────────────────────────────── */
const state = {
  type:       'anova1',
  k:          2,
  inputMode:  'upload',   // 'upload' | 'manual'

  // dados compartilhados (CSV ou construído a partir da entrada manual)
  headers:    [],
  rows:       [],
  colRoles:   {},

  // definição manual de variáveis
  factors:    [],   // [{ id, name, unit }]
  responses:  [],   // [{ id, name, unit }]
  manualRows: [],   // array de arrays de strings (parallel a headers)

  result:     null,
  reportText: '',
};

let varIdCounter = 0;
const newId = () => ++varIdCounter;

/* ── Textos ────────────────────────────────────────────────── */
const TYPE_INFO = {
  anova1: 'ANOVA univariado: analisa se há diferença significativa entre as médias de grupos. Insira colunas de fator (entrada) e uma coluna de resposta (saída).',
  anova2: 'ANOVA multivariado (MANOVA): múltiplas variáveis de resposta analisadas simultaneamente. Insira fatores (entrada) e 2+ respostas (saída).',
  fat2k:  'Planejamento 2k: experimento fatorial com k fatores em 2 níveis (−1 e +1). Insira exatamente k colunas de entrada e uma ou mais de saída.',
  ccd:    'Composto central (CCD): planejamento de superfície de resposta. Combina pontos fatoriais, axiais e centrais. Insira fatores (entrada) e respostas (saída).',
};

const TYPE_LABEL = {
  anova1: 'ANOVA Univariado',
  anova2: 'ANOVA Multivariado (MANOVA)',
  fat2k:  'Planejamento Fatorial 2^k',
  ccd:    'Planejamento Composto Central (CCD)',
};

/* ── Boot ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  bindTypeCards();
  bindKButtons();
  bindUpload();
  initManualDefaults();
});

/* ════════════════════════════════════════════════════════════
   NAVEGAÇÃO
   ════════════════════════════════════════════════════════════ */

function goTo(n) {
  if (n === 2) { renderStep(2); return; }
  if (n === 3) {
    if (state.inputMode === 'manual') {
      const err = commitManualData();
      if (err) { showAlert(err); return; }
    }
    if (!state.headers.length) return;
    renderStep(3);
    buildColConfig();
    buildUnitsReview();
    return;
  }
  if (n === 4) {
    const warn = validateVars();
    const warnEl = document.getElementById('var-warning');
    if (warn) { warnEl.style.display = ''; document.getElementById('var-warn-text').textContent = warn; return; }
    warnEl.style.display = 'none';
    renderStep(4);
    runAnalysis();
    return;
  }
  renderStep(n);
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

function showAlert(msg) {
  const el = document.getElementById('var-warning');
  el.style.display = '';
  document.getElementById('var-warn-text').textContent = msg;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ════════════════════════════════════════════════════════════
   STEP 1 — TIPO
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
    c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false');
  });
  card.classList.add('selected');
  card.setAttribute('aria-pressed', 'true');
  state.type = card.dataset.type;
  document.getElementById('type-info-text').textContent = TYPE_INFO[state.type];
  document.getElementById('k-field').style.display =
    (state.type === 'fat2k' || state.type === 'ccd') ? '' : 'none';
  // atualiza sugestão de fatores no painel manual
  if (state.type === 'fat2k' || state.type === 'ccd') syncFactorsToK();
}

function bindKButtons() {
  document.querySelectorAll('.k-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.k-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.k = parseInt(btn.dataset.k, 10);
      syncFactorsToK();
    });
  });
}

// Ajusta número de fatores manuais quando k muda
function syncFactorsToK() {
  if (state.inputMode !== 'manual') return;
  if (state.type !== 'fat2k' && state.type !== 'ccd') return;
  while (state.factors.length < state.k) addFactor(true);
  while (state.factors.length > state.k) state.factors.pop();
  renderFactorsList();
  rebuildManualTableHeader();
}

/* ════════════════════════════════════════════════════════════
   STEP 2 — MODO DE ENTRADA
   ════════════════════════════════════════════════════════════ */

function switchMode(mode) {
  state.inputMode = mode;
  document.getElementById('tab-upload').classList.toggle('active', mode === 'upload');
  document.getElementById('tab-manual').classList.toggle('active', mode === 'manual');
  document.getElementById('panel-upload').style.display = mode === 'upload' ? '' : 'none';
  document.getElementById('panel-manual').style.display = mode === 'manual' ? '' : 'none';
  // recalcula btn-to-3
  refreshNextBtn();
}

function refreshNextBtn() {
  const ok = state.inputMode === 'upload'
    ? state.headers.length > 0
    : (state.factors.length > 0 && state.responses.length > 0);
  document.getElementById('btn-to-3').disabled = !ok;
}

/* ── Upload CSV ─────────────────────────────────────────── */

function bindUpload() {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');
  input.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag');
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
    refreshNextBtn();
    renderPreview();
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .trim().split('\n').map(l => l.trim()).filter(Boolean);
  state.headers = parseCSVLine(lines[0]);
  state.rows    = lines.slice(1).map(parseCSVLine);
  state.colRoles = {};
  state.headers.forEach((h, i) => {
    state.colRoles[h] = i < state.headers.length - 1 ? 'entrada' : 'saida';
  });
}

function parseCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"')              { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else                         { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function renderPreview() {
  let html = '<table class="data-table"><thead><tr>';
  state.headers.forEach(h => { html += `<th>${esc(h)}</th>`; });
  html += '</tr></thead><tbody>';
  state.rows.slice(0, 5).forEach(row => {
    html += '<tr>';
    row.forEach(cell => { html += `<td>${esc(cell)}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('preview-wrap').innerHTML = html;
  document.getElementById('preview-area').style.display = '';
}

/* ── Entrada manual ─────────────────────────────────────── */

function initManualDefaults() {
  // começa com 2 fatores e 1 resposta
  addFactor(true); addFactor(true);
  addResponse(true);
  renderFactorsList();
  renderResponsesList();
  rebuildManualTableHeader();
  // adiciona 5 linhas iniciais
  for (let i = 0; i < 5; i++) addDataRow(true);
  renderManualTable();
}

function addFactor(silent = false) {
  const id = newId();
  state.factors.push({ id, name: '', unit: '' });
  if (!silent) { renderFactorsList(); rebuildManualTableHeader(); refreshNextBtn(); }
}

function addResponse(silent = false) {
  const id = newId();
  state.responses.push({ id, name: '', unit: '' });
  if (!silent) { renderResponsesList(); rebuildManualTableHeader(); refreshNextBtn(); }
}

function removeFactor(id) {
  const idx = state.factors.findIndex(f => f.id === id);
  if (idx === -1) return;
  state.factors.splice(idx, 1);
  // remove essa coluna dos dados
  state.manualRows.forEach(row => row.splice(idx, 1));
  renderFactorsList(); rebuildManualTableHeader(); refreshNextBtn();
}

function removeResponse(id) {
  const idx = state.responses.findIndex(r => r.id === id);
  if (idx === -1) return;
  state.responses.splice(idx, 1);
  const col = state.factors.length + idx;
  state.manualRows.forEach(row => row.splice(col, 1));
  renderResponsesList(); rebuildManualTableHeader(); refreshNextBtn();
}

function renderFactorsList() {
  const el = document.getElementById('factors-list');
  if (!state.factors.length) {
    el.innerHTML = '<div class="empty-vars">Nenhum fator adicionado.</div>';
    return;
  }
  el.innerHTML = `
    <div class="var-row-labels">
      <span>Nome do fator</span><span>Unidade</span><span></span>
    </div>
    ${state.factors.map((f, i) => `
    <div class="var-row" id="frow-${f.id}">
      <input type="text" placeholder="ex: Temperatura" value="${esc(f.name)}"
        oninput="updateFactor(${f.id},'name',this.value)"
        aria-label="Nome do fator ${i+1}" />
      <input type="text" class="unit-input" placeholder="ex: °C" value="${esc(f.unit)}"
        oninput="updateFactor(${f.id},'unit',this.value)"
        aria-label="Unidade do fator ${i+1}" />
      <button class="var-row-delete" onclick="removeFactor(${f.id})" title="Remover fator">
        <i class="ti ti-x" aria-hidden="true"></i>
      </button>
    </div>`).join('')}`;
}

function renderResponsesList() {
  const el = document.getElementById('responses-list');
  if (!state.responses.length) {
    el.innerHTML = '<div class="empty-vars">Nenhuma resposta adicionada.</div>';
    return;
  }
  el.innerHTML = `
    <div class="var-row-labels">
      <span>Nome da resposta</span><span>Unidade</span><span></span>
    </div>
    ${state.responses.map((r, i) => `
    <div class="var-row" id="rrow-${r.id}">
      <input type="text" placeholder="ex: Resistência" value="${esc(r.name)}"
        oninput="updateResponse(${r.id},'name',this.value)"
        aria-label="Nome da resposta ${i+1}" />
      <input type="text" class="unit-input" placeholder="ex: MPa" value="${esc(r.unit)}"
        oninput="updateResponse(${r.id},'unit',this.value)"
        aria-label="Unidade da resposta ${i+1}" />
      <button class="var-row-delete" onclick="removeResponse(${r.id})" title="Remover resposta">
        <i class="ti ti-x" aria-hidden="true"></i>
      </button>
    </div>`).join('')}`;
}

function updateFactor(id, field, value) {
  const f = state.factors.find(x => x.id === id);
  if (f) { f[field] = value; }
  rebuildManualTableHeader();
  refreshNextBtn();
}

function updateResponse(id, field, value) {
  const r = state.responses.find(x => x.id === id);
  if (r) { r[field] = value; }
  rebuildManualTableHeader();
}

/* ── Tabela manual de dados ─────────────────────────────── */

function totalCols() { return state.factors.length + state.responses.length; }

function rebuildManualTableHeader() {
  const thead = document.getElementById('manual-thead');
  if (!thead) return;
  const cols = totalCols();
  if (cols === 0) {
    document.getElementById('manual-table-section').style.display = 'none';
    return;
  }
  document.getElementById('manual-table-section').style.display = '';

  let html = '<tr>';
  state.factors.forEach(f => {
    const name = f.name || 'Fator';
    const unit = f.unit ? ` (${f.unit})` : '';
    html += `<th class="col-entrada">${esc(name)}<span class="col-unit">${esc(unit)}</span></th>`;
  });
  state.responses.forEach(r => {
    const name = r.name || 'Resposta';
    const unit = r.unit ? ` (${r.unit})` : '';
    html += `<th class="col-saida">${esc(name)}<span class="col-unit">${esc(unit)}</span></th>`;
  });
  html += '</tr>';
  thead.innerHTML = html;

  // normaliza linhas existentes
  state.manualRows.forEach(row => {
    while (row.length < cols) row.push('');
    if (row.length > cols) row.splice(cols);
  });
  renderManualTable();
}

function renderManualTable() {
  const tbody = document.getElementById('manual-tbody');
  if (!tbody) return;
  const cols = totalCols();
  tbody.innerHTML = state.manualRows.map((row, ri) =>
    `<tr>${Array.from({ length: cols }, (_, ci) =>
      `<td><input type="text" value="${esc(row[ci] || '')}"
        oninput="setCellValue(${ri},${ci},this.value)"
        aria-label="Linha ${ri+1} coluna ${ci+1}" /></td>`
    ).join('')}</tr>`
  ).join('');
}

function setCellValue(ri, ci, value) {
  if (!state.manualRows[ri]) return;
  state.manualRows[ri][ci] = value;
}

function addDataRow(silent = false) {
  state.manualRows.push(Array(totalCols()).fill(''));
  if (!silent) renderManualTable();
}

function removeLastRow() {
  if (state.manualRows.length <= 1) return;
  state.manualRows.pop();
  renderManualTable();
}

/* ── Commit: manual → state.headers / state.rows ────────── */
function commitManualData() {
  // sincroniza valores digitados (lê do DOM para capturar última edição)
  const inputs = document.querySelectorAll('#manual-tbody input');
  const cols   = totalCols();
  inputs.forEach(inp => {
    const td = inp.closest('td');
    const tr = td?.closest('tr');
    const tbody = document.getElementById('manual-tbody');
    const ri = Array.from(tbody.children).indexOf(tr);
    const ci = Array.from(tr.children).indexOf(td);
    if (ri >= 0 && ci >= 0 && state.manualRows[ri]) state.manualRows[ri][ci] = inp.value;
  });

  if (state.factors.length === 0)   return 'Adicione pelo menos um fator de entrada.';
  if (state.responses.length === 0)  return 'Adicione pelo menos uma variável de resposta.';

  // valida nomes
  for (const f of state.factors) {
    if (!f.name.trim()) return 'Todos os fatores precisam de um nome.';
  }
  for (const r of state.responses) {
    if (!r.name.trim()) return 'Todas as variáveis de resposta precisam de um nome.';
  }

  // verifica se há dados
  const hasData = state.manualRows.some(row => row.some(c => c.trim() !== ''));
  if (!hasData) return 'Insira pelo menos uma linha de dados na tabela.';

  // constrói headers e rows
  state.headers = [
    ...state.factors.map(f => f.name.trim()),
    ...state.responses.map(r => r.name.trim()),
  ];

  state.rows = state.manualRows
    .filter(row => row.some(c => c.trim() !== ''))
    .map(row => state.headers.map((_, i) => row[i] || ''));

  state.colRoles = {};
  state.factors.forEach(f   => { state.colRoles[f.name.trim()]  = 'entrada'; });
  state.responses.forEach(r => { state.colRoles[r.name.trim()]  = 'saida'; });

  return ''; // sem erro
}

/* ════════════════════════════════════════════════════════════
   STEP 3 — VARIÁVEIS
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

function buildUnitsReview() {
  const panel = document.getElementById('units-review');
  if (state.inputMode !== 'manual') { panel.style.display = 'none'; return; }

  const grid = document.getElementById('units-grid');
  grid.innerHTML = [
    ...state.factors.map(f => ({
      name: f.name, unit: f.unit, role: 'entrada',
    })),
    ...state.responses.map(r => ({
      name: r.name, unit: r.unit, role: 'saida',
    })),
  ].map(v => `
    <span class="unit-pill ${v.role}">
      ${esc(v.name)}
      ${v.unit ? `<span class="pill-unit">${esc(v.unit)}</span>` : ''}
    </span>`).join('');

  panel.style.display = '';
}

function validateVars() {
  const inputs  = activeInputs();
  const outputs = activeOutputs();
  if (!inputs.length)  return 'Defina pelo menos uma coluna de entrada (variável independente).';
  if (!outputs.length) return 'Defina pelo menos uma coluna de saída (variável dependente).';
  if (state.type === 'anova1' && outputs.length > 1)
    return 'ANOVA univariado aceita apenas uma variável de saída. Remova as extras ou use ANOVA multivariado.';
  if (state.type === 'fat2k' || state.type === 'ccd') {
    const detectedK = inputs.length;
    if (detectedK < 2 || detectedK > 6)
      return `Planejamento ${state.type === 'fat2k' ? '2k' : 'CCD'} requer entre 2 e 6 fatores de entrada. Você definiu ${detectedK}.`;
    state.k = detectedK;
  }
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
    + ((state.type === 'fat2k' || state.type === 'ccd') ? ` (k=${state.k})` : '');

  logProc(`> Tipo: ${label}`);
  logProc(`> Entradas (${inputs.length}): ${inputs.join(', ')}`);
  logProc(`> Saídas (${outputs.length}): ${outputs.join(', ')}`);
  logProc(`> Linhas: ${state.rows.length}`);
  logProc(`> Modo: ${state.inputMode === 'manual' ? 'entrada manual' : 'CSV'}`);
  logProc('> Chamando API...');
  document.getElementById('proc-msg').textContent = 'Analisando com IA...';

  const csvSubset = buildSubsetCSV([...inputs, ...outputs]);
  const prompt    = buildPrompt(csvSubset, inputs, outputs, label);
  const maxTokens = (state.type === 'fat2k' && state.k >= 4) ? 6000 : 4000;

  try {
    const resp = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: API_MODEL, max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`HTTP ${resp.status}: ${err?.error?.message || resp.statusText}`);
    }

    const data = await resp.json();
    logProc('> Resposta recebida. Processando...');

    const raw    = (data.content || []).map(i => i.text || '').join('');
    const parsed = extractJSON(raw);
    if (!parsed) throw new Error('JSON inválido na resposta. Tente novamente.');

    state.result     = parsed;
    state.reportText = buildReportText(parsed, label, inputs, outputs);

    logProc('> Análise concluída!');
    document.getElementById('proc-msg').textContent = 'Concluído!';
    document.getElementById('spinner').style.borderTopColor = 'var(--success)';
    setTimeout(() => renderResults(parsed, label), 700);

  } catch (err) {
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('proc-msg').textContent  = 'Erro na análise.';
    logProc(`> ERRO: ${err.message}`);
    logProc('> Sugestões:');
    logProc('  - Verifique nomes/unidades sem caracteres especiais');
    logProc('  - Confirme que os dados são numéricos');
    logProc('  - Tente novamente (instabilidade de rede)');
    document.getElementById('proc-log').style.borderColor = 'var(--danger-border)';
  }
}

function buildSubsetCSV(cols) {
  const idxMap = cols.map(c => state.headers.indexOf(c));
  const rows   = state.rows.map(r => idxMap.map(i => r[i] ?? '').join(','));
  return [cols.join(','), ...rows].join('\n');
}

// Monta metadados de unidades para enriquecer o prompt
function buildUnitsContext() {
  if (state.inputMode !== 'manual') return '';
  const parts = [
    ...state.factors.map(f   => f.unit ? `${f.name}: ${f.unit}` : null),
    ...state.responses.map(r => r.unit ? `${r.name}: ${r.unit}` : null),
  ].filter(Boolean);
  return parts.length ? `\nUnidades das variáveis:\n${parts.map(p => `  - ${p}`).join('\n')}` : '';
}

function buildPrompt(csv, inputs, outputs, label) {
  const typeGuide = {
    anova1: `Realize ANOVA de um fator. Calcule SQ entre grupos, SQ dentro grupos, GL, QM, F e p-valor.
Inclua comparação de médias (Tukey ou LSD) se houver diferença significativa.`,
    anova2: `Realize MANOVA. Calcule estatísticas multivariadas (Wilks' Lambda ou Pillai's Trace).
Inclua ANOVAs univariadas separadas para cada variável resposta como análise complementar.`,
    fat2k: `Realize análise fatorial 2^k completo com k=${state.k} fatores.
Calcule efeitos principais e TODAS as interações (até ordem ${state.k}).
Use contraste de Yates. Calcule SQ de cada efeito = n * efeito² / 4 (ou n * efeito² sem réplicas).
Inclua na ANOVA: efeitos principais, interações e Erro (se réplicas).`,
    ccd: `Realize análise de superfície de resposta (RSM) para CCD com k=${state.k} fatores.
Ajuste modelo quadrático completo: y = b0 + Σbi*xi + Σbii*xi² + Σbij*xi*xj.
Verifique Lack of Fit vs Erro puro. Identifique o ponto ótimo.`,
  }[state.type] || '';

  return `Você é um estatístico especializado em planejamento de experimentos (DOE).

DADOS CSV:
${csv}
${buildUnitsContext()}

CONFIGURAÇÃO:
- Tipo: ${label}
- Entradas (fatores): ${inputs.join(', ')}
- Saídas (respostas): ${outputs.join(', ')}
- Observações: ${state.rows.length}

INSTRUÇÕES ESPECÍFICAS:
${typeGuide}

Retorne SOMENTE o JSON abaixo, sem texto antes ou depois, sem markdown:
{
  "resumo": "Resumo executivo em português (2-3 parágrafos) incluindo nomes e unidades das variáveis",
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
  "conclusao": "Conclusões detalhadas com interpretação das variáveis e unidades, e recomendações práticas",
  "dados_graficos": {
    "medias_por_grupo": [{"grupo":"nome","media":0.0,"ic_inf":0.0,"ic_sup":0.0}],
    "residuos": [0.0],
    "valores_ajustados": [0.0],
    "efeitos_principais": [{"fator":"nome","nivel_baixo":0.0,"nivel_alto":0.0}]
  }
}`;
}

function extractJSON(raw) {
  let text = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(text); } catch (_) {}
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { start = -1; }
      }
    }
  }
  return null;
}

/* ════════════════════════════════════════════════════════════
   STEP 5 — RESULTADOS
   ════════════════════════════════════════════════════════════ */

function renderResults(r, label) {
  renderStep(5);
  const r2pct  = r.r2          != null ? (r.r2 * 100).toFixed(1) + '%' : '—';
  const r2apct = r.r2_ajustado != null ? (r.r2_ajustado * 100).toFixed(1) + '%' : '—';

  // monta badge de unidades (só entrada manual)
  const unitsBadge = buildUnitsBadgeHTML();

  document.getElementById('result-container').innerHTML = `
    <div class="result-section">
      <h3>
        <i class="ti ti-info-circle" aria-hidden="true"></i>
        Resumo — ${esc(label)}
        <span class="badge blue" style="margin-left:auto">R² = ${r2pct}</span>
        <span class="badge green" style="margin-left:4px">R² aj. = ${r2apct}</span>
      </h3>
      ${unitsBadge}
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
            <th>Fonte de variação</th><th>GL</th><th>SQ</th><th>QM</th><th>F</th><th>p-valor</th><th>Sig.</th>
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
        <div class="chart-wrap"><div class="chart-title">Médias por grupo / tratamento</div><canvas id="ch-means"></canvas></div>
        <div class="chart-wrap"><div class="chart-title">Efeitos principais</div><canvas id="ch-effects"></canvas></div>
        <div class="chart-wrap"><div class="chart-title">Resíduos vs. valores ajustados</div><canvas id="ch-resid"></canvas></div>
        <div class="chart-wrap"><div class="chart-title">Distribuição dos resíduos</div><canvas id="ch-hist"></canvas></div>
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

function buildUnitsBadgeHTML() {
  if (state.inputMode !== 'manual') return '';
  const pills = [
    ...state.factors.map(f   => `<span class="unit-pill entrada">${esc(f.name)}${f.unit ? ` <span class="pill-unit">${esc(f.unit)}</span>` : ''}</span>`),
    ...state.responses.map(r => `<span class="unit-pill saida">${esc(r.name)}${r.unit ? ` <span class="pill-unit">${esc(r.unit)}</span>` : ''}</span>`),
  ].join('');
  return `<div class="units-grid" style="margin-bottom:10px">${pills}</div>`;
}

function fillDescTable(r) {
  const tbody = document.getElementById('desc-tbody');
  (r.estatisticas_descritivas?.por_variavel || []).forEach(v => {
    // busca unidade se entrada manual
    const unitStr = getUnit(v.variavel);
    tbody.innerHTML += `<tr>
      <td>${esc(v.variavel)}${unitStr ? `<span style="color:var(--text-muted);font-size:11px;margin-left:4px">${esc(unitStr)}</span>` : ''}</td>
      <td>${v.n}</td><td>${fmt(v.media)}</td><td>${fmt(v.dp)}</td>
      <td>${fmt(v.min)}</td><td>${fmt(v.mediana)}</td><td>${fmt(v.max)}</td><td>${fmt(v.cv)}%</td>
    </tr>`;
  });
}

function fillAnovaTable(r) {
  const tbody = document.getElementById('anova-tbody');
  (r.tabela_anova || []).forEach(row => {
    const sig = row.significativo;
    tbody.innerHTML += `<tr>
      <td><strong>${esc(row.fonte)}</strong></td>
      <td>${row.gl}</td><td>${fmt(row.sq)}</td><td>${fmt(row.qm)}</td><td>${fmt(row.f)}</td>
      <td style="color:${sig?'var(--success-text)':'var(--text-muted)'}">${row.p_valor!=null?row.p_valor.toFixed(4):'—'}</td>
      <td>${sig?'<span class="badge green">*</span>':'<span style="color:var(--text-muted);font-size:12px">ns</span>'}</td>
    </tr>`;
  });
}

function fillEffectsTable(r) {
  const tbody = document.getElementById('eff-tbody');
  (r.efeitos || []).forEach(e => {
    const sig = e.p_valor != null && e.p_valor < 0.05;
    tbody.innerHTML += `<tr>
      <td>${esc(e.nome)}</td><td>${fmt(e.estimativa)}</td>
      <td>${fmt(e.erro_padrao)}</td><td>${fmt(e.t)}</td>
      <td style="color:${sig?'var(--success-text)':'var(--text-muted)'}">${e.p_valor!=null?e.p_valor.toFixed(4):'—'}</td>
    </tr>`;
  });
}

function getUnit(varName) {
  if (state.inputMode !== 'manual') return '';
  const f = state.factors.find(x => x.name === varName);
  if (f && f.unit) return `(${f.unit})`;
  const r = state.responses.find(x => x.name === varName);
  if (r && r.unit) return `(${r.unit})`;
  return '';
}

/* ── Gráficos ─────────────────────────────────────────────── */
const PALETTE = ['#378ADD','#1D9E75','#D85A30','#D4537E','#BA7517','#7F77DD'];

function drawCharts(r) {
  const gd = r.dados_graficos || {};
  drawMeans(gd.medias_por_grupo    || []);
  drawEffects(gd.efeitos_principais || []);
  drawResid(gd.residuos || [], gd.valores_ajustados || []);
  drawHist(gd.residuos  || []);
}

function drawMeans(means) {
  const el = document.getElementById('ch-means');
  if (!el || !means.length) return;
  new Chart(el, {
    type: 'bar',
    data: {
      labels: means.map(m => m.grupo),
      datasets: [{ label:'Média', data: means.map(m=>m.media),
        backgroundColor:'rgba(55,138,221,0.65)', borderColor:'rgba(24,95,165,0.9)', borderWidth:1 }],
    },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:false}} },
  });
}

function drawEffects(ef) {
  const el = document.getElementById('ch-effects');
  if (!el || !ef.length) return;
  new Chart(el, {
    type:'line',
    data: {
      labels:['Nível −1','Nível +1'],
      datasets: ef.map((e,i) => ({
        label:e.fator, data:[e.nivel_baixo,e.nivel_alto],
        borderColor:PALETTE[i%PALETTE.length], backgroundColor:'transparent',
        tension:0.1, pointRadius:5,
      })),
    },
    options:{ responsive:true, scales:{y:{beginAtZero:false}} },
  });
}

function drawResid(residuos, ajustados) {
  const el = document.getElementById('ch-resid');
  if (!el || !residuos.length || !ajustados.length) return;
  new Chart(el, {
    type:'scatter',
    data:{ datasets:[{ label:'Resíduos',
      data: ajustados.map((f,i)=>({ x:parseFloat(f), y:parseFloat(residuos[i]??0) })),
      backgroundColor:'rgba(55,138,221,0.55)', pointRadius:5 }] },
    options:{ responsive:true, plugins:{legend:{display:false}},
      scales:{ x:{title:{display:true,text:'Valores ajustados'}}, y:{title:{display:true,text:'Resíduos'}} } },
  });
}

function drawHist(residuos) {
  const el = document.getElementById('ch-hist');
  if (!el || !residuos.length) return;
  const BINS=8, min=Math.min(...residuos), max=Math.max(...residuos);
  const step=(max-min)/BINS||1;
  const counts=new Array(BINS).fill(0);
  residuos.forEach(v=>{ counts[Math.min(Math.floor((v-min)/step),BINS-1)]++; });
  new Chart(el, {
    type:'bar',
    data:{ labels:counts.map((_,i)=>(min+i*step).toFixed(2)),
      datasets:[{ label:'Freq.', data:counts,
        backgroundColor:'rgba(29,158,117,0.6)', borderColor:'rgba(15,110,86,0.9)', borderWidth:1 }] },
    options:{ responsive:true, plugins:{legend:{display:false}},
      scales:{ x:{title:{display:true,text:'Resíduo'}}, y:{title:{display:true,text:'Frequência'},ticks:{stepSize:1}} } },
  });
}

/* ════════════════════════════════════════════════════════════
   EXPORTAÇÃO
   ════════════════════════════════════════════════════════════ */

function buildReportText(r, label, inputs, outputs) {
  const SEP='='.repeat(52), sep2='-'.repeat(32);
  const r2pct  = r.r2          != null ? (r.r2*100).toFixed(2)+'%' : '—';
  const r2apct = r.r2_ajustado != null ? (r.r2_ajustado*100).toFixed(2)+'%' : '—';

  let t = `RELATÓRIO DE ANÁLISE ESTATÍSTICA\n${SEP}\n\n`;
  t += `Tipo           : ${label}\n`;
  t += `Modo de entrada: ${state.inputMode === 'manual' ? 'entrada manual' : 'arquivo CSV'}\n`;

  if (state.inputMode === 'manual') {
    t += `\nFATORES DE ENTRADA\n${sep2}\n`;
    state.factors.forEach(f => { t += `  ${f.name}${f.unit ? ` [${f.unit}]` : ''}\n`; });
    t += `\nVARIÁVEIS DE RESPOSTA\n${sep2}\n`;
    state.responses.forEach(r2 => { t += `  ${r2.name}${r2.unit ? ` [${r2.unit}]` : ''}\n`; });
    t += '\n';
  }

  t += `Entradas       : ${inputs.join(', ')}\n`;
  t += `Saídas         : ${outputs.join(', ')}\n`;
  t += `Data           : ${new Date().toLocaleString('pt-BR')}\n\n`;
  t += `RESUMO EXECUTIVO\n${sep2}\n${r.resumo||'—'}\n\n`;
  t += `R² = ${r2pct}   R² ajustado = ${r2apct}\n\n`;

  t += `ESTATÍSTICAS DESCRITIVAS\n${sep2}\n`;
  (r.estatisticas_descritivas?.por_variavel||[]).forEach(v=>{
    const u = getUnit(v.variavel);
    t += `${v.variavel}${u?' '+u:''}: n=${v.n}, média=${fmt(v.media)}, DP=${fmt(v.dp)}, `;
    t += `mín=${fmt(v.min)}, mediana=${fmt(v.mediana)}, máx=${fmt(v.max)}, CV=${fmt(v.cv)}%\n`;
  });

  t += `\nTABELA ANOVA\n${sep2}\n`;
  (r.tabela_anova||[]).forEach(row=>{
    t += `${row.fonte}: GL=${row.gl}, SQ=${fmt(row.sq)}, QM=${fmt(row.qm)}, `;
    t += `F=${fmt(row.f)}, p=${row.p_valor?.toFixed(4)} ${row.significativo?'(*)':'(ns)'}\n`;
  });

  t += `\nESTIMATIVAS DOS EFEITOS\n${sep2}\n`;
  (r.efeitos||[]).forEach(e=>{
    t += `${e.nome}: Est=${fmt(e.estimativa)}, EP=${fmt(e.erro_padrao)}, `;
    t += `t=${fmt(e.t)}, p=${e.p_valor?.toFixed(4)}\n`;
  });

  t += `\nCONCLUSÕES E RECOMENDAÇÕES\n${sep2}\n${r.conclusao||'—'}\n`;
  return t;
}

function exportReport() {
  if (!state.reportText) { alert('Nenhum relatório disponível.'); return; }
  const blob = new Blob([state.reportText], { type:'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `relatorio_experimento_${Date.now()}.txt`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ════════════════════════════════════════════════════════════
   REINICIAR / FINALIZAR
   ════════════════════════════════════════════════════════════ */

function restart() {
  if (!confirm('Reiniciar apagará os dados e resultados atuais. Confirma?')) return;

  Object.assign(state, {
    type:'anova1', k:2, inputMode:'upload',
    headers:[], rows:[], colRoles:{},
    factors:[], responses:[], manualRows:[],
    result:null, reportText:'',
  });
  varIdCounter = 0;

  document.querySelectorAll('.type-card').forEach(c=>{
    c.classList.remove('selected'); c.setAttribute('aria-pressed','false');
  });
  document.querySelector('[data-type="anova1"]').classList.add('selected');
  document.querySelector('[data-type="anova1"]').setAttribute('aria-pressed','true');

  document.querySelectorAll('.k-btn').forEach(b=>b.classList.remove('selected'));
  document.querySelector('[data-k="2"]').classList.add('selected');

  document.getElementById('file-name-display').style.display = 'none';
  document.getElementById('preview-area').style.display      = 'none';
  document.getElementById('btn-to-3').disabled               = true;
  document.getElementById('file-input').value                = '';
  document.getElementById('k-field').style.display           = 'none';
  document.getElementById('type-info-text').textContent      = TYPE_INFO.anova1;
  document.getElementById('var-warning').style.display       = 'none';
  document.getElementById('proc-log').style.borderColor      = '';

  switchMode('upload');
  initManualDefaults();
  renderStep(1);
}

function finish() {
  if (confirm('Deseja encerrar a análise? A página será recarregada.')) window.location.reload();
}

/* ════════════════════════════════════════════════════════════
   UTILITÁRIOS
   ════════════════════════════════════════════════════════════ */

function fmt(v) {
  if (v == null || v === '') return '—';
  return parseFloat(v).toFixed(3);
}

function esc(s) {
  return String(s??'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

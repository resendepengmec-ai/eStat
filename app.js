/* ═══════════════════════════════════════════════════════════
   Análise Estatística de Experimentos — app.js
   ═══════════════════════════════════════════════════════════ */
'use strict';

// Detecta ambiente automaticamente:
//   - localhost / 127.0.0.1  → proxy local (node proxy.js)
//   - qualquer outro host     → server.js na nuvem (mesma origem)
const API_URL = (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1'
) ? 'http://localhost:3001/api/analyze'
  : '/api/analyze';   // mesma origem em produção (Cloud Run, Render etc.)

const API_MODEL = 'claude-sonnet-4-6';

/* ── Estado global ─────────────────────────────────────────── */
const state = {
  type:      'anova1',
  k:         2,
  inputMode: 'upload',
  headers:   [],
  rows:      [],
  colRoles:  {},

  // sub-estados por tipo (manual)
  a1: { respName:'', respUnit:'', groups:[], replicas:3 },
  a2: { groups:[], responses:[], replicas:3 },
  fat2k: { factors:[], responses:[], replicas:1 },
  ccd:   { factors:[], responses:[], centerPts:3 },

  result:     null,
  reportText: '',
};

let _uid = 0;
const uid = () => ++_uid;

/* ── Textos ────────────────────────────────────────────────── */
const TYPE_INFO = {
  anova1: 'ANOVA univariado: compara médias de grupos. Informe a resposta, os tratamentos, réplicas e preencha os dados.',
  anova2: 'ANOVA multivariado (MANOVA): múltiplas respostas. Informe grupos, variáveis de resposta, réplicas e dados.',
  fat2k:  'Planejamento 2k: k fatores em 2 níveis. Informe os fatores com seus níveis — a tabela de Yates é gerada automaticamente.',
  ccd:    'Composto central: superfície de resposta com pontos fatoriais, axiais e centrais.',
};
const TYPE_LABEL = {
  anova1:'ANOVA Univariado', anova2:'ANOVA Multivariado (MANOVA)',
  fat2k:'Planejamento Fatorial 2^k', ccd:'Planejamento Composto Central (CCD)',
};

/* ════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  bindTypeCards();
  bindKButtons();
  bindUpload();
  initDefaults();
});

function initDefaults() {
  // ANOVA1 defaults
  state.a1.groups = [
    {id:uid(),name:'Grupo A',unit:''},
    {id:uid(),name:'Grupo B',unit:''},
    {id:uid(),name:'Grupo C',unit:''},
  ];
  // ANOVA2 defaults
  state.a2.groups    = [{id:uid(),name:'Grupo A'},{id:uid(),name:'Grupo B'}];
  state.a2.responses = [{id:uid(),name:'Resposta 1',unit:''},{id:uid(),name:'Resposta 2',unit:''}];
  // 2k defaults (k=2)
  state.fat2k.factors   = [{id:uid(),name:'',unit:'',lo:'',hi:''},{id:uid(),name:'',unit:'',lo:'',hi:''}];
  state.fat2k.responses = [{id:uid(),name:'',unit:''}];
  // CCD defaults (k=2)
  state.ccd.factors   = [{id:uid(),name:'',unit:'',lo:'',hi:''},{id:uid(),name:'',unit:'',lo:'',hi:''}];
  state.ccd.responses = [{id:uid(),name:'',unit:''}];
}

/* ── Wrappers para mudança de réplicas (atualizam state antes de rebuild) ── */
function a1OnReplicaChange(val) {
  state.a1.replicas = Math.max(1, parseInt(val,10)||1);
  a1RebuildTable();
}
function a2OnReplicaChange(val) {
  state.a2.replicas = Math.max(1, parseInt(val,10)||1);
  a2RebuildTable();
}
function fat2kOnReplicaChange(val) {
  fat2kSyncFromDOM();
  state.fat2k.replicas = Math.max(1, parseInt(val,10)||1);
  fat2kRebuildTable();
}
function ccdOnCenterPtsChange(val) {
  ccdSyncFromDOM();
  state.ccd.centerPts = Math.max(1, parseInt(val,10)||1);
  ccdRebuildTable();
}

/* ════════════════════════════════════════════════════════════
   STEP 1 — TIPO
   ════════════════════════════════════════════════════════════ */
function bindTypeCards() {
  document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => selectType(card));
    card.addEventListener('keydown', e => {
      if (e.key==='Enter'||e.key===' ') { e.preventDefault(); selectType(card); }
    });
  });
}

function selectType(card) {
  document.querySelectorAll('.type-card').forEach(c => {
    c.classList.remove('selected'); c.setAttribute('aria-pressed','false');
  });
  card.classList.add('selected'); card.setAttribute('aria-pressed','true');
  state.type = card.dataset.type;
  document.getElementById('type-info-text').textContent = TYPE_INFO[state.type];
  // atualiza link "Saiba mais"
  const helpLink = document.getElementById('help-link');
  if (helpLink) helpLink.href = `help.html?page=${state.type}`;
  const isFactorial = state.type==='fat2k'||state.type==='ccd';
  document.getElementById('k-field').style.display = isFactorial ? '' : 'none';
  // atualiza painel manual se já estiver nele
  if (state.inputMode==='manual') renderManualPanel();
}

function bindKButtons() {
  document.querySelectorAll('.k-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.k-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.k = parseInt(btn.dataset.k,10);
      syncKFactors();
      if (state.inputMode==='manual') renderManualPanel();
    });
  });
}

// Sincroniza número de fatores em fat2k e ccd quando k muda
function syncKFactors() {
  ['fat2k','ccd'].forEach(t => {
    while (state[t].factors.length < state.k)
      state[t].factors.push({id:uid(),name:'',unit:'',lo:'',hi:''});
    if (state[t].factors.length > state.k)
      state[t].factors = state[t].factors.slice(0,state.k);
  });
}

/* ════════════════════════════════════════════════════════════
   STEP 2 — MODO
   ════════════════════════════════════════════════════════════ */
function switchMode(mode) {
  state.inputMode = mode;
  document.getElementById('tab-upload').classList.toggle('active', mode==='upload');
  document.getElementById('tab-manual').classList.toggle('active', mode==='manual');
  document.getElementById('panel-upload').style.display = mode==='upload' ? '' : 'none';
  document.getElementById('panel-manual').style.display = mode==='manual' ? '' : 'none';
  document.getElementById('btn-to-3').disabled = mode==='manual' ? false : state.headers.length===0;
  if (mode==='manual') renderManualPanel();
}

/* ════════════════════════════════════════════════════════════
   UPLOAD CSV
   ════════════════════════════════════════════════════════════ */
function bindUpload() {
  const zone=document.getElementById('upload-zone');
  const input=document.getElementById('file-input');
  input.addEventListener('change', e => { if(e.target.files[0]) handleFile(e.target.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag');
    if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    parseCSV(ev.target.result);
    document.getElementById('file-name-text').textContent = file.name;
    document.getElementById('file-rows-text').textContent = state.rows.length+' linhas';
    document.getElementById('file-name-display').style.display = 'flex';
    document.getElementById('btn-to-3').disabled = false;
    renderPreview();
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .trim().split('\n').map(l=>l.trim()).filter(Boolean);
  state.headers = parseCSVLine(lines[0]);
  state.rows    = lines.slice(1).map(parseCSVLine);
  state.colRoles = {};
  state.headers.forEach((h,i) => { state.colRoles[h] = i<state.headers.length-1?'entrada':'saida'; });
}

function parseCSVLine(line) {
  const r=[]; let c='',q=false;
  for(const ch of line) {
    if(ch==='"') q=!q;
    else if(ch===','&&!q) { r.push(c.trim()); c=''; }
    else c+=ch;
  }
  r.push(c.trim()); return r;
}

function renderPreview() {
  let h='<table class="data-table"><thead><tr>';
  state.headers.forEach(col => { h+=`<th>${esc(col)}</th>`; });
  h+='</tr></thead><tbody>';
  state.rows.slice(0,5).forEach(row => {
    h+='<tr>'+row.map(c=>`<td>${esc(c)}</td>`).join('')+'</tr>';
  });
  h+='</tbody></table>';
  document.getElementById('preview-wrap').innerHTML = h;
  document.getElementById('preview-area').style.display = '';
}

/* ════════════════════════════════════════════════════════════
   RENDERIZAÇÃO DO PAINEL MANUAL (por tipo)
   ════════════════════════════════════════════════════════════ */
function renderManualPanel() {
  // mostra só o sub-painel do tipo atual
  ['anova1','anova2','fat2k','ccd'].forEach(t => {
    document.getElementById('manual-'+t).style.display = t===state.type ? '' : 'none';
  });
  syncKFactors();
  if (state.type==='anova1')  renderA1();
  if (state.type==='anova2')  renderA2();
  if (state.type==='fat2k') renderFat2k();
  if (state.type==='ccd')   renderCcd();
}

/* ─────────────────────────────────────────────────────────
   ANOVA1 manual
   ───────────────────────────────────────────────────────── */
function renderA1() {
  // campo resposta já está fixo no HTML
  renderA1Groups();
  a1RebuildTable();
}

function a1AddGroup() {
  a1SyncFromDOM();  // salva nomes já digitados antes de adicionar novo
  state.a1.groups.push({id:uid(),name:'',unit:''});
  renderA1Groups(); a1RebuildTable();
}

function a1RemoveGroup(id) {
  a1SyncFromDOM();  // salva nomes antes de remover
  state.a1.groups = state.a1.groups.filter(g=>g.id!==id);
  renderA1Groups(); a1RebuildTable();
}

function renderA1Groups() {
  const el = document.getElementById('a1-groups-list');
  if (!state.a1.groups.length) {
    el.innerHTML='<div class="empty-vars">Nenhum grupo adicionado.</div>'; return;
  }
  el.innerHTML = `
    <div class="var-row-labels">
      <span>Nome do grupo / tratamento</span><span>Nível / descrição</span><span></span>
    </div>
    ${state.a1.groups.map((g,i)=>`
    <div class="group-row" data-id="${g.id}">
      <input type="text" placeholder="ex: Tratamento A" value="${esc(g.name)}"
        aria-label="Nome do grupo ${i+1}" />
      <input type="text" placeholder="ex: 0 mg/L" value="${esc(g.unit||'')}"
        aria-label="Nível do grupo ${i+1}" />
      <button class="var-row-delete" onclick="a1RemoveGroup(${g.id})">
        <i class="ti ti-x"></i>
      </button>
    </div>`).join('')}`;
  document.getElementById('a1-replica-block').style.display =
    state.a1.groups.length>0 ? '' : 'none';
}

function a1SyncFromDOM() {
  document.querySelectorAll('#a1-groups-list .group-row').forEach(row => {
    const g = state.a1.groups.find(x=>x.id===parseInt(row.dataset.id,10));
    if (!g) return;
    const ins = row.querySelectorAll('input');
    if(ins[0]) g.name = ins[0].value;
    if(ins[1]) g.unit = ins[1].value;
  });
  const nameEl = document.getElementById('a1-resp-name');
  const unitEl = document.getElementById('a1-resp-unit');
  const repEl  = document.getElementById('a1-replicas');
  if(nameEl) state.a1.respName = nameEl.value;
  if(unitEl) state.a1.respUnit = unitEl.value;
  if(repEl)  state.a1.replicas = parseInt(repEl.value||'3',10);
}

function a1RebuildTable() {
  // NÃO sincroniza do DOM aqui — só lê o state (evita apagar dados na inicialização)
  const thead = document.getElementById('a1-thead');
  const tbody = document.getElementById('a1-tbody');
  if (!thead||!tbody) return;
  const reps   = Math.max(1, state.a1.replicas||3);
  const groups = state.a1.groups;
  if (!groups.length) return;

  // cabeçalho: Grupo | R1 | R2 | ...
  let hdr = '<tr><th>Grupo / tratamento</th>';
  for(let r=1;r<=reps;r++) hdr+=`<th class="col-resp">Réplica ${r}</th>`;
  hdr+='</tr>';
  thead.innerHTML = hdr;

  // corpo: uma linha por grupo, lê valores existentes
  const existData = readA1Data();
  let body='';
  groups.forEach((g,gi) => {
    const label = g.name||`Grupo ${gi+1}`;
    body += `<tr><td class="cell-fixed" style="text-align:left;padding-left:10px">${esc(label)}</td>`;
    for(let r=0;r<reps;r++) {
      const val = existData[gi]?.[r]??'';
      body+=`<td class="cell-resp"><input type="text" value="${esc(val)}"
        aria-label="${esc(label)} réplica ${r+1}" /></td>`;
    }
    body+='</tr>';
  });
  tbody.innerHTML = body;
}

function readA1Data() {
  const tbody = document.getElementById('a1-tbody');
  if (!tbody) return [];
  return Array.from(tbody.rows).map(tr =>
    Array.from(tr.querySelectorAll('td.cell-resp input')).map(i=>i.value)
  );
}

function commitA1() {
  a1SyncFromDOM();
  if (!state.a1.respName.trim()) return 'Informe o nome da variável de resposta.';
  if (!state.a1.groups.length)   return 'Adicione pelo menos dois grupos/tratamentos.';
  if (state.a1.groups.length<2)  return 'Adicione pelo menos dois grupos para comparação.';
  for (const g of state.a1.groups) {
    if (!g.name.trim()) return 'Preencha o nome de todos os grupos.';
  }
  const rawData = readA1Data();
  const hasData = rawData.some(row=>row.some(v=>v.trim()!==''));
  if (!hasData) return 'Preencha pelo menos uma célula de resposta na tabela.';

  // Valida que os valores preenchidos são numéricos
  for (let gi=0; gi<rawData.length; gi++) {
    for (const v of rawData[gi]) {
      if (v.trim()!=='' && !isNumericVal(v))
        return `Valor inválido "${v}" no grupo "${state.a1.groups[gi]?.name||gi+1}". Use ponto ou vírgula como separador decimal (ex: 12,5 ou 12.5).`;
    }
  }

  const reps   = state.a1.replicas;
  const resp   = state.a1.respName.trim();
  const groups = state.a1.groups;

  state.headers  = ['tratamento', resp];
  state.colRoles = { 'tratamento':'entrada', [resp]:'saida' };
  state.rows = [];
  groups.forEach((g,gi) => {
    const vals = rawData[gi]||[];
    for(let r=0;r<reps;r++) {
      const v = vals[r]?.trim()??'';
      // BUG 5 fix: normaliza vírgula→ponto antes de enviar ao CSV
      if(v!=='') state.rows.push([g.name.trim(), normalizeNum(v)]);
    }
  });
  if (!state.rows.length) return 'Nenhum dado numérico encontrado. Preencha a tabela de réplicas.';
  return '';
}

/* ─────────────────────────────────────────────────────────
   ANOVA2 manual
   ───────────────────────────────────────────────────────── */
function renderA2() {
  renderA2Groups(); renderA2Responses(); a2RebuildTable();
}

function a2AddGroup() {
  a2SyncFromDOM();
  state.a2.groups.push({id:uid(),name:''});
  renderA2Groups(); a2RebuildTable();
}
function a2RemoveGroup(id) {
  a2SyncFromDOM();
  state.a2.groups=state.a2.groups.filter(g=>g.id!==id);
  renderA2Groups(); a2RebuildTable();
}
function a2AddResponse() {
  a2SyncFromDOM();
  state.a2.responses.push({id:uid(),name:'',unit:''});
  renderA2Responses(); a2RebuildTable();
}
function a2RemoveResponse(id) {
  a2SyncFromDOM();
  state.a2.responses=state.a2.responses.filter(r=>r.id!==id);
  renderA2Responses(); a2RebuildTable();
}

function renderA2Groups() {
  const el=document.getElementById('a2-groups-list');
  if(!state.a2.groups.length){ el.innerHTML='<div class="empty-vars">Nenhum grupo.</div>'; return; }
  el.innerHTML=`
    <div class="var-row-labels"><span>Nome do grupo</span><span></span></div>
    ${state.a2.groups.map((g,i)=>`
    <div class="group-row" data-id="${g.id}" style="grid-template-columns:1fr 32px">
      <input type="text" placeholder="ex: Grupo A" value="${esc(g.name)}" aria-label="Grupo ${i+1}" />
      <button class="var-row-delete" onclick="a2RemoveGroup(${g.id})"><i class="ti ti-x"></i></button>
    </div>`).join('')}`;
  document.getElementById('a2-replica-block').style.display =
    state.a2.groups.length>0&&state.a2.responses.length>0 ? '' : 'none';
}

function renderA2Responses() {
  const el=document.getElementById('a2-responses-list');
  if(!state.a2.responses.length){ el.innerHTML='<div class="empty-vars">Nenhuma resposta.</div>'; return; }
  el.innerHTML=`
    <div class="var-row-labels"><span>Nome da resposta</span><span>Unidade</span><span></span></div>
    ${state.a2.responses.map((r,i)=>`
    <div class="var-row" data-id="${r.id}">
      <input type="text" placeholder="ex: Resistência" value="${esc(r.name)}" aria-label="Resposta ${i+1}" />
      <input type="text" class="unit-input" placeholder="ex: MPa" value="${esc(r.unit)}" aria-label="Unidade ${i+1}" />
      <button class="var-row-delete" onclick="a2RemoveResponse(${r.id})"><i class="ti ti-x"></i></button>
    </div>`).join('')}`;
  document.getElementById('a2-replica-block').style.display =
    state.a2.groups.length>0&&state.a2.responses.length>0 ? '' : 'none';
}

function a2SyncFromDOM() {
  document.querySelectorAll('#a2-groups-list .group-row').forEach(row => {
    const g=state.a2.groups.find(x=>x.id===parseInt(row.dataset.id,10));
    if(g){ const el=row.querySelector('input'); if(el) g.name=el.value; }
  });
  document.querySelectorAll('#a2-responses-list .var-row').forEach(row => {
    const r=state.a2.responses.find(x=>x.id===parseInt(row.dataset.id,10));
    if(r){ const ins=row.querySelectorAll('input'); if(ins[0]) r.name=ins[0].value; if(ins[1]) r.unit=ins[1].value; }
  });
  const repEl=document.getElementById('a2-replicas');
  if(repEl) state.a2.replicas=parseInt(repEl.value||'3',10);
}

function a2RebuildTable() {
  // NÃO sincroniza do DOM aqui
  const thead=document.getElementById('a2-thead');
  const tbody=document.getElementById('a2-tbody');
  if(!thead||!tbody) return;
  const reps=Math.max(1,state.a2.replicas||3);
  const groups=state.a2.groups; const resps=state.a2.responses;
  if(!groups.length||!resps.length) return;

  let hdr='<tr><th>Grupo</th><th>Réplica</th>';
  resps.forEach(r=>{ hdr+=`<th class="col-resp">${esc(r.name||'Resposta')}<span class="col-unit">${r.unit?` (${esc(r.unit)})`  :''}</span></th>`; });
  hdr+='</tr>'; thead.innerHTML=hdr;

  const existData=readA2Data();
  let body='';
  groups.forEach((g,gi)=>{
    for(let r=0;r<reps;r++){
      body+=`<tr>`;
      if(r===0) body+=`<td class="cell-fixed" rowspan="${reps}" style="text-align:left;padding-left:10px;vertical-align:middle">${esc(g.name||'Grupo')}</td>`;
      body+=`<td class="cell-fixed">${r+1}</td>`;
      resps.forEach((_,ci)=>{
        const val=existData[gi*reps+r]?.[ci]??'';
        body+=`<td class="cell-resp"><input type="text" value="${esc(val)}" /></td>`;
      });
      body+='</tr>';
    }
  });
  tbody.innerHTML=body;
}

function readA2Data() {
  const tbody=document.getElementById('a2-tbody');
  if(!tbody) return [];
  return Array.from(tbody.rows).map(tr=>
    Array.from(tr.querySelectorAll('td.cell-resp input')).map(i=>i.value)
  );
}

function commitA2() {
  a2SyncFromDOM();
  if(!state.a2.groups.length||state.a2.groups.length<2) return 'Adicione pelo menos dois grupos.';
  if(!state.a2.responses.length) return 'Adicione pelo menos uma variável de resposta.';
  for(const g of state.a2.groups) if(!g.name.trim()) return 'Preencha o nome de todos os grupos.';
  for(const r of state.a2.responses) if(!r.name.trim()) return 'Preencha o nome de todas as respostas.';
  const rawData=readA2Data();
  const hasData=rawData.some(row=>row.some(v=>v.trim()!==''));
  if(!hasData) return 'Preencha a tabela de dados.';

  // Valida numéricos
  for(let ri=0;ri<rawData.length;ri++){
    for(const v of rawData[ri]){
      if(v.trim()!==''&&!isNumericVal(v))
        return `Valor inválido "${v}". Use ponto ou vírgula como decimal (ex: 12,5 ou 12.5).`;
    }
  }

  const reps=state.a2.replicas;
  const groups=state.a2.groups; const resps=state.a2.responses;
  state.headers=['grupo',...resps.map(r=>r.name.trim())];
  state.colRoles={'grupo':'entrada'};
  resps.forEach(r=>{ state.colRoles[r.name.trim()]='saida'; });
  state.rows=[];
  groups.forEach((g,gi)=>{
    for(let r=0;r<reps;r++){
      const vals=rawData[gi*reps+r]||[];
      // BUG 5 fix: normaliza decimais
      const row=[g.name.trim(),...resps.map((_,ci)=>normalizeNum(vals[ci]?.trim()||''))];
      if(row.slice(1).some(v=>v!=='')) state.rows.push(row);
    }
  });
  if(!state.rows.length) return 'Nenhum dado numérico encontrado.';
  return '';
}

/* ─────────────────────────────────────────────────────────
   PLANEJAMENTO 2k manual
   ───────────────────────────────────────────────────────── */
function renderFat2k() {
  document.getElementById('fat2k-k-label').textContent=`k = ${state.k}`;
  renderFat2kFactors(); renderFat2kResponses(); fat2kRebuildTable();
}

function fat2kAddResponse() {
  fat2kSyncFromDOM();
  state.fat2k.responses.push({id:uid(),name:'',unit:''});
  renderFat2kResponses(); fat2kRebuildTable();
}
function fat2kRemoveResponse(id) {
  fat2kSyncFromDOM();
  state.fat2k.responses=state.fat2k.responses.filter(r=>r.id!==id);
  renderFat2kResponses(); fat2kRebuildTable();
}

function renderFat2kFactors() {
  const el=document.getElementById('fat2k-factors-list');
  el.innerHTML=state.fat2k.factors.map((f,i)=>`
  <div class="var-row-5" data-id="${f.id}">
    <input type="text" placeholder="ex: Temperatura" value="${esc(f.name)}"
      aria-label="Nome fator ${i+1}" oninput="fat2kSyncFromDOM();fat2kRebuildTable()" />
    <input type="text" class="unit-input" placeholder="ex: °C" value="${esc(f.unit)}"
      aria-label="Unidade fator ${i+1}" oninput="fat2kSyncFromDOM();fat2kRebuildTable()" />
    <input type="text" class="level-input" placeholder="ex: 60" value="${esc(f.lo)}"
      aria-label="Nível baixo fator ${i+1}" oninput="fat2kSyncFromDOM();fat2kRebuildTable()" />
    <input type="text" class="level-input" placeholder="ex: 80" value="${esc(f.hi)}"
      aria-label="Nível alto fator ${i+1}" oninput="fat2kSyncFromDOM();fat2kRebuildTable()" />
    <span style="color:var(--text-muted);font-size:11px;text-align:center">F${i+1}</span>
  </div>`).join('');
}

function renderFat2kResponses() {
  const el=document.getElementById('fat2k-responses-list');
  if(!state.fat2k.responses.length){ el.innerHTML='<div class="empty-vars">Adicione ao menos uma variável de resposta.</div>'; return; }
  el.innerHTML=`
    <div class="var-row-labels"><span>Nome da resposta</span><span>Unidade</span><span></span></div>
    ${state.fat2k.responses.map((r,i)=>`
    <div class="var-row" data-id="${r.id}">
      <input type="text" placeholder="ex: Rendimento" value="${esc(r.name)}" aria-label="Resposta ${i+1}" />
      <input type="text" class="unit-input" placeholder="ex: %" value="${esc(r.unit)}" aria-label="Unidade ${i+1}" />
      <button class="var-row-delete" onclick="fat2kRemoveResponse(${r.id})"><i class="ti ti-x"></i></button>
    </div>`).join('')}`;
}

function fat2kSyncFromDOM() {
  document.querySelectorAll('#fat2k-factors-list .var-row-5').forEach(row=>{
    const f=state.fat2k.factors.find(x=>x.id===parseInt(row.dataset.id,10));
    if(!f) return;
    const ins=row.querySelectorAll('input');
    if(ins[0]) f.name=ins[0].value;
    if(ins[1]) f.unit=ins[1].value;
    if(ins[2]) f.lo=ins[2].value;
    if(ins[3]) f.hi=ins[3].value;
  });
  document.querySelectorAll('#fat2k-responses-list .var-row').forEach(row=>{
    const r=state.fat2k.responses.find(x=>x.id===parseInt(row.dataset.id,10));
    if(!r) return;
    const ins=row.querySelectorAll('input');
    if(ins[0]) r.name=ins[0].value;
    if(ins[1]) r.unit=ins[1].value;
  });
  const repEl=document.getElementById('fat2k-replicas');
  if(repEl) state.fat2k.replicas=parseInt(repEl.value||'1',10);
}

// Gera matriz de Yates para k fatores
function yatesMatrix(k) {
  const n = Math.pow(2,k);
  const mat = [];
  for(let run=0;run<n;run++) {
    const row=[];
    for(let f=0;f<k;f++) {
      // fator f: período de mudança = 2^f
      row.push( Math.floor(run/Math.pow(2,f))%2===0 ? -1 : 1 );
    }
    mat.push(row);
  }
  return mat;
}

function fat2kRebuildTable() {
  // NÃO sincroniza do DOM aqui
  const thead=document.getElementById('fat2k-thead');
  const tbody=document.getElementById('fat2k-tbody');
  if(!thead||!tbody) return;
  const k=state.k; const reps=Math.max(1,state.fat2k.replicas||1);
  const mat=yatesMatrix(k); const n=mat.length;
  const factors=state.fat2k.factors; const resps=state.fat2k.responses;

  // cabeçalho
  let hdr='<tr><th class="col-run">#</th>';
  factors.forEach((f,i)=>{
    const nm=f.name||`F${i+1}`;
    const un=f.lo&&f.hi ? ` [${f.lo}/${f.hi}]` : '';
    hdr+=`<th class="col-factor">${esc(nm)}<span class="col-unit">${esc(un)}</span></th>`;
  });
  resps.forEach((r,ri)=>{
    const nm=r.name||`Y${ri+1}`;
    for(let rep=1;rep<=reps;rep++){
      const label = reps>1 ? `${nm} R${rep}` : nm;
      hdr+=`<th class="col-resp">${esc(label)}<span class="col-unit">${r.unit?` (${esc(r.unit)})`:''}</span></th>`;
    }
  });
  hdr+='</tr>'; thead.innerHTML=hdr;

  // lê dados existentes
  const existResp=readFat2kRespData();

  // corpo
  let body='';
  mat.forEach((rowCoded,ri)=>{
    body+=`<tr><td class="cell-run">${ri+1}</td>`;
    // colunas fixas de fatores: mostra nível codificado e valor real se definido
    rowCoded.forEach((lvl,fi)=>{
      const f=factors[fi];
      let display = lvl===-1?'−1':'+1';
      if(f&&f.lo&&f.hi) {
        const real = lvl===-1 ? f.lo : f.hi;
        display+=` <span style="color:var(--text-muted);font-size:10px">(${esc(real)})</span>`;
      }
      body+=`<td class="cell-fixed">${display}</td>`;
    });
    // colunas de resposta editáveis
    resps.forEach((_,rsi)=>{
      for(let rep=0;rep<reps;rep++){
        const idx=ri*(reps*resps.length)+rsi*reps+rep;
        const val=existResp[idx]??'';
        body+=`<td class="cell-resp"><input type="text" value="${esc(val)}" /></td>`;
      }
    });
    body+='</tr>';
  });
  tbody.innerHTML=body;
}

function readFat2kRespData() {
  const tbody=document.getElementById('fat2k-tbody');
  if(!tbody) return [];
  const vals=[];
  tbody.querySelectorAll('td.cell-resp input').forEach(inp=>vals.push(inp.value));
  return vals;
}

function commitFat2k() {
  fat2kSyncFromDOM();
  const factors=state.fat2k.factors; const resps=state.fat2k.responses;
  for(const f of factors) if(!f.name.trim()) return 'Preencha o nome de todos os fatores.';
  if(!resps.length) return 'Adicione pelo menos uma variável de resposta.';
  for(const r of resps) if(!r.name.trim()) return 'Preencha o nome de todas as variáveis de resposta.';

  const mat=yatesMatrix(state.k); const reps=state.fat2k.replicas;
  const respVals=readFat2kRespData();
  const hasData=respVals.some(v=>v.trim()!=='');
  if(!hasData) return 'Preencha pelo menos uma célula de resposta na tabela de Yates.';

  // Valida numéricos nas células de resposta
  for(const v of respVals){
    if(v.trim()!==''&&!isNumericVal(v))
      return `Valor inválido "${v}" nas respostas. Use ponto ou vírgula como decimal (ex: 12,5 ou 12.5). Não use separador de milhar.`;
  }

  const factorHeaders=factors.map(f=>f.name.trim());
  const respHeaders=[];
  resps.forEach(r=>{ for(let rep=1;rep<=reps;rep++) respHeaders.push(reps>1?`${r.name.trim()}_R${rep}`:r.name.trim()); });

  state.headers=[...factorHeaders,...respHeaders];
  state.colRoles={};
  factorHeaders.forEach(h=>{ state.colRoles[h]='entrada'; });
  respHeaders.forEach(h=>{ state.colRoles[h]='saida'; });

  state.rows=[];
  const nResp=resps.length*reps;
  mat.forEach((rowCoded,ri)=>{
    const row=rowCoded.map(String); // colunas codificadas −1/+1 ficam como texto
    for(let c=0;c<nResp;c++){
      const idx=ri*nResp+c;
      // BUG 14 fix: normaliza vírgula→ponto nas respostas
      row.push(normalizeNum(respVals[idx]??''));
    }
    state.rows.push(row);
  });
  return '';
}

/* ─────────────────────────────────────────────────────────
   CCD manual
   ───────────────────────────────────────────────────────── */
function renderCcd() {
  document.getElementById('ccd-k-label').textContent=`k = ${state.k}`;
  renderCcdFactors(); renderCcdResponses(); ccdRebuildTable();
}

function ccdAddResponse() {
  ccdSyncFromDOM();
  state.ccd.responses.push({id:uid(),name:'',unit:''});
  renderCcdResponses(); ccdRebuildTable();
}
function ccdRemoveResponse(id) {
  ccdSyncFromDOM();
  state.ccd.responses=state.ccd.responses.filter(r=>r.id!==id);
  renderCcdResponses(); ccdRebuildTable();
}

function renderCcdFactors() {
  const el=document.getElementById('ccd-factors-list');
  el.innerHTML=state.ccd.factors.map((f,i)=>`
  <div class="var-row-5" data-id="${f.id}">
    <input type="text" placeholder="ex: Temperatura" value="${esc(f.name)}" aria-label="Nome fator ${i+1}" oninput="ccdSyncFromDOM();ccdRebuildTable()" />
    <input type="text" class="unit-input" placeholder="ex: °C" value="${esc(f.unit)}" aria-label="Unidade ${i+1}" oninput="ccdSyncFromDOM();ccdRebuildTable()" />
    <input type="text" class="level-input" placeholder="ex: 60" value="${esc(f.lo)}" aria-label="Nível baixo ${i+1}" oninput="ccdSyncFromDOM();ccdRebuildTable()" />
    <input type="text" class="level-input" placeholder="ex: 80" value="${esc(f.hi)}" aria-label="Nível alto ${i+1}" oninput="ccdSyncFromDOM();ccdRebuildTable()" />
    <span style="color:var(--text-muted);font-size:11px;text-align:center">F${i+1}</span>
  </div>`).join('');
}

function renderCcdResponses() {
  const el=document.getElementById('ccd-responses-list');
  if(!state.ccd.responses.length){ el.innerHTML='<div class="empty-vars">Adicione ao menos uma variável de resposta.</div>'; return; }
  el.innerHTML=`
    <div class="var-row-labels"><span>Nome</span><span>Unidade</span><span></span></div>
    ${state.ccd.responses.map((r,i)=>`
    <div class="var-row" data-id="${r.id}">
      <input type="text" placeholder="ex: Conversão" value="${esc(r.name)}" aria-label="Resposta ${i+1}" />
      <input type="text" class="unit-input" placeholder="ex: %" value="${esc(r.unit)}" aria-label="Unidade ${i+1}" />
      <button class="var-row-delete" onclick="ccdRemoveResponse(${r.id})"><i class="ti ti-x"></i></button>
    </div>`).join('')}`;
}

function ccdSyncFromDOM() {
  document.querySelectorAll('#ccd-factors-list .var-row-5').forEach(row=>{
    const f=state.ccd.factors.find(x=>x.id===parseInt(row.dataset.id,10));
    if(!f) return;
    const ins=row.querySelectorAll('input');
    if(ins[0]) f.name=ins[0].value;
    if(ins[1]) f.unit=ins[1].value;
    if(ins[2]) f.lo=ins[2].value;
    if(ins[3]) f.hi=ins[3].value;
  });
  document.querySelectorAll('#ccd-responses-list .var-row').forEach(row=>{
    const r=state.ccd.responses.find(x=>x.id===parseInt(row.dataset.id,10));
    if(!r) return;
    const ins=row.querySelectorAll('input');
    if(ins[0]) r.name=ins[0].value;
    if(ins[1]) r.unit=ins[1].value;
  });
  const cpEl=document.getElementById('ccd-center-pts');
  if(cpEl) state.ccd.centerPts=parseInt(cpEl.value||'3',10);
}

// Gera matriz CCD codificada
function ccdMatrix(k, nCenter) {
  const alpha = Math.pow(Math.pow(2,k), 0.25); // alpha rotável
  const mat   = [];
  // Pontos fatoriais
  yatesMatrix(k).forEach(row=>mat.push({type:'fat', vals:row}));
  // Pontos axiais
  for(let f=0;f<k;f++){
    const row1=Array(k).fill(0); row1[f]=+alpha;
    const row2=Array(k).fill(0); row2[f]=-alpha;
    mat.push({type:'ax',vals:row1}); mat.push({type:'ax',vals:row2});
  }
  // Pontos centrais
  for(let c=0;c<nCenter;c++) mat.push({type:'ctr',vals:Array(k).fill(0)});
  return mat;
}

function ccdRebuildTable() {
  // NÃO sincroniza do DOM aqui
  const thead=document.getElementById('ccd-thead');
  const tbody=document.getElementById('ccd-tbody');
  if(!thead||!tbody) return;
  const k=state.k; const nc=Math.max(1,state.ccd.centerPts||3);
  const mat=ccdMatrix(k,nc);
  const factors=state.ccd.factors; const resps=state.ccd.responses;

  let hdr='<tr><th class="col-run">#</th><th class="col-run" style="font-size:10px">Tipo</th>';
  factors.forEach((f,i)=>{
    const nm=f.name||`F${i+1}`;
    hdr+=`<th class="col-factor">${esc(nm)}<span class="col-unit">${f.unit?` (${esc(f.unit)})`  :''}</span></th>`;
  });
  resps.forEach(r=>{
    hdr+=`<th class="col-resp">${esc(r.name||'Y')}<span class="col-unit">${r.unit?` (${esc(r.unit)})`  :''}</span></th>`;
  });
  hdr+='</tr>'; thead.innerHTML=hdr;

  const existResp=readCcdRespData();
  const typeLabel={fat:'Fat',ax:'Ax',ctr:'Ctr'};
  let body='';
  mat.forEach((pt,ri)=>{
    body+=`<tr><td class="cell-run">${ri+1}</td>`;
    body+=`<td class="cell-run" style="font-size:10px;color:var(--text-muted)">${typeLabel[pt.type]}</td>`;
    pt.vals.forEach(v=>{
      body+=`<td class="cell-fixed">${v===0?'0':v>0?`+${v.toFixed(3)}`:v.toFixed(3)}</td>`;
    });
    resps.forEach((_,rsi)=>{
      const val=existResp[ri*resps.length+rsi]??'';
      body+=`<td class="cell-resp"><input type="text" value="${esc(val)}" /></td>`;
    });
    body+='</tr>';
  });
  tbody.innerHTML=body;
}

function readCcdRespData() {
  const tbody=document.getElementById('ccd-tbody');
  if(!tbody) return [];
  return Array.from(tbody.querySelectorAll('td.cell-resp input')).map(i=>i.value);
}

function commitCcd() {
  ccdSyncFromDOM();
  const factors=state.ccd.factors; const resps=state.ccd.responses;
  for(const f of factors) if(!f.name.trim()) return 'Preencha o nome de todos os fatores.';
  if(!resps.length) return 'Adicione pelo menos uma variável de resposta.';
  for(const r of resps) if(!r.name.trim()) return 'Preencha o nome de todas as variáveis de resposta.';

  const nc=state.ccd.centerPts;
  const mat=ccdMatrix(state.k,nc);
  const respVals=readCcdRespData();
  if(!respVals.some(v=>v.trim()!=='')) return 'Preencha ao menos uma célula de resposta.';

  // Valida numéricos
  for(const v of respVals){
    if(v.trim()!==''&&!isNumericVal(v))
      return `Valor inválido "${v}". Use ponto ou vírgula como decimal (ex: 12,5 ou 12.5). Não use separador de milhar.`;
  }

  const factorHeaders=factors.map(f=>f.name.trim());
  const respHeaders=resps.map(r=>r.name.trim());
  state.headers=[...factorHeaders,...respHeaders];
  state.colRoles={};
  factorHeaders.forEach(h=>{ state.colRoles[h]='entrada'; });
  respHeaders.forEach(h=>{ state.colRoles[h]='saida'; });

  state.rows=mat.map((pt,ri)=>{
    const row=pt.vals.map(v=>v.toFixed(4));
    // BUG 14 fix: normaliza vírgula→ponto nas respostas
    resps.forEach((_,rsi)=>{ row.push(normalizeNum(respVals[ri*resps.length+rsi]??'')); });
    return row;
  });
  return '';
}

/* ════════════════════════════════════════════════════════════
   NAVEGAÇÃO
   ════════════════════════════════════════════════════════════ */
function goTo(n) {
  document.getElementById('step2-alert').style.display='none';

  if (n===2) {
    renderStep(2);
    if (state.inputMode==='manual') renderManualPanel();
    return;
  }

  if (n===3) {
    if (state.inputMode==='manual') {
      const err = commitManualData();
      if (err) {
        const el=document.getElementById('step2-alert');
        el.style.display='';
        document.getElementById('step2-alert-text').textContent=err;
        el.scrollIntoView({behavior:'smooth',block:'nearest'});
        return;
      }
    }
    if (!state.headers.length) return;
    renderStep(3); buildColConfig(); buildUnitsReview();
    return;
  }
  if (n===4) {
    const warn=validateVars();
    const warnEl=document.getElementById('var-warning');
    if(warn){ warnEl.style.display=''; document.getElementById('var-warn-text').textContent=warn; return; }
    warnEl.style.display='none';
    renderStep(4); runAnalysis(); return;
  }
  renderStep(n);
}

function commitManualData() {
  if (state.type==='anova1')  return commitA1();
  if (state.type==='anova2')  return commitA2();
  if (state.type==='fat2k') return commitFat2k();
  if (state.type==='ccd')   return commitCcd();
  return '';
}

function renderStep(n) {
  for(let i=1;i<=5;i++){
    document.getElementById(`sec${i}`).classList.toggle('visible',i===n);
    const ind=document.getElementById(`step${i}-ind`);
    ind.classList.remove('active','done');
    const dot=ind.querySelector('.dot');
    if(i<n){ ind.classList.add('done'); ind.removeAttribute('aria-current'); dot.innerHTML='<i class="ti ti-check" style="font-size:10px"></i>'; }
    else if(i===n){ ind.classList.add('active'); ind.setAttribute('aria-current','step'); dot.textContent=i; }
    else{ ind.removeAttribute('aria-current'); dot.textContent=i; }
  }
}

/* ════════════════════════════════════════════════════════════
   STEP 3 — REVISAR
   ════════════════════════════════════════════════════════════ */
function buildColConfig() {
  document.getElementById('col-config').innerHTML=state.headers.map(h=>{
    const role=state.colRoles[h];
    return `
    <div class="col-row">
      <span class="col-name" title="${esc(h)}">${esc(h)}</span>
      <div class="col-role">
        <button class="role-btn ${role==='entrada'?'entrada':''}" onclick="setRole('${escAttr(h)}','entrada')">Entrada</button>
        <button class="role-btn ${role==='saida'?'saida':''}" onclick="setRole('${escAttr(h)}','saida')">Saída</button>
        <button class="role-btn ${role==='ignorar'?'ignorar':''}" onclick="setRole('${escAttr(h)}','ignorar')">Ignorar</button>
      </div>
    </div>`;
  }).join('');
}

function setRole(col,role){ state.colRoles[col]=role; buildColConfig(); }

function buildUnitsReview() {
  const panel=document.getElementById('units-review');
  if(state.inputMode!=='manual'){ panel.style.display='none'; return; }
  const items=[];
  const addItem=(name,unit,role)=>items.push({name,unit,role});
  if(state.type==='anova1'){
    state.a1.groups.forEach(g=>addItem(g.name,g.unit||'','entrada'));
    addItem(state.a1.respName,state.a1.respUnit,'saida');
  } else if(state.type==='anova2'){
    state.a2.groups.forEach(g=>addItem(g.name,'','entrada'));
    state.a2.responses.forEach(r=>addItem(r.name,r.unit,'saida'));
  } else if(state.type==='fat2k'){
    state.fat2k.factors.forEach(f=>addItem(f.name,f.unit,'entrada'));
    state.fat2k.responses.forEach(r=>addItem(r.name,r.unit,'saida'));
  } else if(state.type==='ccd'){
    state.ccd.factors.forEach(f=>addItem(f.name,f.unit,'entrada'));
    state.ccd.responses.forEach(r=>addItem(r.name,r.unit,'saida'));
  }
  document.getElementById('units-grid').innerHTML=items.map(v=>
    `<span class="unit-pill ${v.role}">${esc(v.name)}${v.unit?` <span class="pill-unit">${esc(v.unit)}</span>`:''}</span>`
  ).join('');
  panel.style.display='';
}

function validateVars() {
  const inputs=activeInputs(); const outputs=activeOutputs();
  if(!inputs.length) return 'Defina pelo menos uma variável de entrada.';
  if(!outputs.length) return 'Defina pelo menos uma variável de saída.';
  if(state.type==='anova1'&&outputs.length>1) return 'ANOVA univariado aceita apenas uma variável de saída.';
  if(state.type==='fat2k'||state.type==='ccd'){
    const k=inputs.length;
    if(k<2||k>6) return `Requer entre 2 e 6 fatores. Detectado: ${k}.`;
    state.k=k;
  }
  return '';
}

function activeInputs()  { return state.headers.filter(h=>state.colRoles[h]==='entrada'); }
function activeOutputs() { return state.headers.filter(h=>state.colRoles[h]==='saida'); }

/* ════════════════════════════════════════════════════════════
   PRÉ-CÁLCULO 2k (JavaScript puro — garante precisão numérica)
   ════════════════════════════════════════════════════════════ */
function computeFat2k(inputs, outputs) {
  const k=inputs.length, nRuns=Math.pow(2,k), N=state.rows.length, n=N/nRuns;
  const respIdx=state.headers.indexOf(outputs[0]);
  const inpIdxs=inputs.map(f=>state.headers.indexOf(f));

  function sign(r,fi){ return Math.floor(r/Math.pow(2,fi))%2===0?-1:1; }
  function runIndex(row){
    let idx=0;
    for(let fi=0;fi<k;fi++){ if(parseFloat(row[inpIdxs[fi]])>0) idx+=Math.pow(2,fi); }
    return idx;
  }
  function effectName(mask){
    let nm='';
    for(let fi=0;fi<k;fi++) if(mask&(1<<fi)) nm+=inputs[fi];
    return nm;
  }

  // Médias por corrida
  const runSums=new Array(nRuns).fill(0), runCounts=new Array(nRuns).fill(0);
  state.rows.forEach(row=>{ const r=runIndex(row); runSums[r]+=parseFloat(row[respIdx]); runCounts[r]++; });
  const runMeans=runSums.map((s,r)=>runCounts[r]>0?s/runCounts[r]:0);
  const grandMean=runMeans.reduce((s,v)=>s+v,0)/nRuns;

  // Efeitos e SQ por contraste de Yates
  const effects=[];
  for(let mask=1;mask<Math.pow(2,k);mask++){
    let contraste=0;
    for(let r=0;r<nRuns;r++){
      let sinal=1;
      for(let fi=0;fi<k;fi++) if(mask&(1<<fi)) sinal*=sign(r,fi);
      contraste+=sinal*runMeans[r];
    }
    const efeito=contraste/(nRuns/2);
    const SQ=(contraste**2*n)/nRuns;
    effects.push({name:effectName(mask),efeito,SQ});
  }

  // Erro puro
  let SQE=0;
  if(n>1) state.rows.forEach(row=>{ const r=runIndex(row); SQE+=(parseFloat(row[respIdx])-runMeans[r])**2; });
  const glE=nRuns*(n-1);
  const QME=glE>0?SQE/glE:null;
  const SQT=effects.reduce((s,e)=>s+e.SQ,0)+SQE;

  // Monta texto para o prompt
  let txt=`\n=== VALORES PRÉ-CALCULADOS — USE EXATAMENTE ESTES ===\n`;
  txt+=`Média geral: ${grandMean.toFixed(4)}\n`;
  txt+=`N=${N}, corridas=${nRuns}, réplicas/ponto=${n}\n\n`;
  txt+=`Efeito | Estimativa | SQ | GL\n`;
  effects.forEach(e=>{ txt+=`${e.name} | ${e.efeito.toFixed(4)} | ${e.SQ.toFixed(4)} | 1\n`; });
  txt+=`Erro Puro | — | ${SQE.toFixed(4)} | ${glE}\n`;
  txt+=`Total | — | ${SQT.toFixed(4)} | ${N-1}\n`;
  if(QME){ txt+=`QME=${QME.toFixed(4)}\n`; effects.forEach(e=>{ txt+=`F(${e.name})=${(e.SQ/QME).toFixed(4)}\n`; }); }
  txt+=`=== FIM DOS PRÉ-CÁLCULOS — NÃO RECALCULE ===\n`;
  return txt;
}

/* ════════════════════════════════════════════════════════════
   STEP 4 — ANÁLISE
   ════════════════════════════════════════════════════════════ */
function logProc(msg){
  const log=document.getElementById('proc-log');
  log.textContent+=msg+'\n'; log.scrollTop=log.scrollHeight;
}

async function runAnalysis(){
  document.getElementById('proc-log').textContent='';
  document.getElementById('proc-msg').textContent='Preparando dados...';
  document.getElementById('spinner').style.borderTopColor='';
  document.getElementById('spinner').style.display='';

  const inputs=activeInputs(); const outputs=activeOutputs();
  const label=TYPE_LABEL[state.type]+((state.type==='fat2k'||state.type==='ccd')?` (k=${state.k})`:'');

  // Mostra aviso do proxy apenas em localhost
  const isLocal = location.hostname==='localhost' || location.hostname==='127.0.0.1';
  const reminder = document.getElementById('proxy-reminder');
  if (reminder) reminder.style.display = isLocal ? '' : 'none';
  logProc(`> Tipo: ${label}`);
  logProc(`> Modo: ${state.inputMode==='manual'?'entrada manual':'CSV'}`);
  logProc(`> Entradas (${inputs.length}): ${inputs.join(', ')}`);
  logProc(`> Saídas (${outputs.length}): ${outputs.join(', ')}`);
  logProc(`> Linhas: ${state.rows.length}`);

  // ── Pré-calcula 2k no JavaScript (garante precisão) ──────
  let preCalc2k = '';
  if (state.type==='fat2k') {
    try {
      preCalc2k = computeFat2k(inputs, outputs);
      logProc('> Cálculos 2k pré-computados localmente ✓');
    } catch(e) {
      logProc(`> Aviso: pré-cálculo falhou (${e.message}), usando API`);
    }
  }

  logProc('> Chamando API...');
  document.getElementById('proc-msg').textContent='Analisando com IA...';

  const csvSubset=buildSubsetCSV([...inputs,...outputs]);
  const prompt=buildPrompt(csvSubset,inputs,outputs,label,preCalc2k);
  const nOutputs = outputs.length;
  const maxTokens = 8000;

  try{
    let resp;
    try {
      resp = await fetch(API_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:API_MODEL,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]}),
      });
    } catch(fetchErr) {
      const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      throw new Error(isLocal
        ? 'Não foi possível conectar ao proxy local (http://localhost:3001).\n' +
          'Verifique se o proxy está rodando:\n' +
          '  1. Abra um terminal na pasta do projeto\n' +
          '  2. Execute:  node proxy.js\n' +
          '  3. Acesse:   http://localhost:3001  (não abra o index.html diretamente)'
        : 'Erro de conexão com o servidor.\n' +
          'Verifique se o serviço está ativo no painel do provedor de nuvem.'
      );
    }
    if(!resp.ok){ const e=await resp.json().catch(()=>({})); throw new Error(`HTTP ${resp.status}: ${e?.error?.message||resp.statusText}`); }
    const data=await resp.json();
    // Oculta aviso do proxy — conexão funcionou
    const proxyReminder = document.getElementById('proxy-reminder');
    if (proxyReminder) proxyReminder.style.display = 'none';
    const raw=(data.content||[]).map(i=>i.text||'').join('');
    logProc('> Resposta recebida. Processando...');
    // Log se a resposta parece truncada
    if (data.stop_reason === 'max_tokens') {
      logProc('> AVISO: resposta truncada (max_tokens atingido). Tentando recuperar JSON parcial...');
    }
    const parsed=extractJSON(raw);
    if(!parsed) {
      // Loga os últimos 200 chars para diagnóstico
      logProc(`> Trecho final da resposta: ...${raw.slice(-200)}`);
      throw new Error('JSON inválido na resposta. Tente novamente.');
    }
    state.result=parsed; state.reportText=buildReportText(parsed,label,inputs,outputs);
    logProc('> Concluído!');
    document.getElementById('proc-msg').textContent='Concluído!';
    document.getElementById('spinner').style.borderTopColor='var(--success)';
    setTimeout(()=>renderResults(parsed,label),700);
  } catch(err){
    document.getElementById('spinner').style.display='none';
    document.getElementById('proc-msg').textContent='Erro na análise.';
    // Mostra cada linha da mensagem de erro separada
    err.message.split('\n').forEach((line, i) => {
      logProc(i===0 ? `> ERRO: ${line}` : `>       ${line}`);
    });
    logProc('');
    if (!err.message.includes('proxy')) {
      logProc('> Outras sugestões:');
      logProc('  - Confirme que os dados são numéricos (use vírgula como decimal)');
      logProc('  - Tente novamente (pode ser instabilidade temporária da API)');
    }
    document.getElementById('proc-log').style.borderColor='var(--danger-border)';
  }
}

function buildSubsetCSV(cols){
  const idxMap=cols.map(c=>state.headers.indexOf(c));
  return [cols.join(','),...state.rows.map(r=>idxMap.map(i=>r[i]??'').join(','))].join('\n');
}

function buildUnitsContext(){
  if(state.inputMode!=='manual') return '';
  const map={};
  const add=(name,unit)=>{ if(unit) map[name]=unit; };
  if(state.type==='anova1'){
    state.a1.groups.forEach(g=>add(g.name,g.unit));
    add(state.a1.respName,state.a1.respUnit);
  } else if(state.type==='anova2'){
    state.a2.responses.forEach(r=>add(r.name,r.unit));
  } else if(state.type==='fat2k'){
    state.fat2k.factors.forEach(f=>add(f.name,f.unit));
    state.fat2k.responses.forEach(r=>add(r.name,r.unit));
  } else if(state.type==='ccd'){
    state.ccd.factors.forEach(f=>add(f.name,f.unit));
    state.ccd.responses.forEach(r=>add(r.name,r.unit));
  }
  const parts=Object.entries(map).map(([n,u])=>`  - ${n}: ${u}`);
  return parts.length?`\nUnidades das variáveis:\n${parts.join('\n')}`:'';
}

// Contexto de níveis reais (para 2k e CCD)
function buildLevelsContext(){
  if(state.inputMode!=='manual') return '';
  const lines=[];
  const src=state.type==='fat2k'?state.fat2k.factors:state.type==='ccd'?state.ccd.factors:[];
  src.forEach(f=>{ if(f.lo||f.hi) lines.push(`  - ${f.name}: nível baixo = ${f.lo}, nível alto = ${f.hi}`); });
  return lines.length?`\nNíveis reais dos fatores:\n${lines.join('\n')}`:'';
}

function buildPrompt(csv,inputs,outputs,label,preCalc=''){

  // ── Número total de observações e réplicas ──────────────
  const N    = state.rows.length;
  const k    = state.k;
  const reps = (state.type==='fat2k') ? (state.fat2k.replicas||1)
             : (state.type==='ccd')   ? 1
             : (state.type==='anova1') ? (state.a1.replicas||1)
             : (state.a2.replicas||1);

  // ── Guias matemáticos rigorosos por tipo ────────────────
  const guide = {

/* ════════════════════════════════════════════════════
   ANOVA UNIVARIADO (one-way)
   Modelo: y_ij = μ + τ_i + ε_ij
   i = 1..a (grupos), j = 1..n_i (réplicas)
   ════════════════════════════════════════════════════ */
anova1: `Realize ANOVA one-way. Calcule SQTr=Σni(ȳi-ȳ)², SQE=Σ(yij-ȳi)², GL_Tr=a-1, GL_E=N-a.
F=QMTr/QME. Se significativo (p<0,05), aplique Tukey HSD=q·√(QME/n).
ATENÇÃO: arrays residuos/valores_ajustados com NO MÁXIMO 8 valores.`,

anova2: `Realize MANOVA. Calcule matrizes H e E. Compute Wilks' Λ=|E|/|H+E| e Pillai's Trace.
Após MANOVA, faça ANOVAs univariadas protegidas (Bonferroni α*=0,05/p) para cada resposta.
ATENÇÃO: arrays residuos/valores_ajustados com NO MÁXIMO 8 valores.`,

/* ── Guias compactos por tipo (economiza tokens na resposta) ── */
fat2k: `Realize análise fatorial 2^k com k=${k} fatores, ${reps} réplica(s), N=${N} observações.
Use contrastes de Yates: Efeito = Contraste/(N/2), SQ = Contraste²/N, GL=1 por efeito.
Erro puro: SQE = soma (y_lr − ȳ_l)², GL_E = ${Math.pow(2,k)*(reps-1)}.
Calcule TODOS os efeitos principais e interações. F = QM_efeito/QME.
Interprete nos níveis reais fornecidos.
ATENÇÃO: arrays residuos/valores_ajustados com NO MÁXIMO 8 valores.`,

ccd: `Realize RSM/CCD com k=${k} fatores, α=${Math.pow(2,k/4).toFixed(3)}, N=${N} pontos.
Ajuste modelo quadrático completo (${1+2*k+k*(k-1)/2} parâmetros) por OLS.
Particione: SQReg, SQLoF, SQEp (pontos centrais), SQRes. Teste LoF.
Calcule ponto estacionário x_s = -B⁻¹b/2, classifique pelos autovalores de B.
Converta x_s para unidades reais.
ATENÇÃO: arrays residuos/valores_ajustados com NO MÁXIMO 8 valores.`,

  }[state.type]||'';

  // ── JSON de saída específico por tipo ────────────────────
  const jsonTemplate = {
anova1: `{
  "resumo": "2-3 parágrafos: modelo, hipóteses testadas, resultado F, quais grupos diferem",
  "premissas": {"normalidade":"Shapiro-Wilk ou comentário","homogeneidade":"Levene/Bartlett","conclusao_premissas":"atendidas/violadas?"},
  "estatisticas_descritivas": {"por_variavel": [{"variavel":"","n":0,"media":0.0,"dp":0.0,"min":0.0,"max":0.0,"mediana":0.0,"cv":0.0,"ic_inf_95":0.0,"ic_sup_95":0.0}]},
  "tabela_anova": [{"fonte":"Tratamentos","gl":0,"sq":0.0,"qm":0.0,"f":0.0,"p_valor":0.0,"significativo":true},{"fonte":"Erro","gl":0,"sq":0.0,"qm":0.0,"f":null,"p_valor":null,"significativo":false},{"fonte":"Total","gl":0,"sq":0.0,"qm":null,"f":null,"p_valor":null,"significativo":false}],
  "efeitos": [{"nome":"τ_i (grupo vs média geral)","estimativa":0.0,"erro_padrao":0.0,"t":0.0,"p_valor":0.0}],
  "tukey": [{"comparacao":"A vs B","diferenca":0.0,"hsd":0.0,"significativo":true}],
  "r2": 0.0, "r2_ajustado": 0.0,
  "conclusao": "Grupos que diferem, magnitude, direção, recomendações com nomes e unidades reais",
  "dados_graficos": {"medias_por_grupo":[{"grupo":"","media":0.0,"ic_inf":0.0,"ic_sup":0.0}],"residuos":[0.0,0.0,0.0,0.0,0.0],"valores_ajustados":[0.0,0.0,0.0,0.0,0.0],"efeitos_principais":[]}
}
ATENÇÃO: nos arrays "residuos" e "valores_ajustados" inclua NO MÁXIMO 8 valores representativos — NÃO liste todos os N valores individualmente.`,
anova2: `{
  "resumo": "2-3 parágrafos: análise multivariada e por resposta",
  "criterios_multivariados": {"wilks_lambda":0.0,"wilks_F":0.0,"wilks_p":0.0,"pillai_trace":0.0,"pillai_F":0.0,"pillai_p":0.0,"hotelling_trace":0.0,"significativo":true},
  "estatisticas_descritivas": {"por_variavel": [{"variavel":"","n":0,"media":0.0,"dp":0.0,"min":0.0,"max":0.0,"mediana":0.0,"cv":0.0,"ic_inf_95":0.0,"ic_sup_95":0.0}]},
  "tabela_anova": [{"fonte":"","gl":0,"sq":0.0,"qm":0.0,"f":0.0,"p_valor":0.0,"significativo":true}],
  "efeitos": [{"nome":"","estimativa":0.0,"erro_padrao":0.0,"t":0.0,"p_valor":0.0}],
  "r2": 0.0, "r2_ajustado": 0.0,
  "conclusao": "Interpretação multivariada + por resposta com unidades reais",
  "dados_graficos": {"medias_por_grupo":[{"grupo":"","media":0.0,"ic_inf":0.0,"ic_sup":0.0}],"residuos":[0.0,0.0,0.0,0.0,0.0],"valores_ajustados":[0.0,0.0,0.0,0.0,0.0],"efeitos_principais":[]}
}`,
fat2k: `{
  "resumo": "2-3 parágrafos: efeitos significativos, magnitudes, interações, interpretação real",
  "estatisticas_descritivas": {"por_variavel": [{"variavel":"","n":0,"media":0.0,"dp":0.0,"min":0.0,"max":0.0,"mediana":0.0,"cv":0.0}]},
  "tabela_anova": [{"fonte":"A","gl":1,"sq":0.0,"qm":0.0,"f":0.0,"p_valor":0.0,"significativo":true}],
  "efeitos": [{"nome":"A","estimativa":0.0,"erro_padrao":0.0,"t":0.0,"p_valor":0.0}],
  "r2": 0.0, "r2_ajustado": 0.0,
  "conclusao": "Fatores/interações significativos, sentido do efeito nos níveis reais, configuração ótima",
  "dados_graficos": {
    "medias_por_grupo":[{"grupo":"","media":0.0,"ic_inf":0.0,"ic_sup":0.0}],
    "residuos":[0.0,0.0,0.0,0.0,0.0],"valores_ajustados":[0.0,0.0,0.0,0.0,0.0],
    "efeitos_principais":[{"fator":"","nivel_baixo":0.0,"nivel_alto":0.0}],
    "pareto_efeitos":[{"nome":"","valor_absoluto":0.0,"significativo":true}]
  }
}`,
ccd: `{
  "resumo": "2-3 parágrafos: qualidade do ajuste, termos significativos, ponto ótimo em unidades reais",
  "coeficientes_modelo": [{"termo":"b0 (intercepto)","estimativa":0.0,"erro_padrao":0.0,"t":0.0,"p_valor":0.0,"significativo":true}],
  "estatisticas_descritivas": {"por_variavel": [{"variavel":"","n":0,"media":0.0,"dp":0.0,"min":0.0,"max":0.0,"mediana":0.0,"cv":0.0,"ic_inf_95":0.0,"ic_sup_95":0.0}]},
  "tabela_anova": [
    {"fonte":"Regressão","gl":0,"sq":0.0,"qm":0.0,"f":0.0,"p_valor":0.0,"significativo":true},
    {"fonte":"Lack of Fit","gl":0,"sq":0.0,"qm":0.0,"f":0.0,"p_valor":0.0,"significativo":false},
    {"fonte":"Erro Puro","gl":0,"sq":0.0,"qm":0.0,"f":null,"p_valor":null,"significativo":false},
    {"fonte":"Resíduo","gl":0,"sq":0.0,"qm":0.0,"f":null,"p_valor":null,"significativo":false},
    {"fonte":"Total","gl":0,"sq":0.0,"qm":null,"f":null,"p_valor":null,"significativo":false}
  ],
  "efeitos": [{"nome":"","estimativa":0.0,"erro_padrao":0.0,"t":0.0,"p_valor":0.0}],
  "ponto_otimo": {"coordenadas_codificadas":{},"coordenadas_reais":{},"resposta_predita":0.0,"tipo":"máximo","autovalores_B":[]},
  "r2": 0.0, "r2_ajustado": 0.0, "r2_predicao": 0.0,
  "conclusao": "Adequação do modelo (LoF), termos significativos, ponto ótimo nas unidades reais, recomendações",
  "dados_graficos": {"medias_por_grupo":[],"residuos":[0.0,0.0,0.0,0.0,0.0],"valores_ajustados":[0.0,0.0,0.0,0.0,0.0],"efeitos_principais":[{"fator":"","nivel_baixo":0.0,"nivel_alto":0.0}]}
}`,
  }[state.type] || `{"resumo":"","estatisticas_descritivas":{"por_variavel":[]},"tabela_anova":[],"efeitos":[],"r2":0.0,"r2_ajustado":0.0,"conclusao":"","dados_graficos":{"medias_por_grupo":[],"residuos":[],"valores_ajustados":[],"efeitos_principais":[]}}`;

  return `Você é estatístico especializado em DOE (Design of Experiments).
Calcule tudo numericamente com base nos dados reais fornecidos — não use valores de exemplo.

DADOS CSV:
${csv}
${buildUnitsContext()}
${buildLevelsContext()}
${preCalc}
CONFIGURAÇÃO:
- Análise: ${label}
- Entradas: ${inputs.join(', ')}
- Saídas: ${outputs.join(', ')}
- Observações: ${state.rows.length}

MÉTODO ESTATÍSTICO — SIGA RIGOROSAMENTE:
${guide}

Retorne SOMENTE o JSON abaixo, sem texto antes ou depois, sem markdown, sem comentários.
Substitua todos os 0.0 pelos valores reais calculados.
REGRA CRÍTICA: nos arrays "residuos" e "valores_ajustados", inclua NO MÁXIMO 8 valores — nunca liste todos os N valores da amostra.
${jsonTemplate}`;
}

function extractJSON(raw){
  let text=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  try{ return JSON.parse(text); } catch(_){}
  let depth=0,start=-1;
  for(let i=0;i<text.length;i++){
    if(text[i]==='{'){if(depth===0)start=i;depth++;}
    else if(text[i]==='}'){
      depth--;
      if(depth===0&&start!==-1){
        try{return JSON.parse(text.slice(start,i+1));}catch(_){start=-1;}
      }
    }
  }
  return null;
}

/* ════════════════════════════════════════════════════════════
   STEP 5 — RESULTADOS
   ════════════════════════════════════════════════════════════ */
function renderResults(r,label){
  renderStep(5);
  const r2pct  = r.r2          !=null?(r.r2*100).toFixed(1)+'%':'—';
  const r2apct = r.r2_ajustado !=null?(r.r2_ajustado*100).toFixed(1)+'%':'—';

  document.getElementById('result-container').innerHTML=`
    <div class="result-section">
      <h3><i class="ti ti-info-circle"></i> Resumo — ${esc(label)}
        <span class="badge blue" style="margin-left:auto">R² = ${r2pct}</span>
        <span class="badge green" style="margin-left:4px">R² aj. = ${r2apct}</span>
      </h3>
      <div class="result-text">${esc(r.resumo||'—')}</div>
    </div>
    <div class="result-section">
      <h3><i class="ti ti-table"></i> Estatísticas descritivas</h3>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>Variável</th><th>n</th><th>Média</th><th>DP</th>
          <th>Mín</th><th>Mediana</th><th>Máx</th><th>CV%</th>
        </tr></thead><tbody id="desc-tbody"></tbody></table>
      </div>
    </div>
    <div class="result-section">
      <h3><i class="ti ti-math"></i> Tabela ANOVA</h3>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>Fonte</th><th>GL</th><th>SQ</th><th>QM</th><th>F</th><th>p-valor</th><th>Sig.</th>
        </tr></thead><tbody id="anova-tbody"></tbody></table>
      </div>
    </div>
    <div class="result-section">
      <h3><i class="ti ti-arrows-shuffle"></i> Estimativas dos efeitos</h3>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>Efeito</th><th>Estimativa</th><th>Erro padrão</th><th>t</th><th>p-valor</th>
        </tr></thead><tbody id="eff-tbody"></tbody></table>
      </div>
    </div>
    <div class="result-section">
      <h3><i class="ti ti-chart-area"></i> Gráficos</h3>
      <div class="charts-grid">
        <div class="chart-wrap"><div class="chart-title">Médias por grupo</div><canvas id="ch-means"></canvas></div>
        <div class="chart-wrap"><div class="chart-title">Efeitos principais</div><canvas id="ch-effects"></canvas></div>
        <div class="chart-wrap"><div class="chart-title">Resíduos vs. ajustados</div><canvas id="ch-resid"></canvas></div>
        <div class="chart-wrap"><div class="chart-title">Distribuição dos resíduos</div><canvas id="ch-hist"></canvas></div>
      </div>
    </div>
    ${state.type==='anova1' && r.tukey?.length ? `
    <div class="result-section">
      <h3><i class="ti ti-arrows-diff"></i> Comparação múltipla — HSD de Tukey</h3>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>Comparação</th><th>Diferença</th><th>HSD (α=5%)</th><th>Sig.</th>
        </tr></thead><tbody id="tukey-tbody"></tbody></table>
      </div>
    </div>` : ''}

    ${state.type==='anova2' && r.criterios_multivariados ? `
    <div class="result-section">
      <h3><i class="ti ti-chart-radar"></i> Critérios multivariados (MANOVA)</h3>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>Critério</th><th>Valor</th><th>F aprox.</th><th>p-valor</th><th>Sig.</th>
        </tr></thead><tbody id="manova-tbody"></tbody></table>
      </div>
    </div>` : ''}

    ${state.type==='fat2k' && r.dados_graficos?.pareto_efeitos?.length ? `
    <div class="result-section">
      <h3><i class="ti ti-chart-bar-popular"></i> Pareto dos efeitos (|Efeito| padronizado)</h3>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>Efeito</th><th>|Estimativa|</th><th>Sig.</th>
        </tr></thead><tbody id="pareto-tbody"></tbody></table>
      </div>
    </div>` : ''}

    ${state.type==='ccd' && r.ponto_otimo ? `
    <div class="result-section">
      <h3><i class="ti ti-target"></i> Ponto estacionário (ótimo)</h3>
      <div class="table-wrap">
        <table class="data-table"><thead><tr>
          <th>Fator</th><th>Codificado (xₛ)</th><th>Real</th>
        </tr></thead><tbody id="otimo-tbody"></tbody></table>
      </div>
      <div style="margin-top:8px;padding:8px 12px;background:var(--success-bg);border-radius:var(--radius);font-size:13px;color:var(--success-text)">
        <strong>Resposta predita:</strong> ${fmt(r.ponto_otimo.resposta_predita)}
        &nbsp;|&nbsp; <strong>Tipo:</strong> ${esc(r.ponto_otimo.tipo||'—')}
        ${r.ponto_otimo.autovalores_B?.length ? `&nbsp;|&nbsp; <strong>Autovalores de B:</strong> ${r.ponto_otimo.autovalores_B.map(v=>fmt(v)).join(', ')}` : ''}
      </div>
    </div>` : ''}

    <div class="result-section">
      <h3><i class="ti ti-notes"></i> Conclusões e recomendações</h3>
      <div class="result-text">${esc(r.conclusao||'—')}</div>
    </div>`;

  const tbody_desc=document.getElementById('desc-tbody');
  (r.estatisticas_descritivas?.por_variavel||[]).forEach(v=>{
    tbody_desc.innerHTML+=`<tr>
      <td>${esc(v.variavel)}</td><td>${v.n}</td>
      <td>${fmt(v.media)}</td><td>${fmt(v.dp)}</td>
      <td>${fmt(v.min)}</td><td>${fmt(v.mediana)}</td><td>${fmt(v.max)}</td><td>${fmt(v.cv)}%</td>
    </tr>`;
  });
  const tbody_anova=document.getElementById('anova-tbody');
  (r.tabela_anova||[]).forEach(row=>{
    const sig=row.significativo;
    tbody_anova.innerHTML+=`<tr>
      <td><strong>${esc(row.fonte)}</strong></td>
      <td>${row.gl}</td><td>${fmt(row.sq)}</td><td>${fmt(row.qm)}</td><td>${fmt(row.f)}</td>
      <td style="color:${sig?'var(--success-text)':'var(--text-muted)'}">${row.p_valor!=null?row.p_valor.toFixed(4):'—'}</td>
      <td>${sig?'<span class="badge green">*</span>':'<span style="color:var(--text-muted);font-size:12px">ns</span>'}</td>
    </tr>`;
  });
  const tbody_eff=document.getElementById('eff-tbody');
  (r.efeitos||[]).forEach(e=>{
    const sig=e.p_valor!=null&&e.p_valor<0.05;
    tbody_eff.innerHTML+=`<tr>
      <td>${esc(e.nome)}</td><td>${fmt(e.estimativa)}</td>
      <td>${fmt(e.erro_padrao)}</td><td>${fmt(e.t)}</td>
      <td style="color:${sig?'var(--success-text)':'var(--text-muted)'}">${e.p_valor!=null?e.p_valor.toFixed(4):'—'}</td>
    </tr>`;
  });
  setTimeout(()=>drawCharts(r),80);

  // ── Tukey (ANOVA1) ──────────────────────────────────────
  const tb_tukey=document.getElementById('tukey-tbody');
  if(tb_tukey) (r.tukey||[]).forEach(row=>{
    const sig=row.significativo;
    tb_tukey.innerHTML+=`<tr>
      <td>${esc(row.comparacao)}</td>
      <td>${fmt(row.diferenca)}</td>
      <td>${fmt(row.hsd)}</td>
      <td>${sig?'<span class="badge green">*</span>':'<span style="color:var(--text-muted);font-size:12px">ns</span>'}</td>
    </tr>`;
  });

  // ── Critérios MANOVA ────────────────────────────────────
  const tb_manova=document.getElementById('manova-tbody');
  if(tb_manova && r.criterios_multivariados){
    const cm=r.criterios_multivariados;
    const rows=[
      {crit:"Wilks' Lambda (Λ)",   val:fmt(cm.wilks_lambda),   F:fmt(cm.wilks_F),   p:cm.wilks_p},
      {crit:"Traço de Pillai (V)", val:fmt(cm.pillai_trace),  F:fmt(cm.pillai_F),  p:cm.pillai_p},
      {crit:"Hotelling-Lawley (T²)",val:fmt(cm.hotelling_trace),F:'—',             p:null},
    ];
    rows.forEach(row=>{
      const sig=row.p!=null&&row.p<0.05;
      tb_manova.innerHTML+=`<tr>
        <td>${row.crit}</td><td>${row.val}</td><td>${row.F}</td>
        <td style="color:${sig?'var(--success-text)':'var(--text-muted)'}">${row.p!=null?row.p.toFixed(4):'—'}</td>
        <td>${sig?'<span class="badge green">*</span>':'<span style="color:var(--text-muted);font-size:12px">ns</span>'}</td>
      </tr>`;
    });
  }

  // ── Pareto 2k ───────────────────────────────────────────
  const tb_pareto=document.getElementById('pareto-tbody');
  if(tb_pareto){
    const pareto=(r.dados_graficos?.pareto_efeitos||[])
      .slice().sort((a,b)=>b.valor_absoluto-a.valor_absoluto);
    pareto.forEach(row=>{
      tb_pareto.innerHTML+=`<tr>
        <td><strong>${esc(row.nome)}</strong></td>
        <td>${fmt(row.valor_absoluto)}</td>
        <td>${row.significativo?'<span class="badge green">*</span>':'<span style="color:var(--text-muted);font-size:12px">ns</span>'}</td>
      </tr>`;
    });
  }

  // ── Ponto ótimo CCD ─────────────────────────────────────
  const tb_otimo=document.getElementById('otimo-tbody');
  if(tb_otimo && r.ponto_otimo){
    const cod=r.ponto_otimo.coordenadas_codificadas||{};
    const real=r.ponto_otimo.coordenadas_reais||{};
    const keys=Object.keys(cod).length ? Object.keys(cod) : Object.keys(real);
    keys.forEach(fator=>{
      tb_otimo.innerHTML+=`<tr>
        <td>${esc(fator)}</td>
        <td>${fmt(cod[fator])}</td>
        <td><strong>${fmt(real[fator])}</strong></td>
      </tr>`;
    });
  }
}

const PALETTE=['#378ADD','#1D9E75','#D85A30','#D4537E','#BA7517','#7F77DD'];
function drawCharts(r){
  const gd=r.dados_graficos||{};
  const means=gd.medias_por_grupo||[]; const ef=gd.efeitos_principais||[];
  const res=gd.residuos||[]; const adj=gd.valores_ajustados||[];
  const el=id=>document.getElementById(id);
  if(el('ch-means')&&means.length) new Chart(el('ch-means'),{type:'bar',data:{labels:means.map(m=>m.grupo),datasets:[{label:'Média',data:means.map(m=>m.media),backgroundColor:'rgba(55,138,221,0.65)',borderColor:'rgba(24,95,165,0.9)',borderWidth:1}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:false}}}});
  if(el('ch-effects')&&ef.length) new Chart(el('ch-effects'),{type:'line',data:{labels:['Nível −1','Nível +1'],datasets:ef.map((e,i)=>({label:e.fator,data:[e.nivel_baixo,e.nivel_alto],borderColor:PALETTE[i%PALETTE.length],backgroundColor:'transparent',tension:0.1,pointRadius:5}))},options:{responsive:true,scales:{y:{beginAtZero:false}}}});
  if(el('ch-resid')&&res.length&&adj.length) new Chart(el('ch-resid'),{type:'scatter',data:{datasets:[{label:'Resíduos',data:adj.map((f,i)=>({x:parseFloat(f),y:parseFloat(res[i]??0)})),backgroundColor:'rgba(55,138,221,0.55)',pointRadius:5}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:'Valores ajustados'}},y:{title:{display:true,text:'Resíduos'}}}}});
  if(el('ch-hist')&&res.length){
    const BINS=8,min=Math.min(...res),max=Math.max(...res),step=(max-min)/BINS||1;
    const counts=new Array(BINS).fill(0);
    res.forEach(v=>{counts[Math.min(Math.floor((v-min)/step),BINS-1)]++;});
    new Chart(el('ch-hist'),{type:'bar',data:{labels:counts.map((_,i)=>(min+i*step).toFixed(2)),datasets:[{label:'Freq.',data:counts,backgroundColor:'rgba(29,158,117,0.6)',borderColor:'rgba(15,110,86,0.9)',borderWidth:1}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:'Resíduo'}},y:{title:{display:true,text:'Frequência'},ticks:{stepSize:1}}}}});
  }
}

/* ════════════════════════════════════════════════════════════
   EXPORTAÇÃO
   ════════════════════════════════════════════════════════════ */
function buildReportText(r,label,inputs,outputs){
  const SEP='='.repeat(52),sep2='-'.repeat(32);
  let t=`RELATÓRIO DE ANÁLISE ESTATÍSTICA\n${SEP}\n\n`;
  t+=`Tipo: ${label}\nModo: ${state.inputMode==='manual'?'entrada manual':'CSV'}\n`;
  t+=`Entradas: ${inputs.join(', ')}\nSaídas: ${outputs.join(', ')}\n`;
  t+=`Data: ${new Date().toLocaleString('pt-BR')}\n\n`;
  t+=`RESUMO\n${sep2}\n${r.resumo||'—'}\n\n`;
  const r2pct=r.r2!=null?(r.r2*100).toFixed(2)+'%':'—';
  const r2apct=r.r2_ajustado!=null?(r.r2_ajustado*100).toFixed(2)+'%':'—';
  t+=`R² = ${r2pct}   R² ajustado = ${r2apct}\n\n`;
  t+=`ESTATÍSTICAS DESCRITIVAS\n${sep2}\n`;
  (r.estatisticas_descritivas?.por_variavel||[]).forEach(v=>{
    t+=`${v.variavel}: n=${v.n}, média=${fmt(v.media)}, DP=${fmt(v.dp)}, mín=${fmt(v.min)}, máx=${fmt(v.max)}, CV=${fmt(v.cv)}%\n`;
  });
  t+=`\nTABELA ANOVA\n${sep2}\n`;
  (r.tabela_anova||[]).forEach(row=>{
    t+=`${row.fonte}: GL=${row.gl}, SQ=${fmt(row.sq)}, QM=${fmt(row.qm)}, F=${fmt(row.f)}, p=${row.p_valor?.toFixed(4)} ${row.significativo?'(*)':'(ns)'}\n`;
  });
  t+=`\nEFEITOS\n${sep2}\n`;
  (r.efeitos||[]).forEach(e=>{
    t+=`${e.nome}: Est=${fmt(e.estimativa)}, EP=${fmt(e.erro_padrao)}, t=${fmt(e.t)}, p=${e.p_valor?.toFixed(4)}\n`;
  });
  t+=`\nCONCLUSÕES\n${sep2}\n${r.conclusao||'—'}\n`;
  return t;
}

function exportReport(){
  if(!state.reportText){alert('Nenhum relatório disponível.');return;}
  const blob=new Blob([state.reportText],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`relatorio_${Date.now()}.txt`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}

/* ════════════════════════════════════════════════════════════
   REINICIAR / FINALIZAR
   ════════════════════════════════════════════════════════════ */
function restart(){
  if(!confirm('Reiniciar apagará todos os dados. Confirma?')) return;
  _uid=0;
  Object.assign(state,{
    type:'anova1',k:2,inputMode:'upload',
    headers:[],rows:[],colRoles:{},
    a1:{respName:'',respUnit:'',groups:[],replicas:3},
    a2:{groups:[],responses:[],replicas:3},
    fat2k:{factors:[],responses:[],replicas:1},
    ccd:{factors:[],responses:[],centerPts:3},
    result:null,reportText:'',
  });
  document.querySelectorAll('.type-card').forEach(c=>{c.classList.remove('selected');c.setAttribute('aria-pressed','false');});
  document.querySelector('[data-type="anova1"]').classList.add('selected');
  document.querySelector('[data-type="anova1"]').setAttribute('aria-pressed','true');
  document.querySelectorAll('.k-btn').forEach(b=>b.classList.remove('selected'));
  document.querySelector('[data-k="2"]').classList.add('selected');
  document.getElementById('k-field').style.display='none';
  document.getElementById('file-name-display').style.display='none';
  document.getElementById('preview-area').style.display='none';
  document.getElementById('btn-to-3').disabled=true;
  document.getElementById('file-input').value='';
  document.getElementById('step2-alert').style.display='none';
  document.getElementById('var-warning').style.display='none';
  document.getElementById('proc-log').style.borderColor='';
  document.getElementById('type-info-text').textContent=TYPE_INFO.anova1;
  switchMode('upload');
  initDefaults();
  renderStep(1);
}

function finish(){
  if(confirm('Encerrar análise? A página será recarregada.')) window.location.reload();
}

/* ════════════════════════════════════════════════════════════
   UTILITÁRIOS
   ════════════════════════════════════════════════════════════ */
function fmt(v){ if(v==null||v==='') return '—'; return parseFloat(v).toFixed(3); }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s){ return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

/* ════════════════════════════════════════════════════════════
   UTILITÁRIOS NUMÉRICOS
   ════════════════════════════════════════════════════════════ */

/**
 * Normaliza valor numérico do usuário para ponto decimal:
 *   "12,5"    → "12.5"      (vírgula decimal BR)
 *   "1.234,5" → "1234.5"   (milhar ponto + decimal vírgula BR)
 *   "12.5"    → "12.5"      (ponto decimal padrão)
 *   "-1"      → "-1"        (valores codificados 2k/CCD)
 */
function normalizeNum(v) {
  if (!v && v !== 0) return '';
  let s = String(v).trim();
  if (s === '') return '';
  if (s.includes(',')) {
    // padrão BR: remove ponto de milhar, troca vírgula por ponto
    s = s.replace(/\./g, '').replace(',', '.');
  }
  return isNaN(parseFloat(s)) ? s : s;
}

/** True se o valor é numérico válido (aceita vírgula como decimal) */
function isNumericVal(v) {
  if (!v && v !== 0) return false;
  const s = String(v).trim();
  if (s === '') return false;
  return !isNaN(parseFloat(normalizeNum(s)));
}

/**
 * Normaliza um array de valores de uma linha de dados:
 * os primeiros `nFixed` colunas são mantidos como texto (fatores codificados),
 * o restante é normalizado como número.
 */
function normalizeRow(row, nFixed) {
  return row.map((v, i) => i < nFixed ? v : normalizeNum(v));
}

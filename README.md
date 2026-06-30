# Análise Estatística de Experimentos

Ferramenta web para análise estatística de experimentos (ANOVA, 2k, CCD) com relatório gerado por IA.

## Estrutura

```
stat-experiment-analyzer/
├── index.html      ← interface principal
├── style.css       ← estilos (dark mode automático)
├── app.js          ← lógica do frontend
├── proxy.js        ← servidor proxy local (necessário para rodar)
├── examples/       ← CSVs de exemplo
└── README.md
```

## Como executar (obrigatório)

O proxy local é necessário porque navegadores bloqueiam chamadas diretas à API Anthropic por segurança (política CORS).

### 1. Instale o Node.js
Baixe em https://nodejs.org (versão 18 ou superior). Não requer `npm install`.

### 2. Obtenha sua chave de API Anthropic
Acesse https://console.anthropic.com → API Keys → Create Key.

### 3. Inicie o proxy

**Windows (Prompt de Comando):**
```cmd
set ANTHROPIC_API_KEY=sk-ant-SuaChaveAqui
node proxy.js
```

**Windows (PowerShell):**
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-SuaChaveAqui"
node proxy.js
```

**Linux / macOS:**
```bash
export ANTHROPIC_API_KEY=sk-ant-SuaChaveAqui
node proxy.js
```

### 4. Abra no navegador
```
http://localhost:3001
```

> **Não abra `index.html` direto** — o navegador bloqueará as chamadas à API. Use sempre o endereço `http://localhost:3001`.

---

## Métodos disponíveis

| Método | Modelo | Saídas principais |
|--------|--------|-------------------|
| **ANOVA Univariado** | `y_ij = μ + τ_i + ε_ij` | Tabela ANOVA, Tukey HSD, IC 95% por grupo |
| **ANOVA Multivariado** | MANOVA: `Y = XB + E` | Wilks' Λ, Pillai, Hotelling, ANOVAs protegidas |
| **Planejamento 2k** | Contrastes de Yates | Efeitos, SQ por contraste, Pareto, gráficos de efeitos |
| **Composto Central** | Modelo quadrático completo RSM | Coeficientes, LoF, ponto ótimo, autovalores de B |

## Formato do CSV (entrada por arquivo)

```csv
fator_A,fator_B,resposta
-1,-1,23.4
1,-1,27.8
-1,1,19.2
1,1,31.5
```

Níveis codificados: `-1` (baixo) e `1` (alto) para 2k e CCD.

## Entrada manual

Na aba "Entrada manual" do Step 2, cada tipo de experimento tem seu próprio formulário:

- **ANOVA 1**: nome e unidade da resposta, grupos com nível/descrição, número de réplicas → tabela preenchida por grupo × réplica
- **ANOVA 2**: grupos + múltiplas respostas (nome e unidade), réplicas → tabela preenchida
- **2k**: k fatores com nome, unidade, nível baixo e alto → **tabela de Yates gerada automaticamente** (−1/+1), usuário preenche apenas as colunas de resposta, por réplica
- **CCD**: k fatores + pontos centrais → tabela com pontos fatoriais (±1), axiais (±α) e centrais (0) gerada automaticamente

## Porta alternativa

```bash
PORT=3002 node proxy.js   # Linux/macOS
set PORT=3002 && node proxy.js   # Windows CMD
```

## Segurança

- A chave de API fica apenas no ambiente do servidor local (proxy.js), nunca no código-fonte
- O proxy só aceita conexões de `127.0.0.1` (localhost)
- Nunca adicione `ANTHROPIC_API_KEY` ao repositório Git

## Licença

MIT

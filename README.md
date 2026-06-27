# Análise Estatística de Experimentos

Ferramenta web para análise estatística de experimentos científicos e industriais. Interface guiada por etapas — carregue um CSV, classifique as variáveis e obtenha relatório completo gerado por IA.

## Funcionalidades

| Método | Descrição |
|--------|-----------|
| **ANOVA Univariado** | Compara médias entre grupos para uma variável resposta |
| **ANOVA Multivariado (MANOVA)** | Múltiplas variáveis resposta analisadas simultaneamente |
| **Planejamento Fatorial 2k** | Fatorial completo com k fatores em dois níveis (k = 2 a 6) |
| **Composto Central (CCD)** | Superfície de resposta com pontos fatoriais, axiais e centrais |

### Saídas geradas

- Estatísticas descritivas (n, média, DP, mín, máx, mediana, CV%)
- Tabela ANOVA com GL, SQ, QM, F e p-valor
- Estimativas dos efeitos com erro padrão e teste t
- Coeficientes R² e R² ajustado
- Gráficos: médias com IC 95%, efeitos principais, resíduos vs. ajustados, histograma de resíduos
- Relatório exportável em `.txt`

## Estrutura do projeto

```
stat-experiment-analyzer/
├── index.html                        # Interface principal
├── style.css                         # Estilos (dark mode automático)
├── app.js                            # Lógica da aplicação
├── examples/
│   ├── exemplo_anova_univariado.csv  # 4 tratamentos × 5 repetições
│   ├── exemplo_2k_fatorial.csv       # 2³ com 2 réplicas
│   └── exemplo_ccd.csv               # CCD com 2 fatores
└── README.md
```

## Pré-requisitos

Nenhuma dependência local. O projeto usa apenas:

- [Chart.js 4.4](https://www.chartjs.org/) — gráficos (via CDN)
- [Tabler Icons 3.19](https://tabler.io/icons) — ícones (via CDN)
- [API Anthropic](https://docs.anthropic.com/) — análise estatística por IA

## Executar localmente

Abra `index.html` com qualquer servidor HTTP estático:

```bash
# Python 3
python -m http.server 8080

# Node.js
npx serve .
```

Acesse `http://localhost:8080`.

> **Atenção:** abrir `index.html` direto no navegador (`file://`) bloqueia as chamadas à API por política CORS. Use sempre um servidor HTTP.

## Configuração da API Anthropic

A chamada à API está em `app.js` (constante `API_URL`). **Para produção, não exponha a chave no frontend.** Alternativas recomendadas:

### 1 — Proxy backend (recomendado)

Crie um endpoint `/api/analyze` no seu servidor que injete a chave:

```js
// Exemplo com Express (Node.js)
app.post('/api/analyze', async (req, res) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(req.body),
  });
  res.json(await response.json());
});
```

Em `app.js`, altere:
```js
const API_URL = '/api/analyze';
```

### 2 — Serverless (Vercel / Netlify Functions)

Crie `api/analyze.js` (Vercel) ou `netlify/functions/analyze.js` e aponte `API_URL` para a função.

### 3 — Desenvolvimento local

Defina a chave em uma variável de ambiente e injete via build tool (Vite, Webpack). Nunca comite a chave no repositório.

## Formato do CSV

Primeira linha = nomes das colunas. Separador = vírgula.

### ANOVA univariado
```csv
tratamento,resultado
A,12.3
A,13.1
B,15.2
B,14.8
```

### ANOVA multivariado
```csv
grupo,resposta1,resposta2
A,12.3,45.1
A,13.1,44.7
B,15.2,50.3
```

### Planejamento 2k (k = 3)
```csv
fator_A,fator_B,fator_C,resposta
-1,-1,-1,23.4
 1,-1,-1,27.8
-1, 1,-1,19.2
 1, 1,-1,31.5
```
Níveis codificados: `-1` (baixo) e `1` (alto).

### CCD
```csv
temperatura,pressao,conversao
-1,-1,68.2
 1,-1,74.5
-1, 1,71.3
 1, 1,80.1
-1.414,0,65.8
 1.414,0,82.3
 0,-1.414,70.1
 0, 1.414,75.6
 0,0,77.4
 0,0,78.1
```
Inclua pontos fatoriais (±1), axiais (±α) e centrais (0).

## Fluxo de uso

```
1. Tipo      → escolha o método e, se aplicável, k
2. Dados     → faça upload do CSV; verifique a pré-visualização
3. Variáveis → classifique cada coluna como Entrada, Saída ou Ignorar
4. Processar → análise enviada à API (alguns segundos)
5. Relatório → tabelas e gráficos; botão Exportar gera .txt
```

## Compatibilidade

Testado nos navegadores modernos (Chrome 120+, Firefox 121+, Safari 17+, Edge 120+). Não requer build ou transpilação — HTML/CSS/JS puros.

## Licença

MIT — livre para uso, modificação e distribuição.

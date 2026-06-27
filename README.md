# Análise Estatística de Experimentos

Ferramenta web para análise estatística de experimentos científicos e industriais, com interface guiada por etapas e relatório automático gerado por IA.

## Funcionalidades

| Método | Descrição |
|--------|-----------|
| **ANOVA Univariado** | Compara médias entre grupos para uma variável resposta |
| **ANOVA Multivariado (MANOVA)** | Múltiplas variáveis de resposta analisadas simultaneamente |
| **Planejamento Fatorial 2k** | Fatorial completo com k fatores (k = 2 a 6) em dois níveis |
| **Composto Central (CCD)** | Superfície de resposta com pontos fatoriais, axiais e centrais |

### O que é gerado

- Estatísticas descritivas (média, DP, mín, máx, mediana, CV%)
- Tabela ANOVA com GL, SQ, QM, F e p-valor
- Estimativas dos efeitos com erro padrão e teste t
- Coeficientes R² e R² ajustado
- Gráficos: médias com IC 95%, efeitos principais, resíduos vs. ajustados, histograma de resíduos
- Relatório exportável em `.txt`

## Pré-requisitos

Nenhuma dependência local. O projeto usa apenas:

- [Chart.js 4.4](https://www.chartjs.org/) — gráficos (CDN)
- [Tabler Icons](https://tabler.io/icons) — ícones (CDN)
- [API Anthropic](https://docs.anthropic.com/) — análise estatística via IA

> **Atenção:** a chave de API Anthropic deve ser configurada no ambiente de hospedagem (ver abaixo).

## Estrutura do projeto

```
stat-experiment-analyzer/
├── index.html          # Interface principal
├── style.css           # Estilos (dark mode automático)
├── app.js              # Lógica da aplicação
├── examples/           # CSVs de exemplo para testar
│   ├── exemplo_anova_univariado.csv
│   ├── exemplo_2k_fatorial.csv
│   └── exemplo_ccd.csv
└── README.md
```

## Uso local

Basta abrir `index.html` em qualquer servidor HTTP estático:

```bash
# Python
python -m http.server 8080

# Node.js (npx)
npx serve .

# VS Code
# extensão Live Server → clique em "Go Live"
```

Acesse `http://localhost:8080`.

> Abrir `index.html` direto no navegador (`file://`) bloqueia as chamadas à API por política CORS. Use sempre um servidor HTTP.

## Configuração da API

A chamada à API Anthropic é feita do lado do cliente em `app.js`. Para produção, **não exponha a chave de API no frontend**. Opções recomendadas:

1. **Proxy backend** — crie um endpoint `/api/analyze` que injeta a chave server-side.
2. **Variável de ambiente** — se usar Vercel, Netlify Functions ou similar, mova a chamada para uma function.
3. **Desenvolvimento local** — use a chave diretamente só em ambiente controlado.

## Formato do CSV

A primeira linha deve conter os nomes das colunas. Os valores devem ser separados por vírgula.

### ANOVA univariado
```csv
tratamento,resultado
A,12.3
B,15.2
```

### Planejamento 2k (k = 3)
```csv
fator_A,fator_B,fator_C,resposta
-1,-1,-1,23.4
 1,-1,-1,27.8
```
Os níveis devem ser codificados como `-1` (baixo) e `+1` / `1` (alto).

### CCD
```csv
temperatura,pressao,conversao
-1,-1,68.2
 1,-1,74.5
-1.414,0,65.8
 0,0,77.4
```
Inclua pontos fatoriais (±1), axiais (±α) e centrais (0).

## Fluxo de uso

1. **Tipo** — escolha o método e, se aplicável, o valor de k
2. **Dados** — faça upload do CSV; veja a pré-visualização
3. **Variáveis** — classifique cada coluna como Entrada, Saída ou Ignorar
4. **Processar** — a análise é enviada à API
5. **Relatório** — visualize tabelas e gráficos; exporte o relatório

## Licença

MIT — livre para uso, modificação e distribuição.

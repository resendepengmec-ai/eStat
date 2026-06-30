# Guia de Deploy em Nuvem

O `server.js` serve os arquivos estáticos **e** faz o proxy para a API Anthropic.
Qualquer usuário com a URL acessa o sistema — sem instalar nada.

---

## Opção A — Render (mais simples, gratuito)

**Render.com** é a opção mais fácil: conecta ao GitHub e deploy automático.

### Passos

1. Crie conta em **https://render.com** (login com GitHub)
2. **New → Web Service**
3. Conecte seu repositório GitHub
4. Configure:
   ```
   Name:         analise-experimentos
   Runtime:      Node
   Build Command: (deixar vazio)
   Start Command: node server.js
   ```
5. Em **Environment Variables**, adicione:
   ```
   ANTHROPIC_API_KEY = sk-ant-SuaChaveAqui
   ```
6. Clique em **Create Web Service**

Em ~2 minutos a URL estará disponível:
```
https://analise-experimentos.onrender.com
```

**Plano gratuito:** serviço dorme após 15 min sem uso (acorda em ~30s na próxima visita).
**Plano Starter ($7/mês):** sempre ativo.

---

## Opção B — Railway (gratuito com $5 de crédito/mês)

1. Acesse **https://railway.app** → login com GitHub
2. **New Project → Deploy from GitHub repo**
3. Selecione o repositório
4. Railway detecta o `package.json` automaticamente
5. Em **Variables**, adicione:
   ```
   ANTHROPIC_API_KEY = sk-ant-SuaChaveAqui
   ```
6. Deploy automático — URL gerada em ~1 min

```
https://analise-experimentos.up.railway.app
```

---

## Opção C — Google Cloud Run (escalável, paga por uso)

Requer [Google Cloud SDK](https://cloud.google.com/sdk) instalado.

```bash
# 1. Login no Google Cloud
gcloud auth login

# 2. Crie ou selecione um projeto
gcloud projects create analise-experimentos --set-as-default
# OU selecione existente:
gcloud config set project SEU_PROJECT_ID

# 3. Ative as APIs necessárias
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# 4. Deploy direto do código fonte (sem Docker manual)
gcloud run deploy analise-experimentos \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=sk-ant-SuaChaveAqui \
  --memory 256Mi \
  --min-instances 0 \
  --max-instances 3

# 5. URL gerada ao final:
# https://analise-experimentos-xxxx-uc.a.run.app
```

**Custo:** gratuito até 2M requisições/mês e 360.000 vCPU-segundos.
Com `min-instances 0`: serviço dorme sem uso (cold start de ~2s).
Com `min-instances 1`: sempre ativo (~$5/mês).

---

## Opção D — Fly.io (gratuito, sempre ativo)

```bash
# 1. Instale flyctl: https://fly.io/docs/hands-on/install-flyctl/
# 2. Login
fly auth login

# 3. Na pasta do projeto:
fly launch --name analise-experimentos --region gru  # gru = São Paulo

# 4. Defina a chave de API
fly secrets set ANTHROPIC_API_KEY=sk-ant-SuaChaveAqui

# 5. Deploy
fly deploy

# URL:
# https://analise-experimentos.fly.dev
```

**Plano gratuito:** 3 VMs compartilhadas sempre ativas.

---

## Comparação rápida

| Plataforma   | Gratuito        | Sempre ativo | Facilidade | Região BR |
|-------------|-----------------|--------------|------------|-----------|
| Render      | Sim (dorme)     | $7/mês       | ⭐⭐⭐⭐⭐  | Não       |
| Railway     | $5 crédito/mês  | Sim          | ⭐⭐⭐⭐    | Não       |
| Cloud Run   | Sim (por uso)   | $5/mês       | ⭐⭐⭐      | Sim (SP)  |
| Fly.io      | Sim (3 VMs)     | Sim          | ⭐⭐⭐      | Sim (GRU) |

**Recomendação:** comece pelo **Render** (mais simples) ou **Fly.io** (gratuito + sempre ativo + São Paulo).

---

## Variáveis de ambiente necessárias

Todas as plataformas precisam apenas de:

```
ANTHROPIC_API_KEY = sk-ant-SuaChaveAqui
```

A chave **nunca vai para o GitHub** — fica apenas no painel do provedor.

---

## Atualizar após mudanças

Com o GitHub conectado (Render, Railway), basta:

```bash
git add .
git commit -m "atualização"
git push
```

O deploy novo acontece automaticamente em ~1 minuto.

Para Cloud Run e Fly.io, rodar `gcloud run deploy ...` ou `fly deploy` novamente.

# Dockerfile para Google Cloud Run, Railway, Render, Fly.io
FROM node:20-alpine

# Diretório de trabalho
WORKDIR /app

# Copia todos os arquivos do projeto
COPY . .

# Remove arquivos desnecessários em produção
RUN rm -f proxy.js && \
    rm -rf deploy/ examples/.gitkeep

# Porta padrão (Cloud Run usa PORT via env var)
EXPOSE 8080

# Inicia o servidor
CMD ["node", "server.js"]

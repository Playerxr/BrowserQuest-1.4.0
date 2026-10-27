FROM node:22-bookworm-slim

# Repertoire de l'application
WORKDIR /app

# Outils de compilation natifs pour better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copie des dependances et installation de production
COPY package*.json ./
RUN npm install --omit=dev

# Copie des sources du jeu
COPY . .

# Variables d'environnement standard
ENV PORT=8000
ENV NODE_ENV=production
ENV BROWSERQUEST_TRUST_PROXY=true

# Port d'ecoute
EXPOSE 8000

# Lancement du serveur Nova Quest 24/7
CMD ["node", "server/js/main.js"]

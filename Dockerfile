# منصة السلامة HSE — حاوية جاهزة لأي استضافة (Render/Railway/VPS)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
# تهيئة البيانات التجريبية عند أول تشغيل فقط، ثم تشغيل الخادم
CMD ["sh", "-c", "[ -f data/hse.db ] || node server/seed.js --force; node server/index.js"]

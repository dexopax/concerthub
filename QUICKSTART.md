# 🚀 Быстрый старт

## Локальный запуск (для тестирования)

1. **Установите зависимости:**
   \`\`\`bash
   npm install
   \`\`\`

2. **Запустите сервер:**
   \`\`\`bash
   npm start
   \`\`\`

3. **Откройте в браузере:**
   - Основной сайт: http://localhost:3000
   - Админ-панель: http://localhost:3000/admin
   - Логин/пароль: admin / admin123

## Деплой на tales-values.com

### Способ 1: Node.js хостинг (если доступен)

1. Загрузите все файлы на сервер
2. В терминале сервера:
   \`\`\`bash
   npm install
   npm start
   \`\`\`

### Способ 2: VPS сервер (полный контроль)

1. **Подключитесь по SSH**

2. **Установите Node.js:**
   \`\`\`bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   \`\`\`

3. **Загрузите проект:**
   \`\`\`bash
   cd /var/www/tales-values.com
   # Загрузите файлы через FTP или git
   \`\`\`

4. **Установите зависимости:**
   \`\`\`bash
   npm install
   \`\`\`

5. **Установите PM2 (менеджер процессов):**
   \`\`\`bash
   sudo npm install -g pm2
   pm2 start server.js --name concerthub
   pm2 startup
   pm2 save
   \`\`\`

6. **Настройте Nginx:**
   \`\`\`bash
   sudo nano /etc/nginx/sites-available/tales-values.com
   \`\`\`

   Добавьте:
   \`\`\`nginx
   server {
       listen 80;
       server_name tales-values.com www.tales-values.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   \`\`\`

   Активируйте конфигурацию:
   \`\`\`bash
   sudo ln -s /etc/nginx/sites-available/tales-values.com /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   \`\`\`

### Способ 3: Облачные платформы (самый простой)

**Railway.app (рекомендуется - бесплатный):**
1. Зарегистрируйтесь на railway.app
2. Нажмите "New Project" → "Deploy from GitHub repo"
3. Подключите ваш репозиторий
4. Railway автоматически развернет приложение
5. Получите ссылку на сайт
6. Настройте свой домен в настройках Railway

**Render.com (также бесплатный):**
1. Зарегистрируйтесь на render.com
2. New → Web Service
3. Подключите репозиторий
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Deploy!

## ⚙️ Настройка для production

1. **Измените пароль администратора:**
   В server.js найдите строку с `admin123` и измените на надежный пароль

2. **Настройте переменные окружения:**
   Создайте файл `.env`:
   \`\`\`
   PORT=3000
   JWT_SECRET=ваш-супер-секретный-ключ-минимум-32-символа
   NODE_ENV=production
   \`\`\`

3. **Установите SSL (HTTPS):**
   \`\`\`bash
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot --nginx -d tales-values.com -d www.tales-values.com
   \`\`\`

## 📝 Полезные команды PM2

\`\`\`bash
pm2 list                  # Список процессов
pm2 logs concerthub       # Просмотр логов
pm2 restart concerthub    # Перезапуск
pm2 stop concerthub       # Остановка
pm2 delete concerthub     # Удаление
\`\`\`

## 🆘 Помощь

Если что-то не работает:
1. Проверьте логи: `pm2 logs concerthub`
2. Проверьте статус: `pm2 status`
3. Проверьте порт: `netstat -tulpn | grep 3000`
4. Проверьте Nginx: `sudo nginx -t`

## 📞 Контакты

При возникновении проблем обращайтесь к разработчику.

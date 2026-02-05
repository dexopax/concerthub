const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const QRCode = require('qrcode');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize Resend with API key
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_hU331c45_rFNGda6H4Biwzokam7HjCLot';
const resend = new Resend(RESEND_API_KEY);

// Helper function to generate unique order number
function generateOrderNumber() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `ORD-${timestamp}-${random}`.toUpperCase();
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('./concerthub.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('✅ Connected to SQLite database');
        initDatabase();
    }
});

// Initialize database tables
function initDatabase() {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Concerts table
    db.run(`
        CREATE TABLE IF NOT EXISTS concerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            genre TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            venue TEXT NOT NULL,
            price INTEGER NOT NULL,
            image TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Orders table
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            concert_id INTEGER NOT NULL,
            concert_title TEXT NOT NULL,
            ticket_type TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price_per_ticket INTEGER NOT NULL,
            total_price INTEGER NOT NULL,
            customer_email TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            order_number TEXT UNIQUE NOT NULL,
            qr_code TEXT,
            order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending',
            FOREIGN KEY (concert_id) REFERENCES concerts(id)
        )
    `);

    // Create default admin user
    const defaultPassword = 'admin123';
    bcrypt.hash(defaultPassword, 10, (err, hash) => {
        if (err) {
            console.error('Error hashing password:', err);
            return;
        }

        db.run(`
            INSERT OR IGNORE INTO users (username, password, role) 
            VALUES ('admin', ?, 'admin')
        `, [hash], (err) => {
            if (err) {
                console.error('Error creating admin user:', err);
            } else {
                console.log('✅ Default admin user created (admin/admin123)');
            }
        });
    });

    // Insert default concerts
    const defaultConcerts = [
        {
            title: "The Rolling Stones",
            genre: "Рок",
            date: "2026-03-15",
            time: "20:00",
            venue: "Олимпийский стадион, Москва",
            price: 5000,
            image: "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=500",
            description: "Легендарная британская рок-группа с их новым мировым турне!"
        },
        {
            title: "Билли Айлиш",
            genre: "Поп",
            date: "2026-04-20",
            time: "19:00",
            venue: "СК Лужники, Москва",
            price: 4500,
            image: "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=500",
            description: "Яркое выступление мировой поп-звезды с её последним альбомом."
        }
    ];

    db.get('SELECT COUNT(*) as count FROM concerts', (err, row) => {
        if (!err && row.count === 0) {
            const stmt = db.prepare(`
                INSERT INTO concerts (title, genre, date, time, venue, price, image, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            defaultConcerts.forEach(concert => {
                stmt.run([
                    concert.title,
                    concert.genre,
                    concert.date,
                    concert.time,
                    concert.venue,
                    concert.price,
                    concert.image,
                    concert.description
                ]);
            });

            stmt.finalize(() => {
                console.log('✅ Default concerts added');
            });
        }
    });
}

// Auth middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// ==================== AUTH ROUTES ====================

// Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    });
});

// ==================== CONCERTS ROUTES ====================

// Get all concerts
app.get('/api/concerts', (req, res) => {
    db.all('SELECT * FROM concerts ORDER BY date ASC', (err, concerts) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(concerts);
    });
});

// Get single concert
app.get('/api/concerts/:id', (req, res) => {
    db.get('SELECT * FROM concerts WHERE id = ?', [req.params.id], (err, concert) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!concert) {
            return res.status(404).json({ error: 'Concert not found' });
        }
        res.json(concert);
    });
});

// Add concert (protected)
app.post('/api/concerts', authenticateToken, (req, res) => {
    const { title, genre, date, time, venue, price, image, description } = req.body;

    db.run(
        `INSERT INTO concerts (title, genre, date, time, venue, price, image, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, genre, date, time, venue, price, image, description],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            res.status(201).json({ id: this.lastID, message: 'Concert created' });
        }
    );
});

// Update concert (protected)
app.put('/api/concerts/:id', authenticateToken, (req, res) => {
    const { title, genre, date, time, venue, price, image, description } = req.body;

    db.run(
        `UPDATE concerts 
         SET title = ?, genre = ?, date = ?, time = ?, venue = ?, price = ?, image = ?, description = ?
         WHERE id = ?`,
        [title, genre, date, time, venue, price, image, description, req.params.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Concert not found' });
            }
            res.json({ message: 'Concert updated', id: req.params.id });
        }
    );
});

// Delete concert (protected)
app.delete('/api/concerts/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM concerts WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Concert not found' });
        }
        res.json({ message: 'Concert deleted' });
    });
});

// ==================== ORDERS ROUTES ====================

// Helper function to generate email HTML template
function generateTicketEmailHTML(orderData) {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; margin: 0; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 32px; }
        .content { padding: 40px 30px; }
        .ticket { background: #f8f9ff; border: 2px dashed #667eea; border-radius: 15px; padding: 30px; margin: 20px 0; }
        .ticket-row { display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e0e0e0; }
        .ticket-row:last-child { border-bottom: none; margin-bottom: 0; }
        .ticket-label { color: #666; font-weight: 600; }
        .ticket-value { color: #333; font-weight: bold; }
        .qr-container { text-align: center; padding: 30px; background: white; border-radius: 15px; margin: 20px 0; }
        .qr-code { max-width: 250px; height: auto; }
        .order-number { font-size: 24px; font-weight: bold; color: #667eea; text-align: center; margin: 20px 0; letter-spacing: 2px; }
        .instructions { background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .footer { text-align: center; padding: 30px; color: #999; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎵 Ваш билет готов!</h1>
            <p>Спасибо за покупку, ${orderData.customer_name}!</p>
        </div>
        <div class="content">
            <div class="ticket">
                <div class="ticket-row"><span class="ticket-label">Концерт:</span><span class="ticket-value">${orderData.concert_title}</span></div>
                <div class="ticket-row"><span class="ticket-label">Тип билета:</span><span class="ticket-value">${orderData.ticket_type}</span></div>
                <div class="ticket-row"><span class="ticket-label">Количество:</span><span class="ticket-value">${orderData.quantity} шт.</span></div>
                <div class="ticket-row"><span class="ticket-label">Цена:</span><span class="ticket-value">${orderData.total_price.toLocaleString()} ₽</span></div>
            </div>
            <div class="order-number">Номер заказа: ${orderData.order_number}</div>
            <div class="qr-container">
                <h3>QR-код для входа</h3>
                <img src="${orderData.qr_code}" alt="QR Code" class="qr-code">
                <p style="color: #666;">Покажите этот QR-код на входе</p>
            </div>
            <div class="instructions">
                <h3>⚠️ Важная информация:</h3>
                <ul>
                    <li>Сохраните это письмо - оно является вашим билетом</li>
                    <li>QR-код нужно предъявить на входе</li>
                    <li>Приходите за 30 минут до начала</li>
                    <li>Один QR-код = один вход</li>
                </ul>
            </div>
        </div>
        <div class="footer">
            <p><strong>ConcertHub</strong> - Билеты на лучшие концерты</p>
            <p>Номер заказа: ${orderData.order_number}</p>
        </div>
    </div>
</body>
</html>
    `;
}

// Get all orders (protected)
app.get('/api/orders', authenticateToken, (req, res) => {
    db.all('SELECT * FROM orders ORDER BY order_date DESC', (err, orders) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(orders);
    });
});

// Create order
app.post('/api/orders', async (req, res) => {
    const { concert_id, concert_title, ticket_type, quantity, price_per_ticket, total_price, customer_email, customer_name, customer_phone } = req.body;

    // Validate required fields
    if (!customer_email || !customer_name || !customer_phone) {
        return res.status(400).json({ error: 'Customer information is required' });
    }

    // Generate unique order number
    const orderNumber = generateOrderNumber();

    // Generate QR code data (URL to verify ticket)
    const qrData = `${orderNumber}`;
    
    try {
        // Generate QR code as base64 string
        const qrCode = await QRCode.toDataURL(qrData);

        db.run(
            `INSERT INTO orders (concert_id, concert_title, ticket_type, quantity, price_per_ticket, total_price, customer_email, customer_name, customer_phone, order_number, qr_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [concert_id, concert_title, ticket_type, quantity, price_per_ticket, total_price, customer_email, customer_name, customer_phone, orderNumber, qrCode],
            async function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Prepare order data for email
                const orderData = {
                    concert_title,
                    ticket_type,
                    quantity,
                    total_price,
                    customer_name,
                    customer_email,
                    order_number: orderNumber,
                    qr_code: qrCode
                };
                
                // Send email with ticket
                try {
                    const emailResult = await resend.emails.send({
                        from: 'ConcertHub <tickets@tales-values.com>',
                        to: customer_email,
                        subject: `Ваш билет на ${concert_title} - Заказ ${orderNumber}`,
                        html: generateTicketEmailHTML(orderData)
                    });
                    console.log(`✅ Email sent to ${customer_email}`, emailResult);
                } catch (emailError) {
                    console.error('❌ Email sending error:', emailError);
                    console.error('Error details:', JSON.stringify(emailError, null, 2));
                    // Don't fail the order if email fails
                }
                
                res.status(201).json({
                    id: this.lastID,
                    order_number: orderNumber,
                    qr_code: qrCode,
                    message: 'Order created successfully'
                });
            }
        );
    } catch (error) {
        console.error('QR code generation error:', error);
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Get order statistics (protected)
app.get('/api/stats', authenticateToken, (req, res) => {
    const stats = {};

    // Total concerts
    db.get('SELECT COUNT(*) as count FROM concerts', (err, result) => {
        stats.totalConcerts = result ? result.count : 0;

        // Total orders
        db.get('SELECT COUNT(*) as count, SUM(total_price) as revenue FROM orders', (err, result) => {
            stats.totalOrders = result ? result.count : 0;
            stats.totalRevenue = result && result.revenue ? result.revenue : 0;

            res.json(stats);
        });
    });
});

// ==================== SERVE FRONTEND ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🎵 Main site: http://localhost:${PORT}/`);
    console.log(`📧 Email sender: tickets@tales-values.com`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err);
        }
        console.log('\n✅ Database connection closed');
        process.exit(0);
    });
});

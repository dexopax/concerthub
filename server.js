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
        initializeDatabase();
    }
});

function initializeDatabase() {
    // Create concerts table with city and views
    db.run(`CREATE TABLE IF NOT EXISTS concerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        city TEXT NOT NULL DEFAULT 'Москва',
        genre TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        image_url TEXT,
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create orders table
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        concert_id INTEGER NOT NULL,
        concert_title TEXT NOT NULL,
        ticket_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price_per_ticket INTEGER NOT NULL,
        total_price INTEGER NOT NULL,
        customer_name TEXT,
        customer_email TEXT,
        customer_phone TEXT,
        qr_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (concert_id) REFERENCES concerts (id)
    )`);

    // Create admin table
    db.run(`CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`, () => {
        const defaultPassword = 'admin123';
        bcrypt.hash(defaultPassword, 10, (err, hash) => {
            if (err) {
                console.error('Error hashing password:', err);
                return;
            }
            db.run(`INSERT OR IGNORE INTO admin (username, password) VALUES (?, ?)`,
                ['admin', hash],
                (err) => {
                    if (err) {
                        console.error('Error creating admin:', err);
                    } else {
                        console.log('✅ Default admin user created (admin/admin123)');
                    }
                });
        });
    });

    // Check if sample data exists
    db.get('SELECT COUNT(*) as count FROM concerts', (err, row) => {
        if (err) {
            console.error('Error checking concerts:', err);
        } else if (row.count === 0) {
            insertSampleData();
        }
    });
}

function insertSampleData() {
    const sampleConcerts = [
        {
            title: 'The Rolling Stones',
            artist: 'The Rolling Stones',
            date: '2026-03-15',
            venue: 'Олимпийский стадион',
            city: 'Москва',
            genre: 'Рок',
            description: 'Легендарная группа в Москве!',
            price: 5000,
            image_url: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800',
            views: 150
        },
        {
            title: 'Билли Айлиш',
            artist: 'Билли Айлиш',
            date: '2026-04-20',
            venue: 'СК Лужники',
            city: 'Москва',
            genre: 'Поп',
            description: 'Концерт молодой звезды',
            price: 4500,
            image_url: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800',
            views: 200
        },
        {
            title: 'Metallica',
            artist: 'Metallica',
            date: '2026-05-10',
            venue: 'Газпром Арена',
            city: 'Санкт-Петербург',
            genre: 'Метал',
            description: 'Тяжелый рок в Петербурге',
            price: 6000,
            image_url: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=800',
            views: 180
        }
    ];

    const stmt = db.prepare(`INSERT INTO concerts 
        (title, artist, date, venue, city, genre, description, price, image_url, views) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    sampleConcerts.forEach(concert => {
        stmt.run(
            concert.title,
            concert.artist,
            concert.date,
            concert.venue,
            concert.city,
            concert.genre,
            concert.description,
            concert.price,
            concert.image_url,
            concert.views
        );
    });

    stmt.finalize();
    console.log('✅ Sample concerts added to database');
}

// API Routes

// Get all concerts with optional filters
app.get('/api/concerts', (req, res) => {
    const { city, date, genre, sort } = req.query;
    
    let query = 'SELECT * FROM concerts WHERE 1=1';
    const params = [];

    if (city && city !== 'all') {
        query += ' AND city = ?';
        params.push(city);
    }

    if (date) {
        query += ' AND date = ?';
        params.push(date);
    }

    if (genre && genre !== 'all') {
        query += ' AND genre = ?';
        params.push(genre);
    }

    // Sorting
    if (sort === 'popular') {
        query += ' ORDER BY views DESC';
    } else if (sort === 'price_asc') {
        query += ' ORDER BY price ASC';
    } else if (sort === 'price_desc') {
        query += ' ORDER BY price DESC';
    } else {
        query += ' ORDER BY date ASC';
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Get available cities
app.get('/api/cities', (req, res) => {
    db.all('SELECT DISTINCT city FROM concerts ORDER BY city', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows.map(row => row.city));
        }
    });
});

// Get concert by ID and increment views
app.get('/api/concerts/:id', (req, res) => {
    const { id } = req.params;
    
    // Increment views
    db.run('UPDATE concerts SET views = views + 1 WHERE id = ?', [id], (err) => {
        if (err) {
            console.error('Error updating views:', err);
        }
    });

    db.get('SELECT * FROM concerts WHERE id = ?', [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (!row) {
            res.status(404).json({ error: 'Concert not found' });
        } else {
            res.json(row);
        }
    });
});

// Create new order
app.post('/api/orders', async (req, res) => {
    const {
        concert_id,
        concert_title,
        ticket_type,
        quantity,
        price_per_ticket,
        total_price,
        customer_name,
        customer_email,
        customer_phone
    } = req.body;

    const orderNumber = generateOrderNumber();

    try {
        // Generate QR code
        const qrCodeData = await QRCode.toDataURL(orderNumber);

        db.run(`INSERT INTO orders 
            (order_number, concert_id, concert_title, ticket_type, quantity, 
             price_per_ticket, total_price, customer_name, customer_email, 
             customer_phone, qr_code) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [orderNumber, concert_id, concert_title, ticket_type, quantity,
                price_per_ticket, total_price, customer_name, customer_email,
                customer_phone, qrCodeData],
            async function (err) {
                if (err) {
                    console.error('Database error:', err);
                    res.status(500).json({ error: 'Failed to create order' });
                    return;
                }

                // Send email with ticket
                try {
                    const emailResult = await resend.emails.send({
                        from: 'ConcertHub <tickets@tales-values.com>',
                        to: customer_email,
                        subject: `Ваш билет на ${concert_title} - Заказ ${orderNumber}`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                                    <h1 style="color: white; margin: 0;">🎵 Ваш билет готов!</h1>
                                    <p style="color: white; margin-top: 10px;">Спасибо за покупку, ${customer_name}!</p>
                                </div>
                                <div style="background: #f8f9ff; padding: 30px; border-radius: 0 0 10px 10px;">
                                    <h2 style="color: #333;">Концерт: ${concert_title}</h2>
                                    <p><strong>Тип билета:</strong> ${ticket_type}</p>
                                    <p><strong>Количество:</strong> ${quantity} шт.</p>
                                    <p><strong>Номер заказа:</strong> ${orderNumber}</p>
                                    <div style="text-align: center; margin: 30px 0;">
                                        <img src="${qrCodeData}" alt="QR Code" style="width: 200px; height: 200px;"/>
                                        <p style="color: #666; font-size: 12px;">Покажите этот QR-код на входе</p>
                                    </div>
                                    <div style="background: white; padding: 20px; border-radius: 8px; margin-top: 20px;">
                                        <h3 style="color: #667eea;">Итого: ${total_price.toLocaleString()} ₽</h3>
                                    </div>
                                </div>
                            </div>
                        `
                    });

                    console.log('✅ Email sent to', customer_email, emailResult);

                    res.json({
                        id: this.lastID,
                        order_number: orderNumber,
                        message: 'Order created successfully and ticket sent to email'
                    });
                } catch (emailError) {
                    console.error('❌ Email sending error:', emailError);
                    console.error('Error details:', JSON.stringify(emailError, null, 2));
                    res.json({
                        id: this.lastID,
                        order_number: orderNumber,
                        message: 'Order created but email failed to send'
                    });
                }
            });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Admin login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM admin WHERE username = ?', [username], (err, user) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else if (!user) {
            res.status(401).json({ error: 'Invalid credentials' });
        } else {
            bcrypt.compare(password, user.password, (err, result) => {
                if (err || !result) {
                    res.status(401).json({ error: 'Invalid credentials' });
                } else {
                    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
                    res.json({ token, username: user.username });
                }
            });
        }
    });
});

// Admin: Get all orders
app.get('/api/admin/orders', verifyToken, (req, res) => {
    db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Admin: Add concert
app.post('/api/admin/concerts', verifyToken, (req, res) => {
    const { title, artist, date, venue, city, genre, description, price, image_url } = req.body;

    db.run(`INSERT INTO concerts (title, artist, date, venue, city, genre, description, price, image_url, views) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [title, artist, date, venue, city, genre, description, price, image_url],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
            } else {
                res.json({ id: this.lastID, message: 'Concert added successfully' });
            }
        });
});

// Admin: Delete concert
app.delete('/api/admin/concerts/:id', verifyToken, (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM concerts WHERE id = ?', [id], function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ message: 'Concert deleted successfully' });
        }
    });
});

// Middleware to verify JWT token
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ error: 'No token provided' });
    }

    jwt.verify(token.replace('Bearer ', ''), JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.userId = decoded.id;
        next();
    });
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📧 Email sender: tickets@tales-values.com`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🎵 Main site: http://localhost:${PORT}/`);
});

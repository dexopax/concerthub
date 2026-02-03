const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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

function initDatabase() {
    // Users table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'admin'
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

        db.run(
            'INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)',
            ['admin', hash, 'admin'],
            (err) => {
                if (err) {
                    console.error('Error creating admin user:', err);
                } else {
                    console.log('✅ Default admin user created (admin/admin123)');
                }
            }
        );
    });

    // Insert default concerts
    const defaultConcerts = [
        {
            title: 'Рок-фестиваль 2025',
            genre: 'Рок',
            date: '2025-07-15',
            time: '19:00',
            venue: 'Олимпийский',
            price: 2500,
            image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=500',
            description: 'Грандиозный рок-фестиваль с участием лучших групп!'
        },
        {
            title: 'Джазовый вечер',
            genre: 'Джаз',
            date: '2025-08-20',
            time: '20:00',
            venue: 'Крокус Сити Холл',
            price: 3500,
            image: 'https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=500',
            description: 'Незабываемый вечер джазовой музыки в исполнении мировых звезд'
        }
    ];

    defaultConcerts.forEach(concert => {
        db.run(
            `INSERT OR IGNORE INTO concerts (title, genre, date, time, venue, price, image, description)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [concert.title, concert.genre, concert.date, concert.time, concert.venue, concert.price, concert.image, concert.description]
        );
    });
}

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Auth routes
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, username: user.username });
    });
});

// Concert routes
app.get('/api/concerts', (req, res) => {
    db.all('SELECT * FROM concerts ORDER BY date ASC', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
    });
});

app.get('/api/concerts/:id', (req, res) => {
    db.get('SELECT * FROM concerts WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (!row) {
            return res.status(404).json({ error: 'Concert not found' });
        }
        res.json(row);
    });
});

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
            res.status(201).json({ id: this.lastID, message: 'Concert created successfully' });
        }
    );
});

app.put('/api/concerts/:id', authenticateToken, (req, res) => {
    const { title, genre, date, time, venue, price, image, description } = req.body;

    db.run(
        `UPDATE concerts SET title = ?, genre = ?, date = ?, time = ?, venue = ?, price = ?, image = ?, description = ?
         WHERE id = ?`,
        [title, genre, date, time, venue, price, image, description, req.params.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Concert not found' });
            }
            res.json({ message: 'Concert updated successfully' });
        }
    );
});

app.delete('/api/concerts/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM concerts WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Concert not found' });
        }
        res.json({ message: 'Concert deleted successfully' });
    });
});

// Order routes
app.get('/api/orders', authenticateToken, (req, res) => {
    db.all('SELECT * FROM orders ORDER BY order_date DESC', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows);
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
            function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
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

// Statistics
app.get('/api/stats', authenticateToken, (req, res) => {
    const stats = {};

    db.get('SELECT COUNT(*) as count FROM concerts', [], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        stats.totalConcerts = row.count;

        db.get('SELECT COUNT(*) as count FROM orders', [], (err, row) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            stats.totalOrders = row.count;

            db.get('SELECT SUM(total_price) as total FROM orders', [], (err, row) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                stats.totalRevenue = row.total || 0;
                res.json(stats);
            });
        });
    });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🎵 Main site: http://localhost:${PORT}/`);
});

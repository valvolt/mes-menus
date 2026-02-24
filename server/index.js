const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const path = require('path');
const util = require('util');

const DB_PATH = process.env.DB_PATH || '/data/mes-menus.sqlite';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'cuisinier';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';
const PORT = process.env.PORT || 8080;

const db = new sqlite3.Database(DB_PATH);
db.runAsync = function(sql, ...params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};
db.getAsync = util.promisify(db.get.bind(db));
db.allAsync = util.promisify(db.all.bind(db));

async function initDb() {
  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('cuisinier','client')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Support two slots per meal (slot 1 and 2). Migrate existing table if needed.
  // We check PRAGMA table_info to detect whether the existing menu_assignments table exists
  // and whether it already has the 'slot' column. If not present we'll either create the
  // table with the new schema or migrate existing data into a new table preserving ids.
  const maCols = await db.allAsync(`PRAGMA table_info(menu_assignments)`);
  if (maCols.length === 0) {
    // table doesn't exist — create with slot and unique constraint on (date, meal, slot)
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS menu_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        meal TEXT NOT NULL CHECK(meal IN ('dejeuner','diner')),
        slot INTEGER NOT NULL DEFAULT 1 CHECK(slot IN (1,2)),
        assigned_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(date, meal, slot)
      );
    `);
  } else if (!maCols.find(c => c.name === 'slot')) {
    // migrate existing table: rename, recreate new schema, copy rows with slot=1, drop old
    await db.runAsync(`ALTER TABLE menu_assignments RENAME TO menu_assignments_old;`);
    await db.runAsync(`
      CREATE TABLE menu_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        meal TEXT NOT NULL CHECK(meal IN ('dejeuner','diner')),
        slot INTEGER NOT NULL DEFAULT 1 CHECK(slot IN (1,2)),
        assigned_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(date, meal, slot)
      );
    `);
    await db.runAsync(`
      INSERT INTO menu_assignments (id, menu_id, date, meal, slot, assigned_by, created_at)
      SELECT id, menu_id, date, meal, 1 as slot, assigned_by, created_at FROM menu_assignments_old;
    `);
    await db.runAsync(`DROP TABLE menu_assignments_old;`);
  }

  await db.runAsync(`
    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assignment_id INTEGER NOT NULL REFERENCES menu_assignments(id) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, assignment_id)
    );
  `);

  // Ensure admin (cuisinier) exists
  const existing = await db.getAsync(`SELECT * FROM users WHERE username = ?`, ADMIN_USERNAME);
  if (!existing) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await db.runAsync(
      `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'cuisinier')`,
      ADMIN_USERNAME,
      hash
    );
    console.log('Created admin user:', ADMIN_USERNAME);
  } else {
    console.log('Admin user exists:', ADMIN_USERNAME);
  }

  // Optionally create a default client account from environment variables
  const CLIENT_USERNAME = process.env.CLIENT_USERNAME;
  const CLIENT_PASSWORD = process.env.CLIENT_PASSWORD;
  if (CLIENT_USERNAME && CLIENT_PASSWORD) {
    const existingClient = await db.getAsync(`SELECT * FROM users WHERE username = ?`, CLIENT_USERNAME);
    if (!existingClient) {
      const chash = await bcrypt.hash(CLIENT_PASSWORD, 10);
      await db.runAsync(
        `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'client')`,
        CLIENT_USERNAME,
        chash
      );
      console.log('Created default client user:', CLIENT_USERNAME);
    } else {
      console.log('Default client exists:', CLIENT_USERNAME);
    }
  }
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireCuisinier(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'cuisinier') {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden: cuisinier only' });
  }
}

async function computeMenuStats(menuId) {
  // total assignments
  const countRow = await db.getAsync(
    `SELECT COUNT(*) as cnt FROM menu_assignments WHERE menu_id = ?`,
    menuId
  );
  const nombre_total_assignations = countRow ? countRow.cnt : 0;

  // average score across all ratings linked to assignments of this menu
  const avgRow = await db.getAsync(
    `SELECT AVG(r.score) as avg_score
     FROM ratings r
     JOIN menu_assignments ma ON ma.id = r.assignment_id
     WHERE ma.menu_id = ?`,
    menuId
  );
  const note_moyenne = avgRow && avgRow.avg_score ? Number(avgRow.avg_score).toFixed(2) : null;

  // trend: get averages per date ordered
  const rows = await db.allAsync(
    `SELECT ma.date as date, AVG(r.score) as avg_score
     FROM menu_assignments ma
     LEFT JOIN ratings r ON r.assignment_id = ma.id
     WHERE ma.menu_id = ?
     GROUP BY ma.date
     ORDER BY ma.date ASC`,
    menuId
  );

  let tendance = '—';
  if (rows.length === 0) {
    tendance = '—';
  } else if (rows.every(r => r.avg_score === rows[0].avg_score)) {
    tendance = 'constante';
  } else {
    const first = rows[0].avg_score || 0;
    const last = rows[rows.length - 1].avg_score || 0;
    if (last > first) tendance = 'en hausse';
    else if (last < first) tendance = 'en baisse';
    else tendance = 'constante';
  }

  return {
    nombre_total_assignations,
    note_moyenne: note_moyenne !== null ? Number(note_moyenne) : null,
    tendance
  };
}

async function getMenusSorted(sort = 'alpha') {
  // Base menus
  const menus = await db.allAsync(`SELECT id, name FROM menus`);

  // For each menu compute stats (small dataset expected)
  const enriched = [];
  for (const m of menus) {
    const stats = await computeMenuStats(m.id);
    enriched.push({
      id: m.id,
      name: m.name,
      ...stats
    });
  }

  if (sort === 'alpha') {
    enriched.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  } else if (sort === 'frequency') {
    enriched.sort((a, b) => b.nombre_total_assignations - a.nombre_total_assignations);
  } else if (sort === 'rating') {
    enriched.sort((a, b) => (b.note_moyenne || 0) - (a.note_moyenne || 0));
  }

  return enriched;
}

(async () => {
  await initDb();

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Ensure the session store uses the directory + filename derived from DB_PATH.
  // connect-sqlite3 expects 'db' to be the filename and 'dir' to be the directory.
  const storeDbFile = path.basename(DB_PATH);
  const storeDir = path.dirname(DB_PATH) || '.';
  app.use(
    session({
      store: new SQLiteStore({ db: storeDbFile, dir: storeDir }),
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // secure should be true in production with HTTPS
      }
    })
  );

  // Authentication endpoints
  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username & password required' });

    const user = await db.getAsync(`SELECT id, username, password_hash, role FROM users WHERE username = ?`, username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // store minimal user in session
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
      if (err) return res.status(500).json({ error: 'Could not logout' });
      res.json({ ok: true });
    });
  });

  // Return current session user (if any)
  app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
      res.json({ user: req.session.user });
    } else {
      res.json({ user: null });
    }
  });

  // Cuisinier creates clients
  app.post('/api/users', requireAuth, requireCuisinier, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username & password required' });

    try {
      const hash = await bcrypt.hash(password, 10);
      const result = await db.runAsync(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'client')`, username, hash);
      res.json({ ok: true, id: result.lastID });
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT') return res.status(400).json({ error: 'username exists' });
      console.error(err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // Create menu (cuisinier)
  app.post('/api/menus', requireAuth, requireCuisinier, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      const result = await db.runAsync(`INSERT INTO menus (name) VALUES (?)`, name);
      res.json({ ok: true, id: result.lastID });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // Update menu (cuisinier) - permet de modifier le nom d'un menu existant
  app.put('/api/menus/:id', requireAuth, requireCuisinier, async (req, res) => {
    const id = Number(req.params.id);
    const { name } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });

    try {
      const result = await db.runAsync(`UPDATE menus SET name = ? WHERE id = ?`, name, id);
      if (result && result.changes && result.changes > 0) {
        res.json({ ok: true });
      } else {
        res.status(404).json({ error: 'menu not found' });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // List menus with stats and sort
  app.get('/api/menus', requireAuth, requireCuisinier, async (req, res) => {
    const sort = req.query.sort || 'alpha';
    const list = await getMenusSorted(sort);
    res.json(list);
  });

  // Assign menu to a date+meal+slot (cuisinier)
  // Supports slot 1 or 2. If slot is not provided, defaults to 1.
  app.post('/api/assignments', requireAuth, requireCuisinier, async (req, res) => {
    const { menu_id, date, meal, slot } = req.body;
    if (!menu_id || !date || !meal) return res.status(400).json({ error: 'menu_id, date, meal required' });

    const d = dayjs(date, 'YYYY-MM-DD', true);
    if (!d.isValid()) return res.status(400).json({ error: 'invalid date' });

    const today = dayjs().startOf('day');
    const max = today.add(7, 'day');
    if (d.isBefore(today) || d.isAfter(max)) {
      return res.status(400).json({ error: 'date out of allowed range (today..today+7)' });
    }
    if (!['dejeuner', 'diner'].includes(meal)) return res.status(400).json({ error: 'invalid meal' });

    const s = slot ? Number(slot) : 1;
    if (![1,2].includes(s)) return res.status(400).json({ error: 'slot must be 1 or 2' });

    try {
      await db.runAsync(
        `INSERT OR REPLACE INTO menu_assignments (menu_id, date, meal, slot, assigned_by) VALUES (?, ?, ?, ?, ?)`,
        menu_id,
        d.format('YYYY-MM-DD'),
        meal,
        s,
        req.session.user.id
      );
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // Get assignments for a date (public: clients and cuisinier can see)
  app.get('/api/day/:date', async (req, res) => {
    const date = req.params.date;
    const d = dayjs(date, 'YYYY-MM-DD', true);
    if (!d.isValid()) return res.status(400).json({ error: 'invalid date' });

    const rows = await db.allAsync(
      `SELECT ma.id as assignment_id, ma.date, ma.meal, ma.slot, m.id as menu_id, m.name
       FROM menu_assignments ma
       JOIN menus m ON m.id = ma.menu_id
       WHERE ma.date = ?
       ORDER BY CASE WHEN ma.meal = 'dejeuner' THEN 0 ELSE 1 END, ma.slot ASC`,
      d.format('YYYY-MM-DD')
    );

    // Attach rating for current user if logged in
    let userId = null;
    if (req.session && req.session.user) userId = req.session.user.id;

    for (const r of rows) {
      if (userId) {
        const rating = await db.getAsync(
          `SELECT score FROM ratings WHERE user_id = ? AND assignment_id = ?`,
          userId,
          r.assignment_id
        );
        r.user_score = rating ? rating.score : null;
      } else {
        r.user_score = null;
      }
      // Average score for the assignment
      const avg = await db.getAsync(
        `SELECT AVG(score) as avg_score FROM ratings WHERE assignment_id = ?`,
        r.assignment_id
      );
      r.avg_score = avg && avg.avg_score ?(avg.avg_score).toFixed(2) : null;
    }

    res.json(rows);
  });

  // Shortcut for today
  app.get('/api/today', async (req, res) => {
    const date = dayjs().format('YYYY-MM-DD');
    res.redirect(`/api/day/${date}`);
  });

  // Create or update rating
  app.post('/api/ratings', requireAuth, async (req, res) => {
    const { assignment_id, score } = req.body;
    if (!assignment_id || !score) return res.status(400).json({ error: 'assignment_id & score required' });
    const s = Number(score);
    if (!Number.isInteger(s) || s < 1 || s > 5) return res.status(400).json({ error: 'score must be integer 1..5' });

    // Check assignment date rule: if date < today, cannot modify
    const assignment = await db.getAsync(`SELECT id, date FROM menu_assignments WHERE id = ?`, assignment_id);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });

    const assignmentDate = dayjs(assignment.date, 'YYYY-MM-DD');
    const today = dayjs().startOf('day');
    if (assignmentDate.isBefore(today)) {
      return res.status(400).json({ error: 'cannot modify ratings for past days' });
    }

    try {
      // Try update first
      const existing = await db.getAsync(
        `SELECT id FROM ratings WHERE user_id = ? AND assignment_id = ?`,
        req.session.user.id,
        assignment_id
      );
      if (existing) {
        await db.runAsync(
          `UPDATE ratings SET score = ?, updated_at = datetime('now') WHERE id = ?`,
          s,
          existing.id
        );
        return res.json({ ok: true, updated: true });
      } else {
        await db.runAsync(
          `INSERT INTO ratings (user_id, assignment_id, score) VALUES (?, ?, ?)`,
          req.session.user.id,
          assignment_id,
          s
        );
        return res.json({ ok: true, created: true });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'internal' });
    }
  });

  // Upcoming assignments for next N days (cuisinier)
  app.get('/api/upcoming', requireAuth, requireCuisinier, async (req, res) => {
    const days = parseInt(req.query.days || '7', 10);
    const today = dayjs().startOf('day');

    const results = [];
    for (let i = 0; i <= days; i++) {
      const d = today.add(i, 'day').format('YYYY-MM-DD');
      const rows = await db.allAsync(
        `SELECT ma.id as assignment_id, ma.date, ma.meal, ma.slot, m.id as menu_id, m.name
         FROM menu_assignments ma
         JOIN menus m ON m.id = ma.menu_id
         WHERE ma.date = ?
         ORDER BY CASE WHEN ma.meal = 'dejeuner' THEN 0 ELSE 1 END, ma.slot ASC`,
        d
      );
      results.push({ date: d, assignments: rows });
    }
    res.json(results);
  });

  // Serve static frontend if present (optional)
  const staticDir = path.join(__dirname, '..', 'web');
  app.use(express.static(staticDir));

  app.listen(PORT, () => {
    console.log(`mes-menus server running on port ${PORT}`);
  });
})();
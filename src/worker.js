import {
  addDays,
  calculateWeek,
  calendarMonthRange,
  groupByDay,
  money,
  operationalWeek,
  weekStartsForMonth
} from './rules.js';

const APP_NAME = 'HLabVet Entregas';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 120_000;

let schemaReady = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cooperado')),
  weekly_base_amount REAL NOT NULL DEFAULT 663.33,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category TEXT NOT NULL DEFAULT 'fora_natal'
    CHECK (category IN ('natal', 'zona_norte', 'fora_natal')),
  weekday_value REAL NOT NULL DEFAULT 0,
  weekend_value REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_date TEXT NOT NULL,
  location_id TEXT NOT NULL REFERENCES locations(id),
  notes TEXT NOT NULL DEFAULT '',
  billing_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (billing_mode IN ('auto', 'included', 'extra')),
  value_override REAL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_closures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  delivery_count INTEGER NOT NULL,
  included_count INTEGER NOT NULL,
  extra_count INTEGER NOT NULL,
  base_amount REAL NOT NULL,
  extra_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, week_start)
);

CREATE TABLE IF NOT EXISTS monthly_closures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  delivery_count INTEGER NOT NULL,
  extra_count INTEGER NOT NULL,
  base_amount REAL NOT NULL,
  extra_amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  snapshot_json TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_user_date
  ON deliveries(user_id, delivery_date);

CREATE INDEX IF NOT EXISTS idx_deliveries_date
  ON deliveries(delivery_date);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_weekly_user_end
  ON weekly_closures(user_id, week_end);

CREATE INDEX IF NOT EXISTS idx_monthly_user_month
  ON monthly_closures(user_id, month);

INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES
  ('weekday_included', '6', datetime('now')),
  ('weekend_natal_included', '2', datetime('now'));

INSERT OR IGNORE INTO locations(
  id,
  name,
  category,
  weekday_value,
  weekend_value,
  active,
  sort_order,
  created_at,
  updated_at
) VALUES
  (
    'loc-natal',
    'Natal',
    'natal',
    20,
    20,
    1,
    10,
    datetime('now'),
    datetime('now')
  ),
  (
    'loc-zona-norte',
    'Zona Norte de Natal',
    'zona_norte',
    20,
    20,
    1,
    20,
    datetime('now'),
    datetime('now')
  ),
  (
    'loc-parnamirim',
    'Parnamirim',
    'fora_natal',
    20,
    20,
    1,
    30,
    datetime('now'),
    datetime('now')
  ),
  (
    'loc-macaiba',
    'Macaíba',
    'fora_natal',
    30,
    30,
    1,
    40,
    datetime('now'),
    datetime('now')
  ),
  (
    'loc-sao-jose',
    'São José de Mipibu',
    'fora_natal',
    50,
    50,
    1,
    50,
    datetime('now'),
    datetime('now')
  ),
  (
    'loc-cajupiranga',
    'Cajupiranga',
    'fora_natal',
    30,
    30,
    1,
    60,
    datetime('now'),
    datetime('now')
  );
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      await ensureSchema(env.DB);
      return await api(request, env, url);
    } catch (error) {
      console.error('API_ERROR', {
        message: error instanceof Error ? error.message : String(error),
        cause: error?.cause?.message || '',
        stack: error instanceof Error ? error.stack : ''
      });

      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }

      return json(
        { error: 'Não foi possível concluir esta operação.' },
        500
      );
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runAutomaticClosures(controller.cron, env));
  }
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function ensureSchema(db) {
  if (schemaReady) return;

  if (!db || typeof db.prepare !== 'function') {
    throw new Error(
      'O banco D1 não está vinculado ao Worker com o nome DB.'
    );
  }

  const statements = SCHEMA
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (let index = 0; index < statements.length; index += 1) {
    const sql = statements[index];

    try {
      await db.prepare(sql).run();
    } catch (error) {
      console.error('D1_SCHEMA_INIT_ERROR', {
        statementNumber: index + 1,
        sql,
        message: error instanceof Error ? error.message : String(error),
        cause: error?.cause?.message || '',
        stack: error instanceof Error ? error.stack : ''
      });

      throw error;
    }
  }

  schemaReady = true;
}

async function api(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (method === 'GET' && path === '/api/status') {
    const row = await env.DB
      .prepare('SELECT COUNT(*) AS total FROM users')
      .first();

    return json({
      app_name: APP_NAME,
      setup_needed: Number(row?.total || 0) === 0
    });
  }

  if (method === 'POST' && path === '/api/setup') {
    return setup(request, env, url);
  }

  if (method === 'POST' && path === '/api/login') {
    return login(request, env, url);
  }

  const auth = await authenticate(request, env.DB);

  if (!auth) {
    throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
  }

  if (method === 'POST' && path === '/api/logout') {
    return logout(auth, env, url);
  }

  if (method === 'GET' && path === '/api/me') {
    return json({ user: publicUser(auth.user) });
  }

  if (method === 'POST' && path === '/api/change-password') {
    return changePassword(request, env, auth, url);
  }

  if (method === 'GET' && path === '/api/locations') {
    return listLocations(env, auth, url);
  }

  if (method === 'POST' && path === '/api/locations') {
    return createLocation(request, env, auth);
  }

  if (method === 'PATCH' && path.startsWith('/api/locations/')) {
    return updateLocation(
      request,
      env,
      auth,
      url,
      path.split('/').pop()
    );
  }

  if (method === 'GET' && path === '/api/users') {
    return listUsers(env, auth, url);
  }

  if (method === 'POST' && path === '/api/users') {
    return createUser(request, env, auth);
  }

  if (method === 'PATCH' && path.startsWith('/api/users/')) {
    return updateUser(
      request,
      env,
      auth,
      url,
      path.split('/').pop()
    );
  }

  if (method === 'GET' && path === '/api/settings') {
    return getSettings(env, auth, url);
  }

  if (method === 'PATCH' && path === '/api/settings') {
    return updateSettings(request, env, auth, url);
  }

  if (method === 'GET' && path === '/api/deliveries') {
    return listDeliveries(env, auth, url);
  }

  if (method === 'POST' && path === '/api/deliveries') {
    return createDeliveries(request, env, auth, url);
  }

  if (method === 'PATCH' && path.startsWith('/api/deliveries/')) {
    return updateDelivery(
      request,
      env,
      auth,
      url,
      path.split('/').pop()
    );
  }

  if (method === 'DELETE' && path.startsWith('/api/deliveries/')) {
    return deleteDelivery(
      env,
      auth,
      url,
      path.split('/').pop()
    );
  }

  if (method === 'GET' && path === '/api/week') {
    return getWeek(env, auth, url);
  }

  if (method === 'POST' && path === '/api/week/close') {
    return closeWeek(request, env, auth, url);
  }

  if (method === 'GET' && path === '/api/month') {
    return getMonth(env, auth, url);
  }

  if (method === 'GET' && path === '/api/admin/dashboard') {
    return adminDashboard(env, auth, url);
  }

  throw new HttpError(404, 'Página não encontrada.');
}

async function setup(request, env, url) {
  const count = await env.DB
    .prepare('SELECT COUNT(*) AS total FROM users')
    .first();

  if (Number(count?.total || 0) > 0) {
    throw new HttpError(409, 'O administrador já foi criado.');
  }

  const body = await readBody(request);
  const name = cleanText(body.name, 80);
  const loginName = normalizeLogin(body.login);

  validatePassword(body.password);

  if (!name || !loginName) {
    throw new HttpError(400, 'Informe nome e login.');
  }

  const { hash, salt } = await passwordHash(body.password);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO users (
      id,
      name,
      login,
      password_hash,
      password_salt,
      role,
      weekly_base_amount,
      must_change_password,
      active,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'admin', 663.33, 0, 1, ?, ?)
  `)
    .bind(id, name, loginName, hash, salt, now, now)
    .run();

  const user = await env.DB
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(id)
    .first();

  return sessionResponse(user, env.DB, url);
}

async function login(request, env, url) {
  const body = await readBody(request);
  const loginName = normalizeLogin(body.login);

  const user = await env.DB
    .prepare('SELECT * FROM users WHERE login=? COLLATE NOCASE')
    .bind(loginName)
    .first();

  if (
    !user ||
    !user.active ||
    !(await verifyPassword(body.password || '', user))
  ) {
    throw new HttpError(401, 'Login ou senha incorretos.');
  }

  return sessionResponse(user, env.DB, url);
}

async function logout(auth, env, url) {
  await env.DB
    .prepare('DELETE FROM sessions WHERE id=?')
    .bind(auth.sessionId)
    .run();

  return json(
    { ok: true },
    200,
    { 'Set-Cookie': sessionCookie('', url, 0) }
  );
}

async function changePassword(request, env, auth, url) {
  const body = await readBody(request);

  validatePassword(body.password);

  const { hash, salt } = await passwordHash(body.password);

  await env.DB.prepare(`
    UPDATE users
    SET password_hash=?,
        password_salt=?,
        must_change_password=0,
        updated_at=?
    WHERE id=?
  `)
    .bind(hash, salt, new Date().toISOString(), auth.user.id)
    .run();

  const user = {
    ...auth.user,
    must_change_password: 0
  };

  return json({
    ok: true,
    user: publicUser(user)
  });
}

async function listUsers(env, auth) {
  requireAdmin(auth);

  const result = await env.DB.prepare(`
    SELECT
      id,
      name,
      login,
      role,
      weekly_base_amount,
      must_change_password,
      active,
      created_at,
      updated_at
    FROM users
    ORDER BY
      role='admin' DESC,
      active DESC,
      name COLLATE NOCASE
  `).all();

  return json({
    users: result.results.map(publicUser)
  });
}

async function createUser(request, env, auth) {
  requireAdmin(auth);

  const body = await readBody(request);
  const name = cleanText(body.name, 80);
  const loginName = normalizeLogin(body.login);

  validatePassword(body.password);

  if (!name || !loginName) {
    throw new HttpError(400, 'Informe nome e login do cooperado.');
  }

  const base = validMoney(
    body.weekly_base_amount ?? 663.33,
    'Valor semanal inválido.'
  );

  const { hash, salt } = await passwordHash(body.password);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  try {
    await env.DB.prepare(`
      INSERT INTO users (
        id,
        name,
        login,
        password_hash,
        password_salt,
        role,
        weekly_base_amount,
        must_change_password,
        active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'cooperado', ?, 1, 1, ?, ?)
    `)
      .bind(id, name, loginName, hash, salt, base, now, now)
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      throw new HttpError(409, 'Esse login já está sendo usado.');
    }

    throw error;
  }

  const user = await env.DB
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(id)
    .first();

  return json(
    { user: publicUser(user) },
    201
  );
}

async function updateUser(request, env, auth, _url, id) {
  requireAdmin(auth);

  const current = await env.DB
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(id)
    .first();

  if (!current) {
    throw new HttpError(404, 'Cooperado não encontrado.');
  }

  const body = await readBody(request);

  const name = body.name === undefined
    ? current.name
    : cleanText(body.name, 80);

  const loginName = body.login === undefined
    ? current.login
    : normalizeLogin(body.login);

  const base = body.weekly_base_amount === undefined
    ? current.weekly_base_amount
    : validMoney(body.weekly_base_amount, 'Valor semanal inválido.');

  const active = body.active === undefined
    ? current.active
    : Number(Boolean(body.active));

  let hash = current.password_hash;
  let salt = current.password_salt;
  let mustChange = current.must_change_password;

  if (body.password) {
    validatePassword(body.password);

    const next = await passwordHash(body.password);

    hash = next.hash;
    salt = next.salt;
    mustChange = 1;
  }

  try {
    await env.DB.prepare(`
      UPDATE users
      SET name=?,
          login=?,
          weekly_base_amount=?,
          active=?,
          password_hash=?,
          password_salt=?,
          must_change_password=?,
          updated_at=?
      WHERE id=?
    `)
      .bind(
        name,
        loginName,
        base,
        active,
        hash,
        salt,
        mustChange,
        new Date().toISOString(),
        id
      )
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      throw new HttpError(409, 'Esse login já está sendo usado.');
    }

    throw error;
  }

  const updated = await env.DB
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(id)
    .first();

  return json({
    user: publicUser(updated)
  });
}

async function listLocations(env, auth, url) {
  const includeInactive =
    auth.user.role === 'admin' &&
    url.searchParams.get('all') === '1';

  const query = `
    SELECT *
    FROM locations
    ${includeInactive ? '' : 'WHERE active=1'}
    ORDER BY sort_order, name COLLATE NOCASE
  `;

  const result = await env.DB.prepare(query).all();

  return json({
    locations: result.results.map(publicLocation)
  });
}

async function createLocation(request, env, auth) {
  requireAdmin(auth);

  const body = await readBody(request);
  const data = validateLocation(body);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  try {
    await env.DB.prepare(`
      INSERT INTO locations (
        id,
        name,
        category,
        weekday_value,
        weekend_value,
        active,
        sort_order,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `)
      .bind(
        id,
        data.name,
        data.category,
        data.weekday_value,
        data.weekend_value,
        data.sort_order,
        now,
        now
      )
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      throw new HttpError(409, 'Esse local já está cadastrado.');
    }

    throw error;
  }

  const location = await env.DB
    .prepare('SELECT * FROM locations WHERE id=?')
    .bind(id)
    .first();

  return json(
    { location: publicLocation(location) },
    201
  );
}

async function updateLocation(request, env, auth, _url, id) {
  requireAdmin(auth);

  const current = await env.DB
    .prepare('SELECT * FROM locations WHERE id=?')
    .bind(id)
    .first();

  if (!current) {
    throw new HttpError(404, 'Local não encontrado.');
  }

  const body = await readBody(request);
  const data = validateLocation({ ...current, ...body });

  const active = body.active === undefined
    ? current.active
    : Number(Boolean(body.active));

  try {
    await env.DB.prepare(`
      UPDATE locations
      SET name=?,
          category=?,
          weekday_value=?,
          weekend_value=?,
          active=?,
          sort_order=?,
          updated_at=?
      WHERE id=?
    `)
      .bind(
        data.name,
        data.category,
        data.weekday_value,
        data.weekend_value,
        active,
        data.sort_order,
        new Date().toISOString(),
        id
      )
      .run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      throw new HttpError(409, 'Esse local já está cadastrado.');
    }

    throw error;
  }

  const updated = await env.DB
    .prepare('SELECT * FROM locations WHERE id=?')
    .bind(id)
    .first();

  return json({
    location: publicLocation(updated)
  });
}

async function getSettings(env, auth) {
  requireAdmin(auth);

  return json({
    settings: await loadSettings(env.DB)
  });
}

async function updateSettings(request, env, auth) {
  requireAdmin(auth);

  const body = await readBody(request);

  const weekday = validInteger(
    body.weekday_included,
    0,
    100,
    'Limite semanal inválido.'
  );

  const weekend = validInteger(
    body.weekend_natal_included,
    0,
    100,
    'Limite de sábado inválido.'
  );

  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO settings(key, value, updated_at)
      VALUES ('weekday_included', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).bind(String(weekday), now),

    env.DB.prepare(`
      INSERT INTO settings(key, value, updated_at)
      VALUES ('weekend_natal_included', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `).bind(String(weekend), now)
  ]);

  return json({
    settings: await loadSettings(env.DB)
  });
}

async function createDeliveries(request, env, auth) {
  if (auth.user.must_change_password) {
    throw new HttpError(
      403,
      'Crie sua nova senha antes de lançar entregas.'
    );
  }

  const body = await readBody(request);
  const date = validateDate(body.delivery_date);

  if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) {
    throw new HttpError(
      400,
      'O período de trabalho vai de segunda a sábado. Selecione outra data.'
    );
  }

  const targetUserId =
    auth.user.role === 'admin' && body.user_id
      ? String(body.user_id)
      : auth.user.id;

  await ensureTargetUser(env.DB, targetUserId);

  const location = await env.DB
    .prepare('SELECT * FROM locations WHERE id=? AND active=1')
    .bind(String(body.location_id || ''))
    .first();

  if (!location) {
    throw new HttpError(400, 'Selecione um local ativo.');
  }

  const quantity = validInteger(
    body.quantity ?? 1,
    1,
    50,
    'Quantidade inválida.'
  );

  const notes = cleanText(body.notes, 180);
  const now = new Date().toISOString();

  const statements = [];
  const ids = [];

  for (let index = 0; index < quantity; index += 1) {
    const id = crypto.randomUUID();

    ids.push(id);

    statements.push(
      env.DB.prepare(`
        INSERT INTO deliveries (
          id,
          user_id,
          delivery_date,
          location_id,
          notes,
          billing_mode,
          value_override,
          created_by,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'auto', NULL, ?, ?, ?)
      `).bind(
        id,
        targetUserId,
        date,
        location.id,
        notes,
        auth.user.id,
        now,
        now
      )
    );
  }

  await env.DB.batch(statements);

  return json(
    {
      ok: true,
      created: quantity,
      ids
    },
    201
  );
}

async function listDeliveries(env, auth, url) {
  const today = fortalezaDate();

  const from = validateDate(
    url.searchParams.get('from') || `${today.slice(0, 7)}-01`
  );

  const to = validateDate(
    url.searchParams.get('to') || today
  );

  if (from > to) {
    throw new HttpError(
      400,
      'A data inicial deve ser anterior à data final.'
    );
  }

  const userId = selectedUserId(
    auth,
    url.searchParams.get('user_id')
  );

  const firstWeek = operationalWeek(from);
  const lastWeek = operationalWeek(to);

  const rows = await fetchDeliveries(
    env.DB,
    userId,
    firstWeek.start,
    lastWeek.end
  );

  const settings = await loadSettings(env.DB);

  const user = await env.DB
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(userId)
    .first();

  if (!user) {
    throw new HttpError(404, 'Cooperado não encontrado.');
  }

  const calculated = calculateAcrossWeeks(
    rows,
    settings,
    Number(user.weekly_base_amount)
  );

  const filtered = calculated.filter(
    (item) =>
      item.delivery_date >= from &&
      item.delivery_date <= to
  );

  return json({
    from,
    to,
    user: publicUser(user),
    deliveries: filtered,
    summary: summarizeItems(filtered)
  });
}

async function updateDelivery(request, env, auth, _url, id) {
  const current = await env.DB
    .prepare('SELECT * FROM deliveries WHERE id=?')
    .bind(id)
    .first();

  if (!current) {
    throw new HttpError(404, 'Entrega não encontrada.');
  }

  if (
    auth.user.role !== 'admin' &&
    current.user_id !== auth.user.id
  ) {
    throw new HttpError(403, 'Acesso negado.');
  }

  const body = await readBody(request);

  const date = body.delivery_date === undefined
    ? current.delivery_date
    : validateDate(body.delivery_date);

  if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) {
    throw new HttpError(
      400,
      'O período vai de segunda a sábado.'
    );
  }

  const locationId = body.location_id === undefined
    ? current.location_id
    : String(body.location_id);

  const location = await env.DB
    .prepare('SELECT * FROM locations WHERE id=?')
    .bind(locationId)
    .first();

  if (!location) {
    throw new HttpError(400, 'Local inválido.');
  }

  const notes = body.notes === undefined
    ? current.notes
    : cleanText(body.notes, 180);

  const billingMode =
    auth.user.role === 'admin' &&
    body.billing_mode !== undefined
      ? validateBillingMode(body.billing_mode)
      : current.billing_mode;

  const override =
    auth.user.role === 'admin' &&
    body.value_override !== undefined
      ? (
        body.value_override === null ||
        body.value_override === ''
          ? null
          : validMoney(body.value_override, 'Valor inválido.')
      )
      : current.value_override;

  await env.DB.prepare(`
    UPDATE deliveries
    SET delivery_date=?,
        location_id=?,
        notes=?,
        billing_mode=?,
        value_override=?,
        updated_at=?
    WHERE id=?
  `)
    .bind(
      date,
      locationId,
      notes,
      billingMode,
      override,
      new Date().toISOString(),
      id
    )
    .run();

  return json({ ok: true });
}

async function deleteDelivery(env, auth, _url, id) {
  const current = await env.DB
    .prepare('SELECT * FROM deliveries WHERE id=?')
    .bind(id)
    .first();

  if (!current) {
    throw new HttpError(404, 'Entrega não encontrada.');
  }

  if (
    auth.user.role !== 'admin' &&
    current.user_id !== auth.user.id
  ) {
    throw new HttpError(403, 'Acesso negado.');
  }

  await env.DB
    .prepare('DELETE FROM deliveries WHERE id=?')
    .bind(id)
    .run();

  return json({ ok: true });
}

async function getWeek(env, auth, url) {
  const date = validateDate(
    url.searchParams.get('date') || fortalezaDate()
  );

  const userId = selectedUserId(
    auth,
    url.searchParams.get('user_id')
  );

  return json(await buildWeek(env.DB, userId, date));
}

async function closeWeek(request, env, auth) {
  const body = await readBody(request);

  const date = validateDate(
    body.date || fortalezaDate()
  );

  const userId =
    auth.user.role === 'admin' && body.user_id
      ? String(body.user_id)
      : auth.user.id;

  if (auth.user.role !== 'admin') {
    const day = fortalezaWeekday();

    if (day !== 0 && day !== 6) {
      throw new HttpError(
        403,
        'O cooperado pode fechar a semana somente no sábado ou domingo.'
      );
    }
  }

  const result = await persistWeekClosure(
    env.DB,
    userId,
    date,
    auth.user.id
  );

  return json({
    ok: true,
    week: result
  });
}

async function getMonth(env, auth, url) {
  const month = validateMonth(
    url.searchParams.get('month') ||
    fortalezaDate().slice(0, 7)
  );

  const userId = selectedUserId(
    auth,
    url.searchParams.get('user_id')
  );

  return json(await buildMonth(env.DB, userId, month));
}

async function adminDashboard(env, auth, url) {
  requireAdmin(auth);

  const date = validateDate(
    url.searchParams.get('date') || fortalezaDate()
  );

  const users = await env.DB.prepare(`
    SELECT *
    FROM users
    WHERE role='cooperado' AND active=1
    ORDER BY name COLLATE NOCASE
  `).all();

  const rows = [];

  for (const user of users.results) {
    const week = await buildWeek(env.DB, user.id, date);

    const todayItems = week.calculation.items.filter(
      (item) => item.delivery_date === date
    );

    rows.push({
      user: publicUser(user),
      day: summarizeItems(todayItems),
      week: stripWeekItems(week)
    });
  }

  return json({
    date,
    cooperados: rows
  });
}

async function buildWeek(db, userId, date) {
  const range = operationalWeek(date);

  const user = await db
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(userId)
    .first();

  if (!user) {
    throw new HttpError(404, 'Cooperado não encontrado.');
  }

  const [deliveries, settings, closure] = await Promise.all([
    fetchDeliveries(db, userId, range.start, range.end),

    loadSettings(db),

    db.prepare(`
      SELECT *
      FROM weekly_closures
      WHERE user_id=? AND week_start=?
    `)
      .bind(userId, range.start)
      .first()
  ]);

  const calculation = calculateWeek(deliveries, {
    weekdayIncluded: settings.weekday_included,
    weekendNatalIncluded: settings.weekend_natal_included,
    baseAmount: Number(user.weekly_base_amount)
  });

  return {
    user: publicUser(user),
    week_start: range.start,
    week_end: range.end,
    calculation,
    days: groupByDay(calculation),
    closure: closure ? publicClosure(closure) : null
  };
}

async function buildMonth(db, userId, month) {
  const user = await db
    .prepare('SELECT * FROM users WHERE id=?')
    .bind(userId)
    .first();

  if (!user) {
    throw new HttpError(404, 'Cooperado não encontrado.');
  }

  const range = calendarMonthRange(month);
  const starts = weekStartsForMonth(month);
  const settings = await loadSettings(db);

  const weeks = [];

  let deliveryCount = 0;
  let extraCount = 0;
  let baseAmount = 0;
  let extraAmount = 0;

  for (const start of starts) {
    const end = addDays(start, 5);

    const deliveries = await fetchDeliveries(
      db,
      userId,
      start,
      end
    );

    const calculation = calculateWeek(deliveries, {
      weekdayIncluded: settings.weekday_included,
      weekendNatalIncluded: settings.weekend_natal_included,
      baseAmount: Number(user.weekly_base_amount)
    });

    const monthItems = calculation.items.filter(
      (item) =>
        item.delivery_date >= range.start &&
        item.delivery_date <= range.end
    );

    const partial = summarizeItems(monthItems);

    deliveryCount += partial.delivery_count;
    extraCount += partial.extra_count;

    extraAmount = money(
      extraAmount + partial.extra_amount
    );

    baseAmount = money(
      baseAmount + Number(user.weekly_base_amount)
    );

    const closure = await db.prepare(`
      SELECT *
      FROM weekly_closures
      WHERE user_id=? AND week_start=?
    `)
      .bind(userId, start)
      .first();

    weeks.push({
      week_start: start,
      week_end: end,
      delivery_count: partial.delivery_count,
      extra_count: partial.extra_count,
      base_amount: money(user.weekly_base_amount),
      extra_amount: partial.extra_amount,
      total_amount: money(
        Number(user.weekly_base_amount) +
        partial.extra_amount
      ),
      closed: Boolean(closure)
    });
  }

  const saved = await db.prepare(`
    SELECT *
    FROM monthly_closures
    WHERE user_id=? AND month=?
  `)
    .bind(userId, month)
    .first();

  return {
    user: publicUser(user),
    month,
    from: range.start,
    to: range.end,
    weeks,
    summary: {
      delivery_count: deliveryCount,
      extra_count: extraCount,
      base_amount: baseAmount,
      extra_amount: extraAmount,
      total_amount: money(baseAmount + extraAmount)
    },
    closure: saved ? publicClosure(saved) : null
  };
}

async function persistWeekClosure(
  db,
  userId,
  date,
  closedBy = null
) {
  const week = await buildWeek(db, userId, date);
  const c = week.calculation;
  const now = new Date().toISOString();

  const snapshot = JSON.stringify({
    week_start: week.week_start,
    week_end: week.week_end,
    calculation: c,
    days: week.days
  });

  await db.prepare(`
    INSERT INTO weekly_closures (
      id,
      user_id,
      week_start,
      week_end,
      delivery_count,
      included_count,
      extra_count,
      base_amount,
      extra_amount,
      total_amount,
      snapshot_json,
      closed_by,
      closed_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(user_id, week_start) DO UPDATE SET
      week_end=excluded.week_end,
      delivery_count=excluded.delivery_count,
      included_count=excluded.included_count,
      extra_count=excluded.extra_count,
      base_amount=excluded.base_amount,
      extra_amount=excluded.extra_amount,
      total_amount=excluded.total_amount,
      snapshot_json=excluded.snapshot_json,
      closed_by=excluded.closed_by,
      closed_at=excluded.closed_at,
      updated_at=excluded.updated_at
  `)
    .bind(
      crypto.randomUUID(),
      userId,
      week.week_start,
      week.week_end,
      c.delivery_count,
      c.included_count,
      c.extra_count,
      c.base_amount,
      c.extra_amount,
      c.total_amount,
      snapshot,
      closedBy,
      now,
      now
    )
    .run();

  return {
    ...stripWeekItems(week),
    closure: { closed_at: now }
  };
}

async function persistMonthClosure(db, userId, month) {
  const data = await buildMonth(db, userId, month);
  const s = data.summary;
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO monthly_closures (
      id,
      user_id,
      month,
      delivery_count,
      extra_count,
      base_amount,
      extra_amount,
      total_amount,
      snapshot_json,
      closed_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(user_id, month) DO UPDATE SET
      delivery_count=excluded.delivery_count,
      extra_count=excluded.extra_count,
      base_amount=excluded.base_amount,
      extra_amount=excluded.extra_amount,
      total_amount=excluded.total_amount,
      snapshot_json=excluded.snapshot_json,
      closed_at=excluded.closed_at,
      updated_at=excluded.updated_at
  `)
    .bind(
      crypto.randomUUID(),
      userId,
      month,
      s.delivery_count,
      s.extra_count,
      s.base_amount,
      s.extra_amount,
      s.total_amount,
      JSON.stringify(data),
      now,
      now
    )
    .run();
}

async function runAutomaticClosures(cron, env) {
  await ensureSchema(env.DB);

  const users = await env.DB.prepare(`
    SELECT id
    FROM users
    WHERE role='cooperado' AND active=1
  `).all();

  const today = fortalezaDate();

  if (cron === '5 3 * * SUN') {
    const previousSaturday = addDays(today, -1);

    for (const user of users.results) {
      await persistWeekClosure(
        env.DB,
        user.id,
        previousSaturday,
        null
      );
    }
  }

  if (cron === '10 3 1 * *') {
    const previousMonthDate = addDays(
      `${today.slice(0, 7)}-01`,
      -1
    );

    const month = previousMonthDate.slice(0, 7);

    for (const user of users.results) {
      await persistMonthClosure(env.DB, user.id, month);
    }
  }
}

async function fetchDeliveries(db, userId, from, to) {
  const result = await db.prepare(`
    SELECT
      d.*,
      l.name AS location_name,
      l.category,
      l.weekday_value,
      l.weekend_value,
      u.name AS user_name
    FROM deliveries d
    JOIN locations l ON l.id=d.location_id
    JOIN users u ON u.id=d.user_id
    WHERE
      d.user_id=?
      AND d.delivery_date BETWEEN ? AND ?
    ORDER BY d.delivery_date, d.created_at, d.id
  `)
    .bind(userId, from, to)
    .all();

  return result.results;
}

function calculateAcrossWeeks(rows, settings, baseAmount) {
  const grouped = new Map();

  for (const row of rows) {
    const start = operationalWeek(row.delivery_date).start;

    if (!grouped.has(start)) {
      grouped.set(start, []);
    }

    grouped.get(start).push(row);
  }

  return [...grouped.entries()].flatMap(
    ([, deliveries]) => calculateWeek(deliveries, {
      weekdayIncluded: settings.weekday_included,
      weekendNatalIncluded: settings.weekend_natal_included,
      baseAmount
    }).items
  );
}

function summarizeItems(items) {
  return items.reduce(
    (summary, item) => {
      summary.delivery_count += 1;

      if (item.is_extra) {
        summary.extra_count += 1;

        summary.extra_amount = money(
          summary.extra_amount +
          Number(item.extra_value || 0)
        );
      }

      return summary;
    },
    {
      delivery_count: 0,
      extra_count: 0,
      extra_amount: 0
    }
  );
}

async function loadSettings(db) {
  const result = await db
    .prepare('SELECT key, value FROM settings')
    .all();

  const values = Object.fromEntries(
    result.results.map((row) => [row.key, row.value])
  );

  return {
    weekday_included: Number(values.weekday_included ?? 6),
    weekend_natal_included: Number(
      values.weekend_natal_included ?? 2
    )
  };
}

async function ensureTargetUser(db, id) {
  const user = await db.prepare(`
    SELECT id
    FROM users
    WHERE id=? AND role='cooperado' AND active=1
  `)
    .bind(id)
    .first();

  if (!user) {
    throw new HttpError(400, 'Cooperado inválido ou inativo.');
  }
}

function selectedUserId(auth, requested) {
  if (auth.user.role === 'admin') {
    if (!requested) {
      throw new HttpError(400, 'Selecione um cooperado.');
    }

    return requested;
  }

  return auth.user.id;
}

async function authenticate(request, db) {
  const token = parseCookies(
    request.headers.get('Cookie') || ''
  ).hlabvet_session;

  if (!token) return null;

  const sessionId = await sha256(token);

  const row = await db.prepare(`
    SELECT
      s.id AS session_id,
      s.expires_at,
      u.*
    FROM sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.id=?
  `)
    .bind(sessionId)
    .first();

  if (
    !row ||
    !row.active ||
    row.expires_at <= new Date().toISOString()
  ) {
    return null;
  }

  return {
    sessionId: row.session_id,
    user: row
  };
}

async function sessionResponse(user, db, url) {
  const token = randomHex(32);
  const sessionId = await sha256(token);
  const now = new Date();

  const expires = new Date(
    now.getTime() + SESSION_DAYS * 86_400_000
  );

  await db.prepare(`
    INSERT INTO sessions (
      id,
      user_id,
      expires_at,
      created_at
    )
    VALUES (?, ?, ?, ?)
  `)
    .bind(
      sessionId,
      user.id,
      expires.toISOString(),
      now.toISOString()
    )
    .run();

  return json(
    { user: publicUser(user) },
    200,
    {
      'Set-Cookie': sessionCookie(
        token,
        url,
        SESSION_DAYS * 86_400
      )
    }
  );
}

function sessionCookie(token, url, maxAge) {
  const secure = url.protocol === 'https:'
    ? '; Secure'
    : '';

  return (
    `hlabvet_session=${token}; ` +
    'Path=/; HttpOnly; SameSite=Strict; ' +
    `Max-Age=${maxAge}${secure}`
  );
}

async function passwordHash(password, suppliedSalt) {
  const saltBytes = suppliedSalt
    ? fromBase64(suppliedSalt)
    : crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS
    },
    key,
    256
  );

  return {
    hash: toBase64(new Uint8Array(bits)),
    salt: toBase64(saltBytes)
  };
}

async function verifyPassword(password, user) {
  const calculated = await passwordHash(
    password,
    user.password_salt
  );

  return timingSafeEqual(
    calculated.hash,
    user.password_hash
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(size) {
  return [...crypto.getRandomValues(new Uint8Array(size))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(bytes) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(
    atob(value),
    (char) => char.charCodeAt(0)
  );
}

async function readBody(request) {
  const type = request.headers.get('content-type') || '';

  if (!type.includes('application/json')) {
    throw new HttpError(
      415,
      'Envie os dados no formato correto.'
    );
  }

  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Dados inválidos.');
  }
}

function validateLocation(body) {
  const name = cleanText(body.name, 80);

  if (!name) {
    throw new HttpError(400, 'Informe o nome do local.');
  }

  const category = [
    'natal',
    'zona_norte',
    'fora_natal'
  ].includes(body.category)
    ? body.category
    : null;

  if (!category) {
    throw new HttpError(
      400,
      'Selecione a categoria do local.'
    );
  }

  return {
    name,
    category,

    weekday_value: validMoney(
      body.weekday_value,
      'Valor de segunda a sexta inválido.'
    ),

    weekend_value: validMoney(
      body.weekend_value,
      'Valor de sábado inválido.'
    ),

    sort_order: validInteger(
      body.sort_order ?? 100,
      0,
      9999,
      'Ordem inválida.'
    )
  };
}

function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < 6 ||
    password.length > 72
  ) {
    throw new HttpError(
      400,
      'A senha deve ter entre 6 e 72 caracteres.'
    );
  }
}

function normalizeLogin(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40);
}

function cleanText(value, max) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

function validateDate(value) {
  const text = String(value || '');

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number.isNaN(Date.parse(`${text}T12:00:00Z`))
  ) {
    throw new HttpError(400, 'Data inválida.');
  }

  return text;
}

function validateMonth(value) {
  const text = String(value || '');

  if (
    !/^\d{4}-\d{2}$/.test(text) ||
    Number(text.slice(5)) < 1 ||
    Number(text.slice(5)) > 12
  ) {
    throw new HttpError(400, 'Mês inválido.');
  }

  return text;
}

function validateBillingMode(value) {
  if (!['auto', 'included', 'extra'].includes(value)) {
    throw new HttpError(
      400,
      'Regra de cobrança inválida.'
    );
  }

  return value;
}

function validMoney(value, message) {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0 ||
    number > 1_000_000
  ) {
    throw new HttpError(400, message);
  }

  return money(number);
}

function validInteger(value, min, max, message) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new HttpError(400, message);
  }

  return number;
}

function requireAdmin(auth) {
  if (auth.user.role !== 'admin') {
    throw new HttpError(
      403,
      'Somente o administrador pode acessar esta área.'
    );
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
    weekly_base_amount: money(user.weekly_base_amount),
    must_change_password: Boolean(user.must_change_password),
    active: Boolean(user.active),
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

function publicLocation(location) {
  return {
    id: location.id,
    name: location.name,
    category: location.category,
    weekday_value: money(location.weekday_value),
    weekend_value: money(location.weekend_value),
    active: Boolean(location.active),
    sort_order: Number(location.sort_order)
  };
}

function publicClosure(row) {
  return {
    id: row.id,
    closed_at: row.closed_at,
    updated_at: row.updated_at,
    delivery_count: Number(row.delivery_count),
    extra_count: Number(row.extra_count),
    base_amount: money(row.base_amount),
    extra_amount: money(row.extra_amount),
    total_amount: money(row.total_amount)
  };
}

function stripWeekItems(week) {
  const {
    items: _items,
    ...calculation
  } = week.calculation;

  return {
    user: week.user,
    week_start: week.week_start,
    week_end: week.week_end,
    calculation,
    days: week.days,
    closure: week.closure
  };
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) =>
        part.trim().split(/=(.*)/s).slice(0, 2)
      )
      .filter(([key]) => key)
  );
}

function fortalezaDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function fortalezaWeekday() {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza',
    weekday: 'short'
  }).format(new Date());

  return [
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat'
  ].indexOf(name);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

// App-level persistence: users (login accounts) + dummy records for the
// filler modules. Deliberately reuses the SAME Postgres instance OpenFGA
// itself runs against (one free-tier database instead of two), but under
// its own schema (`vls_app`) so it can never collide with the tables
// OpenFGA's own `migrate` command manages in `public`.
"use strict";
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

function makeDb(connectionString) {
  const pool = new Pool({ connectionString });

  async function migrate() {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS vls_app`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vls_app.users (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        email        TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role         TEXT NOT NULL,
        manager_id   TEXT REFERENCES vls_app.users(id),
        active       BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vls_app.dummy_records (
        id         SERIAL PRIMARY KEY,
        module_id  TEXT NOT NULL,
        title      TEXT NOT NULL,
        subtitle   TEXT,
        sort_order INT NOT NULL DEFAULT 0
      )
    `);
  }

  async function seedUsersIfEmpty(employees, demoPassword) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM vls_app.users`);
    if (rows[0].n > 0) return { seeded: false, count: rows[0].n };
    const hash = await bcrypt.hash(demoPassword, 10);
    for (const e of employees) {
      await pool.query(
        `INSERT INTO vls_app.users (id, name, email, password_hash, role, manager_id, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, e.name, e.email, hash, e.role, e.manager || null, e.active !== false]
      );
    }
    return { seeded: true, count: employees.length };
  }

  async function seedDummyRecordsIfEmpty(recordsByModule) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM vls_app.dummy_records`);
    if (rows[0].n > 0) return { seeded: false, count: rows[0].n };
    let total = 0;
    for (const [moduleId, records] of Object.entries(recordsByModule)) {
      for (let i = 0; i < records.length; i++) {
        await pool.query(
          `INSERT INTO vls_app.dummy_records (module_id, title, subtitle, sort_order) VALUES ($1,$2,$3,$4)`,
          [moduleId, records[i].title, records[i].subtitle || null, i]
        );
        total++;
      }
    }
    return { seeded: true, count: total };
  }

  async function listUsers() {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, manager_id AS manager, active FROM vls_app.users ORDER BY created_at ASC`
    );
    return rows;
  }

  async function getUserById(id) {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, manager_id AS manager, active FROM vls_app.users WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async function getUserByEmail(email) {
    const { rows } = await pool.query(`SELECT * FROM vls_app.users WHERE email = $1`, [email.toLowerCase()]);
    return rows[0] || null;
  }

  function slugify(name) {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "user"
    );
  }

  async function createUser({ name, email, password, role, manager }) {
    const hash = await bcrypt.hash(password, 10);
    let id = slugify(name);
    // ensure uniqueness against existing ids
    const { rows } = await pool.query(`SELECT id FROM vls_app.users WHERE id LIKE $1`, [`${id}%`]);
    if (rows.some((r) => r.id === id)) {
      id = `${id}-${rows.length + 1}`;
    }
    await pool.query(
      `INSERT INTO vls_app.users (id, name, email, password_hash, role, manager_id, active)
       VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [id, name, email.toLowerCase(), hash, role, manager || null]
    );
    return getUserById(id);
  }

  async function updateUser(id, fields) {
    const sets = [];
    const values = [];
    let i = 1;
    if (fields.name !== undefined) { sets.push(`name = $${i++}`); values.push(fields.name); }
    if (fields.email !== undefined) { sets.push(`email = $${i++}`); values.push(fields.email.toLowerCase()); }
    if (fields.role !== undefined) { sets.push(`role = $${i++}`); values.push(fields.role); }
    if (fields.manager !== undefined) { sets.push(`manager_id = $${i++}`); values.push(fields.manager || null); }
    if (fields.active !== undefined) { sets.push(`active = $${i++}`); values.push(fields.active); }
    if (fields.password) {
      const hash = await bcrypt.hash(fields.password, 10);
      sets.push(`password_hash = $${i++}`);
      values.push(hash);
    }
    if (!sets.length) return getUserById(id);
    values.push(id);
    await pool.query(`UPDATE vls_app.users SET ${sets.join(", ")} WHERE id = $${i}`, values);
    return getUserById(id);
  }

  async function verifyLogin(email, password) {
    const user = await getUserByEmail(email);
    if (!user || !user.active) return null;
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return null;
    const { password_hash, ...safe } = user;
    return { ...safe, manager: safe.manager_id };
  }

  async function dummyRecordsForModule(moduleId) {
    const { rows } = await pool.query(
      `SELECT title, subtitle FROM vls_app.dummy_records WHERE module_id = $1 ORDER BY sort_order ASC`,
      [moduleId]
    );
    return rows;
  }

  return {
    pool,
    migrate,
    seedUsersIfEmpty,
    seedDummyRecordsIfEmpty,
    listUsers,
    getUserById,
    getUserByEmail,
    createUser,
    updateUser,
    verifyLogin,
    dummyRecordsForModule,
  };
}

module.exports = { makeDb };

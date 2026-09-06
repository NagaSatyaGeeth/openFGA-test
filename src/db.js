// App identity store: login accounts + the role catalogue. Lives in the SAME
// Postgres instance OpenFGA uses, under its own `app` schema (one free
// database, never colliding with OpenFGA's own tables).
//
// IMPORTANT: OpenFGA - not this table - is the source of truth for *access*
// (who has which role, who can do what on which module, who reports to whom).
// Postgres only holds identity (email/password/name/department/active) and
// the role catalogue (id/name/description). That's the clean separation the
// evaluation is meant to show.
"use strict";
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

function makeDb(connectionString) {
  const pool = new Pool({ connectionString });

  async function migrate() {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS app`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app.users (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        department    TEXT,
        active        BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app.roles (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        is_system   BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }

  async function usersCount() {
    const { rows } = await pool.query(`SELECT count(*)::int n FROM app.users`);
    return rows[0].n;
  }

  // ---- roles catalogue ----
  async function listRoles() {
    const { rows } = await pool.query(`SELECT id, name, description, is_system FROM app.roles ORDER BY is_system DESC, name ASC`);
    return rows;
  }
  async function getRole(id) {
    const { rows } = await pool.query(`SELECT id, name, description, is_system FROM app.roles WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async function createRole({ id, name, description, is_system = false }) {
    await pool.query(
      `INSERT INTO app.roles (id, name, description, is_system) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [id, name, description || null, is_system]
    );
    return getRole(id);
  }
  async function updateRole(id, { name, description }) {
    const sets = [], vals = [];
    let i = 1;
    if (name !== undefined) { sets.push(`name=$${i++}`); vals.push(name); }
    if (description !== undefined) { sets.push(`description=$${i++}`); vals.push(description); }
    if (sets.length) { vals.push(id); await pool.query(`UPDATE app.roles SET ${sets.join(", ")} WHERE id=$${i}`, vals); }
    return getRole(id);
  }
  async function deleteRole(id) {
    await pool.query(`DELETE FROM app.roles WHERE id=$1 AND is_system=false`, [id]);
  }

  // ---- users ----
  const PUBLIC_COLS = `id, name, email, department, active, created_at`;
  async function listUsers() {
    const { rows } = await pool.query(`SELECT ${PUBLIC_COLS} FROM app.users ORDER BY created_at ASC`);
    return rows;
  }
  async function getUser(id) {
    const { rows } = await pool.query(`SELECT ${PUBLIC_COLS} FROM app.users WHERE id=$1`, [id]);
    return rows[0] || null;
  }
  async function getUserByEmail(email) {
    const { rows } = await pool.query(`SELECT * FROM app.users WHERE email=$1`, [email.toLowerCase()]);
    return rows[0] || null;
  }

  function slug(name, seed) {
    const base = (name || "user").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "user";
    return seed ? `${base}-${seed}` : base;
  }

  async function createUser({ id, name, email, password, department }) {
    const hash = await bcrypt.hash(password, 10);
    let uid = id || slug(name);
    // ensure unique id
    let n = 1;
    while ((await getUser(uid)) !== null) uid = slug(name, ++n);
    await pool.query(
      `INSERT INTO app.users (id, name, email, password_hash, department, active)
       VALUES ($1,$2,$3,$4,$5,true)`,
      [uid, name, email.toLowerCase(), hash, department || null]
    );
    return getUser(uid);
  }

  async function updateUser(id, fields) {
    const sets = [], vals = [];
    let i = 1;
    if (fields.name !== undefined) { sets.push(`name=$${i++}`); vals.push(fields.name); }
    if (fields.email !== undefined) { sets.push(`email=$${i++}`); vals.push(fields.email.toLowerCase()); }
    if (fields.department !== undefined) { sets.push(`department=$${i++}`); vals.push(fields.department || null); }
    if (fields.active !== undefined) { sets.push(`active=$${i++}`); vals.push(fields.active); }
    if (fields.password) { sets.push(`password_hash=$${i++}`); vals.push(await bcrypt.hash(fields.password, 10)); }
    if (sets.length) { vals.push(id); await pool.query(`UPDATE app.users SET ${sets.join(", ")} WHERE id=$${i}`, vals); }
    return getUser(id);
  }

  async function verifyLogin(email, password) {
    const u = await getUserByEmail(email);
    if (!u || !u.active) return null;
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return null;
    const { password_hash, ...safe } = u;
    return safe;
  }

  return {
    pool, migrate, usersCount,
    listRoles, getRole, createRole, updateRole, deleteRole,
    listUsers, getUser, getUserByEmail, createUser, updateUser, verifyLogin,
  };
}

module.exports = { makeDb };

// One-time bootstrap of an empty database + OpenFGA store from the catalog.
// Idempotent: if users already exist, does nothing (so redeploys/restarts
// never wipe changes made in the running app).
"use strict";
const { MODULES, SEED_ROLES, SEED_USERS } = require("./catalog");
const T = require("./tuples");

async function seed(db, fga) {
  await db.migrate();
  if ((await db.usersCount()) > 0) {
    return { seeded: false };
  }

  // roles catalogue (DB) + their module grants (OpenFGA)
  for (const r of SEED_ROLES) {
    await db.createRole({ id: r.id, name: r.name, description: r.description, is_system: r.id === "administrator" });
    for (const [moduleId, level] of Object.entries(r.grants)) {
      if (!MODULES.find((m) => m.id === moduleId)) continue;
      await fga.write(T.roleGrant(r.id, level, moduleId));
    }
  }

  // users (DB identity) + role membership + manager edges (OpenFGA)
  for (const u of SEED_USERS) {
    await db.createUser({ id: u.id, name: u.name, email: u.email, password: u.password, department: u.department });
    if (u.role) await fga.write(T.membership(u.id, u.role));
  }
  for (const u of SEED_USERS) {
    if (u.manager) await fga.write(T.managerEdge(u.id, u.manager));
  }

  return { seeded: true, users: SEED_USERS.length, roles: SEED_ROLES.length };
}

module.exports = { seed };

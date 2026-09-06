"use strict";
const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");

const { makeDb } = require("./db");
const { makeFga } = require("./fga");
const { seed } = require("./seed");
const { MODULES, LEVELS } = require("./catalog");
const T = require("./tuples");

const PORT = process.env.PORT || 4000;
const APP_DATABASE_URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL || process.env.OPENFGA_DATASTORE_URI;
const OPENFGA_API_URL = process.env.OPENFGA_API_URL || "http://localhost:8081";
const OPENFGA_API_KEY = process.env.OPENFGA_API_KEY || process.env.OPENFGA_AUTHN_PRESHARED_KEYS || "";
const OPENFGA_STORE_NAME = process.env.OPENFGA_STORE_NAME || "openfga-rbac-demo";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-insecure-secret";

const modelJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../openfga/model.json"), "utf8"));
const moduleById = Object.fromEntries(MODULES.map((m) => [m.id, m]));

const db = makeDb(APP_DATABASE_URL);
const fga = makeFga({ apiUrl: OPENFGA_API_URL, apiKey: OPENFGA_API_KEY, storeName: OPENFGA_STORE_NAME });

// ---------------------------------------------------------------------------
// live access resolution — every one of these hits OpenFGA at call time.
// there is NO precomputed matrix and NO boot-time cache: a tuple written a
// moment ago is reflected on the very next request, no restart.
// ---------------------------------------------------------------------------

// highest level this user effectively holds on a module (null = no access)
async function effectiveLevel(userId, moduleId) {
  const u = `user:${userId}`;
  const obj = `module:${moduleId}`;
  // check most-privileged first; the model cascades so approver⇒editor⇒viewer
  if (await fga.check(u, "approver", obj)) return "approver";
  if (await fga.check(u, "editor", obj)) return "editor";
  if (await fga.check(u, "viewer", obj)) return "viewer";
  return null;
}

// effective level for every module, in parallel (still individual live checks)
async function effectiveModules(userId) {
  const results = await Promise.all(
    MODULES.map(async (m) => [m.id, await effectiveLevel(userId, m.id)])
  );
  return Object.fromEntries(results);
}

const rank = (lvl) => T.LEVEL_RANK[lvl] || 0;

// ---------------------------------------------------------------------------
// middleware
// ---------------------------------------------------------------------------
async function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "not authenticated" });
  const u = await db.getUser(req.session.userId);
  if (!u || !u.active) { req.session.destroy(() => {}); return res.status(401).json({ error: "account inactive" }); }
  req.user = u;
  next();
}

// gate a route on a module + minimum level, computed LIVE
function requireModule(moduleId, minLevel) {
  return async (req, res, next) => {
    const mid = typeof moduleId === "function" ? moduleId(req) : moduleId;
    const lvl = await effectiveLevel(req.user.id, mid);
    if (rank(lvl) < rank(minLevel)) {
      return res.status(403).json({ error: `need ${minLevel} on ${mid}; you have ${lvl || "no access"}` });
    }
    req.moduleLevel = lvl;
    next();
  };
}

// ---------------------------------------------------------------------------
// helpers that read OpenFGA for display (roles a user holds, grants, managers)
// ---------------------------------------------------------------------------
async function rolesForUser(userId) {
  const objs = await fga.listObjects(`user:${userId}`, "assignee", "role"); // ["role:x", ...]
  return objs.map((o) => o.split(":")[1]);
}

async function managerOf(userId) {
  const tuples = await fga.read({ relation: "manager", object: `user:${userId}` });
  const t = tuples[0];
  return t ? t.user.split(":")[1] : null;
}

// OpenFGA's Read API can't filter by user alone (it requires an object type),
// so for "all module grants held by subject X" we read every tuple once and
// filter in memory. Fine at demo scale, and still fully live (fresh read each
// call - no cached matrix).
function grantsForSubject(allTuples, subjectRef) {
  const out = {};
  for (const t of allTuples) {
    if (t.user === subjectRef && t.object.startsWith("module:") && LEVELS.includes(t.relation)) {
      const mid = t.object.split(":")[1];
      if (rank(t.relation) > rank(out[mid])) out[mid] = t.relation;
    }
  }
  return out;
}

// direct individual module grants for a user: {moduleId: level}
async function individualGrants(userId) {
  return grantsForSubject(await fga.read({}), `user:${userId}`);
}

// direct grants for a role: {moduleId: level}
async function roleGrants(roleId) {
  return grantsForSubject(await fga.read({}), T.roleAssignee(roleId));
}

// set a subject's grant on a module to exactly `level` (or none). Because the
// model cascades, we keep at most one direct tuple per subject+module: delete
// whatever is there, then write the chosen level. Instant.
async function setGrant(subjectRef, moduleId, level) {
  for (const lvl of LEVELS) {
    await fga.del({ user: subjectRef, relation: lvl, object: `module:${moduleId}` });
  }
  if (level && LEVELS.includes(level)) {
    await fga.write({ user: subjectRef, relation: level, object: `module:${moduleId}` });
  }
}

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
}));

// Readiness gate: the web server binds its port immediately (so Render sees a
// live service) while OpenFGA is connected + seeded in the background. Until
// that finishes, API calls return 503 instead of crashing — a cold/slow
// OpenFGA server (free tier spins down when idle) never takes the app down.
let READY = false;
app.use((req, res, next) => {
  if (READY || !req.path.startsWith("/api/") || req.path === "/api/health") return next();
  res.status(503).json({ error: "starting up — connecting to OpenFGA, try again in a moment" });
});

// ---- auth ----
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const u = await db.verifyLogin(email, password);
  if (!u) return res.status(401).json({ error: "invalid email or password" });
  req.session.userId = u.id;
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

// current user + live nav (modules they can see, with level + allowed actions)
app.get("/api/me", requireAuth, async (req, res) => {
  const levels = await effectiveModules(req.user.id);
  const roles = await rolesForUser(req.user.id);
  const nav = MODULES
    .filter((m) => levels[m.id])
    .map((m) => ({ id: m.id, name: m.name, icon: m.icon, group: m.group, level: levels[m.id] }));
  res.json({ user: req.user, roles, nav, levels });
});

// ---- generic module page ----
app.get("/api/modules/:id", requireAuth, requireModule((r) => r.params.id, "viewer"), async (req, res) => {
  const m = moduleById[req.params.id];
  if (!m) return res.status(404).json({ error: "unknown module" });
  const myLevel = req.moduleLevel;
  const actions = (m.actions || []).map((a) => ({ ...a, allowed: rank(myLevel) >= rank(a.level) }));

  let records = m.records || [];
  if (m.id === "employees") {
    const users = await db.listUsers();
    const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));
    records = await Promise.all(users.map(async (u) => {
      const mgr = await managerOf(u.id);
      const roles = await rolesForUser(u.id);
      return { title: `${u.name}${u.active ? "" : " (inactive)"}`, meta: `${u.department || "—"} · roles: ${roles.join(", ") || "none"} · manager: ${mgr ? nameById[mgr] || mgr : "—"}` };
    }));
  }
  res.json({ module: { id: m.id, name: m.name, icon: m.icon, blurb: m.blurb, group: m.group }, myLevel, actions, records });
});

// ---- users management (module: users) ----
app.get("/api/users", requireAuth, requireModule("users", "viewer"), async (req, res) => {
  const users = await db.listUsers();
  const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const enriched = await Promise.all(users.map(async (u) => ({
    ...u,
    roles: await rolesForUser(u.id),
    manager: await managerOf(u.id),
  })));
  res.json({ users: enriched.map((u) => ({ ...u, managerName: u.manager ? nameById[u.manager] || u.manager : null })), canEdit: rank(req.moduleLevel) >= rank("editor") });
});

app.post("/api/users", requireAuth, requireModule("users", "editor"), async (req, res) => {
  try {
    const { name, email, password, department, role, manager } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: "name, email, password required" });
    if (password.length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });
    if (await db.getUserByEmail(email)) return res.status(409).json({ error: "email already in use" });
    if (role && !(await db.getRole(role))) return res.status(400).json({ error: "unknown role" });

    const u = await db.createUser({ name, email, password, department });
    if (role) await fga.write(T.membership(u.id, role));       // role assignment -> OpenFGA
    if (manager) await fga.write(T.managerEdge(u.id, manager)); // reports-to -> OpenFGA
    res.status(201).json(u);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/users/:id", requireAuth, requireModule("users", "editor"), async (req, res) => {
  try {
    const id = req.params.id;
    const before = await db.getUser(id);
    if (!before) return res.status(404).json({ error: "no such user" });
    const { name, email, password, department, active, role, manager } = req.body || {};
    if (email && email.toLowerCase() !== before.email) {
      const other = await db.getUserByEmail(email);
      if (other && other.id !== id) return res.status(409).json({ error: "email already in use" });
    }
    const after = await db.updateUser(id, { name, email, password, department, active });

    // role change: replace all existing memberships with the chosen one
    if (role !== undefined) {
      const current = await rolesForUser(id);
      for (const r of current) await fga.del(T.membership(id, r));
      if (role) await fga.write(T.membership(id, role));
    }
    // manager change
    if (manager !== undefined) {
      const cur = await managerOf(id);
      if (cur) await fga.del(T.managerEdge(id, cur));
      if (manager) await fga.write(T.managerEdge(id, manager));
    }
    res.json(after);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- roles catalogue (module: roles OR access_control) ----
async function canRoles(req, res, next) {
  const a = await effectiveLevel(req.user.id, "roles");
  const b = await effectiveLevel(req.user.id, "access_control");
  if (!a && !b) return res.status(403).json({ error: "no access to roles" });
  req.rolesWrite = rank(b) >= rank("editor") || rank(a) >= rank("editor");
  next();
}

app.get("/api/roles", requireAuth, canRoles, async (req, res) => {
  const roles = await db.listRoles();
  const withGrants = await Promise.all(roles.map(async (r) => ({ ...r, grants: await roleGrants(r.id) })));
  res.json({ roles: withGrants, canEdit: req.rolesWrite });
});

// ---- Access Control dashboard (module: access_control) ----
const acView = requireModule("access_control", "viewer");
const acEdit = requireModule("access_control", "editor");

// full role × module access matrix (direct grants) + individual-grant summary
app.get("/api/ac/matrix", requireAuth, acView, async (req, res) => {
  const roles = await db.listRoles();
  const all = await fga.read({}); // one live read, filtered per role in memory
  const matrix = {};
  for (const r of roles) matrix[r.id] = grantsForSubject(all, T.roleAssignee(r.id));
  res.json({
    modules: MODULES.map((m) => ({ id: m.id, name: m.name, icon: m.icon, group: m.group })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, description: r.description, is_system: r.is_system })),
    matrix,
    levels: LEVELS,
  });
});

// set a role's grant on a module (level or 'none')
app.post("/api/ac/role-grant", requireAuth, acEdit, async (req, res) => {
  const { roleId, moduleId, level } = req.body || {};
  if (!(await db.getRole(roleId))) return res.status(400).json({ error: "unknown role" });
  if (!moduleById[moduleId]) return res.status(400).json({ error: "unknown module" });
  await setGrant(T.roleAssignee(roleId), moduleId, level === "none" ? null : level);
  res.json({ ok: true, roleId, grants: await roleGrants(roleId) });
});

// set an individual user's grant on a module (the per-person override)
app.post("/api/ac/user-grant", requireAuth, acEdit, async (req, res) => {
  const { userId, moduleId, level } = req.body || {};
  if (!(await db.getUser(userId))) return res.status(400).json({ error: "unknown user" });
  if (!moduleById[moduleId]) return res.status(400).json({ error: "unknown module" });
  await setGrant(`user:${userId}`, moduleId, level === "none" ? null : level);
  res.json({ ok: true, userId, grants: await individualGrants(userId) });
});

// per-user view: their roles, their individual overrides, and their effective level per module
app.get("/api/ac/user/:id", requireAuth, acView, async (req, res) => {
  const u = await db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: "no such user" });
  const roles = await rolesForUser(u.id);
  const individual = await individualGrants(u.id);
  const effective = await effectiveModules(u.id);
  res.json({ user: u, roles, individual, effective, manager: await managerOf(u.id) });
});

// assign / unassign a role to a user
app.post("/api/ac/assign-role", requireAuth, acEdit, async (req, res) => {
  const { userId, roleId, assigned } = req.body || {};
  if (!(await db.getUser(userId))) return res.status(400).json({ error: "unknown user" });
  if (!(await db.getRole(roleId))) return res.status(400).json({ error: "unknown role" });
  if (assigned) await fga.write(T.membership(userId, roleId));
  else await fga.del(T.membership(userId, roleId));
  res.json({ ok: true, roles: await rolesForUser(userId) });
});

// create / update / delete a role
app.post("/api/ac/role", requireAuth, acEdit, async (req, res) => {
  const { id, name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const rid = id || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
  if (await db.getRole(rid)) return res.status(409).json({ error: "role id already exists" });
  const role = await db.createRole({ id: rid, name, description });
  res.status(201).json(role);
});
app.patch("/api/ac/role/:id", requireAuth, acEdit, async (req, res) => {
  const { name, description } = req.body || {};
  res.json(await db.updateRole(req.params.id, { name, description }));
});
app.delete("/api/ac/role/:id", requireAuth, acEdit, async (req, res) => {
  const role = await db.getRole(req.params.id);
  if (!role) return res.status(404).json({ error: "no such role" });
  if (role.is_system) return res.status(400).json({ error: "cannot delete a system role" });
  // clean up its grants + memberships in OpenFGA
  const grants = await roleGrants(role.id);
  for (const mid of Object.keys(grants)) await setGrant(T.roleAssignee(role.id), mid, null);
  const users = await db.listUsers();
  for (const u of users) {
    const rs = await rolesForUser(u.id);
    if (rs.includes(role.id)) await fga.del(T.membership(u.id, role.id));
  }
  await db.deleteRole(role.id);
  res.json({ ok: true });
});

// org hierarchy: list + set manager
app.get("/api/ac/hierarchy", requireAuth, acView, async (req, res) => {
  const users = await db.listUsers();
  const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));
  const rows = await Promise.all(users.map(async (u) => {
    const mgr = await managerOf(u.id);
    return { id: u.id, name: u.name, department: u.department, manager: mgr, managerName: mgr ? nameById[mgr] || mgr : null };
  }));
  res.json({ users: rows });
});

app.post("/api/ac/set-manager", requireAuth, acEdit, async (req, res) => {
  const { userId, managerId } = req.body || {};
  if (!(await db.getUser(userId))) return res.status(400).json({ error: "unknown user" });
  if (managerId && userId === managerId) return res.status(400).json({ error: "a user cannot manage themselves" });
  const cur = await managerOf(userId);
  if (cur) await fga.del(T.managerEdge(userId, cur));
  if (managerId) await fga.write(T.managerEdge(userId, managerId));
  res.json({ ok: true });
});

// ---- the Check tool: live ALLOW/DENY + why ----
app.post("/api/ac/check", requireAuth, acView, async (req, res) => {
  try {
    const { actorId, targetType, targetId, action } = req.body || {};
    if (!(await db.getUser(actorId))) return res.status(400).json({ error: "unknown actor" });
    const actor = `user:${actorId}`;

    if (targetType === "module") {
      if (!moduleById[targetId]) return res.status(400).json({ error: "unknown module" });
      const relation = LEVELS.includes(action) ? action : "viewer";
      const allowed = await fga.check(actor, relation, `module:${targetId}`);

      // why: individual direct? role-derived?
      const reasons = [];
      if (allowed) {
        const indiv = await individualGrants(actorId);
        if (indiv[targetId] && rank(indiv[targetId]) >= rank(relation)) {
          reasons.push(`Direct individual grant: ${actorId} has "${indiv[targetId]}" on ${targetId} (per-user override).`);
        }
        const roles = await rolesForUser(actorId);
        for (const r of roles) {
          const g = await roleGrants(r);
          if (g[targetId] && rank(g[targetId]) >= rank(relation)) {
            reasons.push(`Via role "${r}": role grants "${g[targetId]}" on ${targetId}.`);
          }
        }
        if (relation !== "viewer" && reasons.length === 0) {
          reasons.push("Granted (resolved by OpenFGA through the level cascade).");
        }
        if (reasons.length === 0) reasons.push("Granted by OpenFGA.");
      } else {
        reasons.push(`No role of ${actorId}, and no individual override, grants "${relation}" on ${targetId}.`);
      }
      return res.json({ allowed, relation, target: `module:${targetId}`, reasons });
    }

    if (targetType === "user") {
      if (!(await db.getUser(targetId))) return res.status(400).json({ error: "unknown target user" });
      // "manage" = is actor the target's manager or a manager above them?
      const allowed = await fga.check(actor, "reports_to", `user:${targetId}`);
      const reasons = allowed
        ? [`${actorId} is above ${targetId} in the reporting hierarchy (direct or transitive manager).`]
        : [`${actorId} is not in ${targetId}'s management chain.`];
      return res.json({ allowed, relation: "manages (reports_to)", target: `user:${targetId}`, reasons });
    }

    res.status(400).json({ error: "targetType must be 'module' or 'user'" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// health is always available (never gated) so Render's health check passes
// even while OpenFGA is still connecting.
app.get("/api/health", (req, res) => res.json({ ok: true, ready: READY, ...fga.ids() }));

app.use(express.static(path.join(__dirname, "../public")));
// SPA fallback for any non-API GET
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));

// Bind the port right away so Render marks the service live; connect to
// OpenFGA + seed in the background, retrying forever so a not-yet-ready or
// idle-spun-down OpenFGA server never crashes the app.
app.listen(PORT, () => console.log(`openfga-rbac-demo listening on :${PORT}`));

(async function boot() {
  for (let attempt = 1; ; attempt++) {
    try {
      const { storeId, modelId } = await fga.init(modelJson);
      console.log(`[fga] store=${storeId} model=${modelId}`);
      const s = await seed(db, fga);
      console.log(`[seed] ${s.seeded ? `seeded ${s.users} users / ${s.roles} roles` : "existing data, no seed"}`);
      READY = true;
      console.log("[ready] app fully initialized");
      return;
    } catch (e) {
      console.error(`[boot] attempt ${attempt} failed: ${e.message} — retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
})();

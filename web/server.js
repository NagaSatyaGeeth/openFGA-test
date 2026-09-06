"use strict";
const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const { makeClient } = require("../lib/openfgaClient");
const { makeDb } = require("../lib/db");

const PORT = process.env.PORT || 4000;
// On Render, OPENFGA_API_URL is wired via `fromService: {property: hostport}`,
// which yields a bare "host:port" with no scheme - default it to http:// since
// OpenFGA-to-OpenFGA and web-to-OpenFGA traffic here all stays on Render's
// private network (TLS terminates at the public edge, not between services).
const rawApiUrl = process.env.OPENFGA_API_URL || "http://localhost:8081";
const OPENFGA_API_URL = /^https?:\/\//.test(rawApiUrl) ? rawApiUrl : `http://${rawApiUrl}`;
// Both services can share one Render env var group keyed
// OPENFGA_AUTHN_PRESHARED_KEYS (OpenFGA's own required name for that value);
// accept OPENFGA_API_KEY too for local/manual overrides.
const OPENFGA_API_KEY = process.env.OPENFGA_API_KEY || process.env.OPENFGA_AUTHN_PRESHARED_KEYS || "";
const STORE_NAME = process.env.OPENFGA_STORE_NAME || "vls-authority-spike";
// Reuses the SAME Postgres instance OpenFGA's own datastore runs against
// (one free-tier database, not two) - see lib/db.js for why that's safe.
const APP_DATABASE_URL = process.env.APP_DATABASE_URL || process.env.OPENFGA_DATASTORE_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || "vls-demo-insecure-local-secret";

const org = JSON.parse(fs.readFileSync(path.join(__dirname, "../seed/org.json"), "utf8"));
const model = JSON.parse(fs.readFileSync(path.join(__dirname, "../model/model.json"), "utf8"));
const moduleById = Object.fromEntries(org.modules.map((m) => [m.id, m]));

const client = makeClient({ apiUrl: OPENFGA_API_URL, apiKey: OPENFGA_API_KEY });
const db = makeDb(APP_DATABASE_URL);

const DUMMY_RECORDS = {
  documents: [
    { title: "Employee Handbook v3.2", subtitle: "Updated 2026-06-01 · Policy" },
    { title: "Data Retention SOP", subtitle: "Compliance · reviewed quarterly" },
    { title: "Lab Safety Guidelines", subtitle: "Operations · mandatory acknowledgement" },
  ],
  payroll_finance: [
    { title: "August 2026 Payroll Run", subtitle: "Processed · 10 employees · $84,200" },
    { title: "Q3 Budget Forecast", subtitle: "Draft · finance review pending" },
    { title: "Bonus Pool Allocation", subtitle: "Approved by founder" },
  ],
  reports: [
    { title: "Headcount Trend - H1 2026", subtitle: "Auto-generated · org-wide" },
    { title: "Attrition Report", subtitle: "Quarterly · HR + director view" },
    { title: "Department Spend Summary", subtitle: "Finance rollup" },
  ],
  expenses: [
    { title: "Laptop reimbursement - $1,200", subtitle: "Submitted by Erin Employee · Pending" },
    { title: "Conference travel - $640", subtitle: "Submitted by Mike Manager · Approved" },
    { title: "Client dinner - $95", subtitle: "Submitted by Dana Director · Approved" },
  ],
  invoices: [
    { title: "INV-1042 - Acme Labs Supplies", subtitle: "$4,300 · Paid" },
    { title: "INV-1043 - CloudHost Services", subtitle: "$1,150 · Due 2026-09-20" },
    { title: "INV-1044 - Reagent Vendor Co", subtitle: "$2,780 · Overdue" },
  ],
  attendance: [
    { title: "Erin Employee - August", subtitle: "21/22 days present" },
    { title: "Evan Employee - August", subtitle: "20/22 days present · 1 sick day" },
    { title: "Zack Employee - August", subtitle: "22/22 days present" },
  ],
  appointment_letters: [
    { title: "Offer Letter - Zack Employee", subtitle: "Issued 2026-01-15 · Signed" },
    { title: "Promotion Letter - Mike Manager", subtitle: "Issued 2026-03-01 · Signed" },
    { title: "Appointment Letter - Fiona Finance", subtitle: "Issued 2025-11-10 · Signed" },
  ],
  blockchain: [
    { title: "Block #1042", subtitle: "Anchored 2026-08-01 · hash 0x9f2a…e31c" },
    { title: "Block #1041", subtitle: "Anchored 2026-07-25 · hash 0x7bd4…aa02" },
    { title: "Block #1040", subtitle: "Anchored 2026-07-18 · hash 0x1c88…f450" },
  ],
};

let storeId = null;
let modelId = null;
let permissionsMatrix = null;
let representativeByRole = null;

const ACCESS_ORDER = ["none", "viewer", "editor", "admin"];
const ACCESS_LEVELS = ["admin", "editor", "viewer"]; // checked in this order, most-privileged first

async function computePermissionsMatrix(employees) {
  representativeByRole = Object.fromEntries(
    org.roles.map((role) => [role, employees.find((e) => e.role === role)])
  );
  const matrix = {};
  for (const role of org.roles) {
    const rep = representativeByRole[role];
    matrix[role] = {};
    for (const mod of org.modules) {
      let level = "none";
      if (rep) {
        for (const candidate of ACCESS_LEVELS) {
          const result = await client.check(storeId, modelId, {
            user: `employee:${rep.id}`,
            relation: candidate,
            object: `module:${mod.id}`,
          });
          if (result.allowed) {
            level = candidate;
            break;
          }
        }
      }
      matrix[role][mod.id] = level;
    }
  }
  return matrix;
}

async function ensureSeeded() {
  await db.migrate();
  await db.seedUsersIfEmpty(org.employees, org.demoPassword);
  await db.seedDummyRecordsIfEmpty(DUMMY_RECORDS);
  const employees = await db.listUsers();

  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const { id, created } = await client.findOrCreateStore(STORE_NAME);
      storeId = id;
      modelId = await client.ensureModel(storeId, model);
      const tuples = client.buildTuples(org, employees);
      const { written, skipped } = await client.writeTuplesIdempotent(storeId, tuples);
      console.log(
        `[seed] store=${storeId} (${created ? "created" : "reused"}) model=${modelId} tuples: ${written} written, ${skipped} already present`
      );
      permissionsMatrix = await computePermissionsMatrix(employees);
      console.log(`[matrix] computed permissions matrix for ${org.roles.length} roles x ${org.modules.length} modules`);
      return;
    } catch (err) {
      console.error(`[seed] attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("could not seed OpenFGA store after 20 attempts - is the OpenFGA server reachable?");
}

function accessLevel(role, moduleId) {
  return (permissionsMatrix && permissionsMatrix[role] && permissionsMatrix[role][moduleId]) || "none";
}

function modulesForRole(role) {
  return org.modules
    .map((m) => ({ id: m.id, name: m.name, description: m.description, common: !!m.common, kind: m.kind, level: accessLevel(role, m.id) }))
    .filter((m) => m.level !== "none");
}

async function activeSuperuserCountExcluding(excludeId) {
  const users = await db.listUsers();
  return users.filter((u) => u.id !== excludeId && u.active && org.superuserRoles.includes(u.role)).length;
}

// --- auth & module-access middleware ---

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "not authenticated" });
  next();
}

function requireModuleAccess(moduleIdOrFn, minLevel) {
  return async (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: "not authenticated" });
    const user = await db.getUserById(req.session.userId);
    if (!user || !user.active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "account no longer active" });
    }
    const moduleId = typeof moduleIdOrFn === "function" ? moduleIdOrFn(req) : moduleIdOrFn;
    const level = accessLevel(user.role, moduleId);
    if (ACCESS_ORDER.indexOf(level) < ACCESS_ORDER.indexOf(minLevel)) {
      return res.status(403).json({ error: `requires ${minLevel} on module "${moduleId}", actor has ${level}` });
    }
    req.currentUser = user;
    req.moduleLevel = level;
    next();
  };
}

// SUB_RELATIONS drive the "why" explanation: we ask OpenFGA which specific
// branch of `can_act_on` is true, in addition to the top-level action check.
const SUB_RELATIONS = [
  { relation: "superuser_managed", label: "superuser_access (founder/admin blanket authority)" },
  { relation: "org_wide_role_managed", label: "org-wide manageable-set entry" },
  { relation: "subtree_managed", label: "subtree manageable-set entry (actor is within target's reporting chain)" },
];

function explainDeny(actor, target) {
  const actorSet = org.manageableSets[actor.role];
  if (!actorSet) {
    return `${actor.role} has no manageable set defined at all - it cannot act on anyone but itself, under any scope.`;
  }
  if (!actorSet.roles.includes(target.role)) {
    return `${actor.role}'s manageable set is {${actorSet.roles.join(", ")}} - it does not include target role "${target.role}", so no rule applies regardless of hierarchy.`;
  }
  if (actorSet.scope === "subtree") {
    return `${actor.role} manages "${target.role}" but only within its own reporting subtree, and ${target.name} does not report (directly or transitively) to ${actor.name}.`;
  }
  return `No matching rule was found for this actor/target/role combination.`;
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
  })
);

// --- auth routes ---

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  const user = await db.verifyLogin(email, password);
  if (!user) return res.status(401).json({ error: "invalid email or password" });
  req.session.userId = user.id;
  res.json({ user, modules: modulesForRole(user.role) });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await db.getUserById(req.session.userId);
  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "not authenticated" });
  }
  res.json({ user, modules: modulesForRole(user.role), demoPassword: org.demoPassword });
});

// --- generic per-module data (dummy / employees_view / overview kinds) ---

app.get("/api/modules/:id/data", requireModuleAccess((req) => req.params.id, "viewer"), async (req, res) => {
  const mod = moduleById[req.params.id];
  if (!mod) return res.status(404).json({ error: "unknown module" });
  if (mod.kind === "dummy") {
    return res.json({ kind: "dummy", records: await db.dummyRecordsForModule(mod.id) });
  }
  if (mod.kind === "employees_view") {
    return res.json({ kind: "employees_view", employees: await db.listUsers() });
  }
  if (mod.kind === "overview") {
    const employees = await db.listUsers();
    const byRole = {};
    for (const role of org.roles) byRole[role] = employees.filter((e) => e.role === role && e.active).length;
    return res.json({ kind: "overview", totalActive: employees.filter((e) => e.active).length, byRole });
  }
  res.status(404).json({ error: `module "${mod.id}" has no generic data view` });
});

// --- users module: the one with real CRUD ---

app.get("/api/users", requireModuleAccess("users", "viewer"), async (req, res) => {
  res.json(await db.listUsers());
});

app.post("/api/users", requireModuleAccess("users", "editor"), async (req, res) => {
  const { name, email, password, role, manager } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "name, email, password, and role are required" });
  }
  if (!org.roles.includes(role)) return res.status(400).json({ error: `unknown role "${role}"` });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });
  const existing = await db.getUserByEmail(email);
  if (existing) return res.status(409).json({ error: "a user with that email already exists" });
  if (manager) {
    const mgr = await db.getUserById(manager);
    if (!mgr) return res.status(400).json({ error: `unknown manager id "${manager}"` });
  }

  const user = await db.createUser({ name, email, password, role, manager: manager || null });
  await client.replaceEmployeeTuples(storeId, null, user);
  res.status(201).json(user);
});

app.patch("/api/users/:id", requireModuleAccess("users", "editor"), async (req, res) => {
  const id = req.params.id;
  const before = await db.getUserById(id);
  if (!before) return res.status(404).json({ error: "no such user" });

  const { name, email, password, role, manager, active } = req.body || {};
  if (role !== undefined && !org.roles.includes(role)) return res.status(400).json({ error: `unknown role "${role}"` });
  if (password !== undefined && password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  if (manager !== undefined && manager) {
    if (manager === id) return res.status(400).json({ error: "a user cannot be their own manager" });
    const mgr = await db.getUserById(manager);
    if (!mgr) return res.status(400).json({ error: `unknown manager id "${manager}"` });
  }

  // Rule 2 (org-lockout guard) applied here too, exactly like the Authority
  // Checks tool's simulateLastSuperuser toggle - OpenFGA has no way to
  // express "don't let this be the last one", so it's enforced here in
  // app code against the live active-superuser count.
  if (active === false && org.superuserRoles.includes(before.role)) {
    const remaining = await activeSuperuserCountExcluding(id);
    if (remaining < 1) {
      return res.status(409).json({
        error: `Blocking: deactivating ${before.name} would leave zero active superusers (founder/admin) in the org. This guard runs in application code - OpenFGA's relationship model has no "last remaining member of a set" primitive.`,
      });
    }
  }

  const after = await db.updateUser(id, { name, email, password, role, manager, active });
  if ((role !== undefined && role !== before.role) || (manager !== undefined && manager !== before.manager)) {
    await client.replaceEmployeeTuples(storeId, before, after);
  }
  res.json(after);
});

// --- OpenFGA Dashboard (Authority Checks + Permissions Dashboard) - the
// whole cluster below is gated to whoever holds "admin" on openfga_admin,
// which by seed data is founder/admin only. ---

const openfgaAdmin = requireModuleAccess("openfga_admin", "admin");

app.get("/api/org", openfgaAdmin, async (req, res) => {
  const employees = await db.listUsers();
  res.json({
    employees,
    roles: org.roles,
    superuserRoles: org.superuserRoles,
    manageableSets: org.manageableSets,
    assumptionsNote: org.assumptionsNote,
  });
});

app.get("/api/scenarios", openfgaAdmin, (req, res) => {
  res.json([
    { id: "hr-vs-founder", actor: "carol", target: "alice", action: "deactivate", label: "HR tries to deactivate the founder", expect: "DENY" },
    { id: "manager-own-report", actor: "mike", target: "erin", action: "manage", label: "Manager acts on their own report", expect: "ALLOW" },
    { id: "hr-vs-director", actor: "carol", target: "dana", action: "manage", label: "HR acts on a director", expect: "DENY" },
    { id: "founder-vs-admin", actor: "alice", target: "bob", action: "manage", label: "Founder acts on admin", expect: "ALLOW" },
    { id: "admin-vs-founder", actor: "bob", target: "alice", action: "manage", label: "Admin tries to act on founder (outranked)", expect: "DENY" },
    { id: "manager-vs-peer-report", actor: "mike", target: "zack", action: "manage", label: "Manager acts on a peer manager's report", expect: "DENY" },
    { id: "director-vs-employee", actor: "dana", target: "erin", action: "manage", label: "Director acts on any employee (org-wide, broad but not superuser)", expect: "ALLOW" },
    { id: "director-vs-admin", actor: "dana", target: "bob", action: "manage", label: "Director tries to act on admin", expect: "DENY" },
    { id: "hr-edit-hierarchy", actor: "carol", target: null, action: "edit_hierarchy", label: "HR tries to edit the org hierarchy", expect: "DENY" },
    { id: "admin-edit-hierarchy", actor: "bob", target: null, action: "edit_hierarchy", label: "Admin edits the org hierarchy", expect: "ALLOW" },
  ]);
});

app.post("/api/check", openfgaAdmin, async (req, res) => {
  try {
    const { actorId, targetId, action, simulateLastSuperuser } = req.body;
    const employees = await db.listUsers();
    const employeesById = Object.fromEntries(employees.map((e) => [e.id, e]));
    const actor = employeesById[actorId];
    if (!actor) return res.status(400).json({ error: `unknown actor id "${actorId}"` });

    if (action === "edit_hierarchy") {
      const result = await client.check(storeId, modelId, {
        user: `employee:${actor.id}`,
        relation: "hierarchy_editor",
        object: "org:vls",
      });
      return res.json({
        openfgaAllowed: result.allowed === true,
        finalAllowed: result.allowed === true,
        decidedBy: result.allowed
          ? "hierarchy_editor (superuser_access role list on org:vls)"
          : "no rule grants hierarchy_editor to this actor's role - only founder/admin hold it",
        appGuardTriggered: false,
        actor,
        target: null,
        action,
      });
    }

    const target = employeesById[targetId];
    if (!target) return res.status(400).json({ error: `unknown target id "${targetId}"` });
    if (!["deactivate", "change_role", "manage"].includes(action)) {
      return res.status(400).json({ error: `unknown action "${action}"` });
    }

    const topLevel = await client.check(storeId, modelId, {
      user: `employee:${actor.id}`,
      relation: action,
      object: `employee:${target.id}`,
    });
    const openfgaAllowed = topLevel.allowed === true;

    let decidedBy = "no matching rule";
    if (openfgaAllowed) {
      for (const sub of SUB_RELATIONS) {
        const subResult = await client.check(storeId, modelId, {
          user: `employee:${actor.id}`,
          relation: sub.relation,
          object: `employee:${target.id}`,
        });
        if (subResult.allowed) {
          decidedBy = sub.label;
          break;
        }
      }
    } else {
      decidedBy = explainDeny(actor, target);
    }

    let appGuardTriggered = false;
    let appGuardReason = null;
    if ((action === "deactivate" || action === "change_role") && org.superuserRoles.includes(target.role)) {
      const activeSuperusersExcludingTarget = await activeSuperuserCountExcluding(target.id);
      const remaining = simulateLastSuperuser ? 0 : activeSuperusersExcludingTarget;
      if (remaining < 1) {
        appGuardTriggered = true;
        appGuardReason = `Blocking: this would leave zero active superusers (founder/admin) in the org. OpenFGA's relationship graph has no way to express "last remaining member of a set" - this check runs in application code, outside the ReBAC model, by counting active superuser tuples/flags.`;
      }
    }

    const finalAllowed = openfgaAllowed && !appGuardTriggered;

    res.json({
      openfgaAllowed,
      finalAllowed,
      decidedBy: appGuardTriggered ? appGuardReason : decidedBy,
      appGuardTriggered,
      actor,
      target,
      action,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/expand", openfgaAdmin, async (req, res) => {
  try {
    const { relation, targetId } = req.query;
    const tree = await client.expand(storeId, modelId, {
      relation,
      object: `employee:${targetId}`,
    });
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/modules", openfgaAdmin, (req, res) => {
  res.json(org.modules.map((m) => ({ id: m.id, name: m.name, description: m.description, common: !!m.common })));
});

app.get("/api/permissions-matrix", openfgaAdmin, (req, res) => {
  if (!permissionsMatrix) return res.status(503).json({ error: "matrix not ready yet" });
  res.json({ roles: org.roles, modules: org.modules.map((m) => m.id), matrix: permissionsMatrix });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, storeId, modelId, openfgaApiUrl: OPENFGA_API_URL });
});

app.use(express.static(path.join(__dirname, "public")));

ensureSeeded()
  .then(() => {
    app.listen(PORT, () => console.log(`VLS OpenFGA demo web listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("fatal: could not seed on startup:", err);
    process.exit(1);
  });

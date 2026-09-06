"use strict";
const fs = require("fs");
const path = require("path");
const express = require("express");
const { makeClient } = require("../lib/openfgaClient");

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

const org = JSON.parse(fs.readFileSync(path.join(__dirname, "../seed/org.json"), "utf8"));
const model = JSON.parse(fs.readFileSync(path.join(__dirname, "../model/model.json"), "utf8"));

const employeesById = Object.fromEntries(org.employees.map((e) => [e.id, e]));
const client = makeClient({ apiUrl: OPENFGA_API_URL, apiKey: OPENFGA_API_KEY });

let storeId = null;
let modelId = null;
let permissionsMatrix = null;

// One representative employee per role - Check needs an actual employee
// subject (module access is granted to role#assignee usersets, not roles
// directly), so we pick whoever was seeded first under each role.
const representativeByRole = Object.fromEntries(
  org.roles.map((role) => [role, org.employees.find((e) => e.role === role)])
);

const ACCESS_LEVELS = ["admin", "editor", "viewer"]; // checked in this order, most-privileged first

async function computePermissionsMatrix() {
  const matrix = {};
  for (const role of org.roles) {
    const rep = representativeByRole[role];
    matrix[role] = {};
    for (const mod of org.modules || []) {
      let level = "none";
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
      matrix[role][mod.id] = level;
    }
  }
  return matrix;
}

async function ensureSeeded() {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const { id, created } = await client.findOrCreateStore(STORE_NAME);
      storeId = id;
      modelId = await client.ensureModel(storeId, model);
      const tuples = client.buildTuples(org);
      const { written, skipped } = await client.writeTuplesIdempotent(storeId, tuples);
      console.log(
        `[seed] store=${storeId} (${created ? "created" : "reused"}) model=${modelId} tuples: ${written} written, ${skipped} already present`
      );
      return;
    } catch (err) {
      console.error(`[seed] attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("could not seed OpenFGA store after 20 attempts - is the OpenFGA server reachable?");
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
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/org", (req, res) => {
  res.json({
    employees: org.employees,
    roles: org.roles,
    superuserRoles: org.superuserRoles,
    manageableSets: org.manageableSets,
    assumptionsNote: org.assumptionsNote,
  });
});

app.get("/api/scenarios", (req, res) => {
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

app.post("/api/check", async (req, res) => {
  try {
    const { actorId, targetId, action, simulateLastSuperuser } = req.body;
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

    // --- App-side org-lockout guard (rule 2): OpenFGA has no notion of
    // cardinality/"last remaining member of a set", so this is computed
    // outside the ReBAC graph entirely, against the demo's static "active"
    // flags. `simulateLastSuperuser` lets the UI show what happens when the
    // guard *would* actually be the deciding factor.
    let appGuardTriggered = false;
    let appGuardReason = null;
    if ((action === "deactivate" || action === "change_role") && org.superuserRoles.includes(target.role)) {
      const activeSuperusersExcludingTarget = org.employees.filter(
        (e) => e.id !== target.id && e.active && org.superuserRoles.includes(e.role)
      ).length;
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

app.get("/api/expand", async (req, res) => {
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

app.get("/api/health", (req, res) => {
  res.json({ ok: true, storeId, modelId, openfgaApiUrl: OPENFGA_API_URL });
});

app.get("/api/modules", (req, res) => {
  res.json(
    (org.modules || []).map((m) => ({ id: m.id, name: m.name, description: m.description, common: !!m.common }))
  );
});

app.get("/api/permissions-matrix", (req, res) => {
  if (!permissionsMatrix) return res.status(503).json({ error: "matrix not ready yet" });
  res.json({ roles: org.roles, modules: (org.modules || []).map((m) => m.id), matrix: permissionsMatrix });
});

ensureSeeded()
  .then(async () => {
    permissionsMatrix = await computePermissionsMatrix();
    console.log(`[matrix] computed permissions matrix for ${org.roles.length} roles x ${(org.modules || []).length} modules`);
    app.listen(PORT, () => console.log(`VLS OpenFGA demo web listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("fatal: could not seed OpenFGA on startup:", err);
    process.exit(1);
  });

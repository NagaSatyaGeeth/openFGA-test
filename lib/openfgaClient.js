// Shared OpenFGA HTTP client + seeding logic used by both the CLI seed
// script (scripts/seed.js) and the web app's self-seed-on-boot path
// (web/server.js). Talks to the real OpenFGA HTTP API - no SDK, no mocks.
"use strict";

function makeClient({ apiUrl, apiKey }) {
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  async function api(method, urlPath, body) {
    const res = await fetch(`${apiUrl}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = text;
    }
    if (!res.ok) {
      const err = new Error(`${method} ${urlPath} -> ${res.status}: ${JSON.stringify(json)}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  async function findOrCreateStore(name) {
    const list = await api("GET", "/stores?page_size=100");
    const existing = (list.stores || []).find((s) => s.name === name);
    if (existing) return { id: existing.id, created: false };
    const created = await api("POST", "/stores", { name });
    return { id: created.id, created: true };
  }

  async function ensureModel(storeId, modelJson) {
    // Authorization models are immutable and versioned in OpenFGA - always
    // write the current model.json as a new version rather than reusing
    // whatever's latest, so a code change (e.g. adding a type) actually
    // takes effect on the next boot instead of silently running stale.
    const created = await api("POST", `/stores/${storeId}/authorization-models`, modelJson);
    return created.authorization_model_id;
  }

  function buildTuples(org) {
    const tuples = [];
    for (const e of org.employees) {
      tuples.push({ user: `role:${e.role}`, relation: "role", object: `employee:${e.id}` });
      tuples.push({ user: `employee:${e.id}`, relation: "assignee", object: `role:${e.role}` });
      if (e.manager) {
        tuples.push({ user: `employee:${e.manager}`, relation: "manager", object: `employee:${e.id}` });
      }
    }
    for (const role of org.roles) {
      if (role === "founder") {
        tuples.push({ user: "role:founder#assignee", relation: "superuser_access", object: "role:founder" });
      } else {
        tuples.push({ user: "role:founder#assignee", relation: "superuser_access", object: `role:${role}` });
        tuples.push({ user: "role:admin#assignee", relation: "superuser_access", object: `role:${role}` });
      }
    }
    for (const [actingRole, cfg] of Object.entries(org.manageableSets)) {
      const relation = cfg.scope === "org_wide" ? "managed_org_wide_by" : "managed_subtree_by";
      for (const targetRole of cfg.roles) {
        tuples.push({ user: `role:${actingRole}#assignee`, relation, object: `role:${targetRole}` });
      }
    }
    for (const role of org.superuserRoles) {
      tuples.push({ user: `role:${role}#assignee`, relation: "hierarchy_editor", object: "org:vls" });
    }

    // --- module RBAC: viewer/editor/admin per role, per module ---
    for (const mod of org.modules || []) {
      for (const [level, roles] of Object.entries(mod.access || {})) {
        for (const role of roles) {
          tuples.push({ user: `role:${role}#assignee`, relation: level, object: `module:${mod.id}` });
        }
      }
    }
    return tuples;
  }

  async function writeTuplesIdempotent(storeId, tuples) {
    let written = 0;
    let skipped = 0;
    for (const t of tuples) {
      try {
        await api("POST", `/stores/${storeId}/write`, { writes: { tuple_keys: [t] } });
        written++;
      } catch (err) {
        // OpenFGA returns 400 code "write_failed_due_to_invalid_input" when the
        // exact tuple already exists - safe to skip. Any *other* 400 (e.g.
        // code "validation_error" for a type/relation the current model
        // doesn't define) is a real bug and must not be swallowed - that
        // silently dropped every module tuple during development here when
        // the store's latest model was briefly stale.
        const isDuplicate =
          err.status === 400 && err.body && err.body.code === "write_failed_due_to_invalid_input";
        if (isDuplicate) {
          skipped++;
          continue;
        }
        throw err;
      }
    }
    return { written, skipped };
  }

  async function check(storeId, modelId, { user, relation, object }, contextualTuples) {
    const body = {
      authorization_model_id: modelId,
      tuple_key: { user, relation, object },
    };
    if (contextualTuples && contextualTuples.length) {
      body.contextual_tuples = { tuple_keys: contextualTuples };
    }
    return api("POST", `/stores/${storeId}/check`, body);
  }

  async function expand(storeId, modelId, { relation, object }) {
    return api("POST", `/stores/${storeId}/expand`, {
      authorization_model_id: modelId,
      tuple_key: { relation, object },
    });
  }

  return { api, findOrCreateStore, ensureModel, buildTuples, writeTuplesIdempotent, check, expand };
}

module.exports = { makeClient };

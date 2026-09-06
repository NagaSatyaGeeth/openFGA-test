// Thin OpenFGA HTTP client. Talks to the real OpenFGA server's REST API -
// no SDK, no simulation. Every access decision in this app goes through
// check()/batchCheck() LIVE at request time; nothing is precomputed or frozen.
"use strict";

function makeFga({ apiUrl, apiKey, storeName }) {
  const base = /^https?:\/\//.test(apiUrl) ? apiUrl : `http://${apiUrl}`;
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  let storeId = null;
  let modelId = null;

  async function api(method, path, body) {
    const res = await fetch(`${base}${path}`, {
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
      const err = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  // ---- bootstrap: find/create store, write the current model version ----
  async function init(modelJson) {
    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        const list = await api("GET", "/stores?page_size=100");
        const existing = (list.stores || []).find((s) => s.name === storeName);
        storeId = existing ? existing.id : (await api("POST", "/stores", { name: storeName })).id;
        // Authorization models are immutable + versioned; always write the
        // current model so code changes take effect, and use the id we just
        // created (never a stale "latest").
        const created = await api("POST", `/stores/${storeId}/authorization-models`, modelJson);
        modelId = created.authorization_model_id;
        return { storeId, modelId };
      } catch (err) {
        if (attempt === 30) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  const ids = () => ({ storeId, modelId });

  // ---- writes (all instant; the next check() sees them) ----
  function norm(t) {
    // accepts {user, relation, object}
    return { user: t.user, relation: t.relation, object: t.object };
  }

  async function write(tuples) {
    const arr = (Array.isArray(tuples) ? tuples : [tuples]).map(norm);
    if (!arr.length) return;
    try {
      await api("POST", `/stores/${storeId}/write`, { writes: { tuple_keys: arr } });
    } catch (err) {
      // tolerate "already exists" so writes are idempotent; re-throw anything else
      if (err.status === 400 && err.body && err.body.code === "write_failed_due_to_invalid_input") return;
      throw err;
    }
  }

  async function del(tuples) {
    const arr = (Array.isArray(tuples) ? tuples : [tuples]).map(norm);
    if (!arr.length) return;
    try {
      await api("POST", `/stores/${storeId}/write`, { deletes: { tuple_keys: arr } });
    } catch (err) {
      // tolerate "does not exist"
      if (err.status === 400 && err.body && err.body.code === "write_failed_due_to_invalid_input") return;
      throw err;
    }
  }

  // ---- reads / checks (LIVE) ----
  async function check(user, relation, object, contextualTuples) {
    const body = { authorization_model_id: modelId, tuple_key: { user, relation, object } };
    if (contextualTuples && contextualTuples.length) {
      body.contextual_tuples = { tuple_keys: contextualTuples.map(norm) };
    }
    const res = await api("POST", `/stores/${storeId}/check`, body);
    return res.allowed === true;
  }

  // Batch several checks concurrently (still individual live Checks server-side).
  async function batchCheck(items) {
    return Promise.all(items.map((i) => check(i.user, i.relation, i.object).then((allowed) => ({ ...i, allowed }))));
  }

  // Read raw tuples (direct grants only - not expanded). Filter by any of
  // user/relation/object. Used to render "direct grant" toggles accurately
  // (Check would fold in the cascade + role membership and hide what's direct).
  async function read(filter = {}, pageSize = 100) {
    const tuple_key = {};
    if (filter.user) tuple_key.user = filter.user;
    if (filter.relation) tuple_key.relation = filter.relation;
    if (filter.object) tuple_key.object = filter.object;
    const out = [];
    let continuation_token = "";
    do {
      const body = { page_size: pageSize };
      if (Object.keys(tuple_key).length) body.tuple_key = tuple_key;
      if (continuation_token) body.continuation_token = continuation_token;
      const res = await api("POST", `/stores/${storeId}/read`, body);
      for (const t of res.tuples || []) out.push(t.key);
      continuation_token = res.continuation_token || "";
    } while (continuation_token);
    return out;
  }

  // List all objects of `type` on which `user` has `relation` (live).
  async function listObjects(user, relation, type) {
    const res = await api("POST", `/stores/${storeId}/list-objects`, {
      authorization_model_id: modelId,
      user,
      relation,
      type,
    });
    return res.objects || [];
  }

  async function expand(relation, object) {
    return api("POST", `/stores/${storeId}/expand`, {
      authorization_model_id: modelId,
      tuple_key: { relation, object },
    });
  }

  return { init, ids, write, del, check, batchCheck, read, listObjects, expand };
}

module.exports = { makeFga };

"use strict";
// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");
let ME = null;
let CURRENT = null; // current module id

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json.error || res.statusText); e.body = json; throw e; }
  return json;
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const titadd = (s) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function toast(msg, kind = "ok") {
  const colors = { ok: "bg-emerald-600", err: "bg-rose-600", info: "bg-slate-700" };
  const t = document.createElement("div");
  t.className = `${colors[kind]} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg max-w-sm`;
  t.textContent = msg;
  $("#toast-root").appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function modal(title, innerHtml, { wide = false } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="fixed inset-0 z-40 bg-slate-900/50 flex items-center justify-center p-4" id="modal-backdrop">
      <div class="bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 class="font-semibold text-lg">${esc(title)}</h3>
          <button id="modal-close" class="text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
        </div>
        <div class="p-6">${innerHtml}</div>
      </div>
    </div>`;
  const close = () => (root.innerHTML = "");
  $("#modal-close").onclick = close;
  $("#modal-backdrop").onclick = (e) => { if (e.target.id === "modal-backdrop") close(); };
  return close;
}

const LEVEL_BADGE = {
  approver: "bg-violet-100 text-violet-700 ring-violet-200",
  editor: "bg-brand-100 text-brand-700 ring-brand-200",
  viewer: "bg-sky-100 text-sky-700 ring-sky-200",
  none: "bg-slate-100 text-slate-500 ring-slate-200",
};
const levelPill = (lvl) => `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${LEVEL_BADGE[lvl || "none"]}">${lvl ? titadd(lvl) : "No access"}</span>`;
const levelSelect = (val, cls = "") =>
  `<select class="level-select rounded-lg border border-slate-300 text-sm px-2 py-1 ${cls}">
     ${["none", "viewer", "editor", "approver"].map((l) => `<option value="${l}" ${(''+val || 'none') === l ? "selected" : ""}>${l === "none" ? "— none —" : titadd(l)}</option>`).join("")}
   </select>`;

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------
function renderLogin(errMsg) {
  app.innerHTML = `
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
      <div class="flex items-center gap-2 mb-1"><span class="text-2xl">🔐</span><h1 class="text-xl font-bold">OpenFGA RBAC Demo</h1></div>
      <p class="text-sm text-slate-500 mb-6">Sign in to explore role &amp; permission access control.</p>
      <form id="login-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Email</label>
          <input id="li-email" type="email" required class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" placeholder="admin@demo.test" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Password</label>
          <input id="li-pass" type="password" required class="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none" />
        </div>
        ${errMsg ? `<p class="text-sm text-rose-600">${esc(errMsg)}</p>` : ""}
        <button class="w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2.5 rounded-lg transition">Sign in</button>
      </form>
      <p class="text-xs text-slate-400 mt-6 leading-relaxed">Seeded admin: <code class="bg-slate-100 px-1 rounded">admin@demo.test</code> / <code class="bg-slate-100 px-1 rounded">Admin@Demo2026</code>. Other seeded users use password <code class="bg-slate-100 px-1 rounded">Demo@2026</code>.</p>
    </div>
  </div>`;
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("POST", "/api/auth/login", { email: $("#li-email").value.trim(), password: $("#li-pass").value });
      await boot();
    } catch (err) { renderLogin(err.message); }
  };
}

// ---------------------------------------------------------------------------
// app shell
// ---------------------------------------------------------------------------
function renderShell() {
  const groups = {};
  for (const n of ME.nav) (groups[n.group] ||= []).push(n);
  const groupOrder = ["Overview", "Finance", "Sales", "People", "Administration"];
  const orderedGroups = Object.keys(groups).sort((a, b) => groupOrder.indexOf(a) - groupOrder.indexOf(b));

  app.innerHTML = `
  <div class="flex min-h-screen">
    <aside class="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">
      <div class="px-5 py-4 border-b border-slate-100">
        <div class="flex items-center gap-2 font-bold"><span class="text-xl">🔐</span> RBAC Demo</div>
        <div class="text-xs text-slate-400 mt-0.5">powered by OpenFGA</div>
      </div>
      <nav class="flex-1 overflow-y-auto py-3" id="nav">
        ${orderedGroups.map((g) => `
          <div class="px-3 mb-3">
            <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 mb-1">${esc(g)}</div>
            ${groups[g].map((n) => `
              <button data-mod="${n.id}" class="nav-item w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition text-left">
                <span class="text-base w-5 text-center">${n.icon}</span>
                <span class="flex-1">${esc(n.name)}</span>
                <span class="text-[10px] text-slate-300 group-hover:text-slate-400">${n.level[0].toUpperCase()}</span>
              </button>`).join("")}
          </div>`).join("")}
      </nav>
      <div class="border-t border-slate-100 p-3">
        <div class="flex items-center gap-2.5 px-2 mb-2">
          <div class="w-8 h-8 rounded-full bg-brand-100 text-brand-700 grid place-items-center font-semibold text-sm">${esc((ME.user.name || "?")[0])}</div>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">${esc(ME.user.name)}</div>
            <div class="text-xs text-slate-400 truncate">${esc(ME.roles.join(", ") || "no role")}</div>
          </div>
        </div>
        <button id="logout" class="w-full text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg py-1.5">Sign out</button>
      </div>
    </aside>
    <main class="flex-1 min-w-0"><div id="view" class="p-8 max-w-6xl mx-auto"></div></main>
  </div>`;

  $("#logout").onclick = async () => { await api("POST", "/api/auth/logout"); ME = null; renderLogin(); };
  document.querySelectorAll(".nav-item").forEach((b) => (b.onclick = () => selectModule(b.dataset.mod)));
}

function setActiveNav(id) {
  document.querySelectorAll(".nav-item").forEach((b) => {
    const on = b.dataset.mod === id;
    b.classList.toggle("bg-brand-50", on);
    b.classList.toggle("text-brand-700", on);
    b.classList.toggle("font-semibold", on);
  });
}

function viewHeader(icon, title, sub, right = "") {
  return `<div class="flex items-start justify-between mb-6">
    <div><h1 class="text-2xl font-bold flex items-center gap-2">${icon ? `<span>${icon}</span>` : ""}${esc(title)}</h1>
    ${sub ? `<p class="text-slate-500 mt-1">${sub}</p>` : ""}</div>${right}</div>`;
}

async function selectModule(id) {
  CURRENT = id;
  setActiveNav(id);
  const view = $("#view");
  view.innerHTML = `<div class="text-slate-400">Loading…</div>`;
  try {
    if (id === "users") return await renderUsers(view);
    if (id === "roles") return await renderRoles(view);
    if (id === "access_control") return await renderAccessControl(view);
    return await renderModule(view, id);
  } catch (e) { view.innerHTML = `<div class="text-rose-600">${esc(e.message)}</div>`; }
}

// ---------------------------------------------------------------------------
// generic module page
// ---------------------------------------------------------------------------
async function renderModule(view, id) {
  const d = await api("GET", `/api/modules/${id}`);
  const m = d.module;

  if (id === "dashboard") {
    view.innerHTML =
      viewHeader(m.icon, m.name, m.blurb, `<div class="text-right"><div class="text-xs text-slate-400 mb-1">your access</div>${levelPill(d.myLevel)}</div>`) +
      `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        ${[["Open invoices", "12", "🧾"], ["Pending expenses", "5", "💳"], ["Employees", "—", "👥"], ["Leave requests", "3", "🏖"]]
          .map(([label, val, ic]) => `<div class="bg-white rounded-xl border border-slate-200 p-5">
            <div class="text-2xl mb-2">${ic}</div>
            <div class="text-3xl font-bold">${val}</div>
            <div class="text-sm text-slate-500 mt-1">${label}</div></div>`).join("")}
      </div>
      <div class="bg-white rounded-xl border border-slate-200 p-5">
        <h3 class="font-semibold mb-3">Welcome to the OpenFGA RBAC demo</h3>
        <p class="text-sm text-slate-600 leading-relaxed">Your sidebar shows only the modules your role (and any per-user overrides) grant you — every item is a <b>live</b> OpenFGA <code class="bg-slate-100 px-1 rounded">Check</code>. Admins: head to <b>Access Control</b> to edit the role/module matrix, grant one person extra access, wire up the org hierarchy, and run the live Check tool.</p>
      </div>`;
    return;
  }
  const actionsHtml = (d.actions || []).map((a) =>
    a.allowed
      ? `<button class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium" onclick="window.__act('${esc(a.label)}')">${esc(a.label)}</button>`
      : `<button title="Requires ${a.level} access" disabled class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-sm font-medium cursor-not-allowed flex items-center gap-1">🔒 ${esc(a.label)}</button>`
  ).join("");

  view.innerHTML =
    viewHeader(m.icon, m.name, m.blurb, `<div class="text-right"><div class="text-xs text-slate-400 mb-1">your access</div>${levelPill(d.myLevel)}</div>`) +
    `${actionsHtml ? `<div class="flex flex-wrap gap-2 mb-6">${actionsHtml}</div>` : ""}
     <div class="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
       ${(d.records || []).length
         ? d.records.map((r) => `<div class="px-5 py-3.5 flex items-center justify-between">
             <div class="font-medium text-sm">${esc(r.title)}</div>
             <div class="text-sm text-slate-500">${esc(r.meta || "")}</div></div>`).join("")
         : `<div class="px-5 py-10 text-center text-slate-400 text-sm">No records to display (dummy module).</div>`}
     </div>`;
  window.__act = (label) => toast(`"${label}" — dummy action (gated by OpenFGA; you were allowed).`, "info");
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
async function renderUsers(view) {
  const [d, roles] = await Promise.all([api("GET", "/api/users"), loadRoleList()]);
  const right = d.canEdit ? `<button id="new-user" class="px-3.5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold">+ New user</button>` : "";
  view.innerHTML =
    viewHeader("👤", "Users", "Login accounts. Create users, assign roles, deactivate. Role/manager changes sync to OpenFGA instantly.", right) +
    `<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr><th class="text-left px-5 py-3">Name</th><th class="text-left px-5 py-3">Email</th><th class="text-left px-5 py-3">Department</th><th class="text-left px-5 py-3">Roles</th><th class="text-left px-5 py-3">Manager</th><th class="text-left px-5 py-3">Status</th>${d.canEdit ? "<th></th>" : ""}</tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${d.users.map((u) => `<tr>
            <td class="px-5 py-3 font-medium">${esc(u.name)}</td>
            <td class="px-5 py-3 text-slate-500">${esc(u.email)}</td>
            <td class="px-5 py-3">${esc(u.department || "—")}</td>
            <td class="px-5 py-3">${u.roles.map((r) => `<span class="inline-block bg-slate-100 rounded px-1.5 py-0.5 text-xs mr-1">${esc(r)}</span>`).join("") || "—"}</td>
            <td class="px-5 py-3 text-slate-500">${esc(u.managerName || "—")}</td>
            <td class="px-5 py-3">${u.active ? '<span class="text-emerald-600 text-xs font-semibold">● Active</span>' : '<span class="text-slate-400 text-xs font-semibold">● Inactive</span>'}</td>
            ${d.canEdit ? `<td class="px-5 py-3 text-right whitespace-nowrap"><button class="edit-user text-brand-600 hover:underline text-xs font-medium" data-id="${u.id}">Edit</button></td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  if (d.canEdit) {
    $("#new-user").onclick = () => userModal(null, roles, d.users);
    view.querySelectorAll(".edit-user").forEach((b) => (b.onclick = () => userModal(d.users.find((x) => x.id === b.dataset.id), roles, d.users)));
  }
}

function userModal(u, roles, allUsers) {
  const isEdit = !!u;
  const mgrOpts = `<option value="">— none —</option>` + allUsers.filter((x) => !u || x.id !== u.id).map((x) => `<option value="${x.id}" ${u && u.manager === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const roleOpts = `<option value="">— none —</option>` + roles.map((r) => `<option value="${r.id}" ${u && u.roles.includes(r.id) ? "selected" : ""}>${esc(r.name)}</option>`).join("");
  const close = modal(isEdit ? `Edit ${u.name}` : "New user", `
    <form id="user-form" class="space-y-3">
      <div><label class="block text-sm font-medium mb-1">Name</label><input id="uf-name" class="w-full rounded-lg border border-slate-300 px-3 py-2" value="${isEdit ? esc(u.name) : ""}" required></div>
      <div><label class="block text-sm font-medium mb-1">Email</label><input id="uf-email" type="email" class="w-full rounded-lg border border-slate-300 px-3 py-2" value="${isEdit ? esc(u.email) : ""}" required></div>
      <div><label class="block text-sm font-medium mb-1">Password ${isEdit ? '<span class="text-slate-400 font-normal">(leave blank to keep)</span>' : ""}</label><input id="uf-pass" type="text" class="w-full rounded-lg border border-slate-300 px-3 py-2" ${isEdit ? "" : "required"} placeholder="min 6 chars"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-sm font-medium mb-1">Department</label><input id="uf-dept" class="w-full rounded-lg border border-slate-300 px-3 py-2" value="${isEdit ? esc(u.department || "") : ""}"></div>
        <div><label class="block text-sm font-medium mb-1">Role</label><select id="uf-role" class="w-full rounded-lg border border-slate-300 px-3 py-2">${roleOpts}</select></div>
      </div>
      <div><label class="block text-sm font-medium mb-1">Manager</label><select id="uf-mgr" class="w-full rounded-lg border border-slate-300 px-3 py-2">${mgrOpts}</select></div>
      ${isEdit ? `<label class="flex items-center gap-2 text-sm"><input id="uf-active" type="checkbox" ${u.active ? "checked" : ""}> Active</label>` : ""}
      <p id="uf-err" class="text-sm text-rose-600 hidden"></p>
      <div class="flex justify-end gap-2 pt-2"><button type="button" id="uf-cancel" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button><button class="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold">${isEdit ? "Save" : "Create user"}</button></div>
    </form>`);
  $("#uf-cancel").onclick = close;
  $("#user-form").onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: $("#uf-name").value.trim(), email: $("#uf-email").value.trim(),
      department: $("#uf-dept").value.trim(), role: $("#uf-role").value || null, manager: $("#uf-mgr").value || null,
    };
    const pass = $("#uf-pass").value; if (pass) body.password = pass;
    if (isEdit) body.active = $("#uf-active").checked;
    try {
      if (isEdit) await api("PATCH", `/api/users/${u.id}`, body);
      else await api("POST", "/api/users", body);
      close(); toast(isEdit ? "User updated" : "User created — login + OpenFGA identity provisioned"); selectModule("users");
    } catch (err) { const el = $("#uf-err"); el.textContent = err.message; el.classList.remove("hidden"); }
  };
}

async function loadRoleList() {
  try { const d = await api("GET", "/api/roles"); return d.roles; }
  catch { return []; } // user may lack roles access; fall back to empty
}

// ---------------------------------------------------------------------------
// roles (read-only catalogue view)
// ---------------------------------------------------------------------------
async function renderRoles(view) {
  const d = await api("GET", "/api/roles");
  view.innerHTML =
    viewHeader("🎭", "Roles", "Role catalogue. Edit grants in Access Control → Access Matrix.") +
    `<div class="grid gap-4 md:grid-cols-2">
      ${d.roles.map((r) => `<div class="bg-white rounded-xl border border-slate-200 p-5">
        <div class="flex items-center justify-between"><h3 class="font-semibold">${esc(r.name)} ${r.is_system ? '<span class="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 align-middle">system</span>' : ""}</h3></div>
        <p class="text-sm text-slate-500 mt-0.5 mb-3">${esc(r.description || "")}</p>
        <div class="flex flex-wrap gap-1.5">
          ${Object.entries(r.grants).map(([mid, lvl]) => `<span class="text-xs bg-slate-100 rounded px-2 py-0.5">${esc(mid)}: <b>${esc(lvl)}</b></span>`).join("") || '<span class="text-xs text-slate-400">no grants</span>'}
        </div></div>`).join("")}
    </div>`;
}

// ---------------------------------------------------------------------------
// ACCESS CONTROL — the centerpiece
// ---------------------------------------------------------------------------
let AC_TAB = "matrix";
async function renderAccessControl(view) {
  const tabs = [["matrix", "Access Matrix"], ["users", "User Grants"], ["hierarchy", "Org Hierarchy"], ["check", "Check Tool"]];
  view.innerHTML =
    viewHeader("🔐", "Access Control", "The OpenFGA management dashboard. Every change here writes tuples to OpenFGA and is reflected <b>instantly</b> — no restart.") +
    `<div class="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
      ${tabs.map(([id, label]) => `<button data-tab="${id}" class="ac-tab px-4 py-1.5 rounded-lg text-sm font-medium ${AC_TAB === id ? "bg-white shadow text-brand-700" : "text-slate-500 hover:text-slate-800"}">${label}</button>`).join("")}
    </div><div id="ac-body"></div>`;
  view.querySelectorAll(".ac-tab").forEach((b) => (b.onclick = () => { AC_TAB = b.dataset.tab; renderAccessControl(view); }));
  const body = $("#ac-body");
  if (AC_TAB === "matrix") return acMatrix(body);
  if (AC_TAB === "users") return acUsers(body);
  if (AC_TAB === "hierarchy") return acHierarchy(body);
  if (AC_TAB === "check") return acCheck(body);
}

async function acMatrix(body) {
  body.innerHTML = `<div class="text-slate-400">Loading matrix…</div>`;
  const d = await api("GET", "/api/ac/matrix");
  const canEdit = true; // reaching this endpoint already required access_control viewer; edits are re-checked server-side
  body.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <p class="text-sm text-slate-500">Role × module grants. Change a dropdown to write the grant to OpenFGA immediately.</p>
      <button id="new-role" class="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold">+ New role</button>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 overflow-auto">
      <table class="text-sm min-w-max">
        <thead class="bg-slate-50 text-xs text-slate-500">
          <tr><th class="text-left px-4 py-3 sticky left-0 bg-slate-50">Role</th>
          ${d.modules.map((m) => `<th class="px-3 py-3 text-left whitespace-nowrap">${m.icon} ${esc(m.name)}</th>`).join("")}</tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${d.roles.map((r) => `<tr>
            <td class="px-4 py-2.5 font-medium sticky left-0 bg-white whitespace-nowrap">${esc(r.name)}${r.is_system ? ' <span class="text-[10px] text-amber-600">sys</span>' : ""}</td>
            ${d.modules.map((m) => `<td class="px-3 py-2.5" data-role="${r.id}" data-mod="${m.id}">${levelSelect(d.matrix[r.id] && d.matrix[r.id][m.id])}</td>`).join("")}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-slate-400 mt-3">Tip: open the app in a second browser as another user, change a grant here, and refresh there — it updates with no restart.</p>`;

  body.querySelectorAll("td[data-role] .level-select").forEach((sel) => {
    sel.onchange = async () => {
      const td = sel.closest("td");
      try {
        await api("POST", "/api/ac/role-grant", { roleId: td.dataset.role, moduleId: td.dataset.mod, level: sel.value });
        toast(`Grant updated: ${td.dataset.role} → ${td.dataset.mod} = ${sel.value}`);
        if (td.dataset.role && ME.roles.includes(td.dataset.role)) await refreshMe(); // reflect in my own nav live
      } catch (e) { toast(e.message, "err"); }
    };
  });
  $("#new-role").onclick = roleModal;
}

function roleModal() {
  const close = modal("New role", `
    <form id="role-form" class="space-y-3">
      <div><label class="block text-sm font-medium mb-1">Name</label><input id="rf-name" class="w-full rounded-lg border border-slate-300 px-3 py-2" required></div>
      <div><label class="block text-sm font-medium mb-1">Description</label><input id="rf-desc" class="w-full rounded-lg border border-slate-300 px-3 py-2"></div>
      <p id="rf-err" class="text-sm text-rose-600 hidden"></p>
      <div class="flex justify-end gap-2 pt-1"><button type="button" id="rf-cancel" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button><button class="px-4 py-2 rounded-lg bg-brand-600 text-white font-semibold">Create role</button></div>
    </form>`);
  $("#rf-cancel").onclick = close;
  $("#role-form").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("POST", "/api/ac/role", { name: $("#rf-name").value.trim(), description: $("#rf-desc").value.trim() }); close(); toast("Role created — now set its grants in the matrix"); renderAccessControl($("#view")); }
    catch (err) { const el = $("#rf-err"); el.textContent = err.message; el.classList.remove("hidden"); }
  };
}

async function acUsers(body) {
  body.innerHTML = `<div class="text-slate-400">Loading…</div>`;
  const [uList, mtx] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/ac/matrix")]);
  const users = uList.users;
  body.innerHTML = `
    <div class="grid md:grid-cols-[220px_1fr] gap-6">
      <div class="bg-white rounded-xl border border-slate-200 p-2 h-fit">
        ${users.map((u) => `<button data-uid="${u.id}" class="ac-user w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-slate-100">${esc(u.name)}<div class="text-xs text-slate-400">${esc(u.roles.join(", ") || "no role")}</div></button>`).join("")}
      </div>
      <div id="ac-user-detail" class="text-slate-400 text-sm">Select a user to view and edit their access.</div>
    </div>`;
  body.querySelectorAll(".ac-user").forEach((b) => (b.onclick = () => acUserDetail(b.dataset.uid, mtx)));
  if (users.length) acUserDetail(users[0].id, mtx);
}

async function acUserDetail(uid, mtx) {
  const box = $("#ac-user-detail");
  box.innerHTML = `<div class="text-slate-400 text-sm">Loading…</div>`;
  const d = await api("GET", `/api/ac/user/${uid}`);
  const roleRow = mtx.roles.map((r) =>
    `<label class="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-1.5"><input type="checkbox" class="ac-role" data-role="${r.id}" ${d.roles.includes(r.id) ? "checked" : ""}> ${esc(r.name)}</label>`).join("");
  const gridRows = mtx.modules.map((m) => `
    <tr data-mod="${m.id}">
      <td class="px-3 py-2 text-sm whitespace-nowrap">${m.icon} ${esc(m.name)}</td>
      <td class="px-3 py-2">${levelSelect(d.individual[m.id], "ac-indiv")}</td>
      <td class="px-3 py-2">${levelPill(d.effective[m.id])}</td>
    </tr>`).join("");

  box.innerHTML = `
    <div class="bg-white rounded-xl border border-slate-200 p-5">
      <h3 class="font-semibold text-lg">${esc(d.user.name)}</h3>
      <p class="text-sm text-slate-500 mb-4">${esc(d.user.email)} · ${esc(d.user.department || "—")}</p>

      <div class="mb-5"><div class="text-xs font-semibold uppercase text-slate-400 mb-2">Roles (assignments)</div>
        <div class="flex flex-wrap gap-2">${roleRow}</div></div>

      <div><div class="text-xs font-semibold uppercase text-slate-400 mb-2">Per-module access</div>
        <table class="w-full text-sm">
          <thead class="text-xs text-slate-400"><tr><th class="text-left px-3 py-1">Module</th><th class="text-left px-3 py-1">Individual override</th><th class="text-left px-3 py-1">Effective (live)</th></tr></thead>
          <tbody class="divide-y divide-slate-100">${gridRows}</tbody>
        </table>
        <p class="text-xs text-slate-400 mt-2">"Effective" = role grants ∪ individual override, resolved live by OpenFGA. Set an override to give <b>this one person</b> extra (or reduced-name) access without touching their role.</p>
      </div>
    </div>`;

  box.querySelectorAll(".ac-role").forEach((cb) => (cb.onchange = async () => {
    try { await api("POST", "/api/ac/assign-role", { userId: uid, roleId: cb.dataset.role, assigned: cb.checked }); toast(`Role ${cb.checked ? "assigned" : "removed"}`); acUserDetail(uid, mtx); if (uid === ME.user.id) refreshMe(); }
    catch (e) { toast(e.message, "err"); cb.checked = !cb.checked; }
  }));
  box.querySelectorAll("tr[data-mod] .ac-indiv").forEach((sel) => (sel.onchange = async () => {
    const mid = sel.closest("tr").dataset.mod;
    try { await api("POST", "/api/ac/user-grant", { userId: uid, moduleId: mid, level: sel.value }); toast(`Individual grant: ${mid} = ${sel.value}`); acUserDetail(uid, mtx); if (uid === ME.user.id) refreshMe(); }
    catch (e) { toast(e.message, "err"); }
  }));
}

async function acHierarchy(body) {
  body.innerHTML = `<div class="text-slate-400">Loading…</div>`;
  const d = await api("GET", "/api/ac/hierarchy");
  const opts = (sel) => `<option value="">— none —</option>` + d.users.map((u) => `<option value="${u.id}" ${sel === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("");
  body.innerHTML = `
    <p class="text-sm text-slate-500 mb-3">Set who reports to whom. Writes a <code>manager</code> tuple to OpenFGA (used by the reports-to check in the Check tool).</p>
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table class="w-full text-sm"><thead class="bg-slate-50 text-xs text-slate-500"><tr><th class="text-left px-5 py-3">Employee</th><th class="text-left px-5 py-3">Department</th><th class="text-left px-5 py-3">Reports to</th></tr></thead>
        <tbody class="divide-y divide-slate-100">
          ${d.users.map((u) => `<tr data-uid="${u.id}"><td class="px-5 py-3 font-medium">${esc(u.name)}</td><td class="px-5 py-3 text-slate-500">${esc(u.department || "—")}</td>
            <td class="px-5 py-3"><select class="mgr-select rounded-lg border border-slate-300 text-sm px-2 py-1">${opts(u.manager)}</select></td></tr>`).join("")}
        </tbody></table>
    </div>`;
  body.querySelectorAll("tr[data-uid] .mgr-select").forEach((sel) => (sel.onchange = async () => {
    const uid = sel.closest("tr").dataset.uid;
    try { await api("POST", "/api/ac/set-manager", { userId: uid, managerId: sel.value || null }); toast("Manager updated"); }
    catch (e) { toast(e.message, "err"); }
  }));
}

async function acCheck(body) {
  const [uList, mtx] = await Promise.all([api("GET", "/api/users"), api("GET", "/api/ac/matrix")]);
  const users = uList.users;
  const userOpts = users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("");
  const modOpts = mtx.modules.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("");
  body.innerHTML = `
    <div class="bg-white rounded-xl border border-slate-200 p-6 max-w-2xl">
      <p class="text-sm text-slate-500 mb-4">Ask OpenFGA a question directly. The verdict is a live <code>Check</code> call.</p>
      <div class="grid sm:grid-cols-4 gap-3 items-end">
        <div><label class="block text-xs font-medium mb-1">Actor</label><select id="ck-actor" class="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">${userOpts}</select></div>
        <div><label class="block text-xs font-medium mb-1">Question</label><select id="ck-type" class="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="module:viewer">can view module</option>
          <option value="module:editor">can edit module</option>
          <option value="module:approver">can approve in module</option>
          <option value="user">manages (reports-to) user</option>
        </select></div>
        <div id="ck-target-wrap"><label class="block text-xs font-medium mb-1">Target</label><select id="ck-target" class="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm">${modOpts}</select></div>
        <button id="ck-run" class="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold">Check</button>
      </div>
      <div id="ck-result" class="mt-5"></div>
    </div>`;
  const typeSel = $("#ck-type");
  const retarget = () => {
    const isUser = typeSel.value === "user";
    $("#ck-target").innerHTML = isUser ? userOpts : modOpts;
  };
  typeSel.onchange = retarget;
  $("#ck-run").onclick = async () => {
    const [tt, action] = typeSel.value === "user" ? ["user", null] : ["module", typeSel.value.split(":")[1]];
    try {
      const r = await api("POST", "/api/ac/check", { actorId: $("#ck-actor").value, targetType: tt, targetId: $("#ck-target").value, action });
      $("#ck-result").innerHTML = `
        <div class="rounded-xl border ${r.allowed ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"} p-4">
          <div class="flex items-center gap-2 mb-2"><span class="text-lg font-bold ${r.allowed ? "text-emerald-700" : "text-rose-700"}">${r.allowed ? "ALLOW" : "DENY"}</span>
          <span class="text-xs text-slate-500">${esc(r.relation)} · ${esc(r.target)}</span></div>
          <ul class="text-sm text-slate-600 list-disc pl-5 space-y-1">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        </div>`;
    } catch (e) { toast(e.message, "err"); }
  };
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function refreshMe() {
  ME = await api("GET", "/api/me");
  renderShell();
  if (CURRENT && ME.nav.find((n) => n.id === CURRENT)) selectModule(CURRENT);
  else if (ME.nav[0]) selectModule(ME.nav[0].id);
}

async function boot() {
  try {
    ME = await api("GET", "/api/me");
    renderShell();
    if (ME.nav[0]) selectModule(ME.nav[0].id);
  } catch { renderLogin(); }
}

boot();

let ME = null; // { user, modules }
let ORG = null; // only populated once the openfga_admin view loads

function roleLabel(role) {
  return role.replace(/_/g, " ");
}

function roleBadge(role) {
  return `<span class="role-badge" style="--role-color:var(--role-${role})">${roleLabel(role)}</span>`;
}

function levelBadge(level) {
  return `<span class="level-pill ${level}">${level === "none" ? "No access" : level[0].toUpperCase() + level.slice(1)}</span>`;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `${method} ${url} failed (${res.status})`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---------- login ----------

async function loadLoginHint() {
  try {
    const res = await fetch("/api/health");
    await res.json();
  } catch {}
  document.getElementById("login-hint").innerHTML =
    "Every seeded account uses the same demo password. Try <code>alice@vls-demo.test</code> (founder), " +
    "<code>bob@vls-demo.test</code> (admin), <code>carol@vls-demo.test</code> (HR), " +
    "<code>mike@vls-demo.test</code> (manager), or <code>erin@vls-demo.test</code> (employee).";
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.hidden = true;
  try {
    const data = await api("POST", "/api/auth/login", { email, password });
    ME = data;
    showApp();
  } catch (err) {
    errEl.textContent = err.body?.error || err.message;
    errEl.hidden = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("POST", "/api/auth/logout");
  ME = null;
  document.getElementById("app-shell").hidden = true;
  document.getElementById("login-screen").hidden = false;
});

// ---------- app shell ----------

function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  document.getElementById("me-name").textContent = ME.user.name;
  document.getElementById("me-role").innerHTML = roleBadge(ME.user.role);
  renderNav();
  const first = ME.modules[0];
  if (first) selectModule(first.id);
}

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = ME.modules
    .map(
      (m) =>
        `<button class="nav-item" data-module="${m.id}"><span>${m.name}</span>${m.common ? '<span class="common-dot" title="common module"></span>' : ""}</button>`
    )
    .join("");
  nav.querySelectorAll(".nav-item").forEach((btn) => btn.addEventListener("click", () => selectModule(btn.dataset.module)));
}

function setActiveNav(moduleId) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.module === moduleId));
}

async function selectModule(moduleId) {
  setActiveNav(moduleId);
  const mod = ME.modules.find((m) => m.id === moduleId);
  const content = document.getElementById("content");
  if (!mod) {
    content.innerHTML = `<div class="empty-state">No access to this module.</div>`;
    return;
  }
  if (mod.kind === "openfga_admin") return renderOpenfgaAdmin(content, mod);
  if (mod.kind === "users") return renderUsers(content, mod);
  return renderGenericModule(content, mod);
}

function moduleHeader(mod) {
  return `<div class="module-header">
    <div>
      <h1>${mod.name}${mod.common ? '<span class="common-tag">common</span>' : ""}</h1>
      <p class="subtitle">${mod.description}</p>
    </div>
    ${levelBadge(mod.level)}
  </div>`;
}

async function renderGenericModule(content, mod) {
  content.innerHTML = moduleHeader(mod) + `<div class="panel" id="module-body">Loading…</div>`;
  const data = await api("GET", `/api/modules/${mod.id}/data`);
  const body = document.getElementById("module-body");

  if (data.kind === "dummy") {
    body.innerHTML = data.records.length
      ? `<ul class="record-list">${data.records
          .map((r) => `<li><span class="record-title">${r.title}</span><span class="record-subtitle">${r.subtitle || ""}</span></li>`)
          .join("")}</ul>`
      : `<p class="empty-state">No records yet.</p>`;
    return;
  }

  if (data.kind === "employees_view") {
    const byId = Object.fromEntries(data.employees.map((e) => [e.id, e]));
    body.innerHTML = `<table>
      <thead><tr><th>Employee</th><th>Email</th><th>Role</th><th>Reports to</th><th>Status</th></tr></thead>
      <tbody>${data.employees
        .map(
          (e) => `<tr>
            <td>${e.name}</td>
            <td>${e.email}</td>
            <td>${roleBadge(e.role)}</td>
            <td>${e.manager ? byId[e.manager]?.name || "—" : "—"}</td>
            <td>${e.active ? '<span class="level-pill viewer">Active</span>' : '<span class="level-pill none">Inactive</span>'}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table>
    <p class="panel-note" style="margin-top:14px">Accounts and roles are managed from the <strong>Users</strong> module.</p>`;
    return;
  }

  if (data.kind === "overview") {
    const tiles = Object.entries(data.byRole)
      .map(([role, count]) => `<div class="stat-tile">${roleBadge(role)}<span class="stat-value">${count}</span></div>`)
      .join("");
    body.innerHTML = `<div class="stat-row">
      <div class="stat-tile stat-tile-total">Active headcount<span class="stat-value">${data.totalActive}</span></div>
      ${tiles}
    </div>`;
    return;
  }

  body.innerHTML = `<p class="empty-state">Nothing to show.</p>`;
}

// ---------- users module ----------

async function renderUsers(content, mod) {
  content.innerHTML =
    moduleHeader(mod) +
    `<section class="panel">
      <h2>Accounts</h2>
      <div id="users-table-wrap">Loading…</div>
    </section>` +
    (mod.level === "editor" || mod.level === "admin"
      ? `<section class="panel">
          <h2>Add a user</h2>
          <form id="new-user-form" class="user-form">
            <label>Name<input type="text" id="nu-name" required /></label>
            <label>Email<input type="email" id="nu-email" required /></label>
            <label>Password<input type="password" id="nu-password" required minlength="8" placeholder="min. 8 characters" /></label>
            <label>Role<select id="nu-role"></select></label>
            <label>Reports to<select id="nu-manager"><option value="">— none —</option></select></label>
            <button type="submit">Create user + login</button>
          </form>
          <p id="new-user-error" class="login-error" hidden></p>
        </section>`
      : "");

  let users = await api("GET", "/api/users");
  const rolesRes = ORG_ROLES || (await loadRolesOnce());

  function renderTable() {
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    document.getElementById("users-table-wrap").innerHTML = `<table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Reports to</th><th>Status</th>${
        mod.level !== "viewer" ? "<th></th>" : ""
      }</tr></thead>
      <tbody>${users
        .map(
          (u) => `<tr>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td>${roleBadge(u.role)}</td>
            <td>${u.manager ? byId[u.manager]?.name || "—" : "—"}</td>
            <td>${u.active ? '<span class="level-pill viewer">Active</span>' : '<span class="level-pill none">Inactive</span>'}</td>
            ${
              mod.level !== "viewer"
                ? `<td><button class="link-btn" data-toggle="${u.id}">${u.active ? "Deactivate" : "Reactivate"}</button></td>`
                : ""
            }
          </tr>`
        )
        .join("")}</tbody>
    </table>`;

    document.querySelectorAll("[data-toggle]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.dataset.toggle;
        const u = users.find((x) => x.id === id);
        try {
          const updated = await api("PATCH", `/api/users/${id}`, { active: !u.active });
          users = users.map((x) => (x.id === id ? updated : x));
          renderTable();
        } catch (err) {
          alert(err.body?.error || err.message);
        }
      })
    );
  }
  renderTable();

  if (mod.level === "editor" || mod.level === "admin") {
    const roleSel = document.getElementById("nu-role");
    rolesRes.forEach((r) => roleSel.add(new Option(roleLabel(r), r)));
    const mgrSel = document.getElementById("nu-manager");
    users.forEach((u) => mgrSel.add(new Option(`${u.name} (${roleLabel(u.role)})`, u.id)));

    document.getElementById("new-user-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errEl = document.getElementById("new-user-error");
      errEl.hidden = true;
      const payload = {
        name: document.getElementById("nu-name").value.trim(),
        email: document.getElementById("nu-email").value.trim(),
        password: document.getElementById("nu-password").value,
        role: roleSel.value,
        manager: mgrSel.value || null,
      };
      try {
        const created = await api("POST", "/api/users", payload);
        users.push(created);
        mgrSel.add(new Option(`${created.name} (${roleLabel(created.role)})`, created.id));
        renderTable();
        e.target.reset();
      } catch (err) {
        errEl.textContent = err.body?.error || err.message;
        errEl.hidden = false;
      }
    });
  }
}

let ORG_ROLES = null;
async function loadRolesOnce() {
  // Cheap: derive the role list from the current user's own module set is not
  // possible (roles aren't module-scoped), so ask the one endpoint every
  // logged-in user can reach regardless of role - /api/auth/me doesn't carry
  // it, so fall back to a fixed list mirrored from seed/org.json's 7 roles.
  ORG_ROLES = ["founder", "admin", "director", "hr_manager", "manager", "finance", "employee"];
  return ORG_ROLES;
}

// ---------- OpenFGA admin dashboard (Authority Checks + Permissions Dashboard) ----------

async function renderOpenfgaAdmin(content, mod) {
  const tpl = document.getElementById("tpl-openfga-admin");
  content.innerHTML = "";
  content.appendChild(tpl.content.cloneNode(true));

  initTabs();
  await loadOrg();
  await loadScenarios();
  updateTargetVisibility();
  await loadDashboard();

  document.getElementById("action").addEventListener("change", updateTargetVisibility);
  document.getElementById("target").addEventListener("change", updateTargetVisibility);
  document.getElementById("runCheck").addEventListener("click", runCheck);
}

async function loadOrg() {
  ORG = await api("GET", "/api/org");

  const actorSel = document.getElementById("actor");
  const targetSel = document.getElementById("target");
  for (const e of ORG.employees) {
    const label = `${e.name} (${roleLabel(e.role)})`;
    actorSel.add(new Option(label, e.id));
    targetSel.add(new Option(label, e.id));
  }
  targetSel.value = ORG.employees.find((e) => e.id !== ORG.employees[0].id)?.id;

  document.getElementById("assumptions").textContent = ORG.assumptionsNote;

  const tbody = document.querySelector("#orgTable tbody");
  const byId = Object.fromEntries(ORG.employees.map((e) => [e.id, e]));
  tbody.innerHTML = ORG.employees
    .map(
      (e) => `<tr>
        <td>${e.name}</td>
        <td>${roleBadge(e.role)}</td>
        <td>${e.manager ? byId[e.manager]?.name || "—" : "—"}</td>
      </tr>`
    )
    .join("");
}

async function loadScenarios() {
  const scenarios = await api("GET", "/api/scenarios");
  const container = document.getElementById("scenarios");
  container.innerHTML = "";
  for (const s of scenarios) {
    const btn = document.createElement("button");
    btn.className = "scenario-btn";
    btn.innerHTML = `${s.label}<span class="exp">expect ${s.expect}</span>`;
    btn.addEventListener("click", () => {
      document.getElementById("actor").value = s.actor;
      document.getElementById("action").value = s.action;
      updateTargetVisibility();
      if (s.target) document.getElementById("target").value = s.target;
      runCheck();
      document.querySelector('.tab-btn[data-tab="checks"]')?.click();
    });
    container.appendChild(btn);
  }
}

function updateTargetVisibility() {
  const action = document.getElementById("action").value;
  const isHierarchy = action === "edit_hierarchy";
  document.getElementById("target-label").hidden = isHierarchy;

  const target = document.getElementById("target").value;
  const targetEmp = ORG.employees.find((e) => e.id === target);
  const isSuperuserTarget =
    !isHierarchy &&
    targetEmp &&
    ORG.superuserRoles.includes(targetEmp.role) &&
    ["deactivate", "change_role"].includes(action);
  document.getElementById("guard-row").hidden = !isSuperuserTarget;
}

async function runCheck() {
  const actorId = document.getElementById("actor").value;
  const targetId = document.getElementById("target").value;
  const action = document.getElementById("action").value;
  const simulateLastSuperuser = document.getElementById("simulateGuard").checked;
  const data = await api("POST", "/api/check", { actorId, targetId, action, simulateLastSuperuser });
  renderResult(data);
}

function renderResult(data) {
  const el = document.getElementById("result");
  if (data.error) {
    el.innerHTML = `<div class="guard-note">Error: ${data.error}</div>`;
    return;
  }
  const badgeClass = data.finalAllowed ? "allow" : "deny";
  const badgeText = data.finalAllowed ? "ALLOW" : "DENY";
  let html = `<span class="verdict ${badgeClass}">${badgeText}</span>`;
  html += `<span class="decided-by">${data.decidedBy}</span>`;
  if (data.appGuardTriggered) {
    html += `<div class="guard-note"><strong>Raw OpenFGA verdict was ALLOW</strong> (relationally, the actor is permitted). ${data.decidedBy}</div>`;
  }
  el.innerHTML = html;
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

const LEVEL_LABEL = { none: "None", viewer: "Viewer", editor: "Editor", admin: "Admin" };

async function loadDashboard() {
  const [modules, matrixRes] = await Promise.all([api("GET", "/api/modules"), api("GET", "/api/permissions-matrix")]);
  const { roles, modules: moduleIds, matrix } = matrixRes;
  const moduleById = Object.fromEntries(modules.map((m) => [m.id, m]));

  document.getElementById("legend").innerHTML = ["none", "viewer", "editor", "admin"]
    .map((level) => `<span class="lg-item"><span class="lg-swatch level-chip ${level}" style="min-width:14px;height:14px;border-radius:4px;"></span>${LEVEL_LABEL[level]}</span>`)
    .join("");

  const table = document.getElementById("matrixTable");
  const thead = `<thead><tr><th></th>${moduleIds
    .map((mid) => {
      const m = moduleById[mid];
      return `<th><span class="module-name">${m.name}</span>${m.common ? '<span class="module-common">common</span>' : ""}</th>`;
    })
    .join("")}</tr></thead>`;

  const rows = roles
    .map((role) => {
      const cells = moduleIds
        .map((mid) => {
          const level = matrix[role][mid];
          return `<td class="matrix-cell"><div class="level-chip ${level}" title="${roleLabel(role)} → ${moduleById[mid].name}: ${LEVEL_LABEL[level]}">${LEVEL_LABEL[level]}</div></td>`;
        })
        .join("");
      return `<tr><th>${roleBadge(role)}</th>${cells}</tr>`;
    })
    .join("");

  table.innerHTML = `${thead}<tbody>${rows}</tbody>`;

  document.getElementById("moduleCards").innerHTML = modules
    .map(
      (m) => `<div class="module-desc-card">
      <h4>${m.name}${m.common ? '<span class="common-tag">common</span>' : ""}</h4>
      <p>${m.description}</p>
    </div>`
    )
    .join("");
}

// ---------- boot ----------

(async function init() {
  loadLoginHint();
  try {
    ME = await api("GET", "/api/auth/me");
    showApp();
  } catch {
    // not logged in - login screen is already showing
  }
})();

let ORG = null;
let MODULES = null;

function roleLabel(role) {
  return role.replace(/_/g, " ");
}

function roleBadge(role) {
  return `<span class="role-badge" style="--role-color:var(--role-${role})">${roleLabel(role)}</span>`;
}

async function loadOrg() {
  const res = await fetch("/api/org");
  ORG = await res.json();

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
        <td>${e.manager ? byId[e.manager].name : "—"}</td>
      </tr>`
    )
    .join("");
}

async function loadScenarios() {
  const res = await fetch("/api/scenarios");
  const scenarios = await res.json();
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
      document.querySelector('.tab-btn[data-tab="checks"]').click();
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

  const res = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorId, targetId, action, simulateLastSuperuser }),
  });
  const data = await res.json();
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
    html += `<div class="guard-note">
      <strong>Raw OpenFGA verdict was ALLOW</strong> (relationally, the actor is permitted).
      ${data.decidedBy}
    </div>`;
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
  const [modulesRes, matrixRes] = await Promise.all([fetch("/api/modules"), fetch("/api/permissions-matrix")]);
  MODULES = await modulesRes.json();
  const { roles, modules, matrix } = await matrixRes.json();
  const moduleById = Object.fromEntries(MODULES.map((m) => [m.id, m]));

  document.getElementById("legend").innerHTML = ["none", "viewer", "editor", "admin"]
    .map((level) => `<span class="lg-item"><span class="lg-swatch level-chip ${level}" style="min-width:14px;height:14px;border-radius:4px;"></span>${LEVEL_LABEL[level]}</span>`)
    .join("");

  const table = document.getElementById("matrixTable");
  const thead = `<thead><tr><th></th>${modules
    .map((mid) => {
      const m = moduleById[mid];
      return `<th><span class="module-name">${m.name}</span>${m.common ? '<span class="module-common">common</span>' : ""}</th>`;
    })
    .join("")}</tr></thead>`;

  const rows = roles
    .map((role) => {
      const cells = modules
        .map((mid) => {
          const level = matrix[role][mid];
          return `<td class="matrix-cell"><div class="level-chip ${level}" title="${roleLabel(role)} → ${moduleById[mid].name}: ${LEVEL_LABEL[level]}">${LEVEL_LABEL[level]}</div></td>`;
        })
        .join("");
      return `<tr><th>${roleBadge(role)}</th>${cells}</tr>`;
    })
    .join("");

  table.innerHTML = `${thead}<tbody>${rows}</tbody>`;

  document.getElementById("moduleCards").innerHTML = MODULES.map(
    (m) => `<div class="module-desc-card">
      <h4>${m.name}${m.common ? '<span class="common-tag">common</span>' : ""}</h4>
      <p>${m.description}</p>
    </div>`
  ).join("");
}

document.getElementById("action").addEventListener("change", updateTargetVisibility);
document.getElementById("target").addEventListener("change", updateTargetVisibility);
document.getElementById("runCheck").addEventListener("click", runCheck);

(async function init() {
  initTabs();
  await loadOrg();
  await loadScenarios();
  updateTargetVisibility();
  await loadDashboard();
})();

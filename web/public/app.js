let ORG = null;

async function loadOrg() {
  const res = await fetch("/api/org");
  ORG = await res.json();

  const actorSel = document.getElementById("actor");
  const targetSel = document.getElementById("target");
  for (const e of ORG.employees) {
    const opt1 = new Option(`${e.name} (${e.role})`, e.id);
    const opt2 = new Option(`${e.name} (${e.role})`, e.id);
    actorSel.add(opt1);
    targetSel.add(opt2);
  }
  targetSel.value = ORG.employees.find((e) => e.id !== ORG.employees[0].id)?.id;

  document.getElementById("assumptions").textContent = ORG.assumptionsNote;

  const tbody = document.querySelector("#orgTable tbody");
  const byId = Object.fromEntries(ORG.employees.map((e) => [e.id, e]));
  tbody.innerHTML = ORG.employees
    .map(
      (e) => `<tr>
        <td>${e.name}</td>
        <td><span class="role-badge">${e.role}</span></td>
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

document.getElementById("action").addEventListener("change", updateTargetVisibility);
document.getElementById("target").addEventListener("change", updateTargetVisibility);
document.getElementById("runCheck").addEventListener("click", runCheck);

(async function init() {
  await loadOrg();
  await loadScenarios();
  updateTargetVisibility();
})();

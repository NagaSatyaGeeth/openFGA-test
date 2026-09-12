# OpenFGA RBAC Demo

A standalone, throwaway evaluation app for exercising what **[OpenFGA](https://openfga.dev)**
can do for role-and-permission access control. It has a VLS-Suite-shaped set of
modules (all **dummy data**) so the access control feels real, and every
allow/deny decision is a **live** call to a real OpenFGA server.

> Completely separate from any real VLS Suite repo/infra/ClinLedger. Nothing
> here touches those. This repo (`openFGA-test`) is a dedicated demo sandbox.

## What it does

- **Login** (email + password, sessions; no email-verify / reset — it's a test app).
- **Users**: create / edit / deactivate accounts, assign a role, set a manager.
  Creating a user provisions their OpenFGA identity (role + reports-to) instantly.
- **Employees**: roster with departments, roles, reporting lines.
- **13 VLS-shaped modules** (Dashboard, Invoices, Expenses, Purchasing/Vendors,
  Clients, Employees, Offers, Leave, Attendance, Payroll, Users, Roles, Settings)
  — each gated by OpenFGA: the sidebar item appears only if you can view it, and
  each Create/Edit/Approve/Delete button is enabled only if you hold the level it needs.
- **Access Control dashboard** (the centerpiece):
  - **Access Matrix** — role × module grid; change a dropdown to write the grant to OpenFGA.
  - **User Grants** — per-user roles + **per-individual module overrides** + live effective access.
  - **Org Hierarchy** — set who reports to whom (writes `manager` tuples).
  - **Check Tool** — pick actor + question + target, get a live ALLOW/DENY and *why*.

## How OpenFGA is modelled (`openfga/model.fga`)

```
type user
  relations
    define manager: [user]
    define reports_to: manager or reports_to from manager   # transitive org chart

type role
  relations
    define assignee: [user]

type module
  relations
    define approver: [user, role#assignee]                  # ← accepts BOTH an
    define editor:   [user, role#assignee] or approver      #   individual user AND
    define viewer:   [user, role#assignee] or editor        #   a whole role
```

- **Role grant**: tuple `role:finance_manager#assignee → approver → module:invoices`.
- **Per-individual grant** (override): tuple `user:erin → editor → module:invoices`.
- **Effective access** = union of the two, resolved by OpenFGA. `approver ⇒ editor ⇒ viewer`.
- **Role membership**: `user:erin → assignee → role:employee`.
- **Reporting line**: `user:mike → manager → user:erin`.

### The two correctness properties (explicitly verified)

1. **No boot-time frozen cache — changes reflect instantly.** The app never
   precomputes a permissions matrix at startup. Nav rendering and every gated
   route call OpenFGA `Check` **live** per request. Flip a grant in the Access
   Control dashboard and the very next page load (of any user) reflects it — no
   restart. *(Verified: granting the `employee` role `viewer` on Clients made a
   logged-in employee see Clients on the next `/api/me`, with no restart; and an
   individual override bumped one user's Payroll from `viewer`→`approver` live.)*

2. **Per-individual grants, not just per-role.** Because each module relation is
   declared `[user, role#assignee]`, you can grant one specific person extra
   access without touching their role. *(Verified: gave Erin an individual
   `editor` on Invoices; Evan — same `employee` role — still had no Invoices
   access, proving the grant is per-person.)*

## Logging in

| Email | Role | Password |
|-------|------|----------|
| `admin@demo.test` | Administrator (everything, incl. Access Control) | `Admin@Demo2026` |
| `fiona@demo.test` | Finance Manager | `Demo@2026` |
| `harvey@demo.test` | HR Manager | `Demo@2026` |
| `mike@demo.test` | Manager | `Demo@2026` |
| `erin@demo.test` / `evan@demo.test` | Employee | `Demo@2026` |
| `aisha@demo.test` | Auditor (read-only) | `Demo@2026` |

## Run locally

Requires Docker.

```bash
docker compose up -d --build      # Postgres + OpenFGA + app, all real
open http://localhost:4000
```

If you change the model: `npm run model:build`. If you change UI classes:
`npm run css:build` (Tailwind is precompiled to a static `public/vendor/tailwind.css`,
so there's no build step at deploy time and no runtime CDN dependency).

## Deploy to Render (free tier) — one click

The repo has a Render **Blueprint** (`render.yaml`) that provisions, all on the
free tier: a Postgres database, the OpenFGA server (official Docker image,
migrated), and this app wired to it over Render's private network.

**On your phone:**

1. Open **[this Deploy link](https://render.com/deploy?repo=https://github.com/NagaSatyaGeeth/openFGA-test/tree/claude/openfga-vls-spike-fdllfb)**.
2. Log into (or create) a free Render account — email/Google/GitHub. Nothing is shared with anyone.
3. When asked, let Render read this GitHub repo (`NagaSatyaGeeth/openFGA-test`).
4. Render shows 3 resources from the blueprint (1 database + 2 web services). Confirm the branch is `claude/openfga-vls-spike-fdllfb` and tap **Apply**.
5. Wait a few minutes for all three to go live. Open the **`openfga-rbac-app`** service's `…onrender.com` URL — that's the app.

You never paste any token or key to anyone — the Deploy button uses Render's own
login in your browser.

**Free-tier notes:** services sleep after ~15 min idle (first hit after that takes
~30–60s to wake); free Postgres expires ~30 days after creation. Fine for a demo.

## How to test (5-minute tour)

1. **Log in** as `admin@demo.test`. You'll see every module in the sidebar.
2. **Create a user**: Users → *New user* → give an email + password + role → Create.
   Log out, log in as that user → the sidebar reflects exactly their role's access.
3. **Per-role grant**: Access Control → *Access Matrix* → set (say) `Employee` role →
   `Clients` = `Viewer`. Any employee sees Clients on their next page load — no restart.
4. **Per-individual grant**: Access Control → *User Grants* → pick one employee →
   under *Per-module access* set `Invoices` = `Editor`. Only that person gets it;
   other employees don't. (This is the per-user override.)
5. **Org hierarchy**: Access Control → *Org Hierarchy* → set who reports to whom.
6. **Check tool**: Access Control → *Check Tool* → e.g. actor `mike`, "manages
   (reports-to) user", target `erin` → ALLOW with the reason. Or actor `erin`,
   "can approve in module", target `payroll` → DENY with the reason.

To *see* instant reflection: open the app in two browsers (admin in one, another
user in the other), change that user's grant as admin, refresh the other — it
updates with no restart.

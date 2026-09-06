# VLS Authority Model — OpenFGA Spike

A standalone evaluation of whether [OpenFGA](https://openfga.dev) can cleanly
express VLS Suite's authority rules (who can deactivate/change-role/manage
whom). This is a **spike, not production** — it runs a real OpenFGA server
(the official `ghcr.io/openfga/openfga` Docker image) backed by real
Postgres, with a small web UI that calls OpenFGA's own `Check` API directly.
Nothing here talks to VLS's actual repos, infra, staging, prod, or
ClinLedger — it's a fresh, separate project.

## What's here

```
model/model.fga      OpenFGA authorization model (DSL) - the actual test
model/model.json      ...compiled to the JSON OpenFGA's API accepts
seed/org.json          Seed org chart: 10 employees, 7 roles, manageable sets
lib/openfgaClient.js   Shared OpenFGA HTTP client + seeding logic
scripts/dsl2json.js     Recompile model.fga -> model.json
scripts/seed.js         CLI: seed a running OpenFGA store from seed/org.json
scripts/check.sh        CLI: run one ad-hoc Check against local OpenFGA
web/                    Node/Express backend + static frontend (the UI)
docker-compose.yml      Local dev stack: Postgres + OpenFGA + web, all real
render.yaml             Render Blueprint - deploys the same stack for free
```

## The model, in one paragraph

Both actors and targets are `employee` objects. Each employee is assigned to
one `role` object (founder/admin/director/hr_manager/manager/finance/employee)
via a two-way tuple link. Role objects carry `superuser_access`,
`managed_org_wide_by`, and `managed_subtree_by` relations, seeded with tuples
pointing at *other* roles' assignee-usersets — this is what encodes "founder
outranks admin" and each role's manageable set as **data**, not model logic.
A recursive `reports_to` relation gives unbounded-depth reporting-subtree
checks. See `model/model.fga` for the full commented DSL, and the deployed
UI's "Honest assessment" panel for what mapped cleanly vs. what didn't.

A second axis - **modules** (`type module`) - covers "what can each role touch,
and how far": a standard `admin ⊃ editor ⊃ viewer` permission cascade, seeded
per role in `seed/org.json`. A few modules (Dashboard, Directory, Documents &
Compliance) are seeded **common** - every one of the 7 roles gets at least
Viewer on them - the rest are graded per role, down to Org Settings, which
only founder/admin can touch at all. The UI's "Permissions Dashboard" tab
renders this as a role × module matrix, computed entirely from live OpenFGA
`Check` calls (one representative employee per role, checked admin → editor →
viewer, most-privileged first) rather than read off the seed file directly.

## Run it locally

Requires Docker.

```bash
docker compose up -d          # Postgres + OpenFGA + web, all real, all local
open http://localhost:4000    # the UI (self-seeds on first boot)
```

Ad-hoc checks from the CLI once the stack is up:
```bash
./scripts/check.sh <actor-id> <relation> <target-id>
# e.g. ./scripts/check.sh carol manage dana   -> DENY (hr can't touch a director)
```

To edit the model: change `model/model.fga`, run `npm run model:build` to
recompile `model/model.json`, then restart `docker compose up -d --build web`
(the web app writes a new model version to OpenFGA on boot automatically).

## Deploy to Render (free)

This repo includes a Render **Blueprint** (`render.yaml`) that provisions,
on Render's free plan, in one click:
- a free Postgres instance,
- the real OpenFGA server (official Docker image), migrated and running against it,
- this repo's web UI, wired to call OpenFGA over Render's private network.

### What I need from you

**Nothing you paste to me.** Click this on your phone:

**[Deploy to Render](https://render.com/deploy?repo=https://github.com/NagaSatyaGeeth/openFGA-test/tree/claude/openfga-vls-spike-fdllfb)**

1. It opens Render's dashboard. Log in or create a free Render account (email/Google/GitHub).
2. Render asks to connect GitHub — grant it access to **just this repo**
   (`NagaSatyaGeeth/openFGA-test`), not your whole account, if it offers
   that choice.
3. Render reads `render.yaml` and shows you the 3 resources it's about to
   create (2 web services + 1 Postgres db). Confirm the branch is
   `claude/openfga-vls-spike-fdllfb`, then click **Apply**.
4. Wait a few minutes for the Postgres instance, the OpenFGA server, and the
   web app to build and boot (the web app auto-seeds the model + org chart
   into OpenFGA the first time it starts — no separate seeding step for you).
5. Open the `vls-openfga-web` service's `.onrender.com` URL — that's the UI.

You never hand me or paste anywhere a Render API token, password, or
deploy key — the button just starts Render's own OAuth login in your
browser. If you'd rather I drive it directly via Render's API instead of
you clicking through the dashboard, the only thing that would take is a
Render **API key** (Account Settings -> API Keys on render.com) pasted here
— but that grants control over your whole Render account, so the button
above is the safer default and is what I'd recommend on a phone.

### Free-tier limits worth knowing before you rely on this

- **Postgres expires 30 days after creation** (Render's free-tier policy),
  with a 14-day grace period, then it's deleted. Fine for a spike; if you
  want it to outlive that, say so and I'll either re-seed a fresh free DB or
  move the stack to Fly.io (its free/hobby Postgres doesn't expire the same
  way).
- **Both free web services spin down after 15 minutes idle** and take
  roughly a minute to wake back up on the next request — the first click
  after a while will feel slow, that's expected.
- The OpenFGA server ends up with its own public `.onrender.com` URL too
  (Render's free plan doesn't offer a plan-free *private-only* service
  type), but it's protected by a generated preshared API key shared only
  between the two services via `render.yaml`'s `envVarGroups` — nobody can
  call it without that key.

## Honest assessment: does OpenFGA fit VLS's authority model?

The deployed UI has a live version of this; summarized:

**Mapped cleanly** — RBAC via role objects; founder-outranks-admin as pure
tuple data with zero special-cased model logic; manageable sets
(hr_manager→{employee,finance,manager}, manager→{employee},
director→{employee,finance}) as role→role tuples, so changing who manages
whom is a data change, not a model change; unbounded-depth reporting subtree
via one recursive relation, verified 2+ hops deep against the real server;
org-wide-vs-subtree scoping as a clean intersection that reads like the
English rule; hr_manager/director being unable to touch directors/superusers
falls out for free (those roles just never appear in their manageable-set
tuples).

Module-level RBAC (Dashboard/Payroll/Org Settings/…) also mapped cleanly: one
`admin ⊃ editor ⊃ viewer` cascade (three relations, two `or`s) covers every
module, and "common to all roles" is just a seed-data property (grant Viewer
to all 7 roles), not a model construct.

**Awkward / needed workarounds** — every employee needs tuples in *both*
directions (role→employee and employee→role) purely to support traversal
both ways; the three UI actions collapse to one relation because the spec
doesn't differentiate rules per action (would need real modeling work if
that ever changes); "which rule decided it" isn't a native Check output, so
the demo fires 3 extra Checks against sub-relations to reconstruct a
human-readable reason; org-wide vs. subtree-only authority needed two
separate relations rather than one relation with a scope flag.

**OpenFGA cannot express (needs app logic)** — the last-active-superuser /
org-lockout guard: OpenFGA relations have no cardinality/counting
primitive, no "is this the last member of a set." The deployed UI
demonstrates this live — a checkbox forces the scenario, and you can see
OpenFGA's raw `Check` answer stay ALLOW while an app-side guard (counting
active superuser tuples outside the ReBAC graph entirely) forces the final
DENY. Any VLS rule shaped like "at least one X must always exist" or "no
more than N of Y" has the same limitation, same shape of workaround.
Time-bounded/workflow-state rules weren't in scope here but would likely
need OpenFGA's Conditions (ABAC-lite/CEL) or the same kind of app-side check.

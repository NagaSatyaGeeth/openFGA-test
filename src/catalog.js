// Static catalog: the VLS-Suite-shaped module list, plus the seed roles,
// users and grants used to bootstrap an empty database + OpenFGA store.
// Module *records* here are pure dummy data for display; the modules matter
// only as things to gate.
"use strict";

// Each module: id, name, icon (emoji), group, blurb, the actions its page
// exposes (mapped to the access level each needs), and a few dummy rows.
const MODULES = [
  {
    id: "dashboard", name: "Dashboard", icon: "\u{1F4CA}", group: "Overview",
    blurb: "Org-wide KPIs and recent activity.",
    actions: [], // read-only landing
    records: [],
  },
  {
    id: "invoices", name: "Invoices", icon: "\u{1F9FE}", group: "Finance",
    blurb: "Customer & vendor invoices and payment status.",
    actions: [{ id: "create", label: "New invoice", level: "editor" }, { id: "edit", label: "Edit", level: "editor" }, { id: "approve", label: "Approve", level: "approver" }, { id: "delete", label: "Delete", level: "approver" }],
    records: [
      { title: "INV-2041 · Acme Labs", meta: "$4,300 · Paid" },
      { title: "INV-2042 · CloudHost", meta: "$1,150 · Due Sep 20" },
      { title: "INV-2043 · Reagent Co", meta: "$2,780 · Overdue" },
    ],
  },
  {
    id: "expenses", name: "Expenses", icon: "\u{1F4B3}", group: "Finance",
    blurb: "Expense claims and reimbursements.",
    actions: [{ id: "create", label: "Submit claim", level: "editor" }, { id: "approve", label: "Approve", level: "approver" }],
    records: [
      { title: "Laptop reimbursement", meta: "$1,200 · Erin · Pending" },
      { title: "Conference travel", meta: "$640 · Mike · Approved" },
      { title: "Client dinner", meta: "$95 · Dana · Approved" },
    ],
  },
  {
    id: "vendors", name: "Purchasing / Vendors", icon: "\u{1F3EC}", group: "Finance",
    blurb: "Vendor directory and purchase orders.",
    actions: [{ id: "create", label: "Add vendor", level: "editor" }, { id: "edit", label: "Edit", level: "editor" }, { id: "delete", label: "Delete", level: "approver" }],
    records: [
      { title: "Reagent Vendor Co", meta: "PO-3312 · $12,400 open" },
      { title: "CloudHost Services", meta: "PO-3313 · $1,150/mo" },
      { title: "Office Supplies Ltd", meta: "PO-3314 · $430" },
    ],
  },
  {
    id: "clients", name: "Clients", icon: "\u{1F91D}", group: "Sales",
    blurb: "Client accounts and contacts.",
    actions: [{ id: "create", label: "Add client", level: "editor" }, { id: "edit", label: "Edit", level: "editor" }],
    records: [
      { title: "Northwind Pharma", meta: "Active · 3 projects" },
      { title: "Helix Biotech", meta: "Active · 1 project" },
      { title: "Vertex Clinical", meta: "Prospect" },
    ],
  },
  {
    id: "employees", name: "Employees", icon: "\u{1F465}", group: "People",
    blurb: "Employee records, departments and reporting lines.",
    actions: [{ id: "create", label: "Add employee", level: "editor" }, { id: "edit", label: "Edit", level: "editor" }],
    records: [], // rendered live from the employee list
  },
  {
    id: "offers", name: "Offers", icon: "\u{1F4DD}", group: "People",
    blurb: "Offer & appointment letters.",
    actions: [{ id: "create", label: "Draft offer", level: "editor" }, { id: "approve", label: "Approve", level: "approver" }],
    records: [
      { title: "Offer · Zack Employee", meta: "Issued Jan 15 · Signed" },
      { title: "Promotion · Mike Manager", meta: "Issued Mar 1 · Signed" },
      { title: "Offer · New Analyst", meta: "Draft" },
    ],
  },
  {
    id: "leave", name: "Leave", icon: "\u{1F3D6}", group: "People",
    blurb: "Time-off requests and balances.",
    actions: [{ id: "create", label: "Request leave", level: "editor" }, { id: "approve", label: "Approve", level: "approver" }],
    records: [
      { title: "Erin · 3 days", meta: "Sep 22-24 · Pending" },
      { title: "Evan · 1 day", meta: "Sep 18 · Approved" },
      { title: "Fiona · 5 days", meta: "Oct 1-5 · Pending" },
    ],
  },
  {
    id: "attendance", name: "Attendance", icon: "\u{23F1}", group: "People",
    blurb: "Daily attendance and timesheets.",
    actions: [{ id: "edit", label: "Adjust", level: "editor" }],
    records: [
      { title: "Erin · August", meta: "21/22 days" },
      { title: "Evan · August", meta: "20/22 days · 1 sick" },
      { title: "Zack · August", meta: "22/22 days" },
    ],
  },
  {
    id: "payroll", name: "Payroll", icon: "\u{1F4B0}", group: "Finance",
    blurb: "Payroll runs and compensation.",
    actions: [{ id: "run", label: "Run payroll", level: "editor" }, { id: "approve", label: "Approve run", level: "approver" }],
    records: [
      { title: "August 2026 run", meta: "Processed · $84,200" },
      { title: "September 2026 run", meta: "Draft" },
      { title: "Bonus pool", meta: "Pending approval" },
    ],
  },
  {
    id: "users", name: "Users", icon: "\u{1F464}", group: "Administration",
    blurb: "Login accounts: create, edit, deactivate, assign roles.",
    actions: [], // has its own dedicated UI
    records: [],
  },
  {
    id: "roles", name: "Roles", icon: "\u{1F3AD}", group: "Administration",
    blurb: "Role catalogue.",
    actions: [],
    records: [],
  },
  {
    id: "access_control", name: "Access Control", icon: "\u{1F510}", group: "Administration",
    blurb: "The OpenFGA management dashboard: access matrix, per-role & per-user grants, org hierarchy, live Check tool.",
    actions: [],
    records: [],
  },
  {
    id: "settings", name: "Settings", icon: "\u{2699}", group: "Administration",
    blurb: "Org settings and configuration.",
    actions: [{ id: "edit", label: "Edit settings", level: "editor" }],
    records: [
      { title: "Organization name", meta: "Demo Corp" },
      { title: "Time zone", meta: "UTC" },
      { title: "Fiscal year start", meta: "January" },
    ],
  },
];

const LEVELS = ["viewer", "editor", "approver"];

// Seed roles. `grants` = { moduleId: level } giving each role a starting set
// of module access (written to OpenFGA as role#assignee -> level -> module).
const SEED_ROLES = [
  {
    id: "administrator", name: "Administrator", description: "Full access to everything, including access control.",
    grants: Object.fromEntries(MODULES.map((m) => [m.id, "approver"])),
  },
  {
    id: "finance_manager", name: "Finance Manager", description: "Owns finance modules; can approve.",
    grants: { dashboard: "viewer", invoices: "approver", expenses: "approver", vendors: "editor", payroll: "approver", clients: "viewer", reports: "viewer" },
  },
  {
    id: "hr_manager", name: "HR Manager", description: "Owns people modules.",
    grants: { dashboard: "viewer", employees: "editor", offers: "approver", leave: "approver", attendance: "editor", payroll: "viewer", users: "editor" },
  },
  {
    id: "manager", name: "Manager", description: "Team lead: approves leave, views team data.",
    grants: { dashboard: "viewer", employees: "viewer", leave: "approver", attendance: "editor", expenses: "editor", clients: "viewer" },
  },
  {
    id: "employee", name: "Employee", description: "Baseline access for everyone.",
    grants: { dashboard: "viewer", expenses: "editor", leave: "editor", attendance: "viewer" },
  },
  {
    id: "auditor", name: "Auditor", description: "Read-only across finance & people.",
    grants: { dashboard: "viewer", invoices: "viewer", expenses: "viewer", vendors: "viewer", payroll: "viewer", employees: "viewer", offers: "viewer", leave: "viewer", attendance: "viewer" },
  },
];

// Seed users. The admin is the way in; the rest exist to test RBAC against.
// department + manager are dummy org data; role is the OpenFGA role assignment.
const SEED_USERS = [
  { id: "admin", name: "Admin User", email: "admin@demo.test", role: "administrator", department: "Administration", manager: null, password: "Admin@Demo2026" },
  { id: "fiona", name: "Fiona Finance", email: "fiona@demo.test", role: "finance_manager", department: "Finance", manager: "admin", password: "Demo@2026" },
  { id: "harvey", name: "Harvey HR", email: "harvey@demo.test", role: "hr_manager", department: "People", manager: "admin", password: "Demo@2026" },
  { id: "mike", name: "Mike Manager", email: "mike@demo.test", role: "manager", department: "Sales", manager: "harvey", password: "Demo@2026" },
  { id: "erin", name: "Erin Employee", email: "erin@demo.test", role: "employee", department: "Sales", manager: "mike", password: "Demo@2026" },
  { id: "evan", name: "Evan Employee", email: "evan@demo.test", role: "employee", department: "Sales", manager: "mike", password: "Demo@2026" },
  { id: "aisha", name: "Aisha Auditor", email: "aisha@demo.test", role: "auditor", department: "Finance", manager: "fiona", password: "Demo@2026" },
];

module.exports = { MODULES, LEVELS, SEED_ROLES, SEED_USERS };

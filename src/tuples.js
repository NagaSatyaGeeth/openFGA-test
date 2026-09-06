// Tuple conventions in one place, so the same shapes are used everywhere.
"use strict";
const LEVELS = ["viewer", "editor", "approver"];
const LEVEL_RANK = { viewer: 1, editor: 2, approver: 3 };

const roleAssignee = (roleId) => `role:${roleId}#assignee`;

// user U is a member (assignee) of role R
const membership = (userId, roleId) => ({ user: `user:${userId}`, relation: "assignee", object: `role:${roleId}` });

// grant `level` on module M to a whole role
const roleGrant = (roleId, level, moduleId) => ({ user: roleAssignee(roleId), relation: level, object: `module:${moduleId}` });

// grant `level` on module M to one individual user (the per-person override)
const userGrant = (userId, level, moduleId) => ({ user: `user:${userId}`, relation: level, object: `module:${moduleId}` });

// M is U's manager (reports-to edge)
const managerEdge = (userId, managerId) => ({ user: `user:${managerId}`, relation: "manager", object: `user:${userId}` });

module.exports = { LEVELS, LEVEL_RANK, roleAssignee, membership, roleGrant, userGrant, managerEdge };

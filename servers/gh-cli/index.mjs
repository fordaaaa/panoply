#!/usr/bin/env node
// panoply-gh-cli — an MCP server wrapping the local `gh` CLI. Lets an agent
// drive GitHub (repos, issues, PRs, Actions, Releases, Projects v2) from any
// MCP host with no token forwarding. Requires `gh` installed + authenticated.
//
// Zero dependencies. Stdio JSON-RPC 2.0 (mirrors servers/showcase).

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import readline from "node:readline";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const SERVER_NAME = "panoply-gh-cli";
const SERVER_VERSION = pkg.version;

// --- command execution ------------------------------------------------------

function runGh(args, opts = {}) {
  const cwdOpts = opts.cwd ? { cwd: opts.cwd } : {};
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      ...cwdOpts, env: process.env, maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => reject({ code: -1, message: e.message, stderr: "" }));
    child.on("exit", (code) => {
      out = out.trim(); err = err.trim();
      if (code === 0) resolve(out);
      else reject({ code: code ?? -1, stderr: err || out, stdout: out });
    });
  });
}

function flags(map) {
  const out = [];
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || v === null || v === "") continue;
    out.push(`--${k}`, String(v));
  }
  return out;
}
function repoArg(p) { return p.repo ? ["-R", p.repo] : []; }
function list(v) {
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v.flat() : String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

// --- tool handlers ----------------------------------------------------------
// Each returns Promise<string> (raw gh stdout). A rejected promise surfaces as
// a tool error to the caller.

const HANDLERS = {
  gh_auth_status: (p) =>
    runGh(["auth", "status", ...flags({ hostname: p.hostname })]).catch((e) => {
      const text = e.stderr || e.message || String(e);
      return (e.stdout?.trim() ? e.stdout.trim() + "\n" : "") + text;
    }),

  gh_repo_view: (p) => {
    // `gh repo view` takes the repo as a positional arg, not -R.
    const repo = p.repo ? [p.repo] : [];
    return runGh(["repo", "view", ...repo, "--json", p.json || "name,nameWithOwner,description,defaultBranchRef,url,stargazerCount,forkCount,primaryLanguage,owner,isPrivate,createdAt,pushedAt"]);
  },

  gh_repo_list: (p) =>
    runGh(["repo", "list", "--limit", String(p.limit || 30), "--json", p.json || "nameWithOwner,description,url,stargazerCount,primaryLanguage"]),

  gh_repo_create: (p) => {
    if (!p.name) return Promise.reject("name is required for gh_repo_create");
    const a = [p.name, ...flags({
      description: p.description, homepage: p.homepage, license: p.license,
      gitignore: p.gitignore, team: p.team, visibility: p.visibility,
      "default-branch": p.default_branch,
    })];
    if (p.template) a.push("--template");
    if (p.clone) a.push("--clone");
    if (p.source) a.push("--source", p.source);
    return runGh(["repo", "create", ...a]);
  },

  gh_repo_edit: (p) => {
    if (!p.repo) return Promise.reject("repo is required for gh_repo_edit");
    // `gh repo edit` takes repo as positional, not -R.
    const a = ["edit", p.repo, ...flags({
      description: p.description, homepage: p.homepage,
      "default-branch": p.default_branch, visibility: p.visibility,
    })];
    if (p.enable_issues === false) a.push("--enable-issues=false");
    if (p.enable_projects === false) a.push("--enable-projects=false");
    if (p.enable_wiki === false) a.push("--enable-wiki=false");
    if (p.add_topic) list(p.add_topic).forEach((t) => a.push("--add-topic", t));
    if (p.remove_topic) list(p.remove_topic).forEach((t) => a.push("--remove-topic", t));
    return runGh(["repo", ...a]);
  },

  gh_repo_delete: (p) => {
    if (!p.repo) return Promise.reject("repo is required for gh_repo_delete");
    return runGh(["repo", "delete", p.repo, "--yes"]);
  },

  gh_label_list: (p) => runGh(["label", "list", ...repoArg(p), "--limit", String(p.limit || 30), "--json", "name,color,description"]),

  gh_label_create: (p) => {
    if (!p.name) return Promise.reject("name is required for gh_label_create");
    const a = ["create", ...repoArg(p), "--name", p.name, ...flags({ color: p.color, description: p.description })];
    if (p.force) a.push("--force");
    return runGh(["label", ...a]);
  },

  gh_label_edit: (p) => {
    if (!p.name) return Promise.reject("name is required for gh_label_edit");
    const a = ["edit", p.name, ...repoArg(p), ...flags({ color: p.color, description: p.description })];
    if (p.new_name) a.push("--name", p.new_name);
    return runGh(["label", ...a]);
  },

  gh_label_delete: (p) => {
    if (!p.name) return Promise.reject("name is required for gh_label_delete");
    return runGh(["label", "delete", ...repoArg(p), p.name, "--yes"]);
  },

  gh_issue_list: (p) => {
    const a = ["list", ...repoArg(p), "--limit", String(p.limit || 30), "--state", p.state || "open", ...flags({
      assignee: p.assignee, author: p.author, search: p.search, milestone: p.milestone,
    })];
    if (p.json) a.push("--json", p.json); else a.push("--json", "number,title,state,author,url,createdAt,labels,assignees");
    if (p.label) list(p.label).forEach((l) => a.push("--label", l));
    return runGh(["issue", ...a]);
  },

  gh_issue_create: (p) => {
    if (!p.title) return Promise.reject("title is required for gh_issue_create");
    const a = ["create", ...repoArg(p), "--title", p.title];
    if (p.body) a.push("--body", p.body);
    if (p.body_file) a.push("--body-file", p.body_file);
    if (p.assignee) list(p.assignee).forEach((l) => a.push("--assignee", l));
    if (p.label) list(p.label).forEach((l) => a.push("--label", l));
    if (p.milestone) a.push("--milestone", p.milestone);
    if (p.project) a.push("--project", p.project);
    return runGh(["issue", ...a]);
  },

  gh_issue_view: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_issue_view");
    const a = ["view", p.number, ...repoArg(p)];
    if (p.json) a.push("--json", p.json); else a.push("--json", "number,title,body,state,author,url,createdAt,updatedAt,labels,assignees,milestone");
    if (p.comments) a.push("--comments");
    return runGh(["issue", ...a]);
  },

  gh_issue_edit: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_issue_edit");
    const a = ["edit", p.number, ...repoArg(p), ...flags({ title: p.title, body: p.body, milestone: p.milestone })];
    if (p.add_assignee) list(p.add_assignee).forEach((l) => a.push("--add-assignee", l));
    if (p.remove_assignee) list(p.remove_assignee).forEach((l) => a.push("--remove-assignee", l));
    if (p.add_label) list(p.add_label).forEach((l) => a.push("--add-label", l));
    if (p.remove_label) list(p.remove_label).forEach((l) => a.push("--remove-label", l));
    if (p.add_blocked_by) list(p.add_blocked_by).forEach((l) => a.push("--add-blocked-by", l));
    if (p.remove_blocked_by) list(p.remove_blocked_by).forEach((l) => a.push("--remove-blocked-by", l));
    if (p.add_blocking) list(p.add_blocking).forEach((l) => a.push("--add-blocking", l));
    if (p.remove_blocking) list(p.remove_blocking).forEach((l) => a.push("--remove-blocking", l));
    if (p.remove_milestone) a.push("--remove-milestone");
    if (p.parent) a.push("--parent", p.parent);
    return runGh(["issue", ...a]);
  },

  gh_issue_close: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_issue_close");
    const a = ["close", p.number, ...repoArg(p), ...flags({ reason: p.reason, comment: p.comment })];
    return runGh(["issue", ...a]);
  },

  gh_issue_reopen: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_issue_reopen");
    return runGh(["issue", "reopen", p.number, ...repoArg(p)]);
  },

  gh_issue_comment: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_issue_comment");
    const a = ["comment", p.number, ...repoArg(p)];
    if (p.body) a.push("--body", p.body);
    if (p.body_file) a.push("--body-file", p.body_file);
    return runGh(["issue", ...a]);
  },

  gh_issue_delete: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_issue_delete");
    return runGh(["issue", "delete", p.number, ...repoArg(p)]);
  },

  gh_pr_list: (p) => {
    const a = ["list", ...repoArg(p), "--limit", String(p.limit || 30), "--state", p.state || "open", ...flags({
      assignee: p.assignee, author: p.author, base: p.base, head: p.head, search: p.search,
    })];
    if (p.json) a.push("--json", p.json); else a.push("--json", "number,title,state,author,url,headRefName,baseRefName,createdAt,isDraft,mergeable");
    if (p.label) list(p.label).forEach((l) => a.push("--label", l));
    return runGh(["pr", ...a]);
  },

  gh_pr_view: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_view");
    if (p.diff) return runGh(["pr", "diff", p.number, ...repoArg(p), ...(p.web ? ["--web"] : [])]);
    const a = ["view", p.number, ...repoArg(p)];
    if (p.json) a.push("--json", p.json); else a.push("--json", "number,title,body,state,author,url,headRefName,baseRefName,createdAt,isDraft,mergeable,additions,changedFiles,deletions");
    if (p.comments) a.push("--comments");
    return runGh(["pr", ...a]);
  },

  gh_pr_create: (p) => {
    const a = ["create", ...repoArg(p)];
    if (p.base) a.push("--base", p.base);
    if (p.head) a.push("--head", p.head);
    if (p.title) a.push("--title", p.title);
    if (p.body) a.push("--body", p.body);
    if (p.body_file) a.push("--body-file", p.body_file);
    if (p.fill) a.push("--fill");
    if (p.fill_first) a.push("--fill-first");
    if (p.draft) a.push("--draft");
    if (p.reviewers) list(p.reviewers).forEach((l) => a.push("--reviewer", l));
    if (p.assignee) list(p.assignee).forEach((l) => a.push("--assignee", l));
    if (p.label) list(p.label).forEach((l) => a.push("--label", l));
    if (p.milestone) a.push("--milestone", p.milestone);
    if (p.project) a.push("--project", p.project);
    if (p.no_maintainer_edit) a.push("--no-maintainer-edit");
    return runGh(["pr", ...a]);
  },

  gh_pr_edit: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_edit");
    const a = ["edit", p.number, ...repoArg(p), ...flags({ base: p.base, title: p.title, body: p.body, milestone: p.milestone })];
    if (p.body_file) a.push("--body-file", p.body_file);
    return runGh(["pr", ...a]);
  },

  gh_pr_merge: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_merge");
    const strategy = p.merge ? "merge" : p.squash ? "squash" : p.rebase ? "rebase" : null;
    if (!strategy) return Promise.reject("pass one of {merge:true, squash:true, rebase:true}");
    const a = ["merge", p.number, ...repoArg(p), `--${strategy}`];
    if (p.delete_branch) a.push("--delete-branch");
    if (p.body) a.push("--body", p.body);
    if (p.subject) a.push("--subject", p.subject);
    return runGh(["pr", ...a]);
  },

  gh_pr_close: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_close");
    return runGh(["pr", "close", p.number, ...repoArg(p)]);
  },

  gh_pr_reopen: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_reopen");
    return runGh(["pr", "reopen", p.number, ...repoArg(p)]);
  },

  gh_pr_review: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_review");
    const a = ["review", p.number, ...repoArg(p)];
    if (p.approve) a.push("--approve");
    if (p.request_changes) a.push("--request-changes");
    if (p.body) a.push("--body", p.body);
    if (p.body_file) a.push("--body-file", p.body_file);
    return runGh(["pr", ...a]);
  },

  gh_pr_comment: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_comment");
    const a = ["comment", p.number, ...repoArg(p)];
    if (p.body) a.push("--body", p.body);
    if (p.body_file) a.push("--body-file", p.body_file);
    return runGh(["pr", ...a]);
  },

  gh_pr_checkout: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_checkout");
    const a = ["checkout", p.number, ...repoArg(p)];
    if (p.branch) a.push("--branch", p.branch);
    if (p.force) a.push("--force");
    return runGh(["pr", ...a]);
  },

  gh_pr_checks: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_pr_checks");
    const a = ["checks", p.number, ...repoArg(p)];
    if (p.json) a.push("--json", p.json);
    if (p.required) a.push("--required");
    if (p.watch) a.push("--watch");
    return runGh(["pr", ...a]);
  },

  gh_workflow_list: (p) => runGh(["workflow", "list", ...repoArg(p), "--limit", String(p.limit || 100), "--json", p.json || "id,name,path,state"]),

  gh_workflow_view: (p) => {
    if (!p.name) return Promise.reject("name is required for gh_workflow_view");
    return runGh(["workflow", "view", p.name, ...repoArg(p), "--json", "name,state,path,url"]);
  },

  gh_workflow_run: (p) => {
    if (!p.workflow) return Promise.reject("workflow is required for gh_workflow_run");
    const a = ["run", ...repoArg(p), p.workflow];
    if (p.ref) a.push("--ref", p.ref);
    if (p.fields) for (const [k, v] of Object.entries(p.fields)) a.push("-F", `${k}=${String(v)}`);
    if (p.json_input) a.push("--json");
    return runGh(["workflow", ...a]);
  },

  gh_workflow_disable: (p) => {
    if (!p.name) return Promise.reject("name is required");
    return runGh(["workflow", "disable", p.name, ...repoArg(p)]);
  },

  gh_workflow_enable: (p) => {
    if (!p.name) return Promise.reject("name is required");
    return runGh(["workflow", "enable", p.name, ...repoArg(p)]);
  },

  gh_run_list: (p) => {
    const a = ["list", ...repoArg(p), "--limit", String(p.limit || 20), "--json", p.json || "databaseId,displayTitle,workflowName,status,conclusion,event,headBranch,createdAt,url"];
    if (p.branch) a.push("--branch", p.branch);
    if (p.commit) a.push("--commit", p.commit);
    if (p.event) a.push("--event", p.event);
    if (p.status) a.push("--status", p.status);
    if (p.user) a.push("--user", p.user);
    if (p.workflow) a.push("--workflow", p.workflow);
    return runGh(["run", ...a]);
  },

  gh_run_view: (p) => {
    if (!p.run_id) return Promise.reject("run_id is required for gh_run_view");
    const a = ["view", p.run_id, ...repoArg(p)];
    if (p.json) a.push("--json", p.json);
    if (p.attempt) a.push("--attempt", String(p.attempt));
    if (p.job) a.push("--job", p.job);
    if (p.verbose) a.push("--verbose");
    if (p.exit_status) a.push("--exit-status");
    return runGh(["run", ...a]);
  },

  gh_run_rerun: (p) => {
    if (!p.run_id) return Promise.reject("run_id is required for gh_run_rerun");
    const a = ["rerun", p.run_id, ...repoArg(p)];
    if (p.job) a.push("--job", p.job);
    if (p.debug) a.push("--debug");
    return runGh(["run", ...a]);
  },

  gh_run_cancel: (p) => {
    if (!p.run_id) return Promise.reject("run_id is required for gh_run_cancel");
    const a = ["cancel", p.run_id, ...repoArg(p)];
    if (p.force) a.push("--force");
    return runGh(["run", ...a]);
  },

  gh_run_watch: (p) => {
    if (!p.run_id) return Promise.reject("run_id is required for gh_run_watch");
    return runGh(["run", "watch", p.run_id, ...repoArg(p), "--interval", String(p.interval || 3)]);
  },

  gh_run_download: (p) => {
    if (!p.run_id) return Promise.reject("run_id is required for gh_run_download");
    const a = ["download", p.run_id, ...repoArg(p)];
    if (p.name) a.push("--name", p.name);
    if (p.pattern) a.push("--pattern", p.pattern);
    if (p.destination) a.push("--destination", p.destination);
    return runGh(["run", ...a]);
  },

  gh_release_list: (p) => runGh(["release", "list", ...repoArg(p), "--limit", String(p.limit || 30), "--json", p.json || "name,tagName,isDraft,isPrerelease,createdAt,publishedAt"]),

  gh_release_view: (p) => {
    const a = ["view", ...repoArg(p)];
    if (p.tag) a.push(p.tag);
    a.push("--json", p.json || "name,tagName,draft,prerelease,createdAt,publishedAt,body,url,assets");
    if (p.web) a.push("--web");
    return runGh(["release", ...a]);
  },

  gh_release_create: (p) => {
    if (!p.tag) return Promise.reject("tag is required for gh_release_create");
    const a = ["create", ...repoArg(p), p.tag, ...flags({
      title: p.title, notes: p.notes, draft: p.draft ? "true" : undefined, prerelease: p.prerelease ? "true" : undefined,
    })];
    if (p.notes_file) a.push("--notes-file", p.notes_file);
    if (p.target) a.push("--target", p.target);
    if (p.verify_tag) a.push("--verify-tag");
    return runGh(["release", ...a]);
  },

  gh_release_upload: (p) => {
    if (!p.tag) return Promise.reject("tag is required for gh_release_upload");
    const a = ["upload", ...repoArg(p), p.tag];
    if (p.clobber) a.push("--clobber");
    if (p.files) list(p.files).forEach((f) => a.push(f));
    return runGh(["release", ...a]);
  },

  gh_release_delete: (p) => {
    if (!p.tag) return Promise.reject("tag is required for gh_release_delete");
    const a = ["delete", ...repoArg(p), p.tag];
    if (p.yes) a.push("--yes");
    return runGh(["release", ...a]);
  },
};
// --- projects v2 (first-class support — the "bit more") + passthrough ----
// Appended via Object.assign so the HANDLERS block above stays closed.

Object.assign(HANDLERS, {
  gh_project_list: (p) => {
    const a = ["list", "--owner", p.owner || "@me", "--limit", String(p.limit || 50), "--format", "json"];
    if (p.all) a.push("--closed");
    return runGh(["project", ...a]);
  },

  gh_project_view: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_project_view");
    return runGh(["project", "view", p.number, "--owner", p.owner || "@me", "--format", "json"]);
  },

  gh_project_create: (p) => {
    if (!p.title) return Promise.reject("title is required for gh_project_create");
    const a = ["create", "--title", p.title, "--owner", p.owner || "@me", "--format", "json"];
    if (p.public) a.push("--visibility", "PUBLIC");
    return runGh(["project", ...a]);
  },

  gh_project_edit: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_project_edit");
    const a = ["edit", p.number, "--owner", p.owner || "@me", "--format", "json"];
    if (p.title) a.push("--title", p.title);
    if (p.description) a.push("--description", p.description);
    if (p.readme) a.push("--readme", p.readme);
    if (p.visibility) a.push("--visibility", p.visibility);
    return runGh(["project", ...a]);
  },

  gh_project_field_list: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_project_field_list");
    return runGh(["project", "field-list", p.number, "--owner", p.owner || "@me", "--format", "json", "--limit", String(p.limit || 30)]);
  },

  gh_project_field_create: (p) => {
    if (!p.number || !p.name || !p.data_type)
      return Promise.reject("number, name, and data_type are required for gh_project_field_create");
    const a = ["field-create", p.number, "--owner", p.owner || "@me", "--name", p.name, "--data-type", p.data_type, "--format", "json"];
    if (p.data_type === "SINGLE_SELECT" && p.single_select_options)
      a.push("--single-select-options", list(p.single_select_options).join(","));
    return runGh(["project", ...a]);
  },

  gh_project_item_list: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_project_item_list");
    const a = ["item-list", p.number, "--owner", p.owner || "@me", "--format", "json", "--limit", String(p.limit || 30)];
    if (p.query) a.push("--query", p.query);
    return runGh(["project", ...a]);
  },

  gh_project_item_create: (p) => {
    if (!p.number || !p.title) return Promise.reject("number and title are required for gh_project_item_create");
    const a = ["item-create", p.number, "--owner", p.owner || "@me", "--title", p.title, "--format", "json"];
    if (p.body) a.push("--body", p.body);
    return runGh(["project", ...a]);
  },

  gh_project_item_add: (p) => {
    if (!p.number || !p.url) return Promise.reject("number and url are required for gh_project_item_add");
    return runGh(["project", "item-add", p.number, "--owner", p.owner || "@me", "--url", p.url, "--format", "json"]);
  },

  gh_project_item_edit: (p) => {
    if (!p.id) return Promise.reject("id is required for gh_project_item_edit");
    const a = ["item-edit", "--owner", p.owner || "@me", "--format", "json", "--id", p.id];
    if (p.project_id) a.push("--project-id", p.project_id);
    if (p.field_id) a.push("--field-id", p.field_id);
    if (p.clear) a.push("--clear");
    if (p.text !== undefined) a.push("--text", String(p.text));
    if (p.number_value !== undefined) a.push("--number", String(p.number_value));
    if (p.date) a.push("--date", p.date);
    if (p.iteration_id) a.push("--iteration-id", p.iteration_id);
    if (p.single_select_option_id) a.push("--single-select-option-id", p.single_select_option_id);
    if (p.title) a.push("--title", p.title);
    if (p.body) a.push("--body", p.body);
    return runGh(["project", ...a]);
  },

  gh_project_item_archive: (p) => {
    if (!p.number || !p.id) return Promise.reject("number and id are required for gh_project_item_archive");
    const a = ["item-archive", p.number, "--owner", p.owner || "@me", "--id", p.id, "--format", "json"];
    if (p.undo) a.push("--undo");
    return runGh(["project", ...a]);
  },

  gh_project_item_delete: (p) => {
    if (!p.number || !p.id) return Promise.reject("number and id are required for gh_project_item_delete");
    return runGh(["project", "item-delete", p.number, "--owner", p.owner || "@me", "--id", p.id, "--format", "json"]);
  },

  gh_project_delete: (p) => {
    if (!p.number) return Promise.reject("number is required for gh_project_delete");
    return runGh(["project", "delete", p.number, "--owner", p.owner || "@me", "--format", "json"]);
  },

    // --- raw API passthrough: "everything gh does beyond the curated tools"
  gh_api: (p) => {
    if (!p.endpoint) return Promise.reject("endpoint is required for gh_api (e.g. 'repos/owner/repo')");
    // `gh api` takes the endpoint as a positional path and has NO -R/--repo flag,
    // so the repo must be encoded in the endpoint path itself.
    const a = ["api", p.endpoint];
    if (p.method) a.push("--method", p.method);
    if (p.header) list(p.header).forEach((h) => a.push("--header", h));
    if (p.field) list(p.field).forEach((f) => a.push("-F", f));
    if (p.raw_field) list(p.raw_field).forEach((f) => a.push("-f", f));
    if (p.per_page) a.push("-F", `per_page=${p.per_page}`);
    if (p.jq) a.push("--jq", p.jq);
    if (p.include) a.push("--include");
    return runGh(a);
  },

  gh_graphql: (p) => {
    if (!p.query) return Promise.reject("query is required for gh_graphql");
    const a = ["api", "graphql", "--method", "POST", "-F", `query=${p.query}`];
    if (p.field) list(p.field).forEach((f) => a.push("-F", f));
    return runGh(a);
  },

  // --- generic gh passthrough: raw CLI args, exactly as typed
  gh_cli: (p) => {
    if (!p.args) return Promise.reject("args (array of gh CLI args) is required for gh_cli");
    const argv = Array.isArray(p.args) ? p.args : [p.args];
    return runGh(argv);
  },

    // --- search across GitHub (native gh search subcommands)
  gh_search_issues: (p) => {
    const a = ["search", "issues"];
    if (p.repo) a.push("--repo", p.repo);
    if (p.state) a.push("--state", p.state);
    if (p.assignee) a.push("--assignee", p.assignee);
    if (p.label) list(p.label).forEach((l) => a.push("--label", l));
        a.push("--json", p.json || "number,title,state,url,repository,author,authorAssociation,createdAt");
    a.push("--limit", String(p.limit || 30));
    if (p.query) a.push(p.query);
    return runGh(a);
  },

  gh_search_prs: (p) => {
    const a = ["search", "prs"];
    if (p.repo) a.push("--repo", p.repo);
    if (p.state) a.push("--state", p.state);
    if (p.assignee) a.push("--assignee", p.assignee);
    if (p.author) a.push("--author", p.author);
    if (p.head) a.push("--head", p.head);
    if (p.base) a.push("--base", p.base);
    a.push("--json", p.json || "number,title,state,url,repository,author,createdAt,isDraft");
    a.push("--limit", String(p.limit || 30));
    if (p.query) a.push(p.query);
    return runGh(a);
  },

  gh_search_repos: (p) => {
    const a = ["search", "repos"];
    if (p.language) a.push("--language", p.language);
    if (p.stars) a.push("--stars", String(p.stars));
    a.push("--json", p.json || "fullName,description,stargazersCount,url,language,owner");
    a.push("--limit", String(p.limit || 30));
    if (p.query) a.push(p.query);
    return runGh(a);
  },
});

// --- tool schemas (JSON Schema) ---------------------------------------------

const TOOL_SCHEMAS = {
  gh_auth_status: { type: "object", properties: { hostname: { type: "string", description: "Optional host; omit for all hosts" } }, additionalProperties: false },
  gh_repo_view: { type: "object", properties: { repo: { type: "string" }, json: { type: "string" } }, additionalProperties: false },
  gh_repo_list: { type: "object", properties: { limit: { type: "number" }, json: { type: "string" } }, additionalProperties: false },
  gh_repo_create: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, visibility: { type: "string" }, license: { type: "string" }, gitignore: { type: "string" }, clone: { type: "boolean" }, template: { type: "boolean" }, source: { type: "string" } }, required: ["name"], additionalProperties: false },
  gh_repo_edit: { type: "object", properties: { repo: { type: "string" }, description: { type: "string" }, homepage: { type: "string" }, visibility: { type: "string" }, default_branch: { type: "string" }, add_topic: { type: "array", items: { type: "string" } }, remove_topic: { type: "array", items: { type: "string" } }, enable_issues: { type: "boolean" }, enable_projects: { type: "boolean" }, enable_wiki: { type: "boolean" } }, required: ["repo"], additionalProperties: false },
  gh_repo_delete: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"], additionalProperties: false },
  gh_label_list: { type: "object", properties: { repo: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
  gh_label_create: { type: "object", properties: { repo: { type: "string" }, name: { type: "string" }, color: { type: "string" }, description: { type: "string" }, force: { type: "boolean" } }, required: ["name"], additionalProperties: false },
  gh_label_edit: { type: "object", properties: { repo: { type: "string" }, name: { type: "string" }, new_name: { type: "string" }, color: { type: "string" }, description: { type: "string" } }, required: ["name"], additionalProperties: false },
  gh_label_delete: { type: "object", properties: { repo: { type: "string" }, name: { type: "string" } }, required: ["name"], additionalProperties: false },
  gh_issue_list: { type: "object", properties: { repo: { type: "string" }, limit: { type: "number" }, state: { type: "string" }, assignee: { type: "string" }, author: { type: "string" }, label: { type: "array", items: { type: "string" } }, milestone: { type: "string" }, search: { type: "string" }, json: { type: "string" } }, additionalProperties: false },
  gh_issue_create: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, body: { type: "string" }, body_file: { type: "string" }, assignee: { type: "array", items: { type: "string" } }, label: { type: "array", items: { type: "string" } }, milestone: { type: "string" }, project: { type: "string" } }, required: ["title"], additionalProperties: false },
  gh_issue_view: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, json: { type: "string" }, comments: { type: "boolean" } }, required: ["number"], additionalProperties: false },
  gh_issue_edit: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, title: { type: "string" }, body: { type: "string" }, milestone: { type: "string" }, add_assignee: { type: "array", items: { type: "string" } }, remove_assignee: { type: "array", items: { type: "string" } }, add_label: { type: "array", items: { type: "string" } }, remove_label: { type: "array", items: { type: "string" } }, add_blocked_by: { type: "array", items: { type: "string" } }, remove_blocked_by: { type: "array", items: { type: "string" } }, add_blocking: { type: "array", items: { type: "string" } }, remove_blocking: { type: "array", items: { type: "string" } }, remove_milestone: { type: "boolean" }, parent: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_issue_close: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, reason: { type: "string" }, comment: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_issue_reopen: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_issue_comment: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, body: { type: "string" }, body_file: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_issue_delete: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_pr_list: { type: "object", properties: { repo: { type: "string" }, limit: { type: "number" }, state: { type: "string" }, base: { type: "string" }, head: { type: "string" }, assignee: { type: "string" }, author: { type: "string" }, label: { type: "array", items: { type: "string" } }, search: { type: "string" }, json: { type: "string" } }, additionalProperties: false },
  gh_pr_view: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, json: { type: "string" }, comments: { type: "boolean" }, diff: { type: "boolean" }, web: { type: "boolean" } }, required: ["number"], additionalProperties: false },
  gh_pr_create: { type: "object", properties: { repo: { type: "string" }, base: { type: "string" }, head: { type: "string" }, title: { type: "string" }, body: { type: "string" }, body_file: { type: "string" }, fill: { type: "boolean" }, fill_first: { type: "boolean" }, draft: { type: "boolean" }, reviewers: { type: "array", items: { type: "string" } }, assignee: { type: "array", items: { type: "string" } }, label: { type: "array", items: { type: "string" } }, milestone: { type: "string" }, project: { type: "string" }, no_maintainer_edit: { type: "boolean" } }, additionalProperties: false },
  gh_pr_edit: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, base: { type: "string" }, title: { type: "string" }, body: { type: "string" }, body_file: { type: "string" }, milestone: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_pr_merge: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, merge: { type: "boolean" }, squash: { type: "boolean" }, rebase: { type: "boolean" }, delete_branch: { type: "boolean" }, body: { type: "string" }, subject: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_pr_close: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_pr_reopen: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_pr_review: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, approve: { type: "boolean" }, request_changes: { type: "boolean" }, body: { type: "string" }, body_file: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_pr_comment: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, body: { type: "string" }, body_file: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_pr_checkout: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, branch: { type: "string" }, force: { type: "boolean" } }, required: ["number"], additionalProperties: false },
  gh_pr_checks: { type: "object", properties: { repo: { type: "string" }, number: { type: "string" }, json: { type: "string" }, required: { type: "boolean" }, watch: { type: "boolean" } }, required: ["number"], additionalProperties: false },
  gh_workflow_list: { type: "object", properties: { repo: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
  gh_workflow_view: { type: "object", properties: { repo: { type: "string" }, name: { type: "string" } }, required: ["name"], additionalProperties: false },
  gh_workflow_run: { type: "object", properties: { repo: { type: "string" }, workflow: { type: "string" }, ref: { type: "string" }, fields: { type: "object" } }, required: ["workflow"], additionalProperties: false },
  gh_workflow_disable: { type: "object", properties: { repo: { type: "string" }, name: { type: "string" } }, required: ["name"], additionalProperties: false },
  gh_workflow_enable: { type: "object", properties: { repo: { type: "string" }, name: { type: "string" } }, required: ["name"], additionalProperties: false },
  gh_run_list: { type: "object", properties: { repo: { type: "string" }, limit: { type: "number" }, branch: { type: "string" }, commit: { type: "string" }, event: { type: "string" }, status: { type: "string" }, user: { type: "string" }, workflow: { type: "string" }, json: { type: "string" } }, additionalProperties: false },
  gh_run_view: { type: "object", properties: { repo: { type: "string" }, run_id: { type: "string" }, json: { type: "string" }, attempt: { type: "number" }, job: { type: "string" }, verbose: { type: "boolean" }, exit_status: { type: "boolean" } }, required: ["run_id"], additionalProperties: false },
  gh_run_rerun: { type: "object", properties: { repo: { type: "string" }, run_id: { type: "string" }, job: { type: "string" }, debug: { type: "boolean" } }, required: ["run_id"], additionalProperties: false },
  gh_run_cancel: { type: "object", properties: { repo: { type: "string" }, run_id: { type: "string" }, force: { type: "boolean" } }, required: ["run_id"], additionalProperties: false },
  gh_run_watch: { type: "object", properties: { repo: { type: "string" }, run_id: { type: "string" }, interval: { type: "number" } }, required: ["run_id"], additionalProperties: false },
  gh_run_download: { type: "object", properties: { repo: { type: "string" }, run_id: { type: "string" }, name: { type: "string" }, pattern: { type: "string" }, destination: { type: "string" } }, required: ["run_id"], additionalProperties: false },
  gh_release_list: { type: "object", properties: { repo: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
  gh_release_view: { type: "object", properties: { repo: { type: "string" }, tag: { type: "string" }, json: { type: "string" }, web: { type: "boolean" } }, additionalProperties: false },
  gh_release_create: { type: "object", properties: { repo: { type: "string" }, tag: { type: "string" }, title: { type: "string" }, notes: { type: "string" }, notes_file: { type: "string" }, target: { type: "string" }, draft: { type: "boolean" }, prerelease: { type: "boolean" }, verify_tag: { type: "boolean" } }, required: ["tag"], additionalProperties: false },
  gh_release_upload: { type: "object", properties: { repo: { type: "string" }, tag: { type: "string" }, files: { type: "array", items: { type: "string" } }, clobber: { type: "boolean" } }, required: ["tag"], additionalProperties: false },
  gh_release_delete: { type: "object", properties: { repo: { type: "string" }, tag: { type: "string" }, yes: { type: "boolean" } }, required: ["tag"], additionalProperties: false },
  gh_project_list: { type: "object", properties: { owner: { type: "string", description: "Default \"@me\"" }, limit: { type: "number" }, all: { type: "boolean", description: "include closed projects" } }, additionalProperties: false },
  gh_project_view: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_project_create: { type: "object", properties: { title: { type: "string" }, owner: { type: "string" }, public: { type: "boolean" } }, required: ["title"], additionalProperties: false },
  gh_project_edit: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, title: { type: "string" }, description: { type: "string" }, readme: { type: "string" }, visibility: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_project_field_list: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, limit: { type: "number" } }, required: ["number"], additionalProperties: false },
  gh_project_field_create: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, name: { type: "string" }, data_type: { type: "string", enum: ["TEXT", "SINGLE_SELECT", "DATE", "NUMBER"] }, single_select_options: { type: "array", items: { type: "string" } } }, required: ["number", "name", "data_type"], additionalProperties: false },
  gh_project_item_list: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, query: { type: "string" }, limit: { type: "number" } }, required: ["number"], additionalProperties: false },
  gh_project_item_create: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["number", "title"], additionalProperties: false },
  gh_project_item_add: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, url: { type: "string" } }, required: ["number", "url"], additionalProperties: false },
  gh_project_item_edit: { type: "object", properties: { owner: { type: "string" }, id: { type: "string" }, project_id: { type: "string" }, field_id: { type: "string" }, clear: { type: "boolean" }, text: { type: "string" }, number_value: { type: "number" }, date: { type: "string" }, iteration_id: { type: "string" }, single_select_option_id: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["id"], additionalProperties: false },
  gh_project_item_archive: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, id: { type: "string" }, undo: { type: "boolean" } }, required: ["number", "id"], additionalProperties: false },
  gh_project_item_delete: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" }, id: { type: "string" } }, required: ["number", "id"], additionalProperties: false },
  gh_project_delete: { type: "object", properties: { number: { type: "string" }, owner: { type: "string" } }, required: ["number"], additionalProperties: false },
  gh_api: { type: "object", properties: { repo: { type: "string" }, endpoint: { type: "string" }, method: { type: "string" }, header: { type: "array", items: { type: "string" } }, field: { type: "array", items: { type: "string" } }, raw_field: { type: "array", items: { type: "string" } }, per_page: { type: "number" }, jq: { type: "string" }, include: { type: "boolean" } }, required: ["endpoint"], additionalProperties: false },
  gh_graphql: { type: "object", properties: { query: { type: "string" }, field: { type: "array", items: { type: "string" } } }, required: ["query"], additionalProperties: false },
  gh_cli: { type: "object", properties: { args: { type: "array", items: { type: "string" }, description: "raw gh CLI args, e.g. [\"pr\",\"view\",\"1\",\"--json\",\"number,title\"]" } }, required: ["args"], additionalProperties: false },
    gh_search_issues: { type: "object", properties: { query: { type: "string" }, repo: { type: "string" }, state: { type: "string" }, assignee: { type: "string" }, label: { type: "array", items: { type: "string" } }, limit: { type: "number" }, json: { type: "string" } }, additionalProperties: false },
  gh_search_prs: { type: "object", properties: { query: { type: "string" }, repo: { type: "string" }, state: { type: "string" }, assignee: { type: "string" }, author: { type: "string" }, head: { type: "string" }, base: { type: "string" }, limit: { type: "number" }, json: { type: "string" } }, additionalProperties: false },
  gh_search_repos: { type: "object", properties: { query: { type: "string" }, language: { type: "string" }, stars: { type: "number" }, limit: { type: "number" }, json: { type: "string" } }, additionalProperties: false },
};

const TOOL_DOCS = {
  gh_auth_status: "Run `gh auth status` — reports the logged-in account and token scopes per host.",
  gh_repo_view: "Show repository metadata as JSON (defaults to name/stars/description/etc).",
  gh_repo_list: "List repositories (defaults to yours).",
  gh_repo_create: "Create a new repository. Supply `name`; other fields optional.",
  gh_repo_edit: "Edit repository settings (visibility, topics, description, homepage, features).",
  gh_repo_delete: "Delete a repository by `repo` (OWNER/REPO). Irreversible.",
  gh_label_list: "List labels on a repo.",
  gh_label_create: "Create a label (name required; color, description, force optional).",
  gh_label_edit: "Rename/a recolor/re-describe an existing label.",
  gh_label_delete: "Delete a label by name.",
  gh_issue_list: "List issues with filters (state/assignee/label/milestone/search).",
  gh_issue_create: "Create an issue (title required).",
  gh_issue_view: "View an issue by number. Pass `comments:true` to include comments.",
  gh_issue_edit: "Edit an issue (title/body/milestone) and add/remove assignees/labels/links.",
  gh_issue_close: "Close an issue by number (optional reason + closing comment).",
  gh_issue_reopen: "Reopen a closed issue by number.",
  gh_issue_comment: "Add a comment to an issue (body OR body_file required).",
  gh_issue_delete: "Delete an issue by number.",
  gh_pr_list: "List pull requests with filters (state/base/head/label/search).",
  gh_pr_view: "View a PR by number. Pass `diff:true` to get the diff text instead.",
  gh_pr_create: "Create a pull request (supply base/head/title/body, or use fill:true).",
  gh_pr_edit: "Edit a PR's base/title/body/milestone.",
  gh_pr_merge: "Merge a PR — set exactly one of {merge,squash,rebase:true}.",
  gh_pr_close: "Close a pull request by number.",
  gh_pr_reopen: "Reopen a pull request by number.",
  gh_pr_review: "Submit a review: approve, request-changes, or comment.",
  gh_pr_comment: "Add a comment to a PR.",
  gh_pr_checkout: "Check out a PR's branch locally.",
  gh_pr_checks: "Show CI status for a PR. Use `watch:true` to poll until complete.",
  gh_workflow_list: "List workflow files (hidden ones unless... use limit).",
  gh_workflow_view: "View a workflow file by name.",
  gh_workflow_run: "Trigger workflow_dispatch. Pass `fields:{key,val}` for inputs.",
  gh_workflow_disable: "Disable a workflow by name.",
  gh_workflow_enable: "Enable a workflow by name.",
  gh_run_list: "List recent workflow runs with filters (branch/event/status/workflow/user).",
  gh_run_view: "View a workflow run by database ID.",
  gh_run_rerun: "Rerun a workflow run (optionally a single job, or with --debug).",
  gh_run_cancel: "Cancel a workflow run by database ID.",
  gh_run_watch: "Watch a run live, polling at `interval` seconds.",
  gh_run_download: "Download artifacts from a run (filter by name/pattern).",
  gh_release_list: "List releases on a repo.",
  gh_release_view: "View a release by tag (latest if omitted).",
  gh_release_create: "Create a release (tag required; notes/notes_file/title/target).",
  gh_release_upload: "Upload release assets (tag required; files array).",
  gh_release_delete: "Delete a release tag (yes to skip confirmation).",
  gh_project_list: "List Projects v2 boards for an owner (default @me).",
  gh_project_view: "View a Projects v2 board by number as JSON.",
  gh_project_create: "Create a Projects v2 board (title required; owner, public optional).",
  gh_project_edit: "Edit a project's title/description/readme/visibility.",
  gh_project_field_list: "List a project's fields (title, status, etc.) with IDs.",
  gh_project_field_create: "Add a field to a project: TEXT|SINGLE_SELECT|DATE|NUMBER.",
  gh_project_item_list: "List items in a project, optionally filtered by query.",
  gh_project_item_create: "Create a draft issue item in a project (title required).",
  gh_project_item_add: "Add an existing issue/PR (by url) to a project.",
  gh_project_item_edit: "Edit a project item's field value (text/number/date/select/iteration/clear/title/body).",
  gh_project_item_archive: "Archive (or unarchive with undo) an item in a project.",
  gh_project_item_delete: "Delete an item from a project by ID.",
  gh_project_delete: "Delete a project by number (owner defaults to @me).",
  gh_api: "Raw `gh api` passthrough — call any GitHub REST endpoint by path.",
  gh_graphql: "Run a GraphQL query via `gh api graphql` with typed fields.",
  gh_cli: "Generic gh passthrough: pass raw CLI args exactly as you'd type them.",
    gh_search_issues: "Search issues across GitHub via `gh search issues` (supports repo/state/assignee/label/query).",
  gh_search_prs: "Search pull requests across GitHub via `gh search prs` (supports repo/state/author/head/base/query).",
  gh_search_repos: "Search repositories across GitHub via `gh search repos` (supports language/stars/query).",
};

const TOOLS = Object.keys(HANDLERS).map((name) => ({
  name,
  description: TOOL_DOCS[name] || `${name} — wraps the gh CLI.`,
  inputSchema: TOOL_SCHEMAS[name] || { type: "object", properties: {}, additionalProperties: false },
}));

// --- MCP plumbing (mirrors servers/showcase) --------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function handleRequest(id, method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  }
  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") {
    const name = params?.name ?? "";
    const args = params?.arguments ?? {};
    const wrap = (text, isError = false) => ({ content: [{ type: "text", text }], isError });
    const handler = HANDLERS[name];
    if (!handler) return wrap(`Unknown tool: ${name}`, true);
    return handler(args)
      .then((out) => wrap(out))
      .catch((e) => wrap(typeof e === "string" ? e : (e?.message ?? e?.stderr ?? JSON.stringify(e)), true));
  }
  return Promise.reject(new Error(`Method not found: ${method}`));
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let chain = Promise.resolve();
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); }
  catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  chain = chain
    .then(() => handleRequest(msg.id, msg.method, msg.params))
    .then((result) => {
      if (msg.id !== undefined && result !== undefined) {
        send({ jsonrpc: "2.0", id: msg.id, result });
      }
    })
    .catch((e) => {
      if (msg.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: e.message?.startsWith("Method not found") ? -32601 : -32603, message: e.message },
        });
      }
    });
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

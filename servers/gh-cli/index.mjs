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

  gh_repo_view: (p) =>
    runGh(["repo", "view", ...repoArg(p), "--json", p.json || "name,nameWithOwner,description,defaultBranchRef,url,stargazerCount,forkCount,primaryLanguage,owner,isPrivate,createdAt,pushedAt"]),

  gh_repo_list: (p) =>
    runGh(["repo", "list", ...repoArg(p), "--limit", String(p.limit || 30), "--json", p.json || "nameWithOwner,description,url,stargazerCount,primaryLanguage"]),

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
    const a = ["edit", ...repoArg(p), ...flags({
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
    return runGh(["repo", "delete", ...repoArg(p), "--yes"]);
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

  gh_workflow_list: (p) => runGh(["workflow", "list", ...repoArg(p), "--limit", String(p.limit || 100), "--json", "name,state,path,url"]),

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

  gh_release_list: (p) => runGh(["release", "list", ...repoArg(p), "--limit", String(p.limit || 30), "--json", "name,tagName,draft,prerelease,createdAt,publishedAt,url"]),

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

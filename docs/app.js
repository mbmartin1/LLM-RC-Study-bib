/* ===========================================================================
   Annotated bibliography — single-file app, no dependencies, no build step.

   Source of truth is papers/*.md in the GitHub repo. This file reads them
   through the GitHub API and writes them back through the Contents API.
   Nothing is generated or cached server-side, so nothing can go stale.
   =========================================================================== */
(function () {
"use strict";

var CFG = window.BIB_CONFIG;
var API = "https://api.github.com";
var RAW = "https://raw.githubusercontent.com";

/* ---------------------------------------------------------------- schema  */

// Serialization order. Adding a field means adding it here and in FIELD_META.
var ORDER = ["id","type","title","authors","editors","year","container","volume",
             "issue","pages","publisher","institution","doi","url","accessed",
             "tags","status","added","added_by"];

var LIST_FIELDS = { authors: 1, editors: 1, tags: 1 };

var TYPES = [
  ["article",       "Journal article"],
  ["inproceedings", "Conference paper"],
  ["preprint",      "Preprint"],
  ["incollection",  "Book chapter"],
  ["book",          "Book"],
  ["report",        "Report / working paper"],
  ["thesis",        "Thesis"],
  ["dataset",       "Dataset"],
  ["webpage",       "Web page / article"],
  ["misc",          "Other"]
];

var STATUSES = [
  ["core",              "Core"],
  ["supporting",        "Supporting"],
  ["dataset-candidate", "Dataset candidate"],
  ["background",        "Background"],
  ["to-read",           "To read"]
];

// Label for the "container" field, which means something different per type.
var CONTAINER_LABEL = {
  article: "Journal", inproceedings: "Proceedings / conference",
  incollection: "Book title", preprint: "Repository (e.g. arXiv)",
  webpage: "Site or publication", book: "Series (optional)",
  report: "Series (optional)", thesis: "Institution", dataset: "Repository",
  misc: "Container"
};

function typeLabel(t) {
  for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === t) return TYPES[i][1];
  return t;
}
function statusLabel(s) {
  for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i][0] === s) return STATUSES[i][1];
  return s;
}

/* ----------------------------------------------------------------- utils  */

// Never let a stored field become a javascript: or data: href.
function safeUrl(u) {
  var s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function el(tag, attrs, kids) {
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (k === "class") n.className = attrs[k];
    else if (k === "text") n.textContent = attrs[k];
    else if (k === "html") n.innerHTML = attrs[k];
    else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  }
  if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
    if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return n;
}
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function today() {
  var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function slug(s) {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function b64encode(str) {
  var bytes = new TextEncoder().encode(str), bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function toast(msg, bad) {
  var t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (bad ? " bad" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.hidden = true; }, bad ? 6500 : 3200);
}

/* -------------------------------------------------- frontmatter: parsing  */

// A deliberately small YAML subset: flat keys, double/single-quoted or bare
// scalars, and block or inline lists. Unknown keys are a hard error so a typo
// surfaces immediately instead of silently dropping data.

function parseScalar(raw) {
  var s = raw.trim();
  if (s === "" || s === "~" || s === "null") return "";
  var q = s.charAt(0);
  if ((q === '"' || q === "'") && s.charAt(s.length - 1) === q && s.length > 1) {
    var inner = s.slice(1, -1);
    if (q === '"') {
      return inner.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, function (m, g) {
        if (g.charAt(0) === "u") return String.fromCharCode(parseInt(g.slice(1), 16));
        return { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[g];
      });
    }
    return inner.replace(/''/g, "'");
  }
  var hash = s.indexOf(" #");
  if (hash > -1) s = s.slice(0, hash).trim();
  return s;
}

function splitFlowList(s) {
  var out = [], buf = "", depth = 0, quote = null;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (quote) { buf += c; if (c === quote && s.charAt(i - 1) !== "\\") quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === "[") { depth++; if (depth === 1) continue; }
    if (c === "]") { depth--; if (depth === 0) continue; }
    if (c === "," && depth === 1) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim() !== "") out.push(buf);
  return out.map(parseScalar).filter(function (v) { return v !== ""; });
}

function parsePaper(text, filename) {
  var t = String(text).replace(/\r\n/g, "\n");
  if (t.slice(0, 4) !== "---\n") throw new Error(filename + ": file must start with a --- frontmatter block");
  var end = t.indexOf("\n---\n", 3);
  var tail = "";
  if (end === -1) {
    if (t.slice(-4) === "\n---") { end = t.length - 4; tail = ""; }
    else throw new Error(filename + ": frontmatter block is not closed with ---");
  } else {
    tail = t.slice(end + 5);
  }
  var head = t.slice(4, end + 1);
  var p = {}, lines = head.split("\n"), curList = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim() === "" || /^\s*#/.test(line)) continue;

    var item = /^\s+-\s?(.*)$/.exec(line);
    if (item) {
      if (!curList) throw new Error(filename + ": list item on line " + (i + 2) + " has no key above it");
      var v = parseScalar(item[1]);
      if (v !== "") curList.push(v);
      continue;
    }
    var m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/.exec(line);
    if (!m) throw new Error(filename + ': cannot parse line ' + (i + 2) + ': "' + line + '"');
    var key = m[1], rest = m[2].trim();
    if (ORDER.indexOf(key) === -1) {
      throw new Error(filename + ': unknown field "' + key + '". Allowed fields: ' + ORDER.join(", "));
    }
    curList = null;
    if (LIST_FIELDS[key]) {
      if (rest.charAt(0) === "[") { p[key] = splitFlowList(rest); }
      else if (rest === "") { p[key] = []; curList = p[key]; }
      else { p[key] = [parseScalar(rest)]; }
    } else {
      p[key] = parseScalar(rest);
    }
  }

  if (!p.id) p.id = String(filename).replace(/\.md$/, "");
  if (!p.title) throw new Error(filename + ": missing required field 'title'");
  if (!p.type) p.type = "misc";
  if (!p.status) p.status = "to-read";
  ["authors", "editors", "tags"].forEach(function (k) { if (!p[k]) p[k] = []; });
  p.notes = tail.replace(/^\n+/, "").replace(/\s+$/, "");
  p._file = filename;
  return p;
}

/* ---------------------------------------------- frontmatter: serializing  */

// Round-trips byte-for-byte: serialize(parse(f)) === f for any file this
// function produced. Keep it that way — it is what makes edits show a clean
// one-field diff on GitHub instead of reformatting the whole file.

var BARE = /^[A-Za-z0-9][^:\n"\\#]*$/;

function emitScalar(v) {
  var s = String(v);
  if (s !== "" && BARE.test(s) && s.charAt(s.length - 1) !== " ") return s;
  return JSON.stringify(s);
}

function toMarkdown(p) {
  var out = "---\n";
  for (var i = 0; i < ORDER.length; i++) {
    var k = ORDER[i], v = p[k];
    if (v === null || v === undefined) continue;
    if (LIST_FIELDS[k]) {
      var list = (v || []).filter(function (x) { return String(x).trim() !== ""; });
      if (!list.length) continue;
      out += k + ":\n";
      for (var j = 0; j < list.length; j++) out += "  - " + emitScalar(String(list[j]).trim()) + "\n";
    } else {
      var s = String(v).trim();
      if (s === "") continue;
      out += k + ": " + emitScalar(s) + "\n";
    }
  }
  out += "---\n";
  var body = String(p.notes || "").replace(/\r\n/g, "\n").trim();
  if (body) out += "\n" + body + "\n";
  return out;
}

/* ------------------------------------------------------ markdown rendering */

// Enough Markdown for annotation notes: headings, lists, quotes, fences,
// emphasis, links, code, and [[paper-id]] cross-references.

function inlineMd(src) {
  var out = "", i = 0, codes = [];
  // pull inline code out first so its contents are never re-parsed
  src = String(src).replace(/`([^`]+)`/g, function (m, c) {
    codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000";
  });
  out = esc(src);
  out = out.replace(/\[\[([^\]|]+?)\]\]/g, function (m, id) {
    var key = id.trim();
    var known = !!Store.byId[key];
    return '<span class="xref' + (known ? "" : " dead") + '" data-xref="' + esc(key) + '"' +
           (known ? "" : ' title="No paper with this id yet"') + ">" + esc(key) + "</span>";
  });
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (m, pre, url) {
    return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>";
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
  out = out.replace(/\u0000(\d+)\u0000/g, function (m, n) { return "<code>" + esc(codes[+n]) + "</code>"; });
  return out;
}

function renderMd(src) {
  var lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  var html = "", i = 0;
  function flushList(tag, items) {
    html += "<" + tag + ">" + items.map(function (t) { return "<li>" + inlineMd(t) + "</li>"; }).join("") + "</" + tag + ">";
  }
  while (i < lines.length) {
    var line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^```/.test(line)) {
      var buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += "<pre><code>" + esc(buf.join("\n")) + "</code></pre>";
      continue;
    }
    var h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { var lv = Math.min(h[1].length + 1, 6); html += "<h" + lv + ">" + inlineMd(h[2]) + "</h" + lv + ">"; i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) { html += "<hr>"; i++; continue; }
    if (/^\s*>/.test(line)) {
      var q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      html += "<blockquote>" + renderMd(q.join("\n")) + "</blockquote>";
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      var ul = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) ul.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      flushList("ul", ul); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      var ol = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) ol.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      flushList("ol", ol); continue;
    }
    var para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) &&
           !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])) para.push(lines[i++]);
    html += "<p>" + inlineMd(para.join("\n")) + "</p>";
  }
  return html;
}

/* ------------------------------------------------------------------ names */

function parseName(raw) {
  var s = String(raw || "").trim();
  if (!s) return null;
  // "{Organization Name}" or a name with no comma is treated as a single unit.
  if (s.charAt(0) === "{" && s.charAt(s.length - 1) === "}") {
    return { family: s.slice(1, -1).trim(), given: "", literal: true };
  }
  var c = s.indexOf(",");
  if (c === -1) {
    var parts = s.split(/\s+/);
    if (parts.length === 1) return { family: s, given: "", literal: true };
    return { family: parts.pop(), given: parts.join(" ") };
  }
  return { family: s.slice(0, c).trim(), given: s.slice(c + 1).trim() };
}

function initials(given) {
  if (!given) return "";
  return given.split(/\s+/).filter(Boolean).map(function (part) {
    return part.split("-").filter(Boolean).map(function (bit) {
      return bit.charAt(0).toUpperCase() + ".";
    }).join("-");
  }).join(" ");
}

function apaName(raw) {
  var n = parseName(raw);
  if (!n) return "";
  if (n.literal || !n.given) return n.family;
  return n.family + ", " + initials(n.given);
}

// APA 7: up to 20 names listed; 21+ shows the first 19, an ellipsis, and the last.
function apaNameList(list) {
  var names = (list || []).map(apaName).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + ", & " + names[1];
  if (names.length <= 20) {
    return names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
  }
  return names.slice(0, 19).join(", ") + ", . . . " + names[names.length - 1];
}

// In the "In <editors> (Eds.)," slot APA puts initials before the family name.
function apaNameGivenFirst(raw) {
  var n = parseName(raw);
  if (!n) return "";
  if (n.literal || !n.given) return n.family;
  return initials(n.given) + " " + n.family;
}

function apaNameListGivenFirst(list) {
  var names = (list || []).map(apaNameGivenFirst).filter(Boolean);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " & " + names[1];
  return names.slice(0, -1).join(", ") + ", & " + names[names.length - 1];
}

function shortNames(list) {
  var names = (list || []).map(function (r) { var n = parseName(r); return n ? n.family : ""; }).filter(Boolean);
  if (!names.length) return "Unknown author";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " & " + names[1];
  return names[0] + " et al.";
}

/* ----------------------------------------------------------------- github */

var Auth = {
  token: "",
  login: "",
  canWrite: false,

  init: function () {
    try { this.token = localStorage.getItem("bib:token") || ""; } catch (e) { this.token = ""; }
  },
  headers: function (extra) {
    var h = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (this.token) h.Authorization = "Bearer " + this.token;
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  },
  remember: function (tok) {
    this.token = tok || "";
    try {
      if (tok) localStorage.setItem("bib:token", tok);
      else localStorage.removeItem("bib:token");
    } catch (e) {}
  },
  // Confirms the token actually carries write access to *this* repo. GitHub is
  // the authority here — the UI just mirrors what the API reports.
  verify: function () {
    var self = this;
    if (!this.token) { this.canWrite = false; this.login = ""; return Promise.resolve(false); }
    return fetch(API + "/repos/" + CFG.owner + "/" + CFG.repo, { headers: this.headers() })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status === 401 ? "Token was rejected by GitHub (expired or mistyped)."
                                                    : "GitHub returned " + r.status + " for this repository.");
        return r.json();
      })
      .then(function (repo) {
        self.canWrite = !!(repo.permissions && repo.permissions.push);
        return fetch(API + "/user", { headers: self.headers() })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (u) { self.login = (u && u.login) || ""; return self.canWrite; });
      });
  }
};

function ghJSON(path) {
  return fetch(API + path, { headers: Auth.headers() }).then(function (r) {
    if (r.ok) return r.json();
    if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub's anonymous rate limit is used up for your network. " +
                      "Adding a token (the button in the top right) lifts it.");
    }
    if (r.status === 404) throw new Error("Not found: " + path + " — check owner/repo/branch in config.js.");
    return r.text().then(function (t) { throw new Error("GitHub " + r.status + ": " + t.slice(0, 200)); });
  });
}

/* ------------------------------------------------------------- blob cache */

// Papers are fetched from commit-pinned raw URLs, which are immutable, so the
// content behind a blob sha can be cached forever.
var Cache = {
  get: function (sha) { try { return localStorage.getItem("bib:blob:" + sha); } catch (e) { return null; } },
  put: function (sha, text) {
    try { localStorage.setItem("bib:blob:" + sha, text); }
    catch (e) { this.prune(); try { localStorage.setItem("bib:blob:" + sha, text); } catch (e2) {} }
  },
  prune: function () {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("bib:blob:") === 0) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }
};

/* ------------------------------------------------------------------ store */

var Store = {
  papers: [],
  byId: {},
  head: "",
  fromCache: 0,

  reindex: function () {
    var by = {};
    this.papers.forEach(function (p) { by[p.id] = p; });
    this.byId = by;
    this.papers.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
  },

  load: function () {
    var self = this;
    return ghJSON("/repos/" + CFG.owner + "/" + CFG.repo + "/git/ref/heads/" + CFG.branch)
      .then(function (ref) {
        self.head = ref.object.sha;
        return ghJSON("/repos/" + CFG.owner + "/" + CFG.repo + "/git/trees/" + self.head + "?recursive=1");
      })
      .then(function (tree) {
        var prefix = CFG.dir + "/";
        var files = (tree.tree || []).filter(function (t) {
          return t.type === "blob" && t.path.indexOf(prefix) === 0 && /\.md$/.test(t.path);
        });
        self.fromCache = 0;
        return Promise.all(files.map(function (f) {
          var name = f.path.slice(prefix.length);
          var hit = Cache.get(f.sha);
          if (hit !== null) { self.fromCache++; return { name: name, sha: f.sha, text: hit }; }
          return fetch(RAW + "/" + CFG.owner + "/" + CFG.repo + "/" + self.head + "/" + f.path)
            .then(function (r) {
              if (!r.ok) throw new Error("Could not read " + f.path + " (" + r.status + ")");
              return r.text();
            })
            .then(function (text) { Cache.put(f.sha, text); return { name: name, sha: f.sha, text: text }; });
        }));
      })
      .then(function (files) {
        var papers = [], problems = [];
        files.forEach(function (f) {
          try {
            var p = parsePaper(f.text, f.name);
            p._sha = f.sha;
            papers.push(p);
          } catch (e) { problems.push(e.message); }
        });
        self.papers = papers;
        self.reindex();
        return problems;
      });
  },

  // Writes one paper file through the Contents API. GitHub rejects the call
  // unless the token's owner has write access, so permission is enforced
  // server-side, not here.
  save: function (paper, message) {
    var self = this;
    var file = paper._file || (paper.id + ".md");
    var body = {
      message: message,
      content: b64encode(toMarkdown(paper)),
      branch: CFG.branch
    };
    if (paper._sha) body.sha = paper._sha;
    return fetch(API + "/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + CFG.dir + "/" + encodeURIComponent(file), {
      method: "PUT", headers: Auth.headers({ "Content-Type": "application/json" }), body: JSON.stringify(body)
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        var msg = j.message || ("HTTP " + r.status);
        if (r.status === 409 || /does not match/i.test(msg)) {
          msg = "Someone else changed this paper while you were editing. Reload the page and redo your edit.";
        } else if (r.status === 403 || r.status === 404) {
          msg = "GitHub refused the write. Your token needs the repo scope, and your account needs " +
                "collaborator access to this repository.";
        }
        throw new Error(msg);
      });
    }).then(function (res) {
      paper._sha = res.content.sha;
      paper._file = file;
      Cache.put(paper._sha, toMarkdown(paper));
      var existing = self.byId[paper.id];
      if (existing) {
        var i = self.papers.indexOf(existing);
        if (i > -1) self.papers[i] = paper; else self.papers.push(paper);
      } else self.papers.push(paper);
      self.reindex();
      return res;
    });
  },

  remove: function (paper) {
    var self = this;
    var file = paper._file || (paper.id + ".md");
    return fetch(API + "/repos/" + CFG.owner + "/" + CFG.repo + "/contents/" + CFG.dir + "/" + encodeURIComponent(file), {
      method: "DELETE", headers: Auth.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message: "Remove " + paper.id, sha: paper._sha, branch: CFG.branch })
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(j.message || ("HTTP " + r.status));
      });
      var i = self.papers.indexOf(paper);
      if (i > -1) self.papers.splice(i, 1);
      self.reindex();
    });
  }
};

/* ==========================================================================
   Importers — BibTeX (.bib), RIS (.ris), CSL-JSON (.json)
   ========================================================================== */

var ACCENTS = {
  "'": { a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ć", n: "ń", s: "ś", z: "ź",
         A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", C: "Ć", N: "Ń", S: "Ś", Z: "Ź" },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È", I: "Ì", O: "Ò", U: "Ù" },
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", E: "Ë", I: "Ï", O: "Ö", U: "Ü" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", E: "Ê", I: "Î", O: "Ô", U: "Û" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ", O: "Õ" },
  "c": { c: "ç", C: "Ç", s: "ş", S: "Ş" },
  "v": { c: "č", s: "š", z: "ž", r: "ř", e: "ě", C: "Č", S: "Š", Z: "Ž", R: "Ř" },
  "=": { a: "ā", e: "ē", i: "ī", o: "ō", u: "ū", A: "Ā", E: "Ē", I: "Ī", O: "Ō", U: "Ū" },
  ".": { z: "ż", Z: "Ż", e: "ė", E: "Ė" },
  "u": { a: "ă", g: "ğ", u: "ŭ", A: "Ă", G: "Ğ" }
};

function delatex(s) {
  var t = String(s == null ? "" : s);
  t = t.replace(/\\([`'"^~=.cvu])\{?\\?([A-Za-z])\}?/g, function (m, acc, ch) {
    return (ACCENTS[acc] && ACCENTS[acc][ch]) || ch;
  });
  t = t.replace(/\\ldots\b/g, "…");
  t = t.replace(/\\textendash\b/g, "–").replace(/\\textemdash\b/g, "—");
  t = t.replace(/\\([&%$#_])/g, "$1");
  t = t.replace(/---/g, "—").replace(/--/g, "–");
  t = t.replace(/``/g, "“").replace(/''/g, "”");
  t = t.replace(/\{\\[a-zA-Z]+\s*\}/g, "");
  t = t.replace(/[{}]/g, "");
  t = t.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ");
  return t.trim();
}

// BibTeX separates names with " and ", but a braced corporate name may contain
// the word "and", so the split has to respect brace depth.
function splitNames(raw) {
  var s = String(raw || ""), out = [], buf = "", depth = 0, i = 0;
  while (i < s.length) {
    var c = s.charAt(i);
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth === 0 && /\s/.test(c) && /^\s+and\s+/i.test(s.slice(i))) {
      out.push(buf);
      i += /^\s+and\s+/i.exec(s.slice(i))[0].length;
      buf = "";
      continue;
    }
    buf += c;
    i++;
  }
  out.push(buf);
  return out;
}

// Returns one name as "Family, Given", or "{Organization}" for a corporate
// author. The braces are how the rest of the app knows not to invert the name.
function normalizeOneName(raw) {
  var s = String(raw || "").trim().replace(/,\s*$/, "");
  if (!s) return "";
  var corporate = /^\{[\s\S]*\}$/.test(s);
  var name = delatex(s);
  if (!name) return "";
  if (corporate) return "{" + name + "}";
  if (name.indexOf(",") > -1) {
    var bits = name.split(",");
    var rest = bits.slice(1).join(",").trim();
    return bits[0].trim() + (rest ? ", " + rest : "");
  }
  var n = parseName(name);
  if (!n) return "";
  return n.given ? n.family + ", " + n.given : n.family;
}

// RIS has no brace convention, so corporate authors have to be recognised:
// "World Health Organization," (trailing comma) is the documented marker, and a
// comma-less name of three or more words with no initials is one in practice.
function normalizeRISName(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";
  if (/,\s*$/.test(s)) return "{" + s.replace(/,\s*$/, "") + "}";
  if (s.indexOf(",") === -1) {
    var words = s.split(/\s+/);
    var hasInitial = words.some(function (w) { return /^[A-Z]\.?$/.test(w); });
    if (words.length >= 3 && !hasInitial) return "{" + s + "}";
  }
  return normalizeOneName(s);
}

function normalizeNames(raw) {
  return splitNames(raw).map(normalizeOneName).filter(Boolean);
}

var BIB_TYPES = {
  article: "article", inproceedings: "inproceedings", conference: "inproceedings",
  proceedings: "inproceedings", incollection: "incollection", inbook: "incollection",
  book: "book", booklet: "book", techreport: "report", manual: "report",
  phdthesis: "thesis", mastersthesis: "thesis", thesis: "thesis",
  dataset: "dataset", online: "webpage", electronic: "webpage", www: "webpage",
  misc: "misc", unpublished: "preprint"
};

function parseBibtex(src) {
  var out = [], i = 0, s = String(src);
  while (i < s.length) {
    var at = s.indexOf("@", i);
    if (at === -1) break;
    var m = /^@(\w+)\s*[{(]/.exec(s.slice(at));
    if (!m) { i = at + 1; continue; }
    var kind = m[1].toLowerCase();
    if (kind === "comment" || kind === "preamble" || kind === "string") { i = at + m[0].length; continue; }

    var p = at + m[0].length, depth = 1, start = p;
    while (p < s.length && depth > 0) {
      var c = s.charAt(p);
      if (c === "{") depth++;
      else if (c === "}") depth--;
      p++;
    }
    var inner = s.slice(start, p - 1);
    i = p;

    var comma = inner.indexOf(",");
    var citekey = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    var rest = comma === -1 ? "" : inner.slice(comma + 1);

    var fields = {}, j = 0;
    while (j < rest.length) {
      var fm = /^\s*([A-Za-z][\w-]*)\s*=\s*/.exec(rest.slice(j));
      if (!fm) break;
      j += fm[0].length;
      var key = fm[1].toLowerCase(), val = "";
      var ch = rest.charAt(j);
      if (ch === "{") {
        var d = 1; j++;
        var vs = j;
        while (j < rest.length && d > 0) {
          if (rest.charAt(j) === "{") d++;
          else if (rest.charAt(j) === "}") d--;
          if (d > 0) j++;
        }
        val = rest.slice(vs, j); j++;
      } else if (ch === '"') {
        j++;
        var vq = j;
        while (j < rest.length && !(rest.charAt(j) === '"' && rest.charAt(j - 1) !== "\\")) j++;
        val = rest.slice(vq, j); j++;
      } else {
        var vb = j;
        while (j < rest.length && !/[,\n}]/.test(rest.charAt(j))) j++;
        val = rest.slice(vb, j);
      }
      fields[key] = val.trim();
      var nc = rest.indexOf(",", j);
      if (nc === -1) break;
      j = nc + 1;
    }

    var type = BIB_TYPES[kind] || "misc";
    var arch = (fields.archiveprefix || fields.eprinttype || "").toLowerCase();
    if (type === "misc" && (arch === "arxiv" || (fields.eprint && !fields.journal))) type = "preprint";

    var item = {
      _key: citekey,
      type: type,
      title: delatex(fields.title),
      authors: normalizeNames(fields.author),
      editors: normalizeNames(fields.editor),
      year: (/(\d{4})/.exec(fields.year || fields.date || "") || [])[1] || "",
      container: delatex(fields.journal || fields.journaltitle || fields.booktitle ||
                         fields.series || (arch === "arxiv" ? "arXiv" : "")),
      volume: delatex(fields.volume),
      issue: delatex(fields.number || fields.issue),
      pages: delatex(fields.pages),
      publisher: delatex(fields.publisher || fields.organization),
      institution: delatex(fields.institution || fields.school),
      doi: delatex(fields.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
      url: delatex(String(fields.url || fields.howpublished || "").replace(/^\\url/, "")),
      tags: String(fields.keywords || "").split(/[,;]/).map(function (k) { return slug(delatex(k)); }).filter(Boolean),
      notes: delatex(fields.abstract || fields.annote || fields.note || "")
    };
    if (!/^https?:/.test(item.url)) item.url = "";
    if (item.title) out.push(item);
  }
  return out;
}

var RIS_TYPES = {
  JOUR: "article", EJOUR: "article", CPAPER: "inproceedings", CONF: "inproceedings",
  CHAP: "incollection", BOOK: "book", EBOOK: "book", RPRT: "report",
  THES: "thesis", DATA: "dataset", ELEC: "webpage", ICOMM: "webpage",
  WEB: "webpage", BLOG: "webpage", MGZN: "webpage", NEWS: "webpage",
  UNPB: "preprint", PREPRINT: "preprint", GEN: "misc"
};

function parseRIS(src) {
  var lines = String(src).replace(/\r\n/g, "\n").split("\n");
  var out = [], cur = null, lastTag = null;

  function flush() {
    if (!cur) return;
    if (cur.title) {
      if (cur._sp && cur._ep) cur.pages = cur._sp + "–" + cur._ep;
      else if (cur._sp) cur.pages = cur._sp;
      delete cur._sp; delete cur._ep;
      out.push(cur);
    }
    cur = null;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(line);
    if (!m) {
      if (cur && lastTag && line.trim()) cur[lastTag] = (cur[lastTag] + " " + line.trim()).trim();
      continue;
    }
    var tag = m[1], v = m[2].trim();
    if (tag === "TY") {
      flush();
      cur = { type: RIS_TYPES[v.toUpperCase()] || "misc", authors: [], editors: [], tags: [],
              title: "", year: "", container: "", volume: "", issue: "", pages: "",
              publisher: "", institution: "", doi: "", url: "", notes: "" };
      lastTag = null;
      continue;
    }
    if (!cur) continue;
    lastTag = null;
    switch (tag) {
      case "ER": flush(); break;
      case "AU": case "A1": cur.authors.push(normalizeRISName(v) || v); break;
      case "ED": case "A2": case "A3": cur.editors.push(normalizeRISName(v) || v); break;
      case "TI": case "T1": case "CT": if (!cur.title) { cur.title = v; lastTag = "title"; } break;
      case "T2": case "JO": case "JF": case "JA": case "BT": if (!cur.container) cur.container = v; break;
      case "PY": case "Y1": case "DA": if (!cur.year) cur.year = (/(\d{4})/.exec(v) || [])[1] || ""; break;
      case "VL": cur.volume = v; break;
      case "IS": cur.issue = v; break;
      case "SP": cur._sp = v; break;
      case "EP": cur._ep = v; break;
      case "PB": cur.publisher = v; break;
      case "DO": cur.doi = v.replace(/^https?:\/\/(dx\.)?doi\.org\//, ""); break;
      case "UR": case "L1": if (!cur.url) cur.url = v; break;
      case "KW": cur.tags.push(slug(v)); break;
      case "AB": case "N2": cur.notes = cur.notes ? cur.notes + " " + v : v; lastTag = "notes"; break;
      case "N1": if (!cur.notes) { cur.notes = v; lastTag = "notes"; } break;
    }
  }
  flush();
  return out;
}

var CSL_TYPES = {
  "article-journal": "article", "article-magazine": "webpage", "article-newspaper": "webpage",
  "paper-conference": "inproceedings", "chapter": "incollection", "book": "book",
  "report": "report", "thesis": "thesis", "dataset": "dataset", "webpage": "webpage",
  "post-weblog": "webpage", "post": "webpage", "manuscript": "preprint",
  "article": "preprint", "speech": "misc", "software": "misc", "document": "misc"
};

function cslName(a) {
  if (!a) return "";
  if (a.literal) return "{" + String(a.literal) + "}";
  var family = String(a.family || "").trim(), given = String(a.given || "").trim();
  if (!family) return given;
  return given ? family + ", " + given : family;
}

function parseCSLJSON(src) {
  var data = JSON.parse(src);
  if (!Array.isArray(data)) data = [data];
  return data.map(function (d) {
    var dp = d.issued && d.issued["date-parts"] && d.issued["date-parts"][0];
    var year = dp ? String(dp[0]) : "";
    if (!year && d.issued && d.issued.raw) year = (/(\d{4})/.exec(d.issued.raw) || [])[1] || "";
    var kw = d.keyword ? (Array.isArray(d.keyword) ? d.keyword : String(d.keyword).split(/[,;]/)) : [];
    var type = CSL_TYPES[d.type] || "misc";
    return {
      _key: d.id ? String(d.id) : "",
      type: type,
      title: String(d.title || "").replace(/\s+/g, " ").trim(),
      authors: (d.author || []).map(cslName).filter(Boolean),
      editors: (d.editor || []).map(cslName).filter(Boolean),
      year: year,
      container: String(d["container-title"] || d["collection-title"] || "").trim(),
      volume: d.volume ? String(d.volume) : "",
      issue: d.issue ? String(d.issue) : "",
      pages: String(d.page || ""),
      publisher: type === "report" || type === "thesis" ? "" : String(d.publisher || "").trim(),
      institution: type === "report" || type === "thesis" ? String(d.publisher || "").trim() : "",
      doi: String(d.DOI || "").replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
      url: String(d.URL || "").trim(),
      tags: kw.map(function (k) { return slug(k); }).filter(Boolean),
      notes: String(d.abstract || d.note || "").trim()
    };
  }).filter(function (p) { return p.title; });
}

function sniffAndParse(text, filename) {
  var name = String(filename || "").toLowerCase();
  var head = String(text).slice(0, 4000);
  if (/\.json$/.test(name) || /^\s*[\[{]/.test(head)) return { kind: "CSL-JSON", items: parseCSLJSON(text) };
  if (/\.ris$/.test(name) || /^\s*TY\s{1,2}-\s/m.test(head)) return { kind: "RIS", items: parseRIS(text) };
  if (/\.bib(tex)?$/.test(name) || /@\w+\s*[{(]/.test(head)) return { kind: "BibTeX", items: parseBibtex(text) };
  throw new Error("Could not tell whether this is BibTeX, RIS, or CSL-JSON. " +
                  "Check the file, or paste the entries into the box instead.");
}

var STOPWORDS = { a:1, an:1, the:1, of:1, on:1, in:1, for:1, and:1, to:1, with:1, as:1,
                  is:1, are:1, does:1, do:1, why:1, how:1, what:1, from:1, at:1, by:1 };

function makeId(item, taken) {
  var n = parseName((item.authors && item.authors[0]) || "");
  var fam = slug(n ? n.family : "") || "anon";
  var words = String(item.title || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter(function (w) { return w.length > 2 && !STOPWORDS[w]; }).slice(0, 3);
  var base = (fam + "-" + (item.year || "nd") + "-" + slug(words.join(" "))).replace(/-+$/, "").replace(/-+/g, "-");
  var id = base, k = 2;
  while (taken[id]) id = base + "-" + (k++);
  taken[id] = true;
  return id;
}

/* ==========================================================================
   Exporters — APA 7 reference page, BibTeX, CSL-JSON
   ========================================================================== */

function ital(s) { return "<em>" + esc(s) + "</em>"; }

function doiOrUrl(p) {
  if (p.doi) {
    var d = String(p.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    return '<a href="https://doi.org/' + esc(d) + '" target="_blank" rel="noopener noreferrer">https://doi.org/' + esc(d) + "</a>";
  }
  if (safeUrl(p.url)) return '<a href="' + esc(safeUrl(p.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(p.url) + "</a>";
  return "";
}

function joinParts(parts) {
  return parts.filter(function (x) { return x && String(x).trim() !== ""; }).join(" ");
}

// Returns one APA 7 reference as HTML (italics preserved).
function apaRef(p) {
  var A = apaNameList(p.authors);
  var Y = "(" + (p.year || "n.d.") + ").";
  var titled = esc(p.title || "Untitled") + (/[.?!]$/.test(p.title || "") ? "" : ".");
  var titleItal = ital(p.title || "Untitled") + (/[.?!]$/.test(p.title || "") ? "" : ".");
  var eds = p.editors && p.editors.length
    ? apaNameListGivenFirst(p.editors) + " (" + (p.editors.length > 1 ? "Eds." : "Ed.") + "),"
    : "";
  var head = A ? A + (/[.?!]$/.test(A) ? "" : ".") + " " + Y : "";
  var link = doiOrUrl(p);
  var out;

  switch (p.type) {
    case "article": {
      var src = p.container ? ital(p.container) : "";
      if (src && p.volume) {
        src += ", " + ital(p.volume) + (p.issue ? "(" + esc(p.issue) + ")" : "");
      }
      if (src && p.pages) src += ", " + esc(p.pages);
      out = joinParts([head || titled, head ? titled : Y, src ? src + "." : "", link]);
      break;
    }
    case "inproceedings":
    case "incollection": {
      var inpart = joinParts(["In", eds, p.container ? ital(p.container) : "",
                              p.pages ? "(pp. " + esc(p.pages) + ")." : (p.container ? "." : "")]);
      out = joinParts([head || titled, head ? titled : Y, inpart,
                       p.publisher ? esc(p.publisher) + "." : "", link]);
      break;
    }
    case "book": {
      out = joinParts([head || titleItal, head ? titleItal : Y,
                       p.publisher ? esc(p.publisher) + "." : "", link]);
      break;
    }
    case "report": {
      var pub = p.institution || p.publisher;
      out = joinParts([head || titleItal, head ? titleItal : Y, pub ? esc(pub) + "." : "", link]);
      break;
    }
    case "thesis": {
      var inst = p.institution || p.container;
      var t = ital(p.title || "Untitled") + (inst ? " [Doctoral dissertation, " + esc(inst) + "]." : ".");
      out = joinParts([head || t, head ? t : Y, p.publisher ? esc(p.publisher) + "." : "", link]);
      break;
    }
    case "preprint": {
      var repo = p.container || "Preprint";
      out = joinParts([head || titleItal, head ? titleItal : Y, esc(repo) + ".", link]);
      break;
    }
    case "dataset": {
      var dt = ital(p.title || "Untitled") + " [Data set].";
      out = joinParts([head || dt, head ? dt : Y, p.publisher ? esc(p.publisher) + "." : "", link]);
      break;
    }
    case "webpage": {
      out = joinParts([head || titled, head ? titled : Y,
                       p.container ? ital(p.container) + "." : "", link]);
      break;
    }
    default: {
      out = joinParts([head || titleItal, head ? titleItal : Y,
                       p.container ? esc(p.container) + "." : "",
                       p.publisher ? esc(p.publisher) + "." : "", link]);
    }
  }
  return out.replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
}

function apaSortKey(p) {
  var n = parseName((p.authors && p.authors[0]) || "");
  return ((n ? n.family : "￿" + (p.title || "")) + " " + (p.year || "")).toLowerCase();
}

function htmlToText(html) {
  var d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent.replace(/\s+/g, " ").trim();
}

var BIB_OUT_TYPES = {
  article: "article", inproceedings: "inproceedings", incollection: "incollection",
  book: "book", report: "techreport", thesis: "phdthesis", preprint: "misc",
  dataset: "misc", webpage: "online", misc: "misc"
};

function bibtexEscape(s) {
  return String(s == null ? "" : s).replace(/([&%$#_])/g, "\\$1");
}

function toBibtex(p) {
  var kind = BIB_OUT_TYPES[p.type] || "misc";
  var f = [];
  function add(k, v) { if (v && String(v).trim()) f.push("  " + k + " = {" + bibtexEscape(String(v).trim()) + "}"); }
  add("title", p.title);
  if (p.authors && p.authors.length) add("author", p.authors.join(" and "));
  if (p.editors && p.editors.length) add("editor", p.editors.join(" and "));
  add("year", p.year);
  if (p.type === "article" || p.type === "preprint") add("journal", p.container);
  else if (p.type === "inproceedings" || p.type === "incollection") add("booktitle", p.container);
  else add("series", p.container);
  add("volume", p.volume);
  add("number", p.issue);
  add("pages", String(p.pages || "").replace(/[–—]/g, "--"));
  add("publisher", p.publisher);
  if (kind === "techreport" || kind === "phdthesis") add("institution", p.institution);
  add("doi", p.doi);
  add("url", p.url);
  if (p.tags && p.tags.length) add("keywords", p.tags.join(", "));
  return "@" + kind + "{" + p.id + ",\n" + f.join(",\n") + "\n}";
}

var CSL_OUT_TYPES = {
  article: "article-journal", inproceedings: "paper-conference", incollection: "chapter",
  book: "book", report: "report", thesis: "thesis", preprint: "article",
  dataset: "dataset", webpage: "webpage", misc: "document"
};

function nameToCSL(raw) {
  var n = parseName(raw);
  if (!n) return null;
  if (n.literal || !n.given) return { literal: n.family };
  return { family: n.family, given: n.given };
}

function toCSL(p) {
  var o = { id: p.id, type: CSL_OUT_TYPES[p.type] || "document", title: p.title };
  if (p.authors && p.authors.length) o.author = p.authors.map(nameToCSL).filter(Boolean);
  if (p.editors && p.editors.length) o.editor = p.editors.map(nameToCSL).filter(Boolean);
  if (p.year) o.issued = { "date-parts": [[parseInt(p.year, 10)]] };
  if (p.container) o["container-title"] = p.container;
  if (p.volume) o.volume = String(p.volume);
  if (p.issue) o.issue = String(p.issue);
  if (p.pages) o.page = String(p.pages).replace(/[–—]/g, "-");
  if (p.publisher) o.publisher = p.publisher;
  if (p.institution) o.publisher = p.institution;
  if (p.doi) o.DOI = p.doi;
  if (p.url) o.URL = p.url;
  if (p.tags && p.tags.length) o.keyword = p.tags.join(", ");
  return o;
}

/* ==========================================================================
   UI
   ========================================================================== */

var PUBLIC_WARNING =
  "This page is public. Keep participant data, unpublished results, and anything " +
  "personal out of it — notes here are for why a source matters to the project.";

var State = {
  q: "",
  statuses: {},
  types: {},
  tags: {},
  yearMin: "",
  yearMax: "",
  sort: "year-desc",
  selected: {}
};

function selectedIds() { return Object.keys(State.selected).filter(function (k) { return State.selected[k]; }); }
function anyOn(obj) { for (var k in obj) if (obj[k]) return true; return false; }

/* ------------------------------------------------------------ search bits */

function tokens(q) {
  return String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
}
function haystack(p) {
  if (p._hay) return p._hay;
  p._hay = [p.id, p.title, (p.authors || []).join(" "), (p.editors || []).join(" "), p.year,
            p.container, p.publisher, p.institution, (p.tags || []).join(" "), p.status,
            p.doi, p.notes].join("  ").toLowerCase();
  return p._hay;
}
function matches(p, toks) {
  var h = haystack(p);
  for (var i = 0; i < toks.length; i++) if (h.indexOf(toks[i]) === -1) return false;
  return true;
}
function hl(text, toks) {
  var out = esc(text);
  if (!toks.length) return out;
  var re = new RegExp("(" + toks.map(function (t) {
    return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") + ")", "gi");
  return out.replace(re, "<mark>$1</mark>");
}
function snippet(p, toks) {
  if (!toks.length || !p.notes) return "";
  var plain = String(p.notes).replace(/[*_#>`\[\]]/g, "").replace(/\s+/g, " ");
  var low = plain.toLowerCase(), at = -1;
  for (var i = 0; i < toks.length; i++) { at = low.indexOf(toks[i]); if (at > -1) break; }
  if (at === -1) return "";
  var s = Math.max(0, at - 90), e = Math.min(plain.length, at + 150);
  return (s > 0 ? "…" : "") + plain.slice(s, e).trim() + (e < plain.length ? "…" : "");
}

/* ---------------------------------------------------------------- filters */

function filtered() {
  var toks = tokens(State.q);
  var ymin = parseInt(State.yearMin, 10), ymax = parseInt(State.yearMax, 10);
  var list = Store.papers.filter(function (p) {
    if (anyOn(State.statuses) && !State.statuses[p.status]) return false;
    if (anyOn(State.types) && !State.types[p.type]) return false;
    if (anyOn(State.tags)) {
      var ok = (p.tags || []).some(function (t) { return State.tags[t]; });
      if (!ok) return false;
    }
    var y = parseInt(p.year, 10);
    if (!isNaN(ymin) && (isNaN(y) || y < ymin)) return false;
    if (!isNaN(ymax) && (isNaN(y) || y > ymax)) return false;
    if (toks.length && !matches(p, toks)) return false;
    return true;
  });

  var s = State.sort;
  list.sort(function (a, b) {
    if (s === "year-desc") return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0) ||
                                  apaSortKey(a).localeCompare(apaSortKey(b));
    if (s === "year-asc")  return (parseInt(a.year, 10) || 0) - (parseInt(b.year, 10) || 0) ||
                                  apaSortKey(a).localeCompare(apaSortKey(b));
    if (s === "author-asc") return apaSortKey(a).localeCompare(apaSortKey(b));
    if (s === "title-asc") return String(a.title).localeCompare(String(b.title));
    if (s === "added-desc") return String(b.added || "").localeCompare(String(a.added || "")) ||
                                   String(a.title).localeCompare(String(b.title));
    return 0;
  });
  return list;
}

/* ---------------------------------------------------------------- facets  */

function renderFacet(container, entries, bucket, labelFn) {
  container.textContent = "";
  entries.forEach(function (e) {
    var key = e[0], n = e[1];
    var b = el("button", {
      class: "chip" + (bucket[key] ? " on" : ""),
      type: "button",
      onclick: function () { bucket[key] = !bucket[key]; render(); }
    });
    b.appendChild(document.createTextNode(labelFn ? labelFn(key) : key));
    b.appendChild(el("span", { class: "n", text: String(n) }));
    container.appendChild(b);
  });
  if (!entries.length) container.appendChild(el("span", { class: "sidenote", text: "none yet" }));
}

function countBy(list, pick) {
  var m = {};
  list.forEach(function (p) {
    var vals = pick(p);
    (Array.isArray(vals) ? vals : [vals]).forEach(function (v) {
      if (v) m[v] = (m[v] || 0) + 1;
    });
  });
  return m;
}

function renderFacets() {
  var all = Store.papers;
  var sc = countBy(all, function (p) { return p.status; });
  renderFacet($("facetStatus"), STATUSES.filter(function (s) { return sc[s[0]] || State.statuses[s[0]]; })
    .map(function (s) { return [s[0], sc[s[0]] || 0]; }), State.statuses, statusLabel);

  var tc = countBy(all, function (p) { return p.type; });
  renderFacet($("facetType"), TYPES.filter(function (t) { return tc[t[0]] || State.types[t[0]]; })
    .map(function (t) { return [t[0], tc[t[0]] || 0]; }), State.types, typeLabel);

  // The tag list grows without bound, and on a phone it would push the papers
  // off the screen, so only the commonest are shown until asked for.
  var gc = countBy(all, function (p) { return p.tags; });
  var tags = Object.keys(gc).sort(function (a, b) { return gc[b] - gc[a] || a.localeCompare(b); })
    .map(function (k) { return [k, gc[k]]; });
  var TAG_CAP = 12;
  var shownTags = State.allTags ? tags
    : tags.filter(function (t, i) { return i < TAG_CAP || State.tags[t[0]]; });
  renderFacet($("facetTags"), shownTags, State.tags);
  if (tags.length > TAG_CAP) {
    $("facetTags").appendChild(el("button", {
      class: "chip", type: "button",
      text: State.allTags ? "Show fewer" : "Show all " + tags.length,
      onclick: function () { State.allTags = !State.allTags; render(); }
    }));
  }
}

/* ------------------------------------------------------------------ list  */

function metaLine(p) {
  var bits = [];
  var names = (p.authors || []).map(function (r) { var n = parseName(r); return n ? n.family : ""; }).filter(Boolean);
  if (names.length) bits.push(names.length > 3 ? names.slice(0, 3).join(", ") + " et al." : names.join(", "));
  else bits.push("No author listed");
  if (p.year) bits.push(String(p.year));
  return bits.join(" · ");
}

function render() {
  renderFacets();
  var list = filtered();
  var toks = tokens(State.q);
  var box = $("list");
  box.textContent = "";

  list.forEach(function (p) {
    var cb = el("input", { type: "checkbox" });
    cb.checked = !!State.selected[p.id];
    cb.addEventListener("change", function () {
      State.selected[p.id] = cb.checked;
      updateCounts(list);
    });

    var title = el("button", { class: "card-title", type: "button",
      html: hl(p.title, toks), onclick: function () { openDetail(p.id); } });

    var meta = el("p", { class: "card-meta" });
    meta.innerHTML = hl(metaLine(p), toks) +
      (p.container ? " · <em>" + hl(p.container, toks) + "</em>" : "");

    var row = el("div", { class: "card-row" }, [
      el("span", { class: "pill pill-" + p.status, text: statusLabel(p.status) })
    ]);
    (p.tags || []).forEach(function (t) {
      row.appendChild(el("button", { class: "tag", type: "button", text: t,
        onclick: function (ev) { ev.stopPropagation(); State.tags[t] = !State.tags[t]; render(); } }));
    });

    var main = el("div", { class: "card-main" }, [title, meta, row]);
    var sn = snippet(p, toks);
    if (sn) main.appendChild(el("p", { class: "snippet", html: hl(sn, toks) }));

    box.appendChild(el("div", { class: "card" }, [el("div", null, cb), main]));
  });

  var empty = $("empty");
  if (!list.length) {
    empty.hidden = false;
    empty.textContent = Store.papers.length
      ? "No papers match these filters."
      : "No papers yet — use Add paper or Import to start.";
  } else empty.hidden = true;

  updateCounts(list);
}

function updateCounts(list) {
  var sel = selectedIds();
  $("countLabel").textContent = list.length + " of " + Store.papers.length +
    (Store.papers.length === 1 ? " paper" : " papers");
  var allOn = list.length > 0 && list.every(function (p) { return State.selected[p.id]; });
  $("selAll").checked = allOn;
  $("selAll").indeterminate = !allOn && list.some(function (p) { return State.selected[p.id]; });
  $("selbar").hidden = sel.length === 0;
  $("selCount").textContent = sel.length + (sel.length === 1 ? " paper selected" : " papers selected");
}

/* ----------------------------------------------------------------- sheet  */

function openSheet(node) {
  var body = $("sheetBody");
  body.textContent = "";
  body.appendChild(node);
  $("overlay").hidden = false;
  document.body.style.overflow = "hidden";
  $("sheet").scrollIntoView();
  var f = body.querySelector("input, select, textarea, button");
  if (f && !f.classList.contains("card-title")) setTimeout(function () { f.focus(); }, 30);
}
function closeSheet() {
  $("overlay").hidden = true;
  $("sheetBody").textContent = "";
  document.body.style.overflow = "";
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

/* ---------------------------------------------------------------- detail  */

function openDetail(id) {
  var p = Store.byId[id];
  if (!p) { toast("No paper with id " + id, true); return; }
  history.replaceState(null, "", "#" + encodeURIComponent(id));

  var head = el("div", { class: "detail-head" }, [
    el("h2", { text: p.title }),
    el("p", { class: "detail-cite", html: apaRef(p) })
  ]);

  var links = el("div", { class: "detail-links" });
  if (p.doi) links.appendChild(el("a", { href: "https://doi.org/" + p.doi, target: "_blank", rel: "noopener noreferrer", text: "DOI ↗" }));
  if (safeUrl(p.url)) links.appendChild(el("a", { href: safeUrl(p.url), target: "_blank", rel: "noopener noreferrer", text: "Link ↗" }));
  links.appendChild(el("a", {
    href: "https://github.com/" + CFG.owner + "/" + CFG.repo + "/blob/" + CFG.branch + "/" + CFG.dir + "/" + (p._file || p.id + ".md"),
    target: "_blank", rel: "noopener noreferrer", text: "File on GitHub ↗"
  }));
  links.appendChild(el("a", {
    href: "https://github.com/" + CFG.owner + "/" + CFG.repo + "/commits/" + CFG.branch + "/" + CFG.dir + "/" + (p._file || p.id + ".md"),
    target: "_blank", rel: "noopener noreferrer", text: "History ↗"
  }));
  head.appendChild(links);

  var kv = el("table", { class: "kv" });
  function row(k, v) {
    if (!v || (Array.isArray(v) && !v.length)) return;
    var td = el("td");
    td.textContent = Array.isArray(v) ? v.join("; ") : String(v);
    kv.appendChild(el("tr", null, [el("th", { text: k }), td]));
  }
  row("Type", typeLabel(p.type));
  row("Status", statusLabel(p.status));
  row("Authors", p.authors);
  row("Editors", p.editors);
  row("Year", p.year);
  row(CONTAINER_LABEL[p.type] || "Container", p.container);
  row("Volume", p.volume);
  row("Issue", p.issue);
  row("Pages", p.pages);
  row("Publisher", p.publisher);
  row("Institution", p.institution);
  row("Accessed", p.accessed);
  row("Citation key", p.id);
  row("Added", [p.added, p.added_by ? "by " + p.added_by : ""].filter(Boolean).join(" "));

  if (p.tags && p.tags.length) {
    var tagCell = el("td", { class: "card-row" });
    p.tags.forEach(function (t) {
      tagCell.appendChild(el("button", { class: "tag", type: "button", text: t, onclick: function () {
        closeSheet(); State.tags[t] = true; render();
      } }));
    });
    kv.appendChild(el("tr", null, [el("th", { text: "Tags" }), tagCell]));
  }

  var notes = el("div", { class: "notes" }, [
    el("h3", { text: "Why this is in the bibliography" }),
    el("div", { class: "md", html: p.notes ? renderMd(p.notes) : "<p><em>No notes yet.</em></p>" })
  ]);
  notes.querySelectorAll("[data-xref]").forEach(function (n) {
    n.addEventListener("click", function () {
      var target = n.getAttribute("data-xref");
      if (Store.byId[target]) openDetail(target);
    });
  });

  var actions = el("div", { class: "detail-actions" }, [
    el("button", { class: "btn btn-primary", type: "button", text: "Edit", onclick: function () { openEditor(p); } }),
    el("button", { class: "btn", type: "button", text: "Copy APA", onclick: function () {
      copyRich("<p>" + apaRef(p) + "</p>", htmlToText(apaRef(p)));
    } }),
    el("button", { class: "btn", type: "button", text: "Copy BibTeX", onclick: function () {
      copyPlain(toBibtex(p));
    } })
  ]);

  openSheet(el("div", null, [head, kv, notes, actions]));
}

/* ---------------------------------------------------------------- editor  */

function fieldRow(label, name, value, opts) {
  opts = opts || {};
  var input;
  if (opts.textarea) {
    input = el("textarea", { name: name, rows: opts.rows || 3, class: opts.mono ? "code" : "" });
    input.value = value || "";
  } else if (opts.options) {
    input = el("select", { name: name });
    opts.options.forEach(function (o) {
      var op = el("option", { value: o[0], text: o[1] });
      if (o[0] === value) op.selected = true;
      input.appendChild(op);
    });
  } else {
    input = el("input", { name: name, type: opts.type || "text", placeholder: opts.placeholder || "" });
    input.value = value == null ? "" : String(value);
  }
  var lab = el("label", { text: label });
  if (opts.hint) lab.appendChild(el("span", { class: "hint", text: " — " + opts.hint }));
  return el("div", { class: "fg" + (opts.wide ? " wide" : "") }, [lab, input]);
}

function openEditor(existing) {
  var p = existing || {};
  var isNew = !existing;

  var form = el("form", { class: "editform", onsubmit: function (e) { e.preventDefault(); } });
  var grid = el("div", { class: "form-grid" });

  grid.appendChild(fieldRow("Title", "title", p.title, { wide: true }));
  grid.appendChild(fieldRow("Authors", "authors", (p.authors || []).join("\n"),
    { textarea: true, rows: 3, wide: true, hint: "one per line, “Family, Given”; wrap an organisation in {braces}" }));
  grid.appendChild(fieldRow("Type", "type", p.type || "article", { options: TYPES }));
  grid.appendChild(fieldRow("Status", "status", p.status || "to-read", { options: STATUSES }));
  grid.appendChild(fieldRow("Year", "year", p.year,
    { type: "text", placeholder: "2024", hint: "or a full date for news and web items: 2025, July 2" }));
  var containerRow = fieldRow(CONTAINER_LABEL[p.type || "article"] || "Container", "container", p.container);
  grid.appendChild(containerRow);
  grid.appendChild(fieldRow("Volume", "volume", p.volume));
  grid.appendChild(fieldRow("Issue / number", "issue", p.issue));
  grid.appendChild(fieldRow("Pages", "pages", p.pages, { placeholder: "10–24" }));
  grid.appendChild(fieldRow("Publisher", "publisher", p.publisher));
  grid.appendChild(fieldRow("Institution / school", "institution", p.institution));
  grid.appendChild(fieldRow("DOI", "doi", p.doi, { placeholder: "10.1000/xyz123" }));
  grid.appendChild(fieldRow("URL", "url", p.url));
  grid.appendChild(fieldRow("Accessed", "accessed", p.accessed, { placeholder: "2026-09-08" }));
  grid.appendChild(fieldRow("Editors", "editors", (p.editors || []).join("\n"),
    { textarea: true, rows: 2, wide: true, hint: "one per line; for chapters and proceedings" }));
  grid.appendChild(fieldRow("Tags", "tags", (p.tags || []).join(", "),
    { wide: true, hint: "comma separated" }));
  grid.appendChild(fieldRow("Notes — why this matters to the project", "notes", p.notes,
    { textarea: true, rows: 12, wide: true, hint: "Markdown; [[paper-id]] links to another entry" }));
  grid.appendChild(fieldRow("Citation key", "id", p.id, { wide: true, hint: "the filename; leave blank to generate one" }));

  form.appendChild(grid);

  // form.title and form.id would resolve to the element's own DOM properties
  // rather than to the inputs, so every field goes through namedItem.
  function fld(name) { return form.elements.namedItem(name); }

  // Retitle the container field when the type changes, so the label always
  // says what actually belongs there.
  fld("type").addEventListener("change", function () {
    containerRow.querySelector("label").firstChild.nodeValue = CONTAINER_LABEL[fld("type").value] || "Container";
  });

  var errBox = el("p", { class: "err" });
  var actions = el("div", { class: "form-actions" });

  if (Auth.canWrite) {
    actions.appendChild(el("button", { class: "btn btn-primary", type: "button", text: isNew ? "Add paper" : "Save changes",
      onclick: function (e) { submit(e.target); } }));
  } else {
    actions.appendChild(el("button", { class: "btn btn-primary", type: "button", text: "Open GitHub editor",
      onclick: function () {
        var built = collect();
        if (!built) return;
        var file = CFG.dir + "/" + built.id + ".md";
        var url = isNew
          ? "https://github.com/" + CFG.owner + "/" + CFG.repo + "/new/" + CFG.branch +
            "?filename=" + encodeURIComponent(file) + "&value=" + encodeURIComponent(toMarkdown(built))
          : "https://github.com/" + CFG.owner + "/" + CFG.repo + "/edit/" + CFG.branch + "/" + file;
        if (!isNew) copyPlain(toMarkdown(built), "File text copied — paste it over the editor contents.");
        window.open(url, "_blank", "noopener");
      } }));
    actions.appendChild(el("button", { class: "btn", type: "button", text: "Copy Markdown",
      onclick: function () { var b = collect(); if (b) copyPlain(toMarkdown(b)); } }));
  }
  actions.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: closeSheet }));
  if (!isNew && Auth.canWrite) {
    actions.appendChild(el("span", { class: "grow" }));
    actions.appendChild(el("button", { class: "btn btn-danger", type: "button", text: "Delete",
      onclick: function () {
        if (!confirm("Delete “" + p.title + "” from the bibliography?\n\nIt stays in the repository history and can be restored.")) return;
        Store.remove(p).then(function () {
          closeSheet(); render(); toast("Deleted.");
        }).catch(function (e) { toast(e.message, true); });
      } }));
  }
  form.appendChild(actions);
  form.appendChild(errBox);

  function collect() {
    errBox.textContent = "";
    var v = function (name) { return String(fld(name).value || "").trim(); };
    var lines = function (name) {
      return String(fld(name).value || "").split("\n")
        .map(function (s) { return s.trim(); }).filter(Boolean);
    };
    var built = {
      id: slug(v("id")),
      type: v("type"),
      title: v("title"),
      authors: lines("authors"),
      editors: lines("editors"),
      year: v("year"),
      container: v("container"),
      volume: v("volume"),
      issue: v("issue"),
      pages: v("pages"),
      publisher: v("publisher"),
      institution: v("institution"),
      doi: v("doi").replace(/^https?:\/\/(dx\.)?doi\.org\//, ""),
      url: v("url"),
      accessed: v("accessed"),
      tags: v("tags").split(",").map(function (t) { return slug(t); }).filter(Boolean),
      status: v("status"),
      added: p.added || today(),
      added_by: p.added_by || Auth.login || "",
      notes: fld("notes").value
    };
    if (!built.title) { errBox.textContent = "A title is required."; return null; }
    if (!built.id) built.id = makeId(built, {});
    var clash = Store.byId[built.id];
    if (clash && clash !== existing) {
      errBox.textContent = "Citation key “" + built.id + "” is already used by another paper. Pick a different one.";
      return null;
    }
    return built;
  }

  function submit(btn) {
    var built = collect();
    if (!built) return;
    var renamed = existing && existing.id !== built.id;
    var old = existing;
    if (existing && !renamed) { built._sha = existing._sha; built._file = existing._file; }
    btn.disabled = true;
    btn.textContent = "Saving…";
    Store.save(built, (isNew ? "Add " : "Update ") + built.id)
      .then(function () {
        if (renamed) {
          return Store.remove(old).catch(function () { /* orphan file is harmless */ });
        }
      })
      .then(function () {
        closeSheet();
        render();
        toast(isNew ? "Added “" + built.title + "”" : "Saved.");
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = isNew ? "Add paper" : "Save changes";
        errBox.textContent = e.message;
      });
  }

  var wrap = el("div", null, [
    el("h2", { text: isNew ? "Add a paper" : "Edit paper" }),
    el("p", { class: "sheet-sub", text: PUBLIC_WARNING })
  ]);
  if (!Auth.canWrite) {
    wrap.appendChild(el("p", { class: "banner", style: "border-radius:8px;border:0;margin-bottom:16px",
      text: "You are not signed in with a token, so this will open GitHub's own editor instead of saving directly." }));
  }
  wrap.appendChild(form);
  openSheet(wrap);
}

/* ---------------------------------------------------------------- import  */

function normalizeTitle(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findDuplicate(item) {
  var nt = normalizeTitle(item.title);
  for (var i = 0; i < Store.papers.length; i++) {
    var p = Store.papers[i];
    if (item.doi && p.doi && item.doi.toLowerCase() === String(p.doi).toLowerCase()) return p;
    if (nt && normalizeTitle(p.title) === nt) return p;
  }
  return null;
}

function openImport() {
  var wrap = el("div", null, [
    el("h2", { text: "Import references" }),
    el("p", { class: "sheet-sub", text: "BibTeX (.bib), RIS (.ris), or CSL-JSON (.json) — the export formats Zotero, Mendeley, EndNote, and Google Scholar all produce." })
  ]);

  var fileInput = el("input", { type: "file", multiple: true, accept: ".bib,.bibtex,.ris,.json,.txt,text/plain,application/json", style: "display:none" });
  var zone = el("div", { class: "dropzone" }, [
    el("strong", { text: "Drop files here, or click to choose" }),
    el("small", { text: "You can drop several at once." })
  ]);
  zone.addEventListener("click", function () { fileInput.click(); });
  ["dragenter", "dragover"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("hot"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("hot"); });
  });
  zone.addEventListener("drop", function (e) { readFiles(e.dataTransfer.files); });
  fileInput.addEventListener("change", function () { readFiles(fileInput.files); });

  var pasteWrap = fieldRow("Or paste entries", "paste", "", { textarea: true, rows: 6, mono: true, wide: true,
    hint: "BibTeX, RIS, or CSL-JSON" });
  var pasteBtn = el("button", { class: "btn", type: "button", text: "Read pasted text", onclick: function () {
    var v = pasteWrap.querySelector("textarea").value.trim();
    if (!v) return;
    try { ingest(sniffAndParse(v, "")); } catch (e) { toast(e.message, true); }
  } });

  var prev = el("div");
  var staged = [];

  var commonTags = fieldRow("Tags to add to everything imported", "ctags", "", { hint: "comma separated" });
  var commonStatus = fieldRow("Status for imported papers", "cstatus", "to-read", { options: STATUSES });
  var opts = el("div", { class: "form-grid", style: "margin-top:18px" }, [commonTags, commonStatus]);
  opts.hidden = true;

  var goRow = el("div", { class: "form-actions" });
  goRow.hidden = true;
  var goBtn = el("button", { class: "btn btn-primary", type: "button", text: "Import" });
  var progress = el("span", { class: "sidenote" });
  goRow.appendChild(goBtn);
  goRow.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: closeSheet }));
  goRow.appendChild(progress);

  function readFiles(files) {
    Array.prototype.slice.call(files || []).forEach(function (f) {
      var r = new FileReader();
      r.onload = function () {
        try { ingest(sniffAndParse(String(r.result), f.name), f.name); }
        catch (e) { toast(f.name + ": " + e.message, true); }
      };
      r.readAsText(f);
    });
  }

  function ingest(result, filename) {
    if (!result.items.length) {
      toast("No references found in that " + result.kind + (filename ? " file" : " text") + ".", true);
      return;
    }
    var taken = {};
    Store.papers.forEach(function (p) { taken[p.id] = true; });
    staged.forEach(function (s) { taken[s.item.id] = true; });
    result.items.forEach(function (item) {
      item.id = item._key && !taken[slug(item._key)] ? slug(item._key) : makeId(item, taken);
      taken[item.id] = true;
      delete item._key;
      staged.push({ item: item, dup: findDuplicate(item), keep: !findDuplicate(item) });
    });
    toast("Read " + result.items.length + " " + result.kind + " " +
          (result.items.length === 1 ? "entry" : "entries") + ".");
    drawPreview();
  }

  function drawPreview() {
    prev.textContent = "";
    if (!staged.length) { opts.hidden = true; goRow.hidden = true; return; }
    opts.hidden = false;
    goRow.hidden = false;
    var box = el("div", { class: "prev" });
    staged.forEach(function (s) {
      var cb = el("input", { type: "checkbox" });
      cb.checked = s.keep;
      cb.addEventListener("change", function () { s.keep = cb.checked; updateGo(); });
      var info = el("div", null, [
        el("div", { class: "prev-t", text: s.item.title }),
        el("div", { class: "prev-m", text: [shortNames(s.item.authors), s.item.year, s.item.container,
                                            typeLabel(s.item.type)].filter(Boolean).join(" · ") }),
        el("div", { class: "prev-m", text: "key: " + s.item.id })
      ]);
      if (s.dup) info.appendChild(el("div", { class: "prev-flag",
        text: "Looks like a duplicate of “" + s.dup.title + "” — unticked by default." }));
      box.appendChild(el("div", { class: "prev-item" + (s.dup ? " dup" : "") }, [el("div", null, cb), info]));
    });
    prev.appendChild(el("h3", { class: "subhead", style: "margin-top:20px", text: "Ready to import" }));
    prev.appendChild(box);
    updateGo();
  }

  function updateGo() {
    var n = staged.filter(function (s) { return s.keep; }).length;
    goBtn.textContent = "Import " + n + (n === 1 ? " paper" : " papers");
    goBtn.disabled = n === 0;
  }

  goBtn.addEventListener("click", function () {
    if (!Auth.canWrite) {
      toast("Add a collaborator token first (the button in the top right) — importing writes to the repository.", true);
      openAuth();
      return;
    }
    var picked = staged.filter(function (s) { return s.keep; }).map(function (s) { return s.item; });
    var tagsExtra = commonTags.querySelector("input").value.split(",").map(function (t) { return slug(t); }).filter(Boolean);
    var st = commonStatus.querySelector("select").value;
    goBtn.disabled = true;
    var done = 0, failures = [];

    // Sequential: the Contents API serializes commits on a branch anyway, and
    // parallel writes just collide.
    var chain = Promise.resolve();
    picked.forEach(function (item) {
      chain = chain.then(function () {
        item.status = st;
        item.tags = (item.tags || []).concat(tagsExtra).filter(function (v, i, a) { return a.indexOf(v) === i; });
        item.added = today();
        item.added_by = Auth.login || "";
        return Store.save(item, "Add " + item.id)
          .then(function () { done++; })
          .catch(function (e) { failures.push(item.id + ": " + e.message); });
      }).then(function () {
        progress.textContent = "  " + (done + failures.length) + " of " + picked.length + "…";
      });
    });
    chain.then(function () {
      render();
      closeSheet();
      if (failures.length) toast("Imported " + done + ", failed " + failures.length + ". " + failures[0], true);
      else toast("Imported " + done + (done === 1 ? " paper." : " papers."));
    });
  });

  wrap.appendChild(zone);
  wrap.appendChild(fileInput);
  wrap.appendChild(el("div", { class: "form-grid", style: "margin-top:18px" }, [pasteWrap]));
  wrap.appendChild(el("div", { style: "margin-top:8px" }, [pasteBtn]));
  wrap.appendChild(prev);
  wrap.appendChild(opts);
  wrap.appendChild(goRow);
  openSheet(wrap);
}

/* ---------------------------------------------------------------- export  */

function copyPlain(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast(msg || "Copied."); },
      function () { fallbackCopy(text, msg); });
  } else fallbackCopy(text, msg);
}
function fallbackCopy(text, msg) {
  var ta = el("textarea", { style: "position:fixed;opacity:0" });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); toast(msg || "Copied."); }
  catch (e) { toast("Could not copy — select the text and copy it manually.", true); }
  document.body.removeChild(ta);
}
// Copies with italics intact, so pasting into Word or Google Docs keeps them.
function copyRich(html, text) {
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" })
    })]).then(function () { toast("Copied with formatting."); }, function () { copyPlain(text); });
  } else copyPlain(text);
}
function download(name, text, mime) {
  var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = el("a", { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function openExport() {
  var shown = filtered();
  var sel = selectedIds().map(function (id) { return Store.byId[id]; }).filter(Boolean);
  var scope = sel.length ? "selected" : "shown";
  var format = "apa";

  var wrap = el("div", null, [
    el("h2", { text: "Export a reference list" }),
    el("p", { class: "sheet-sub", text: "APA 7 output is sorted alphabetically and formatted with a hanging indent. Copying keeps the italics." })
  ]);

  var scopeRow = el("div", { class: "chips", style: "margin-bottom:16px" });
  var scopes = [
    ["selected", "Selected (" + sel.length + ")", sel.length > 0],
    ["shown", "Matching current filters (" + shown.length + ")", true],
    ["all", "Everything (" + Store.papers.length + ")", true]
  ];
  scopes.forEach(function (s) {
    if (!s[2]) return;
    var b = el("button", { class: "chip" + (scope === s[0] ? " on" : ""), type: "button", text: s[1],
      onclick: function () {
        scope = s[0];
        Array.prototype.forEach.call(scopeRow.children, function (c) { c.classList.remove("on"); });
        b.classList.add("on");
        draw();
      } });
    scopeRow.appendChild(b);
  });

  var tabs = el("div", { class: "tabs" });
  [["apa", "APA 7"], ["bibtex", "BibTeX"], ["csl", "CSL-JSON"]].forEach(function (t) {
    var b = el("button", { class: "tab" + (format === t[0] ? " on" : ""), type: "button", text: t[1],
      onclick: function () {
        format = t[0];
        Array.prototype.forEach.call(tabs.children, function (c) { c.classList.remove("on"); });
        b.classList.add("on");
        draw();
      } });
    tabs.appendChild(b);
  });

  var preview = el("div", { class: "refpage" });
  var actions = el("div", { class: "form-actions" });

  function current() {
    if (scope === "selected") return sel;
    if (scope === "shown") return shown;
    return Store.papers.slice();
  }

  function draw() {
    var list = current().slice();
    actions.textContent = "";
    if (!list.length) {
      preview.innerHTML = "<p>Nothing to export.</p>";
      return;
    }
    if (format === "apa") {
      list.sort(function (a, b) { return apaSortKey(a).localeCompare(apaSortKey(b)); });
      var html = list.map(function (p) { return "<p>" + apaRef(p) + "</p>"; }).join("");
      preview.innerHTML = html;
      var text = list.map(function (p) { return htmlToText(apaRef(p)); }).join("\n\n");
      actions.appendChild(el("button", { class: "btn btn-primary", type: "button", text: "Copy (keeps italics)",
        onclick: function () { copyRich(html, text); } }));
      actions.appendChild(el("button", { class: "btn", type: "button", text: "Copy plain text",
        onclick: function () { copyPlain(text); } }));
      actions.appendChild(el("button", { class: "btn", type: "button", text: "Download .html",
        onclick: function () { download("references.html", apaDocument(html), "text/html;charset=utf-8"); } }));
      actions.appendChild(el("button", { class: "btn", type: "button", text: "Download .txt",
        onclick: function () { download("references.txt", text); } }));
    } else if (format === "bibtex") {
      list.sort(function (a, b) { return a.id.localeCompare(b.id); });
      var bib = list.map(toBibtex).join("\n\n") + "\n";
      preview.innerHTML = "<pre>" + esc(bib) + "</pre>";
      actions.appendChild(el("button", { class: "btn btn-primary", type: "button", text: "Copy",
        onclick: function () { copyPlain(bib); } }));
      actions.appendChild(el("button", { class: "btn", type: "button", text: "Download .bib",
        onclick: function () { download("references.bib", bib, "application/x-bibtex;charset=utf-8"); } }));
    } else {
      list.sort(function (a, b) { return a.id.localeCompare(b.id); });
      var json = JSON.stringify(list.map(toCSL), null, 2);
      preview.innerHTML = "<pre>" + esc(json) + "</pre>";
      actions.appendChild(el("button", { class: "btn btn-primary", type: "button", text: "Copy",
        onclick: function () { copyPlain(json); } }));
      actions.appendChild(el("button", { class: "btn", type: "button", text: "Download .json",
        onclick: function () { download("references.json", json, "application/json;charset=utf-8"); } }));
    }
    actions.appendChild(el("button", { class: "btn btn-ghost", type: "button", text: "Close", onclick: closeSheet }));
  }

  wrap.appendChild(scopeRow);
  wrap.appendChild(tabs);
  wrap.appendChild(preview);
  wrap.appendChild(actions);
  openSheet(wrap);
  draw();
}

function apaDocument(inner) {
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>References</title><style>" +
    "body{font:12pt/2 'Times New Roman',Times,serif;max-width:6.5in;margin:1in auto;padding:0 16px}" +
    "h1{font-size:12pt;font-weight:700;text-align:center;margin:0 0 2em}" +
    "p{margin:0 0 1em;padding-left:0.5in;text-indent:-0.5in}" +
    "</style></head><body><h1>References</h1>" + inner + "</body></html>";
}

/* ------------------------------------------------------------------ auth  */

function openAuth() {
  var wrap = el("div", null, [el("h2", { text: "Collaborator access" })]);

  if (Auth.canWrite) {
    wrap.appendChild(el("p", { class: "sheet-sub",
      text: "Signed in as " + (Auth.login || "your token") + " with write access. Your token is kept in this browser only — it is never sent anywhere except GitHub. Sign out here if you are on a shared machine." }));
    wrap.appendChild(el("div", { class: "form-actions" }, [
      el("button", { class: "btn", type: "button", text: "Sign out of this browser", onclick: function () {
        Auth.remember("");
        Auth.canWrite = false;
        Auth.login = "";
        paintAuth();
        closeSheet();
        toast("Token removed from this browser.");
      } }),
      el("button", { class: "btn btn-ghost", type: "button", text: "Close", onclick: closeSheet })
    ]));
    openSheet(wrap);
    return;
  }

  wrap.appendChild(el("p", { class: "sheet-sub",
    text: "Anyone can read this bibliography. Editing needs a GitHub token from an account with collaborator access to the repository." }));

  // Fine-grained tokens cannot reach a repository owned by another personal
  // account, even for a collaborator, so this repo uses classic tokens.
  var steps = el("div", { class: "md" });
  steps.innerHTML =
    "<ol>" +
    "<li>Ask Matias to add <em>your own</em> GitHub account as a collaborator on <code>" +
      esc(CFG.owner + "/" + CFG.repo) + "</code>.</li>" +
    "<li>Open <a href=\"https://github.com/settings/tokens/new?scopes=repo&description=" + esc(CFG.repo) +
      "\" target=\"_blank\" rel=\"noopener noreferrer\">github.com/settings/tokens/new</a> " +
      "\u2014 a <strong>classic</strong> token (Settings \u2192 Developer settings \u2192 " +
      "Personal access tokens \u2192 Tokens (classic)).</li>" +
    "<li>Tick the top-level <strong>repo</strong> scope. Nothing else is needed.</li>" +
    "<li>Set an expiry, generate it, and paste it below.</li>" +
    "</ol>" +
    "<p><strong>Make your own token \u2014 never use someone else's.</strong> Every edit is recorded " +
    "as whoever's token made it, and access is granted and revoked per person.</p>" +
    "<p>The token stays in this browser's local storage and is sent only to <code>api.github.com</code>. " +
    "A classic token cannot be narrowed to one repository \u2014 the <code>repo</code> scope reaches every " +
    "repository your account can access \u2014 so treat it like a password: give it an expiry, do not reuse " +
    "it elsewhere, and revoke it at <a href=\"https://github.com/settings/tokens\" target=\"_blank\" " +
    "rel=\"noopener noreferrer\">github.com/settings/tokens</a> when you are done with the project or if " +
    "you think it has leaked.</p>";
  wrap.appendChild(steps);

  var tokenField = fieldRow("Token", "token", "", { wide: true, placeholder: "ghp_…" });
  tokenField.querySelector("input").type = "password";
  wrap.appendChild(el("div", { class: "form-grid" }, [tokenField]));

  var err = el("p", { class: "err" });
  var btn = el("button", { class: "btn btn-primary", type: "button", text: "Verify and save" });
  btn.addEventListener("click", function () {
    var val = tokenField.querySelector("input").value.trim();
    if (!val) { err.textContent = "Paste a token first."; return; }
    err.textContent = "";
    btn.disabled = true;
    btn.textContent = "Checking…";
    Auth.remember(val);
    Auth.verify().then(function (ok) {
      btn.disabled = false;
      btn.textContent = "Verify and save";
      if (!ok) {
        Auth.remember("");
        err.textContent = "That token reached GitHub but does not have write access to this repository. " +
                          "Check that you have been added as a collaborator, and that the token has the repo scope.";
        paintAuth();
        return;
      }
      paintAuth();
      closeSheet();
      toast("Signed in as " + (Auth.login || "collaborator") + ".");
    }).catch(function (e) {
      Auth.remember("");
      btn.disabled = false;
      btn.textContent = "Verify and save";
      err.textContent = e.message;
      paintAuth();
    });
  });
  wrap.appendChild(el("div", { class: "form-actions" }, [btn,
    el("button", { class: "btn btn-ghost", type: "button", text: "Cancel", onclick: closeSheet }), err]));
  openSheet(wrap);
}

function paintAuth() {
  $("authDot").className = "dot" + (Auth.canWrite ? " live" : "");
  $("authLabel").textContent = Auth.canWrite ? (Auth.login || "Collaborator") : "Read-only";
  $("btnAuth").title = Auth.canWrite
    ? "Signed in with write access — click to sign out"
    : "Read-only — click to add a collaborator token";
}

/* ------------------------------------------------------------------ boot  */

function banner(msg, isError) {
  var b = $("banner");
  if (!msg) { b.hidden = true; return; }
  b.textContent = msg;
  b.className = "banner" + (isError ? " err" : "");
  b.hidden = false;
}

function wire() {
  $("repoLink").href = "https://github.com/" + CFG.owner + "/" + CFG.repo;

  var searchTimer;
  $("search").addEventListener("input", function (e) {
    clearTimeout(searchTimer);
    var v = e.target.value;
    searchTimer = setTimeout(function () { State.q = v; render(); }, 120);
  });
  $("sort").addEventListener("change", function (e) { State.sort = e.target.value; render(); });
  $("yearMin").addEventListener("input", function (e) { State.yearMin = e.target.value; render(); });
  $("yearMax").addEventListener("input", function (e) { State.yearMax = e.target.value; render(); });
  $("btnClear").addEventListener("click", function () {
    State.q = ""; State.statuses = {}; State.types = {}; State.tags = {};
    State.yearMin = ""; State.yearMax = "";
    $("search").value = ""; $("yearMin").value = ""; $("yearMax").value = "";
    render();
  });
  $("selAll").addEventListener("change", function (e) {
    var list = filtered();
    list.forEach(function (p) { State.selected[p.id] = e.target.checked; });
    render();
  });
  $("selClear").addEventListener("click", function () { State.selected = {}; render(); });
  $("selExport").addEventListener("click", openExport);
  $("btnExport").addEventListener("click", openExport);
  $("btnImport").addEventListener("click", openImport);
  $("btnAdd").addEventListener("click", function () { openEditor(null); });
  $("btnAuth").addEventListener("click", openAuth);
  $("sheetClose").addEventListener("click", closeSheet);
  $("overlay").addEventListener("mousedown", function (e) { if (e.target === $("overlay")) closeSheet(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("overlay").hidden) closeSheet();
    if (e.key === "/" && document.activeElement === document.body) { e.preventDefault(); $("search").focus(); }
  });
}

function boot() {
  wire();
  Auth.init();
  paintAuth();
  banner("Loading papers from GitHub…");

  Auth.verify().catch(function () { Auth.canWrite = false; }).then(paintAuth);

  Store.load().then(function (problems) {
    banner(problems.length
      ? problems.length + " file(s) could not be read: " + problems.join(" | ")
      : "", problems.length > 0);
    $("cacheNote").textContent = Store.papers.length
      ? "Reading " + CFG.dir + "/ at commit " + Store.head.slice(0, 7) +
        (Store.fromCache ? " · " + Store.fromCache + " cached locally" : "")
      : "";
    render();
    var hash = decodeURIComponent(String(location.hash || "").slice(1));
    if (hash && Store.byId[hash]) openDetail(hash);
  }).catch(function (e) {
    banner(e.message, true);
    render();
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();

// Exposed for the round-trip check in the README and for console debugging.
window.Bib = { Store: Store, parsePaper: parsePaper, toMarkdown: toMarkdown, apaRef: apaRef,
               parseBibtex: parseBibtex, parseRIS: parseRIS, parseCSLJSON: parseCSLJSON,
               toBibtex: toBibtex, toCSL: toCSL, renderMd: renderMd };

})();

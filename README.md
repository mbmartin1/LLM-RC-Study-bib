# LLM-RC-Study bibliography

Shared annotated bibliography for the LLM communicative-efficiency study

**Site: <https://mbmartin1.github.io/LLM-RC-Study-bib/>**


## What is here

```
papers/*.md    one file per source: metadata in frontmatter, relevance notes below
docs/          the site — index.html, style.css, app.js, config.js
```

`papers/` is the only source of truth. The site reads those files live from
GitHub and writes them back through the GitHub Contents API, so nothing is
generated, nothing is cached server-side, and nothing can go stale. Editing a
`.md` file directly on GitHub and using the site produce identical results.

## Using the site

- **Browse** — filter by status, type, tag, and year; search runs over titles,
  authors, containers, tags, and the notes. Press `/` to jump to the search box.
- **Add a paper** — fill in the form, or **Import** a `.bib`, `.ris`, or
  `.json` (CSL-JSON) file. Those are the export formats Zotero, Mendeley,
  EndNote, and Google Scholar all produce. Drop several files at once; likely
  duplicates are flagged and unticked before you commit anything.
- **Export** — tick the papers you want (or take everything matching the current
  filters) and produce an APA 7 reference page. Copying preserves italics, so it
  pastes into Word or Google Docs correctly. BibTeX and CSL-JSON come out of the
  same screen.
- **Cross-reference** — writing `[[some-paper-id]]` in the notes links to
  another entry.

## Getting edit access

Reading needs nothing. Writing needs a GitHub token from an account that is a
collaborator here:

1. Ask Matias to add your GitHub account as a collaborator on this repository.
2. Create a **fine-grained** personal access token at
   <https://github.com/settings/personal-access-tokens/new>.
3. Resource owner `mbmartin1`; repository access **Only select repositories →
   LLM-RC-Study-bib**.
4. Repository permissions: **Contents → Read and write**. Nothing else.
5. Set an expiry, generate, and paste it into the site's top-right button.

The token is held in your browser's local storage and is sent only to
`api.github.com`. GitHub — not the page — decides whether a write is allowed, so
a token from a non-collaborator cannot change anything. Scoped this way, the
worst case if it leaks is an unwanted edit here, which is reversible from the
repository history.

Without a token the site still works read-only, and Add/Edit hands you off to
GitHub's own editor instead of saving directly.


## The file format

```markdown
---
id: futrell-2015-dependency-length
type: article
title: Large-scale evidence of dependency length minimization in 37 languages
authors:
  - Futrell, Richard
  - Mahowald, Kyle
year: 2015
container: Proceedings of the National Academy of Sciences
volume: 112
issue: 33
pages: 10336–10341
doi: 10.1073/pnas.1502134112
tags:
  - dependency-length
  - efficiency-accounts
status: core
added: 2026-09-08
added_by: mbmartin1
---

Free-form Markdown notes: why this source is in the bibliography, what it is
used for, and what is still open about it.
```

| Field | Notes |
| --- | --- |
| `id` | Citation key; must match the filename. |
| `type` | `article`, `inproceedings`, `preprint`, `incollection`, `book`, `report`, `thesis`, `dataset`, `webpage`, `misc`. |
| `title` | Required. Everything else is optional. |
| `authors`, `editors` | One per line, `Family, Given`. Wrap an organisation in `{braces}` so it is not inverted. |
| `year` | `2015`, or a full date for news and web items: `2025, July 2`. |
| `container` | Journal, proceedings, book, or site — whichever the type calls for. |
| `volume`, `issue`, `pages`, `publisher`, `institution`, `doi`, `url`, `accessed` | Used by the APA, BibTeX, and CSL-JSON exporters. |
| `tags` | Lower-case, hyphenated. |
| `status` | `core`, `supporting`, `dataset-candidate`, `background`, `to-read`. |
| `added`, `added_by` | Set automatically when you add through the site. |

Unknown fields are rejected rather than silently dropped, so a typo shows up as
a visible error instead of quietly losing data. Parsing a file and re-writing it
reproduces it byte for byte, so an edit made on the site produces a minimal diff.

## Working on the site itself

`docs/` is plain HTML, CSS, and JavaScript with no dependencies, no CDN, and no
build step — it works offline and on locked-down networks. The Markdown
renderer, the frontmatter parser, the three importers, and the APA/BibTeX/CSL
generators are all in `docs/app.js`.

To preview locally:

```bash
python3 -m http.server 8899
```

then open <http://localhost:8899/docs/>. It still reads papers from GitHub, so
you see live data against local site code.

If the repository is ever renamed or moved, `docs/config.js` is the only file
that needs changing.

---
id: hamner-2012-asap-aes
type: report
title: "Contrasting state-of-the-art automated scoring of essays: Analysis"
authors:
  - Hamner, Ben
  - Shermis, Mark D.
year: 2012
url: "https://api.semanticscholar.org/CorpusID:18407254"
tags:
  - essays
  - corpus
  - essay-scoring
  - access-issue
status: dataset-candidate
added: 2026-09-08
added_by: mbmartin1
---

**Why it is here:** the citation for ASAP-AES, dataset candidate #2 — around 25,000 hand-scored student essays from grades 7–10.

**In favor:** it ships human quality ratings, which opens a comparison the other candidates cannot support: we could score model outputs on the same rubric and ask whether human-rated quality and reading cost move together or apart. That would be a genuinely interesting secondary result.

**Blockers noted in the proposal:** the data was hard to access, and it is unclear whether every essay set responds to a specific prompt. Both matter — without a stable prompt, we cannot have models answer the same question, which is the whole design.

**Next step:** resolve the access question first, since it determines whether this candidate is live at all. The original Kaggle competition data is the usual route. Note also that the essay sets differ in genre (some source-dependent, some not), so "ASAP-AES" is not one homogeneous corpus.

**Citation note:** the proposal's methods section cites this as (Shermis & Hamner, 2012) but the reference list has Hamner & Shermis. Pick one author order and make them agree.

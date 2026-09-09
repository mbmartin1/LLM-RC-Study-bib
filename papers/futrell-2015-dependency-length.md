---
id: futrell-2015-dependency-length
type: article
title: Large-scale evidence of dependency length minimization in 37 languages
authors:
  - Futrell, Richard
  - Mahowald, Kyle
  - Gibson, Edward
year: 2015
container: Proceedings of the National Academy of Sciences
volume: 112
issue: 33
pages: 10336–10341
doi: 10.1073/pnas.1502134112
tags:
  - dependency-length
  - efficiency-accounts
  - corpus-methods
  - measure
status: core
added: 2026-09-08
added_by: mbmartin1
---

**Why it is here:** supplies one of the two efficiency signatures the study measures, and — more practically — supplies the *method* for measuring it.

**How it is used:** the proposal's descriptive-statistics section takes the random-order baseline directly from this paper: observed dependency length is only interpretable relative to a baseline of random linearizations of the same dependency tree. That comparison is what makes the measure a claim about pressure rather than a claim about sentence length.

**Open methods question:** we need a parser to produce the dependency trees for both human and model responses, and parser accuracy may differ systematically between human student writing and polished LLM prose. That is a possible confound — if the parser is more accurate on LLM text, measured dependency length differences could partly be a parsing artifact. Worth an explicit check.

**Related:** [[gibson-2019-efficiency-shapes-language]] for the framing, [[jaeger-2010-redundancy-and-reduction]] for the other signature.

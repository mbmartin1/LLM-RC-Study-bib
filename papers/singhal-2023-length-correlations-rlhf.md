---
id: singhal-2023-length-correlations-rlhf
type: preprint
title: "A Long Way to Go: Investigating Length Correlations in RLHF"
authors:
  - Singhal, Prasann
  - Goyal, Tanya
  - Xu, Jiacheng
  - Durrett, Greg
year: 2023
container: arXiv
doi: 10.48550/arXiv.2310.03716
url: "https://arxiv.org/abs/2310.03716"
tags:
  - rlhf
  - llm-behavior
  - verbosity
  - confound-control
status: supporting
added: 2026-09-08
added_by: mbmartin1
---

**Why it is here:** evidence that LLM outputs are shaped by pressures that are not communicative success — reward models reward length, so RLHF pushes models toward longer outputs largely independent of quality.

**Two jobs in the argument:**
1. It supports the framing claim that models are optimized to satisfy offline raters rather than listeners, which is the premise of treating LLMs as the no-listener-pressure case.
2. It is the direct justification for the proposal's decision to **control for response length**. If length correlates with RLHF training rather than with content, then any raw reading-time difference between human and model text is confounded by length unless it is controlled.

**Design implication:** length control needs a stated method — matched-length sampling, or length as a covariate in the reading-time model. Worth deciding before generation, since it affects how many candidate generations we need per prompt.

**Related:** [[sharma-2024-sycophancy]] is the companion case of a non-communicative optimization pressure.

---
id: oh-2023-surprisal-larger-models
type: article
title: Why Does Surprisal From Larger Transformer-Based Language Models Provide a Poorer Fit to Human Reading Times?
authors:
  - Oh, Byung-Doh
  - Schuler, William
year: 2023
container: Transactions of the Association for Computational Linguistics
volume: 11
pages: 336–350
doi: 10.1162/tacl_a_00548
tags:
  - surprisal
  - reading-times
  - llm-scaling
  - psycholinguistics
  - methods-caution
status: core
added: 2026-09-08
added_by: mbmartin1
---

**Why it is here:** the closest existing result to the proposal's hypothesis, and simultaneously the biggest methodological hazard in the design.

**As evidence:** it shows that scaling a model up makes its surprisal a *worse* predictor of human reading time. That is an existing demonstration that predictive accuracy and human-likeness come apart as capability increases — exactly the divergence the thesis predicts, but measured on the model's estimates of text rather than on the model's own text.

**As a hazard:** if we use a large neural LM as the surprisal estimator for our own analysis, this paper says that estimator is systematically misaligned with human processing, and we may end up measuring the estimator rather than the stimuli. This is the estimator-circularity problem behind the proposal's open question of n-gram vs neural surprisal.

**Suggested resolution to consider:** report both an n-gram and a neural surprisal, and treat agreement between them as the result rather than picking one. If they disagree, that disagreement is itself reportable.

**Related:** [[jaeger-2010-redundancy-and-reduction]] (UID needs the estimator), [[reinhart-2025-do-llms-write-like-humans]].

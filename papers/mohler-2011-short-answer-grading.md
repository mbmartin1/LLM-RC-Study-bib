---
id: mohler-2011-short-answer-grading
type: inproceedings
title: Learning to Grade Short Answer Questions using Semantic Similarity Measures and Dependency Graph Alignments
authors:
  - Mohler, Michael
  - Bunescu, Razvan
  - Mihalcea, Rada
editors:
  - Lin, Dekang
  - Matsumoto, Yuji
  - Mihalcea, Rada
year: 2011
container: "Proceedings of the 49th Annual Meeting of the Association for Computational Linguistics: Human Language Technologies"
pages: 752–762
publisher: Association for Computational Linguistics
url: "https://aclanthology.org/P11-1076/"
tags:
  - short-answer
  - corpus
  - human-baseline
status: dataset-candidate
added: 2026-09-08
added_by: mbmartin1
---

**Why it is here:** dataset candidate #1 for the human reference condition — 2,273 student short answers to 80 questions from an undergraduate data structures course.

**In favor:** genuinely open-ended short responses to specific prompts, which is exactly the shape needed to have models answer the same questions. Small enough to work with easily, and the prompts are explicit.

**Against (from the proposal):** the content is computer science, so reading time in the behavioral studies would be confounded with participants' CS knowledge. That is a serious problem for a general-population online sample — domain familiarity would swamp the structural effects we are trying to detect.

**Possible mitigations to weigh:** screen or measure participant CS background and include it as a covariate; or restrict to the subset of items whose answers are not notation-heavy; or use this corpus for the descriptive-statistics half only and a different corpus for the behavioral half.

**Compare:** [[crossley-2024-persuade]], [[hamner-2012-asap-aes]].

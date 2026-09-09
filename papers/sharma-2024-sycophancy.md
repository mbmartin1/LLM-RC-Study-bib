---
id: sharma-2024-sycophancy
type: inproceedings
title: Towards Understanding Sycophancy in Language Models
authors:
  - Sharma, Mrinank
  - Tong, Meg
  - Korbak, Tomasz
  - Duvenaud, David
  - Askell, Amanda
  - Bowman, Samuel R.
  - Durmus, Esin
  - Hatfield-Dodds, Zac
  - Johnston, Scott R.
  - Kravec, Shauna
  - Maxwell, Timothy
  - McCandlish, Sam
  - Ndousse, Kamal
  - Rausch, Oliver
  - Schiefer, Nicholas
  - Yan, Da
  - Zhang, Miranda
  - Perez, Ethan
editors:
  - Kim, Been
  - Yue, Yisong
  - Chaudhuri, Swarat
  - Fragkiadaki, Katerina
  - Khan, Mohammad
  - Sun, Yizhou
year: 2024
container: International Conference on Learning Representations
volume: 2024
pages: 110–144
url: "https://proceedings.iclr.cc/paper_files/paper/2024/file/0105f7972202c1d4fb817da9f21a9663-Paper-Conference.pdf"
tags:
  - rlhf
  - llm-behavior
  - sycophancy
  - alignment
status: supporting
added: 2026-09-08
added_by: mbmartin1
---

**Why it is here:** the second example of an LLM behavior that comes from optimizing human preference judgments rather than from communicating well. Models tell raters what raters want to hear.

**How it is used:** paired with [[singhal-2023-length-correlations-rlhf]] to establish that LLM outputs are demonstrably imperfect communicators, and that the deviations trace to the preference-optimization objective. This is what licenses the thesis framing of LLMs as producers shaped by offline raters instead of by comprehenders.

**Caveat to keep honest:** sycophancy is about content accommodation, not about the structural efficiency properties we measure. It supports the framing but is not evidence for a structural prediction — the introduction should not blur that line.

**Citation note:** the proposal's body text cites this as (Sharma et al., 2023) while the reference list has 2024. The ICLR proceedings version is 2024; align the in-text citation.

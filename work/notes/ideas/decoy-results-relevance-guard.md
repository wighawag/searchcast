---
title: Optional relevance guard against decoy result pages
slug: decoy-results-relevance-guard
---

## The idea

Some engines occasionally answer with a well-formed results page whose results are unrelated to the query (a decoy). It parses like a real page, so neither the `blocked` selector nor the `ready` selector catches it, and the chain accepts it as an answer.

A cheap, optional post-filter per engine could catch most of these: count a result as relevant when its title, snippet and URL contain at least two distinct non-stopword query terms (or the only term, for a one-term query), and treat the page as a decoy when at most one of the top results is relevant. One-term queries are never judged. A decoy would be reported like `blocked` (so the chain moves on and the engine can cool down), under its own error kind or a flag, so callers can tell the two apart.

## Why not now

Out of scope for the first version (spec `serpcast`, Out of Scope). It needs a measured false-positive rate on real queries before it can be on by default, and the engine chain has to exist first.

---
layout: post
title: "Don't Fear Simple Code"
description: "Resist that voice telling you 'there has to be more to this'"
date: 2021-02-21 07:24:00 -0400
comments: true
tags: []
---

Recently I had an opportunity to consult on a side project that was low risk but had the clear potential to work in tandem with and eventually take over a large portion of a large, complex, legacy section of an application code base. There was a clear directive to build out a novel use case that didn't fit existing patterns, but just as clear a motivation to support the extent of complexity that was already in place. As a side project, this was an excellent opportunity to pilot some from-scratch architecture with the hindsight-driven foresight of our existing system, use cases, and problems. Architects dream of such opportunities in legacy code bases.

Specifically, we had a `Contract` model, responsible for how users logged into a market system would see, claim, and get paid for various jobs, and a `Task` model that was responsible for the task-specific data. We separated the `Task` model because we knew we were going to build this out to support various task types that were not at all alike, but for MVP there was only one.

That's when the objection came. `Task`, in its MVP form, was "too simple". There was a feeling of embarrassment of writing something without adding some intricate state machine, a bunch of cool callback methods, and an intricate web of `if` statements. Something so dumb couldn't possibly lie at the core of what was to be an enormously complex application.

Understandable, but nonsense! If you can comfortably state the model's responsibility (maintain state specific to a given user's research task), then there's no need to try to combine it with something else because it seems too lonely by itself. Simplicity allows your code to grow with flexibility. It does exactly what you want and nothing more. If your initial code is complex, what is it going to look like when you add to it under deadline pressures?

The good kind of complexity comes from assembling simple parts in meaningful ways. Keep it simple.

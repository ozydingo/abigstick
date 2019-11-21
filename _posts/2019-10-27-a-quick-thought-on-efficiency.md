---
layout: post
title: "A quick thought on efficiency"
description: "A relatable thought experiment on log search efficiency"
date: 2019-10-27 09:31:00 -0400
comments: true
tags: [algorithms, performance]
---

Avoid premature optimization.

A transformative philosophy I first encountered in web dev circles that has impactfully shifted my approach to many everyday coding problems. "Make it work, make it right, make it fast". "Perfect is the enemy of good", etc, etc. Love it.

Still, it needn't even be said that there is still a place for optimization and efficiency, even in the sloppy world of web development startups. How often you encounter them depends on what you're working on. But I recently took a moment to appreciate, from a very human and relatable perspective, the value of algorithmic efficiency. So let's look at search.

## Just how good log(n) really is

I just want to share one illustrative example: linear search (going through an array one element at a time) vs. binary search (starting with a sorted array, check the halfway point, decide which half your target is in, repeat. For an array of n items, linear search runs in O(n), and binary search will run in O(log(n)).

Let's imagine you're doing this search by hand. Maybe you're searching through index cards for a piece of information. Each card you look at takes you about one second.

If you have 10 entries (no comment), a linear search will take you on the order of 10 seconds (on average, 5, more specifically). Binary search will cut that down to 3-4 seconds. Whoopie. Avoid premature optimization.

What if you had 100 cards? 100 seconds vs. 6-7 seconds. Significant, but maybe not a huge deal. If you're doing this every now and then before going out for the night, well, it's not worth a big kerfuffle to improve.

1,000 cards? 15 minutes vs 10 seconds. This is starting to matter. Maybe.

One million cards. Ok you don't tend to have a million cards of anything. But it's still useful in this thought experiment because a computer is very often searching through a million records, even at a small startup or hobby project.

11 days or 20 seconds. You decide. Eleven days of 24-7, non-stop searching through your index cards, or less than half a minute. This is what you're starting to make your server do.

One billion cards. Less often encountered in small and startup projects, but still very relevant when you start to reach any measure of scale.

31 years or 30 seconds.

Stop an appreciate that difference for a moment. The same task. Thirty one years. Thirty seconds.

I just like to reflect on that.

Then remember that most searches are still in the 1.5 minutes vs 7 seconds realm. And that those are microseconds, not seconds.

Until they're not.

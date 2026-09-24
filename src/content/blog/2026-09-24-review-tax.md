---
title: "The Review Tax"
description: "AI didn't invent the review bottleneck, but it's very, very good at making it worse — for code and for design docs alike."
date: 2026-09-24 09:00:00 -0400
tags: [ai, process, engineering-culture, design-docs]
---

Hey, could you review this for me real quick?

![A pull request summary: 56 files changed, +14,822 −200](/images/posts/review-tax/pr-changes.png "56 files changed, +14,822 −200")

This is a real example. And we're all seeing this more and more. Agents make it easy to write _a lot_ (not just code -- plans, designs, architecture docs, documentation all count). More folks are empowered to work on large slices. It's human nature to rubber stamp something in front of you that looks "good enough" and throw something over the wall.

All of this compounds the same problem: we're swamped with review busywork and not really doing them right. People skim, miss key details, and feel overwhelmed -- reviewing not-quite-there reasoning produced by an agent that didn't quite have the right context is a *lot* more taxing than reviewing a well-honed argument or proposal. Combine the increased cognitive load per sentence with the massively increased number of sentence and frequency of outputs to be reviewed, and the problem is blatantly obvious.

A lot of teams are leaning more heavily on agentic code review, and I fully support that. But, alone, that solution misses a deeper point. Real review that challenges and generates _shared understanding_ remains a critical part of a healthy SDLC and a health team culture. It's a valid position that more complex code outputs at a faster velocity are a new norm, and we puny humans can't possibly keep up. But my position isn't about code review. It's about reviewing _at the right level_. You've heard it said: no one reviews compiled bit code anymore, and that's a good thing.

Here's the thing. Code reviews were already broken. Architecture reviews were already taxed. Most people simply aren't very good at, or very motivated to, taking the time and effort to really guide your reviewers through what you're asking them to do. To communicate simply, distill a concise yet thorough outline, and progressively disclose the detail needed for an effective, delightful review. This is the skill that we need to develop to separate our work as a team from generic AI slop.

To that end, I gave this position statement to my team. Within days I witnessed it producing enthusiastic support and engaged review meetings. Take a read; it won't take you long ;-)

<div class="not-prose my-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-brand-light)]/40 p-6 md:p-8">
  <p class="mb-4 text-xs font-heading uppercase tracking-wide text-[var(--color-text-light)]">
    Design &amp; Architecture Review in 3Play&rsquo;s SDLC &middot; internal position doc
  </p>

  <p class="italic mb-4">This position has nothing to do with AI, and it has everything to do with AI.</p>

  <h3 class="font-heading font-semibold text-lg mt-6 mb-2">Goal: Reduce waste and churn in our SDLC</h3>
  <p class="mb-2">Tenets:</p>
  <ul class="list-disc pl-5 mb-4 space-y-1">
    <li>Align most often at the earliest, highest levels.</li>
    <li>Produce clear, thoughtful designs to review and to implement.</li>
    <li>Reduce the tax we place on each other in our review process.</li>
    <li>Outsource doing, not thinking, to AI.</li>
    <li>Own your agent's output (don't ask others to de-slop it for you).</li>
  </ul>

  <h3 class="font-heading font-semibold text-lg mt-6 mb-2">Align at the right level of fidelity</h3>
  <p class="mb-4">In a design document:</p>
  <ol class="list-decimal pl-5 mb-4 space-y-1">
    <li>State the problem. State it in 3-5 bullet points. If it doesn't fit, you might be describing a wish list.</li>
    <li>State the north stars, in a few bullet points, linked to any north star documents. Any proposal that follows should align or be an intentional deviation.</li>
    <li>Describe the shape of the system you would like to see solving that problem. Use diagrams and high level descriptions — there should be no specific tools, no method names, no code exploration written here.</li>
  </ol>
  <p class="mb-4">Stop there. Ask for review from a broad audience. <em>Review at this level of fidelity is cheap</em>, gets buy-in from anyone with an opinion, and prepares the right level of context for efficient and effective writing and review of downstream design &amp; architecture documents and code. This process can restate what was done at the Betting Table. This repetition is intentional: <a href="https://borischerny.com/management,/product/2026/09/19/I-am-often-wrong.html">design is iterative</a> and your system has stakeholders who weren't there.</p>
  <p class="mb-4">Only then do we get to what you might have thought the title was getting at:</p>
  <ol class="list-decimal pl-5 mb-4 space-y-1" start="4">
    <li>Flesh out the UX (flows, scenarios, screens). Get a review; alignment here informs the architecture.</li>
    <li>Design the architecture: deeper system diagrams, edge cases, error handling, performance, integration, and rollout. Combine human and agent review at this step.</li>
  </ol>
  <p class="mb-0">Use agents thoughtfully, if at all. For steps 4 and 5, agents can help generate a detailed artifact, but <em>own your agent's output</em>: carefully review and curate what you are asking others to review.</p>

  <h3 class="font-heading font-semibold text-lg mt-6 mb-2">The build isn't the bottleneck</h3>
  <p class="mb-4">We're getting faster at building bigger things. This is because of the people we have, the culture we are developing, the processes we are honing, and, of course, the tools (AI) we are using. Review, not build, is the bottleneck, and it's where important details get lost, often because we're reviewing at the wrong level. <em>Reviewing the right questions at the right fidelity is how we tackle this bottleneck</em>. Designs, plans, and code that are verbose, distractingly detailed, and employ not-quite-there storytelling are how we, and AI, unintentionally exacerbate it. Effective review starts from a clear picture of the problem and the system shape before any detail. It is the author's responsibility to provide that clarity.</p>
  <p class="mb-4">Review remains a critical part of any healthy SDLC. That doesn't mean line-by-line code review, which AI handles increasingly well. Asking reviewers to infer a system description including its architecture and UX from a code PR is an anti-pattern. The same holds for requiring reviewers to evaluate a detailed design or architecture before understanding the problems we are trying to solve and the north stars we're trying to aim for.</p>
  <p class="mb-0">Solving these problems <em>and</em> cranking the dial on build speed are not mutually exclusive. Both are accomplished using the same principle, already stated above:</p>
  <p class="font-semibold mt-2 mb-0">Align most often at the earliest, highest levels.</p>
</div>

If you skimmed the preamble looking for the 14k-line PR and jumped straight past it to see what happened — yeah. That's kind of the point.

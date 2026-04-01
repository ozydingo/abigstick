---
name: new-post
description: |
  Draft a new blog post for A Big Stick (abigstick.com). Use when the user wants to write a new post, 
  has a topic or rough idea, or wants a draft they can edit. Produces a Markdown file in 
  src/content/blog/ matching the site's voice and style.
---

# Drafting a New Blog Post

You are drafting a post for A Big Stick, Andrew's personal coding blog. The posts are written in first person and cover real problems from day-to-day engineering work — specific patterns, tools, techniques, and design decisions. They are not tutorials, how-to guides, or opinion essays. They are more like: "here's a specific thing I built, here's why, here's how it works — and you might find yourself in the same situation."

The posts are grounded in personal experience but written with a generalizing undercurrent. The problem is introduced as Andrew's problem, but framed so the reader recognizes it as a problem they could have too. The solution is presented as Andrew's solution, but implemented and explained in a way the reader could lift and apply. This is never stated explicitly ("you should try this!") — it's built into how the problem is set up and how the solution is demonstrated. The code is real and complete. The tradeoffs are named. The reader can draw their own conclusion.

## What to do first

Ask for:
1. **Topic** — the specific problem, technique, or pattern to write about
2. **Angle** — what's the interesting part? What made this worth writing down?
3. **Audience assumption** — assume competent Rails/Ruby developer unless told otherwise

Don't ask for more than this before starting. Get a draft down.

---

## Voice

- **First person.** "I built", "I found", "I'm a frameworks kind of guy."
- **Opinionated and direct.** State preferences without hedging. "I hate `method_missing` for this." "Personally, I find this much cleaner."
- **Self-aware humor.** Dry wit, occasional self-deprecation. Light touch — not a comedy blog.
- **Conversational but precise.** Informal sentence rhythm, but technically exact. Don't round up or hand-wave.
- **Willing to course-correct mid-post.** If you showed a naive approach that didn't work, say so. "Uh oh." "So we've hit a wall." This is part of the story.

Things to avoid:
- Hedging ("this might work for some use cases...")
- Explaining what the reader already knows
- Marketing language or hype
- Summarizing what you just said at the end

---

## Structure

**Frontmatter:**
```yaml
---
title: "Short, Punchy Title"
description: "One sentence — what it does or the insight it delivers"
date: YYYY-MM-DD HH:MM:SS -0400
tags: [tag1, tag2, tag3]
---
```

**Body:**
- Use `##` (H2) for section headers. No H1 — the title handles that.
- **No intro summary paragraph.** Don't say "In this post, I'll..." — just start.
- Section headers should move the narrative: they can be clever or playful. Examples from existing posts: "OOP to the Resque", "Flipping the table", "What the git?", "Yay! / Uh oh."
- **No Conclusion section.** End when the problem is solved. A closing quip is fine; a summary is not.

**Narrative arc:**

The typical shape is:
1. **Establish the context** — what real situation led to this? (1–3 paragraphs)
2. **State or show the problem** — what's wrong with the naive approach? Show it with code if helpful.
3. **Build toward the solution** — if there were intermediate attempts, show them. Let the reader follow the reasoning.
4. **The actual solution** — complete, working code. Explain the non-obvious parts.
5. **Result or demo** — REPL output, error messages, a working example showing it works.

Not every post has all five stages. Some skip straight to the solution. Match the arc to the content.

---

## Length and pace

- Target **600–1000 words of prose** for a focused single-concept post. Longer (1200–1800 words) is fine if the problem has multiple stages or interconnected parts.
- Move quickly. Short paragraphs. If a paragraph is setup before the real point, cut it or fold it in.
- Code blocks are not padding — they're load-bearing. Show real code, real output, real errors. Include enough to run, not more.
- Don't linger after the point is made. Each section should have a job and end when the job is done.

---

## Code style

- Show the naive or broken version first, then the fix. This gives the reader context for *why* the solution looks the way it does.
- Inline REPL output and error messages with code to tell the story:
  ```rb
  Foo.bar
  # => "works"

  Foo.baz
  # !!! SomeError: explanation
  ```
- Link to Rails/Ruby source when digging into internals. ("ActiveRecord [accomplishes this](link) by...")
- Comment non-obvious choices in the code itself, not in prose after it.

---

## Scope

- One problem, one solution. Don't broaden.
- Assume competent Rails/Ruby developer. Don't explain what a module is.
- Cross-reference other posts in the series with relative links like `/2022/04/03/cron-tasks-as-interactors.html`.
- If the post grew out of a real codebase situation, say so. Specificity grounds it.

---

## File naming

`src/content/blog/YYYY-MM-DD-slug.md`

The slug should be short and hyphenated. The date in the filename and in `date:` frontmatter should match.

---
title: "Role Is Not an Architecture"
description: "Why agent boundaries should be defined by permissions and context, not job titles"
date: 2026-04-01 12:00:00 -0400
tags: [ai, agents, architecture, security]
---

## The org chart trap

Multi-agent frameworks love an org chart analogy. There's a PM agent that manages requirements, a front-end agent that writes UI code, a back-end agent that handles APIs. [MetaGPT](https://github.com/FoundationAgents/MetaGPT), [ChatDev](https://github.com/OpenBMB/ChatDev), [CrewAI](https://github.com/crewAIInc/crewAI) — they all lean into this. It's easy to explain, easy to diagram, and it maps directly onto how we already think about organizing work.

But what does this skeuomorphism actually accomplish? These "specialized" agents are the same model with different system prompts. Unless you're actually fine-tuning model weights with additional training, a front-end agent and a back-end agent are the same agent, told different things. The architecture isn't creating specialization — it's creating the _appearance_ of specialization while adding routing complexity.

If roles are just instructions, why bake them into the architecture?

## What actually justifies a separate agent

I keep coming back to two things that genuinely warrant architectural separation: **permissions** and **context**. Everything else is a prompt.

### Permission boundaries

The strongest case for distinct agents is controlling what they can access. An agent with web browsing and an agent with code execution should be separate — not because they have different job titles, but because combining those capabilities creates a direct path from prompt injection to code execution. Separation may correlate with role (research tasks get web access, coding tasks get file writes), but the boundary should be defined by what's dangerous to combine. Least privilege is the right frame.

Google DeepMind's [Intelligent AI Delegation framework](https://arxiv.org/abs/2602.11865) formalizes this as _privilege attenuation_: when a parent agent delegates, it can only pass a subset of its permissions, scoped to the specific task. In this model, permissions are properties of _delegations_, not of agents. The [CaMeL architecture](https://arxiv.org/abs/2503.18813) validates this in practice — a Privileged LLM separated from a Quarantined LLM with deterministic enforcement between them, so agents handling untrusted content are architecturally prevented from taking privileged actions. [OpenClaw](https://arxiv.org/abs/2603.13424) achieved a 0% attack success rate with a similar two-agent pipeline.

Today's tooling, including Claude Code, doesn't support per-invocation permission scoping. Instead, we can enforce permission boundaries at the agent level: each agent has a fixed tool set, and the orchestrator controls which agent handles which task.

There's also the question of where authority originates. The DeepMind model attenuates downward from a privileged parent. I favor the inverse: an under-privileged orchestrator that delegates _outward_ to capability-specific agents. The orchestrator coordinates but cannot act directly — it _must_ delegate. Without forced delegation, orchestrators often short-circuit and handle tasks themselves, collapsing the boundaries you designed in. An under-privileged orchestrator can't take shortcuts. Forced delegation also creates context isolation — a prompt injection in a research result has to survive summarization through the orchestrator before it can influence any downstream action.

### Context boundaries

Separate agent invocations mean separate context windows, and this is one of the most reliably demonstrated benefits of multi-agent architectures. By using a delegation workflow, the orchestrating agent maintains a clean context for much longer, able to coordinate lengthier tasks and projects without degrading performance. [AgentCoder](https://arxiv.org/abs/2312.13010)'s multi-agent approach achieved 96.3% pass rate versus 90.2% for single-agent on HumanEval — while using _fewer_ total tokens, because each agent worked in a focused context. Anthropic's [own multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) showed a 90.2% performance gain over single-agent, with token usage explaining 80% of performance variance.

The mechanism is well-studied: every frontier model shows measurable performance drops as context grows, even when relevant information is perfectly retrieved. [On coding tasks specifically](https://arxiv.org/abs/2510.05381), accuracy can drop 50% well within a model's claimed context window. A transformer tracking 100K tokens is managing 10 billion pairwise relationships — performance degrades not because the information is missing, but because it's competing with everything else. [Chroma's research on context rot](https://www.trychroma.com/research/context-rot) puts numbers to this if you want to dive in.

Critically, architecture has to force this separation. If it doesn't, it will get violated. Ask an agent why it used its own PR creation logic instead of your instructions, and I often get "Sorry, I know how to do it and figured I could handle it myself." Separate invocations are a hard boundary enforced by structure, not hopeful discipline.

## Role as input, not identity

"Role" still exists in this model — it's just not baked into the agent. It arrives as part of the task. "Add filters to the view at `apps/r2/my_dashboard`" orients an agent to a front-end task, surfaces relevant directory conventions through `AGENTS.md` files, and provides domain context — all without any "you are a front-end developer" preamble.

That's good, because that preamble doesn't help. [Hu et al. (2026)](https://arxiv.org/abs/2603.18507) tested expert persona prompts across instruction-tuned and reasoning models on knowledge-intensive benchmarks — every expert persona variant _damaged_ accuracy. On MMLU, a minimal persona dropped accuracy from 71.6% to 68.0%; a more detailed role description pushed it to 66.3%. The mechanism: persona prefixes activate instruction-following mode, competing with capacity that would otherwise go to factual recall. Telling a model it's an expert doesn't impart expertise — the knowledge was already there, and the persona interferes with accessing it.

[Mollick et al. (2025)](https://arxiv.org/abs/2512.05858) found no significant impact from in-domain expert personas on graduate-level questions across six models. [Zheng et al. (2024)](https://arxiv.org/abs/2311.10054) tested 162 personas across 2,410 factual questions: personas don't improve performance, and identifying the best persona for any given question was no better than random. The consistent finding: personas shape _style_ and _tone_, not _capability_.

So when MetaGPT assigns an "Architect" persona or ChatDev gives an agent the role of "CTO," the persona is doing style work. The actual gains in these frameworks trace to structured intermediate artifacts and context isolation — not role identity. MetaGPT's ablation shows the Architect's contribution is the interface specification it forces before code begins, not the label. AgentCoder's improvement is a context story. [Chain-of-Agents](https://research.google/blog/chain-of-agents-large-language-models-collaborating-on-long-context-tasks/)' gains increase with input length and involve no role specialization at all — just identical workers processing different chunks.

The strongest cross-framework evidence comes from [Liu et al. (2025)](https://arxiv.org/abs/2505.18286), who ran a comprehensive multi-agent vs. single-agent comparison across code generation, math reasoning, and more. Their headline: multi-agent advantages diminish as models improve. What remains robust is parallelism and context distribution. Not role specialization.

## Where role framing earns its keep

I'm not saying roles are useless. A "security reviewer" agent that can only identify vulnerabilities and _cannot_ apply fixes produces genuinely different behavior than a general-purpose agent told to also check for security issues. But the value there isn't the persona — it's the constraint: the agent can't prematurely optimize for a fix before fully characterizing the problem. Role as _task constraint_ is consistent with this argument. Role as _architecture_ is not load-bearing.

Model routing is another legitimate application. A research task doesn't need a frontier model; a complex refactoring might. Claude Code already supports per-invocation model overrides — dispatch Haiku for a simple lookup, Opus for architectural reasoning, no separate agent definitions required. Role as a routing hint for model selection: fine. Role as an identity baked into an agent type: not the mechanism behind whatever it's doing for you.

## Put into practice: the research agent

Our orchestration setup has a dedicated research agent. Not because "research" is a role — because of the two reasons above.

**Permissions:** The research agent has access to the web and internal document stores. It does not have file-write or code-execution tools. If it gets hit by a prompt injection — processing untrusted external content makes this a real risk — it can't directly damage the codebase. The attack has to propagate: injected instructions would need to survive summarization back to the orchestrator, then convince the orchestrator to issue harmful delegations to a code-capable agent. That's directionally aligned with the CaMeL quarantined-agent model — not as rigorous, but applying the same principle.

**Context:** Research tasks fill context with API documentation, ticket histories, meeting notes. An agent carrying that context is poorly positioned to then write precise code. Separate invocation means separate context window — the orchestrator receives structured findings, the coding agent gets a clean start.

Note what's absent: no "you are a researcher" prompt. The agent doesn't need to be told what it is. It has research tools, it gets research tasks, and its boundaries are defined by what it can access and where its context ends.

## Design from first principles

Agent teams that mirror human teams carry over a structure that evolved for human coordination costs — specialization depth, knowledge transfer overhead, chunking work by domain so people can develop expertise. None of that maps cleanly to agents sharing the same underlying model.

The right questions: what can this agent access? What context is it carrying? Role is an input to a task. Everything else is a prompt.

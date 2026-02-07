---
layout: post
title: "Sandbox Your Secrets"
description: "Why your AI agent's deny rules aren't enough, and what actually is"
date: 2026-02-07 03:00:00 -0400
comments: true
tags: [security, ai, claude, sandbox, secrets, docker]
---

## The permission illusion

If you're using Claude Code (or any AI coding agent) in a real codebase, you've probably set up some deny rules to protect your secrets. Ours looked something like this:

```json
{
  "permissions": {
    "deny": [
      "Read(config/secrets/**)",
      "Write(config/secrets/**)",
      "Edit(config/secrets/**)",
      "Bash(cat *config/secrets*)",
      "Bash(head *config/secrets*)",
      "Bash(grep *config/secrets*)"
    ]
  }
}
```

For each secret path, we had deny rules for `Read`, `Write`, `Edit`, and a handful of `Bash` patterns covering the usual suspects: `cat`, `head`, `tail`, `grep`, `less`, `find`, `ls`. Same treatment for credentials, env secrets, SSH keys, AWS config, shell history.

Looks pretty thorough, right? It blocks all the obvious ways an agent would try to read your secrets.

Here's what it doesn't block:

```bash
ruby -e "puts File.read('config/secrets/app/my_api_key')"
```

Or:

```bash
python3 -c "print(open('config/secrets/app/my_api_key').read())"
```

Or the real kicker: the agent modifies an existing test file to log out `Rails.application.credentials.secret_key_base`, runs the test, and reads the output. If your agent can run tests (and it probably can, because that's the point), it has access to everything your test suite has access to.

The deny list is a game of whack-a-mole you can't win. You're pattern-matching against bash commands, but the agent can write _programs_ that read files. There's no way to enumerate every possible program that reads a file.

## Enter the sandbox

Claude Code ships with an OS-level sandbox powered by macOS Seatbelt (or bubblewrap on Linux). This is a kernel-level enforcement layer that restricts what processes can actually do, regardless of what the permission system allows.

I didn't appreciate this until I started poking at it. Here's what I found.

The sandbox scopes filesystem access to the project directory. Writes outside the project are blocked at the kernel level. To test this, I tried a few commands:

```bash
# Inside the project — works fine, no prompt
echo foo > test-sandbox-file

# Outside the project — blocked
echo foo > /Users/me/test-sandbox-file
```

Reads behave similarly. `ls .` works silently. `ls /Users/me/` triggers a permission prompt, even though `Bash(ls:*)` is in the allow list. The sandbox layer sits below the permission system and enforces its own boundaries.

The critical property: **Seatbelt restrictions apply to the entire process tree.** When Claude runs `ruby script.rb` inside the sandbox, the Ruby process inherits the same restrictions. All child processes do. You can't escape from within.

So the sandbox gives us something the permission system can't: a hard boundary that no program running inside it can circumvent.

## The problem restated

Our secrets live inside the project directory. The sandbox scopes access to the project directory. See the issue?

The deny rules in our permissions config are trying to carve out exceptions _within_ a boundary that the sandbox has already declared safe. It's like putting a "do not enter" sign on a room inside your house and hoping the AI respects it, when the front door is wide open.

## Move the secrets out

The fix is almost embarrassingly simple: don't store secrets in the project directory.

If secrets live outside the project, the sandbox prevents access. Not through pattern matching or deny rules, but through kernel-level filesystem enforcement. No amount of creative scripting can read a file the OS won't let you access.

For local dev, we moved secrets to `~/.secrets/my-application/`:

```
~/.secrets/my-application/
  master.key
  credentials/
    development.key
    test.key
  env/
    development.yml
    test.yml
  secrets/
    app/
      <downloaded secrets>
```

Our dev setup script that downloads approved secrets onto dev machines into `config/secrets/`, for example, just writes to this location instead.

## Getting secrets into Docker

Our app runs in Docker, so the containers still need access to these secrets. Docker bind mounts handle this, and we already had the pattern — our `docker-compose.yml` was already mounting `~/.aws` and `~/localhost` into containers:

```yaml
- "~/.aws:/home/runner/.aws"
- "~/localhost:/home/runner/localhost"
```

Adding secret mounts follows the same pattern:

```yaml
- "~/.secrets/my-application/secrets:/home/runner/.secrets:ro"
- "~/.secrets/my-application/master.key:/app/config/master.key:ro"
- "~/.secrets/my-application/credentials:/app/config/credentials:ro"
- "~/.secrets/my-application/env:/app/config/env/secret:ro"
```

For the volume path to resolve correctly across developer machines (everyone has the project in a different absolute path), we generate a `.env` file at setup time with the expanded path:

```bash
# In the secrets setup script
echo "SECRETS_DIR=$HOME/.secrets/my-application" >> "$APP_ROOT/.env"
```

Then `docker-compose.yml` references `${SECRETS_DIR}`. Docker Compose's `.env` file doesn't support shell expansion (writing `$HOME` in `.env` gives you the literal string `$HOME`), so the setup script bakes in the resolved absolute path.

## What about production?

Nothing changes. Our production deploy already sets `RAILS_MASTER_KEY` via environment variable (Rails checks ENV before falling back to the key file), and secrets are managed by Kubernetes Secret mounting into a volume on our pods. The on-disk paths in the project were always a local dev concern.

## What about the agent running Docker commands?

A fair question. If the agent can run `docker exec app cat /app/config/master.key`, aren't we back to square one?

Yes, partially. If the agent can execute code inside Docker, it has access to whatever the container has access to. This is the same fundamental issue as the test-modification attack: any agent that can execute application code has the application's permissions.

But moving secrets out of the project directory still raises the bar meaningfully. The agent can no longer _accidentally_ stumble into secrets through normal file exploration. The sandbox prevents direct reads. And the Docker attack vector requires the agent to specifically target container execution, which is a more deliberate (and detectable) action than `cat config/secrets/foo`.

Defense in depth isn't about one perfect wall. It's about making each layer independently useful.

## The punchline

Your AI agent's deny rules are a speed bump, not a wall. They catch the obvious case where the agent tries to `cat` your secrets, but any indirect access — a script, a test, a one-liner in a language with file I/O — walks right past them.

The OS sandbox _is_ a wall. But only for things outside its boundary. So put your secrets outside its boundary.

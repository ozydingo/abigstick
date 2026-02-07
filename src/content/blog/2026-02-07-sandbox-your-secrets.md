---
title: "Sandbox Your Secrets"
description: "Why your AI agent's deny rules aren't enough, and what to do about it"
date: 2026-02-07 03:00:00 -0400
tags: [security, ai, claude, sandbox, secrets, docker]
---

## The permission illusion

If you're using Claude Code (or any AI coding agent) in a real codebase, you've probably set up some deny rules to protect your secrets:

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

Deny rules for `Read`, `Write`, `Edit`, and a handful of `Bash` patterns covering the usual suspects: `cat`, `head`, `tail`, `grep`, `less`, `find`, `ls`. Repeat for credentials, env secrets, SSH keys, AWS config, shell history.

Looks thorough. It blocks all the obvious ways an agent would try to read your secrets.

Here's what it doesn't block:

```bash
ruby -e "puts File.read('config/secrets/app/my_api_key')"
```

Or:

```bash
python3 -c "print(open('config/secrets/app/my_api_key').read())"
```

Or the real kicker: the agent modifies an existing test to log out `Rails.application.credentials.secret_key_base`, runs the test, and reads the output. If your agent can run tests — and it probably can, because that's the point — it has access to everything your test suite has access to.

The deny list is a game of whack-a-mole you can't win. You're pattern-matching against bash commands, but the agent can write _programs_ that read files. There's no way to enumerate every possible program that reads a file.

This doesn't mean deny rules are useless. They catch accidental access, which is the common case. But they're a speed bump, not a wall. If you need a wall, you need the sandbox.

## Enter the sandbox

Claude Code ships with an OS-level sandbox powered by macOS Seatbelt (or bubblewrap on Linux). This is a kernel-level enforcement layer that restricts what processes can actually do, regardless of what the permission system allows.

The sandbox scopes filesystem access to the project directory. Writes outside the project are blocked at the kernel level:

```bash
# Inside the project — no prompt
echo foo > test-sandbox-file

# Outside the project — blocked
echo foo > /Users/me/test-sandbox-file
```

Reads behave similarly. `ls .` works silently. `ls /Users/me/` triggers a permission prompt, even though `Bash(ls:*)` is in the allow list. The sandbox sits below the permission system and enforces its own boundaries.

The critical property: **Seatbelt restrictions apply to the entire process tree.** When a command runs inside the sandbox, every child process inherits the same restrictions. A Ruby script, a Python one-liner, a shell script that calls another shell script — all sandboxed.

So the sandbox provides something the permission system can't: a hard boundary that no program running inside it can circumvent.

## The problem restated

If your secrets live inside the project directory, and the sandbox scopes access to the project directory, the sandbox doesn't protect your secrets. The deny rules are trying to carve out exceptions _within_ a boundary the sandbox has already declared safe.

It's like putting a "do not enter" sign on a room inside your house and hoping the AI respects it, when the front door is wide open.

## Move the secrets out

The fix is straightforward: don't store secrets in the project directory.

If secrets live outside the project, the sandbox prevents access — not through pattern matching or deny rules, but through kernel-level filesystem enforcement. No amount of creative scripting can read a file the OS won't let you open.

For local dev, put secrets somewhere outside the repo, like `~/.secrets/my-application/`:

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

If you have a dev setup script that downloads secrets into `config/secrets/` or similar, point it at this location instead. Same downloads, different destination.

## Getting secrets into Docker

If your app runs in Docker, the containers still need access to these secrets. Docker bind mounts handle this. If you're already mounting host directories into containers (like `~/.aws`), this is the same pattern:

```yaml
- "~/.secrets/my-application/secrets:/home/runner/.secrets:ro"
- "~/.secrets/my-application/master.key:/app/config/master.key:ro"
- "~/.secrets/my-application/credentials:/app/config/credentials:ro"
- "~/.secrets/my-application/env:/app/config/env/secret:ro"
```

Yes, Docker supports single-file bind mounts. The `:ro` makes them read-only inside the container.

One wrinkle: the volume path needs to resolve correctly across developer machines. Docker Compose's `.env` file doesn't support shell expansion (`$HOME` gives you the literal string), so have your setup script bake in the resolved absolute path:

```bash
echo "SECRETS_DIR=$HOME/.secrets/my-application" >> "$APP_ROOT/.env"
```

Then reference `${SECRETS_DIR}` in `docker-compose.yml`.

## What about production?

As long as you're not checking secrets into your repo (and you're not, right?), your production deploy pipeline is likely unaffected. Production environments typically source secrets from environment variables, secret managers, or orchestration-level mounts — not from the project directory. In our case, Rails master key is an environment variable and other secrets are injected by Kubernetes. Your stack will differ, but the pattern is the same: this change only affects where secrets live on _developer machines_.

## The gap that remains

Moving secrets out of the project directory closes the direct access path. But there's a gap that no sandbox configuration can close: **Docker**.

If your agent can run `docker exec app cat /app/config/master.key`, it has access to whatever the container has access to. This is the same fundamental issue as the test-modification attack — any agent that can execute application code has the application's permissions.

The sandbox can't help here. It restricts the host filesystem, but Docker commands reach into a different execution context entirely. The agent doesn't need to read the secret file on the host; it reads the file inside the container where it's been mounted.

This means moving secrets out of the project is a meaningful improvement — the agent can no longer stumble into secrets through normal file exploration, and the sandbox prevents direct reads on the host — but it's not a complete solution. The Docker path remains open.

## Least privilege is your real wall

This is why the principle of least privilege matters so much for dev environments:

- **Dev secrets should be dev secrets.** If your local environment uses the same API keys as production, moving them out of the project directory is treating a symptom. The real fix is making sure your dev credentials can't do production-level damage. A leaked dev API key should be a nuisance, not an incident.
- **Scope your agent's Docker access.** Does your agent need `docker exec`? If it only needs to run tests, consider whether a more limited interface (like a test runner script) could replace raw container access.
- **Treat container access as privileged.** Any path that lets the agent execute code inside your application runtime is effectively root access to your application's secrets. Design your permissions accordingly.

The sandbox gives you a strong boundary for the host filesystem. Deny rules give you a reasonable guardrail for common cases. But for anything the agent can reach through application code — via Docker, test suites, or any other execution context — the only real protection is making sure there's nothing dangerous to find.

Don't just sandbox your secrets. Make sure the secrets themselves are safe to leak.

---
layout: post
title: "Wrapping Rake"
description: "Useful before and after hooks to rake "
date: 2021-03-21 10:23:00 -0400
comments: true
tags: [ruby, rake]
---

On the verge of a very risky deploy with paltry test coverage, I recently set out to build a number of dashboards to at least provide some signal if something had gone horribly wrong. Here I'm focusing on my efforts on our cron tasks, almost all of which simply run one rake task or another. My primary goal: for all rake tasks, report success or failure. This information must be traceable to the name of the task that failed. Other metrics such as run-time are bonuses.

## Not quite: task enhancement

Rake has a halfway useful feature called [enhance](https://www.rubydoc.info/gems/rake/Rake%2FTask:enhance). This allows you to dynamically attach dependencies to pre-defined rake tasks. In other words, it lets you define a task that will run prior to any desired task. You can also provide a block to `Rake::Task#enhance` that will run after successful completion of the task.

```ruby
task = Rake.application.tasks.find { ... }
task.enhance [:first_run_this, :next_run_this] do
  # ... run this afterwards ...
end
```

Immediately, there are two problem with this feature and our goal.

1. The block only runs on successful completion of the task. Not very useful when we want to log failures.
2. The dependency tasks have no awareness of the task being modified. Meaning we don't have access to the name of the primary task, so we can't report *which* task succeeded or failed; our report has no idea what it's reporting on!

As far as I could discover, there is no `around_filter` style wrapper to rake tasks.

## Run this no matter what

To solve problem 1, we can make judicious use of [`Kernel#at_exit`](https://apidock.com/ruby/Kernel/at_exit). This method accepts a block of code that will be run when the thread exits. This guarantees that we will have a post-execution hook that will be run on success or failure.

```ruby
task log_task_stats: :environment do
  at_exit do
    # ... we can log stats here, if we have them
  end
end
```

## We're gonna have to hack our way in

To solve problem 2, let's take a look at the [source](https://www.rubydoc.info/gems/rake/Rake/Task#enhance-instance_method) of `Rake::Task#enhance`. We can see it appends a block to a tasks `@actions` ivar. And, looking at how `@actions` is used in [`Rake::Tasks#execute`](https://www.rubydoc.info/gems/rake/Rake/Task#execute-instance_method), we're in luck: the blocks are called with the primary task as the first argument! Even better: the primary task block itself is an action in this array!

[`Rake::Tasks#actions`](https://www.rubydoc.info/gems/rake/Rake/Task#actions-instance_method) is part of the publicly document API, but it's a bit more than dicey to start adding blocks into this array ourselves instead of going through public methods. However, left with no other option, that's what we're going to rely on.

In short: action blocks know the task they are attached to, but public methods only give us a way to run them after a task. We'll use our own method to make sure our action block runs first.

Specifically:

1. We will *prepend* an action block that will set up our initial task data. This allows us to define a before_hook block that knows and can store the name of the primary task.
2. We'll set up an after_hook, though the normal channels, that set a `success` boolean. This datum will let our final hook know if the tasks succeeded or failed.
3. We'll use an `at_exit` hook to log our final stats, taking the task name stored by our first action block and the success status either set or left unset by the after_hook or it's absence.

First, let's define our before_hook as a lambda:

```ruby
setup = lambda do |task, *_args|
  @wrapped_rake_task_data = {
    task_name: task.name,
    started_at: Time.zone.now,
  }
end
```

(We use `*_args` because some tasks will pass these in, so we must accept them, but we don't care about them.)

Next, let's set up our final stats logging as its own task. Remember, we're using `at_exit` in a dependency task to run this on success *or* failure.

```ruby
task log_task_stats: :environment do
  # Run after task exits, regardless of success or failure
  at_exit do
    task_data = @wrapped_rake_task_data || {}
    task_name = task_data[:task_name]
    started_at = task_data[:started_at]
    task_data[:exited_at] = Time.zone.now
    task_data[:duration] = started_at && exited_at - started_at

    metrics = MetricsClient.new(...)
    metrics.emit(format(task_data))
  end
end
```

I'm leaving the `metrics` implementation here as pseudocode, since it's not the focus of this post. Also omited are bomb-proof error handlers -- this is, after all, going to be run at *every* rake task invocation: buyer beware.

Next we get the list of tasks we want to amend -- in our case *all* tasks, except for `environment` and our own `log_task_stats` task -- we can't have `log_task_stats` calling itself in an infinite loop!

```ruby
tasks = Rake.application.tasks
tasks -= [
  Rake::Task['environment'],
  Rake::Task['log_task_stats'],
]
```

Finally, we attack the hooks, including an inline-defined "success" action block:

```ruby
tasks.each do |task|
  task.actions.prepend(setup)
  task.enhance([:log_task_stats]) do
    # This runs only if the task successfully completes
    @wrapped_rake_task_data[:finished_at] = Time.zone.now
    @wrapped_rake_task_data[:success] = true
  end
end
```

The key, and the unconventional behavior we're invoking, is to `prepend` the setup lambda to `actions`.

The regular, post-run action block sets the `success` boolean and the end time; this block only runs if the task is successfully completed.

## In sum

1. `Rake::Task#enhance` allows us to define tasks that will run before our primary task, but have no access to the task name that we wish to modify. It also allows us to add a block that *is* aware of the task name but will only run on successful task completion
2. `Kernel#at_exit` lets us run hook that will run after successful *or* failed completion.
3. Hacking our own action block at the front of the `@actions` array of a given task lets us set up an action block that runs *before* the task and has access to the task name that we are modifying.

Combined, these three behaviors allow us to transparently add effective monitoring code to all rake tasks, including third-party and not-yet-written-by-other-teammates tasks without any need for a sweeping rake refacctor, monkey-patch of imported gems, or requiring other developers who have no eye on devops to modify their usage of rake.

And that's a wrap.

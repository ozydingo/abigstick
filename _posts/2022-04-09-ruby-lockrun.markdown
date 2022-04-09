---
layout: post
title: "Ruby LockRun"
description: "Ensuring singleton execution in a distributed system"
date: 2022-04-09 11:42:00 -0400
comments: true
tags: [ruby, cron, lock, lockrun]
---

## Singleton execution

In a [previous post](/2022/04/03/cron-tasks-as-interactors.html) I described a feature of a base Interactor class that would ensure only a single instance of that interactor could run at a given time. This was motivated by migrating cron tasks that had the same requirement, often written using the [lockrun](http://unixwiz.net/tools/lockrun.html) utility. In a crontab, this might look like the following task set to run every 5 minutes:

```
0-55/5 * * * * lockrun ./do_some_destructive_polling
```

where `do_some_destructive_polling` might, for example, loop over some external integration's data modifying its state, and this code is not safe to run multiple instances at once. Such an overlap might occur if (a) a single run happens to take longer than 5 minutes, causing the next invocation to overlap, or (b) any other process such as a manual admin intervention might launch another instnace of this task.

`lockrun` is a common way in a crontask to ensure that the second run just quits (default behavior) to allow the existing run to continue. You can of course configure the behavior on conflict, but this is the simplest and often desired behavior.

## Locking the Ruby

In the previous article I described how we were moving our cron tasks to be runnable Ruby interactors so that we could run this load on a scalable, distributed background job processing system (Resque, in our case). This presents two challenges:

- Since we're in ruby, we dont' have access to `lockrun` unless we shell out and then enter back into Ruby. This is a bit clunky.
- Since the tasks may run on one of any number of servers, the locking mechanism cannot be file-system based, as it is with `lockrun`, but instead must be shared across all instances.

A central database is an obvious choice for the second concern. Which database? For two main reasons I immediately pointed at Redis over SQL:

- Keys can automatically expire, which will save us from a lock that was erroneously left in place after a process quit.
- We don't really need any structured data here, just a key-value pair.

## Redis locking

Luckily, a simple redis-based locking mechanism has already been implemented by the [redlock](https://github.com/leandromoreira/redlock-rb) gem, referred to in the [redis docs](https://redis.io/docs/reference/patterns/distributed-locks/#implementations). While the gem does come with a [disclaimer](https://redis.io/docs/reference/patterns/distributed-locks/#implementations) conservatively cautioning that the locking behavior has not been formally analyzed, in practice it is quite robust.

## Adapting redlock to simple Ruby lockrun code

We will implement a Ruby version of `lockrun` that will be invoked as follows:

```rb
LockRun.run(key, expires_in_seconds) do
  ... code here ...
end
```

The code will run if and only if the lock is available; otherwise, it will simply pass.

We'll write a simple wrapper around `redlock`'s block `run` method, which is described as follows:

```rb
lock_manager.lock("resource_key", 2000) do |locked|
  if locked
    # critical code
  else
    # error handling
  end
end
```

We want the return value to tell us (1) if the lock was acquired, and (2) what the return value of the block was if executed. We'll define a class `LockRun::RunInfo` to capture this information, and our `run` method will look like this:

```rb
  def run(key, exp_seconds)
    lock_manager.lock(key, (exp_seconds * 1000).round, retry_count: 0) do |locked|
      return RunInfo.new(lock_acquired: false, return_value: nil) if !locked

      result = yield
      return RunInfo.new(lock_acquired: true, return_value: result)
    end
  end
```

`LockRun::RunInfo` can simply be a `Struct`:

```rb
RunInfo = Struct.new(:lock_acquired, :return_value, keyword_init: true)
```

Finally, we need to configure `redlock` to communicate with our redis. Here that is replaced with `YOUR_REDIS_URL`, but I suggest extracting this to an application boot configuration and using a separate redis database instance specifically for redlock. Note that a separate redis database can easily run in the same redis instance simply with an incremented db index, such as `redis://redis:6379/0` vs `redis://redis:6379/1`.

```rb
class LockRun
  RunInfo = Struct.new(:lock_acquired, :return_value, keyword_init: true)

  def self.redis
    @redis ||= Redis.new(url: YOUR_REDIS_URL)
  end

  # Allow LockRun.run as a convenience method that calls the instance method
  def self.run(key, exp_seconds, &blk)
    new.run(key, exp_seconds, &blk)
  end

  # The instance method
  def run(key, exp_seconds)
    lock_manager.lock(key, (exp_seconds * 1000).round, retry_count: 0) do |locked|
      return RunInfo.new(lock_acquired: false, return_value: nil) if !locked

      result = yield
      return RunInfo.new(lock_acquired: true, return_value: result)
    end
  end

  private

  def lock_manager
    @lock_manager ||= Redlock::Client.new([self.class.redis])
  end
end
```

And a quick demo

```rb
Thread.new { LockRun.run("xyz", 10) { puts "123"; sleep 5 } }; sleep(1); LockRun.run("xyz", 10) { puts "abc" }

123
# => #<struct DevOps::LockRun::RunInfo lock_acquired=false, return_value=nil>
```

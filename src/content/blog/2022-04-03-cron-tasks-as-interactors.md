---
title: "Cron tasks as Interactors"
description: "How OOP benefits the scripts in your application"
date: 2022-04-03 13:12:00 -0400
tags: [rails, cron, OOP, OOD, patterns]
---

## Interactors

I'm going to start with an overview of a very simple yet deceptively powerful object oriented design pattern: the interactor. An interactor is simply a class with one public callable method, neatly and obviously encapsulating its single responsibility.

```rb
class MyInteractor
  # The class method is a convenience: MyInteractor.call(args) instead of MyInteractor.new(args).call
  def self.call(*args)
    new(*args).call
  end

  # The One True Public Method
  def call
    # ... do the thing, call private methods, etc ...
  end
end
```

A nice feature of interactors is they are a dead-simple pattern that makes it hard to violate single responsibility principle. What can in other contexts be a confusing mess of code blocks and clashing method names become private methods in an interactor. Applied well, this can be very freeing.

Now, let's skip the bikeshedding about how Interactors are either The Best Thing To Happen To Code or The Stupidest Idea Because Of X Y And Z. There's a use case for well-designed interactors that I find incredibly powerful in an increasingly large monolithic application: scheduled tasks / scripts. For example, running a backup, cleanup, or data resync task once a day, once an hour, or whatever. These might be cron tasks in a more monolithic or legacy app or some time-triggered cloud function.

## Time Distribution

Let's talk about cron in a monolith. In particular, I'll use syntax consistent with the [whenever](https://github.com/javan/whenever) gem, which lets you write crontab files with a nicer Ruby DSL:

```rb
every 15.minute do
  rake 'gates:open_the_gates'
end

every 1.hour do
  rake 'gates:close_the_gates'
end
```

I've already written about [instrumenting rake tasks](/2021/03/21/wrapping-rake.html), but I just needed to _take it further_. Specifically, my goals included:

- Creating a pattern where cron tasks could _very easily_ be wired over to a Resque worker instead of run locally on the machine running cron
- Making it easy to write tests for our cron-invoked rake tasks
- Adding additional instrumentation, such as count, failure, and duration reporting, without continuing my ugly hacks into the Rakefile as I did in the previous post.
- Support tasks that could only have a single instance running (across any number of processes and machines)
- Make it easy to mark a particular task as "safe to run outside of prod" -- Because of, well, legacy, we had some unsafe tasks that we guarded by simply not installing the cron schedule in staging. This, of course, increased staging-production divergence, which was causing a lot of pain.

In particular, a big reason I got buy-in for the project because of the first bullet: we had a single machine running a increasingly large and memory-intensive set of cron tasks that started to crash said machine. There wasn't  and there wasn't an obvious path to having these run in a more distributed way without tons of refactoring and rewriting.

## OOP to the rescue

Step 1 was to create a base Interactor class, which I called `ApplicationInteractor` in keeping with `ApplicationRecord`, `ApplicationController`, and such. I was going to migrate code; largely cut-and-paste, from rake tasks into subclasses of `ApplicationInteractor`

```rb
class ApplicationInteractor
  def self.call(*args)
    new(*args).call
  end

  # Simply a placeholder for future development of shared init behavior
  def initialize(*); end

  def call
    raise NoMethodError, "#call is not defined for #{self.class}; please override it."
  end
end
```

With this in place, the following rake task

```rb
task :do_the_thing => :environment do
  big_long_code_vomit
end
```

becomes

```rb
class DoTheThing < ApplicationInteractor
  def call
    big_long_code_vomit
  end
end
```

This allows you to (1) very easily write tests for `DoTheThing#call` and (2) start refactoring `big_long_code_vomit` into private methods of the interactor. Already a win for code maintainability!

But we ain't even started yet.

## OOP to the Resque

The next task was aimed at our first requirement bullet point: pointing cron tasks at our background job processing system. We use Resque, but what follows could just as easily be done for Sidekiq, ActiveJob, or many others. If you  know these systems and have a keen eye, you might have already noticed something -- they already use interactors, usually with a method called `perform`. For Resque, this is a class method, but the concept is the same.

So for Resque, all we'd really have to is alias `call` as `perform` and it will work:

```rb
class ApplicationInteractor
  def self.call(*args)
    new(*args).call
  end

  class << self
    alias perform call
  end

  ...
end
```

However, we had already abstracted Resque worker classes (for instrumentation, db-backed tracking, and a few other more idiosyncratic reasons) to have an _instance_ method called `process`:

```rb
class ApplicationResqueWorker
  def self.perform(...)
    job = persist_job(...)
    report_start(job)
    burn_the_phoenix if !deploy_version_correct? # A story for another time
    new.process(*args)
    report_success(job)
  rescue StandardError => err
    report_error(job, err)
  end

  # Instance method API! Results in better classes.
  def process(*args)
    raise NoMethodError, "`process` is not defined for #{self.class}; please override it."
  end
end
```

Thus we have to implement something more like we would for Sidekiq with its instance method `perform` API. This is just as well, because I prefer that the interactor classes that are being defined to be different from the Resque classes themselves; this keeps their concerns of performing the task vs managing job / queue state separate.

So for each interactor, e.g. `DoTheThing`, I'd automatically define `DoTheThing::ResqueWorker` using Ruby's `inherited` hook:

```rb
  class << self
    def inherited(klass)
      super
      build_resque_class(klass)
    end

    private

    def build_resque_class(klass)
      # Create a new class that works as a Resque worker
      resque_class = Class.new(ApplicationInteractor::BaseResqueClass)
      # Save a pointer to the interactor class as data in the resque class
      resque_class.interactor_class = klass
      # Save the resque class as self::ResqueWorker
      klass.const_set(:ResqueWorker, resque_class)
    end
  end
```

Our `ApplicationInteractor::BaseResqueClass` is the basic adapter around our existing Resque abstraction. It defines the requisite `process` method that calls our original interactor.

```rb
  class ApplicationInteractor::BaseResqueClass
    # Base class that is used to construct the desired resque worker
    include ApplicationResqueWorker

    class << self
      # Store `interactor_class` as class data
      attr_accessor :interactor_class
    end

    def process(*args)
      self.class.interactor_class.call(*args)
    end
  end
```

Thus `DoTheThing::ResqueWorker` is a very simple class: it's a Resque worker (inheriting from `ApplicationResqueWorker`, with all of our bells and whistles) which calls our interactor with the same args.

## Get in line

The remaining piece for our MVP is to hook it up in our `schedule.rb` file. To do this with `whenever`, we'll define a few new custom job types:

```rb
# For tasks that cannot withstand any queueing whatsoever
job_type :call_interactor, "cd :path && bin/rails runner ':task.call' :output"
# For tasks that can accept their default queue
job_type :enqueue_interactor, "cd :path && bin/rails runner ':task::ResqueWorker.enqueue' :output"
# For tasks where cron wants to override the queue
job_type :enqueue_interactor_to, "cd :path && bin/rails runner ':task::ResqueWorker.enqueue_to(\":queue\")' :output"
```

Note that `enqueue` and `enqueue_to` come from our `ApplicationResqueWorker` class, details omitted. Also note: I found that `rails runner` took a non-negligibly higher amount of memory than `bundle exec rake`. For our 450 cron tasks this was important, so I rewrote these as their own rake tasks, but we needn't go into detail.

Now, we can hook up our cron schedule as follows

```rb
every 15.minute do
  enqueue_interactor 'Gates::OpenTheGates'
end

every 1.hour do
  enqueue_interactor 'Gates::CloseTheGates'
end
```

## Music to my fingers

So far, we've created a pattern for interactors in our application that allows us to write tests and better encapsulate the logic. We've made it easy to call or enqueue these interactors. We added a hook in our cron schedule generator to make it easy to migrate cron tasks to Resque. Those are already some pretty big wins!

And now that we have this pattern, we have the full benefit of OOP at our disposal -- let's keep going! Let's add a feature to our base interactor that emits metrics: run count, success, failure, and run time.

Ok, I'm actually going to make this a module for opt-in, but you could do this either way. As a module, we'll use `ActiveSupport::Concern` to easily define class methods such as an override to `call`. (I've simplified this slightly to omit return value tracking and more.)

```rb
module ApplicationInteractor::Instrumentation
  METRIC_BASE = "application.tasks"

  extend ActiveSupport::Concern

  module ClassMethods
    def call(*args)
      emit_count("count")
      DevOps.emit_timer_metrics(METRIC_BASE, tags: metrics_tags) do
        super
      end
      emit_count("success")
    rescue StandardError
      emit_count("failure")
      raise
    end

    private

    def metrics_tags
      {task_name: self.name}
    end

    def emit_count(name)
      DevOps.emit_metric("#{METRIC_BASE}.#{name}", 1, type: "count", tags: metrics_tags)
    end
  end
end
```

Without going into detail about the implementation of `DevOps`, we now get `count`, `success`, `failure`, and `run_time` metrics in every `ApplicationInteractor` that includes this module, without the authoring developer needing to think about it more than know they can `include ApplicationInteractor::Instrumentation`. Sweet!

## Production-ready

One of the other requirements was to mark specific tasks as safe or unsafe to run in production. We have almost 500 unique cron tasks (yikes), so deciding on a case-by-case basis was not in the cards at this time. Instead, the path forward is to mark _all_ interactors that came from cron tasks as unsafe, and one-by-one turn them on as needed or able. With our OOP structure, this is stupid easy.

Every cron task based interactor gets one more module: `ApplicationInteractor::LegacyCron`

```rb
class DoTheCronThing < ApplicationInteractor
  include ApplicationInteractor::Instrumentation
  include ApplicationInteractor::LegacyCron
  ...
end
```

It's just an ENV-overridable guard clause:

```rb
module ApplicationInteractor::LegacyCron
  extend ActiveSupport::Concern

  module ClassMethods
    def call(*args)
      return if !Rails.env.production? && !ENV["FORCE_LEGACY_CRON"]

      super
    end
  end
end
```

We _could_ do something more useful for the conditional. But doing nothing is existing behavior, and I'm not going to spend too much more time thinking about adapting legacy code for non-production environments. So that's it!

## Locked down

The last requirement was the ability to run tasks as singletons -- no other instance of the task is allowed to run at the same time as another. This might be a destructive order polling loop where race conditions are best avoided. In single-instance cron world, we used [lockrun](http://unixwiz.net/tools/lockrun.html) to do this. We'll accomplish this by, you guessed it, another module. We'll use redis to store our locks, backed by the [redlock](https://github.com/leandromoreira/redlock-rb) gem.

This is a bit simplified; in production I wrote a root-namespace `LockRun` class that wraps `redlock` without any notion of interactors, and use that class here. For simplicity here, I'm smashing it all together and omitting some nicities like more detailed return values.

```rb
module ApplicationInteractor::LockRun
  extend ActiveSupport::Concern

  module ClassMethods
    def lock_expiry_in_seconds
      1.hour.to_i
    end

    # Use the class name for the lock key
    def lock_key_name
      name
    end

    def call(*args)
      lock_manager = Redlock::Client.new([REDIS_CONFIG])
      lock_manager.lock(lock_key_name, (lock_expiry_in_seconds * 1000).round, retry_count: 0) do |locked|
        if locked
          super
        elsif ancestors.include?(Instrumentation)
          emit_count("locked")
        end
      end
    end
  end
end
```

Some really nice features of this system:

- Since we're using redis, all of our application instances and workers respect the same lock.
- Since we're using the class name as a key, no two instances of the same interactor will run simultaneously.
- Since we're using expiring redis keys, we get a timeout on our lock in case a machine goes MIA. Note that any uncaught errors are handled by `redlock` to release the lock, it's only if a machine goes poof that we might leave a dangling lock. And machines do go poof.
- We now get metrics for each lockout. This is a nice bonus feature that we didn't have before, and allows us to easily track when a LockRun process is too slow for its own schedule.

## That's all the time we have

To sum up:

- We created a base class `ApplicationInteractor` to standardize the use of task-oriented interactors in our application.
- We moved our rake tasks into interactor classes. This allows them to be testable, refactorable, and break out more private methods for better maintainability.
- We created an easy way to use these interactors from cron, either directly or kicked off to a background job processor such as Resque. This allows our cron instance to lighten its load, putting the heavy lifting on our more scalable job processing machines.
- We added an easy module to instrument our interactors. We chose opt-in over opt-out or required, but any of these are just as easy.
- We added a module for our existing cron tasks to avoid running them outside of production until we've had time to deem them safe and/or necessary.
- We added a module to robustly lock invocations of a given interactor class across all of our machines so that two instances could not run at the same time.

Not bad for a little OOP.

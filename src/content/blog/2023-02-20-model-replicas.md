---
title: "Model Replicas"
description: "A more targeted approach to connecting to readonly replica database instances"
date: 2023-02-20 20:18:00 -0400
tags: [rails, db, replica, activerecord]
---

## Readonly Replicas

Since Rails 6, ActiveRecord has provided a great way to connect to a readonly replica database instance. In brief, with a simple database configuration, `ApplicationRecord` configuration, and block of code, you can execute all database connections within the block connected to a readonly replica, allowing you to spread your query load among database hosts.

database.yml:

```yaml
production:
  primary:
    <<: *default_config
  replica:
    <<: *default_config
    hostname: replica.db_host.foo
    replica: true
```

ApplicationRecord:

```rb
class ApplicationRecord < ActiveRecord::Base
  ...
  connects_to database: { writing: :primary, reading: :replica }
  ...
end
```

Code:

```rb
ApplicationRecord.connected_to(role: "reading") do
  ... code here connects to your configured replica ...
end
```

However, there is a major limitation to this approach, especially when adapting legacy code. In particular, legacy code where it may be difficult to separate the read and write concerns, often because it's a core engine of a product that has accumulated lots of little add-ons and features over the years, AKA a prime candidate to move over to a replica as a quick win to distributing your load.

In a simplified example (yes, really, it's simplified), we had a market page where users could view and claim jobs. This page had lots of little features, such as filters, forecasts, summaries, and all sorts of bells and whistles the product team dreamed up over a decade of operation. As one of the most visited pages of the app with the heaviest set of queries, shifting the core query for what jobs were available became an easy target to move to a read replica.

```rb
# cartoonized example
def index
  # Get the jobs (READ)
  all_jobs = get_all_available_jobs
  # Apply filter conditions and save filter settings (READ, WRITE)
  filtered_jobs = apply_filters(jobs, filters)
  # Adjust filters based on conditions (WRITE)
  auto_adjust_filters(filters, all_jobs)
  # Store analytics (WRITE)
  log_filter_effect(all_jobs, filtered_jobs, filters)
  # Create job recommendations (READ)
  recommended = recommend_jobs(filtered_jobs)
  # Store recommendations for future reuse (WRITE)
  save_recommendations(recommended)
  # Create predictions for future jobs (READ, WRITE)
  generate_job_forecast(jobs)
  # Create a summary and index the view (READ, WRITE)
  save_and_display_job_summary(filtered_jobs)
  # Paginate the jobs (READ)
  @jobs = paginate(filtered_jobs)
end
```

Unfortunately, with all those bells and whistles and quick MVPs, a few writes (saving profile settings, filters, logging, and instrumentation) were intermingled with the construction of the core queries. Refactoring was going to be a slog.

## Target the replica only for a single query

The problem with moving the above example to a replica is that there was no single contiguous block of code that could be executed in a replica context that isn't littered with writes. And you can't just dart in and out of a `connected_to` block, as using the jobs query outside and inside of the replica blocks now just causes ActiveRecord to do double duty, executing the same basic query on _both_ the primary and replica database connections. That's the opposite of what we want! Plus, when a `connected_to` block returns a constructed query, that query is immediately executed, which is problematic if we don't intend to execute the query until a later pagination, for example.

But why does the replica need to be so all-or-nothing? Only because that's the mechanism ActiveRecord gives us by default.

What if, instead of a big block where _all_ connections are executed against a replica, we just used a single stand-in model for our jobs, one that could query the jobs table just like the real thing, but itself be configured only to query the replica? As long as _that model_ was used in a read-only context, any other model writes could happen (user profiles, instrumentation events, forecasts and summaries, saved filters) with no problem.

Really, this idea is simple enough. Let's say our jobs model is represented by a model `Job`. It's easy enough to create a subclass of `Job` that reconfigures its database connection, simply by pointing _both_ the `writing` and `reading` roles at the replica. This way, the default connection (which [will be `writing`](https://guides.rubyonrails.org/active_record_multiple_databases.html#setting-up-your-application)) for this subclass will connect to the replica

```rb
class ReadOnlyJob < Job
  connects_to database: { writing: :replica, reading: :replica }
end
```

So ... we're done, right?

## Controlling your STIs

There's a significant hitch. The battled Rails developer will have felt the red flag go up as soon as we created a subclass of an `ActiveRecord` model. Single Table Inheritance (STI) in Rails works by using subclasses of a base `ActiveRecord` model, so any other usage of subclasses can play poorly with STI models. In our case I'm using `Job` to illustrate because it was already an STI model with subclasses such as `EditJob` and `AuditJob`.

There are two issues we will have to wrestle, all dealing with how any given `ReadOnly` subclass is supposed to act identically to its superclass as far as query generation.

1. Our `ReadOnly` subclass is not another STI type, and the `ReadOnly` name should not be used in the query
2. What class should should be used to instantiate a record of a `ReadOnly` class?

The first problem with #1 is immediately evident in any generated query. Here, the SQL engine looks for a record with type `EditJob::ReadOnly`, but no such records exist.

```rb
EditJob::ReadOnly.all.to_sql
# =>  "SELECT `jobs`.* FROM `jobs` WHERE `jobs`.`type` = 'EditJob::ReadOnly'"
EditJob::ReadOnly.last
# => nil
```

So, that's no good. But that's a simple fix. We just need use the same [STI name](https://api.rubyonrails.org/classes/ActiveRecord/Inheritance/ClassMethods.html#method-i-sti_name) as our superclass. So, on `EditJob::ReadOnly`'s singleton class:

```rb
  delegate :sti_name, to: :superclass
```

giving us

```rb
EditJob::ReadOnly.all.to_sql
# =>  "SELECT `jobs`.* FROM `jobs` WHERE `jobs`.`type` = 'EditJob'"
```

Yay!

```rb
EditJob::ReadOnly.last
# !!! ActiveRecord::SubclassNotFound (Invalid single-table inheritance type: EditJob is not a subclass of EditJob::ReadOnly)
```

Uh oh.

What's happening here? This is issue #2. The query is correct, and returns an `EditJob` record. However, ActiveRecord's STI implementation [has a check](https://github.com/rails/rails/blob/7c70791470fc517deb7c640bead9f1b47efb5539/activerecord/lib/active_record/inheritance.rb#L295) that when a record (`EditJob`) in initialized it is in fact an instance of the STI class being used (`EditJob::ReadOnly`). This allows you to initialize a subclass of `EditJob`, such as `ReallySpecificEditJob < EditJob`, when querying for an `EditJob` (because, after all, a `ReallySpecificEditJob` `is_a` `EditJob` based on the rules of OOP inheritance), but won't let you initialize a `TotallyUnrelatedJob` as an `EditJob`.

Since `EditJob` is not a subclass of `EditJob::ReadOnly` (in fact, the reverse is true), this triggers, and we get the error above.

Not to worry! We can again use the superclass' method so that the same class names that pass for the `EditJob` class will pass for our subclass. This one is a private method, so we have to be a little naughty and use `send`:

```rb
  def find_sti_class(type_name)
    superclass.send(:find_sti_class, type_name)
  end
```

Now,

```rb
EditJob::ReadOnly.last
# => #<EditJob id: ..., ...>
```

Yay!

But we're not actually done with issue #1. We've solved it for every _subclass_ of our base class, but not the base class itself. To illustrate, consider that a query for the base class, `Job`, does _not_ insert any query conditions:

```rb
Job.all.to_sql
# => "SELECT `jobs`.* FROM `jobs`"
```

This is more efficient than adding in a query for all possible `Job` subclasses. ActiveRecord [accomplishes this](https://github.com/rails/rails/blob/7c70791470fc517deb7c640bead9f1b47efb5539/activerecord/lib/active_record/inheritance.rb#L91) by excluding type conditions if this class is the top-level base class.

But `Job::ReadOnly` is not the top level base class.

```rb
Job::ReadOnly.all.to_sql
# => "SELECT `jobs`.* FROM `jobs` WHERE `jobs`.`type` = 'Job'"
```

As we illustrated above, our fix tells ActiveRecord to use `Job` and not `Job::ReadOnly` in the query constraint. However, in this case, we want _no constraints_, just like im our base class. The way ActiveRecord decides this is via the `descends_from_active_record?` method, which returns `true` for the base class and `false` for every other class.

So, once again, we will use the superclass method.

```rb
  delegate :descends_from_active_record?, to: :superclass
```

Now,

```rb
Job::ReadOnly.all.to_sql
# => "SELECT `jobs`.* FROM `jobs`"
```

There's one more case to consider. We've solved for the base class and concrete subclasses. But abstract subclasses that themselves have subclasses are still unhappy:


```rb
ManualJob.all.to_sql
# => "SELECT `jobs`.* FROM `jobs` WHERE `jobs`.`type` IN ('ManualJob', 'ManualJob', 'EditJob', 'EditJob', 'AuditJob' 'AuditJob')"
ManualJob::ReadOnly.all.to_sql
=> "SELECT `jobs`.* FROM `jobs` WHERE `jobs`.`type` = 'ManualJob'"
```

This occurs because once ActiveRecord has decided to add a type condition, it does so by [adding the types of all known descendants](https://github.com/rails/rails/blob/7c70791470fc517deb7c640bead9f1b47efb5539/activerecord/lib/active_record/inheritance.rb#L306) of the queried class as we can see in the first query. While `ManualJob` has two subclasses, `EditJob` and `AuditJob`, the `ManualJob::ReadOnly` class has no descendants. So the classes don't make it into the query.

As a related problem, you can see the first query duplicates `EditJob` and `AuditJob` in the query. This is because `EditJob::ReadOnly` _is_ a descendant of `ManualJob`, and its `sti_class` as we've overridden above is just `EditJob`. The first `EditJob` in the query corresponds to the true `EditJob` class, and the second corresponds to the `EditJob::ReadOnly` subclass.

Both issues are solved with the same solution: override the `type_condition` method. The actual list of type names to use is buried inside this method, so we have to copy over the whole thing and override the parts we need. This is definitely the dirtiest part of this work, but it'll do:

```rb
  def type_condition(table = arel_table)
    # Same as original
    sti_column = table[inheritance_column]
    # Grab descendants from superclass instead of self, remove dups
    sti_names = [superclass] + superclass.descendants.map(&:sti_name).uniq
    # Same as original
    predicate_builder.build(sti_column, sti_names)
  end
```

Finally,

```rb
ManualJob::ReadOnly.all.to_sql
=> "SELECT `jobs`.* FROM `jobs` WHERE `jobs`.`type` IN ('ManualJob', 'EditJob', 'AuditJob')"
```

## The abstraction

Putting it all together, we have four class methods and a model database configuration to override. To do this in the abstract, we'll override the methods in a module, and extend that module as well as define the database configuration in an `inherited` hook of our root `ApplicationModel` class. This way, every model class we define gains its very own `ReadOnly` nested class that connects to the replica.

Note that in order to use `connects_to`, we need a named class. Thus we will use `class_eval` to create the nested class rather than `const_set` with `Class.new`.

```rb
class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true

  connects_to database: { writing: :primary, reading: :replica }

  # HiddenFromSTI: Allow a subclass to behave identically to its superclass from
  # the perspective of ActiveRecord STI. This module is useful for defining a
  # ReadOnly subclass of STI models
  module HiddenFromSTI
    # Use same STI name as superclass (`type` field value in the table)
    # The allows `Foo::Readonly` to load records with sty type `"Foo"`
    delegate :sti_name, to: :superclass

    # ActiveRecord will not add type conditions to the base class. It does this via
    # `descends_from_active_record`; use superclass' definition to accomplish the same.
    # I.e. Job::ReadOnly should not add and `type` constraints, as `Job` does not.
    delegate :descends_from_active_record?, to: :superclass

    # Use the superclass method of class resolution to avoid an error where a record with
    # type == "Foo" is not a subclass of Foo::ReadOnly.
    # This also instantiates a `Foo::ReadOnly` record as a regular `Foo`
    def find_sti_class(type_name)
      superclass.send(:find_sti_class, type_name)
    end

    # Override default type conditions to:
    # 1. Include subclasses of the real class in the query
    #    -> For this, we grab the descendants of the superclass instead of self
    # 2. Exclude ReadOnly classes from the query
    #    -> For this, we de-dup the names list since we've already overridden `sti_name`
    # Original source: https://github.com/rails/rails/blob/7c70791470fc517deb7c640bead9f1b47efb5539/activerecord/lib/active_record/inheritance.rb#L306
    def type_condition(table = arel_table)
      # Same as original
      sti_column = table[inheritance_column]
      # Grab descendants from superclass instead of self, remove dups
      sti_names = ([superclass] + superclass.descendants).map(&:sti_name).uniq
      # Same as original
      predicate_builder.build(sti_column, sti_names)
    end
  end

  class << self
    def inherited(model)
      super
      # Stop infinite recursion: don't trigger this inherited hook on the
      # definition of our ReadOnly class
      return if model.name&.demodulize == "ReadOnly"

      # NOTE: we must define a named class since `connects_to` does not support anonymous classes
      # Therefore, we cannot use `Class.new(...)`, and must instead use the `class` keyword
      model.class_eval <<-BLOCK, __FILE__, __LINE__ + 1
        class self::ReadOnly < self
          extend ApplicationRecord::HiddenFromSTI
          connects_to database: { writing: :replica, reading: :replica }
        end
      BLOCK
    end
  end
end
```

Now, our availble jobs index can construct a replica-bound jobs query while writing other models

```rb
jobs = Job::ReadOnly.available
user.profile.update!(last_seen_job_count: jobs.count)
jobs.where(name: filter).count
```

but we can confirm we're connected to the replica configuration by attempting an update action:

```rb
jobs.update_all(name: "bar")
# !!! ActiveRecord::ReadOnlyError (Write query attempted while in readonly mode: UPDATE `jobs` SET `jobs`.`name` = 'bar' WHERE `jobs`.`type` IN ('Job', 'ManualJob', 'EditJob', 'AudiJob') AND `jobs`.`state` = 'available')
```

Copy that.

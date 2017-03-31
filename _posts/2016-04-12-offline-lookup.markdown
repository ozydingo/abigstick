---
layout: post
title: "offline_lookup"
date: 2016-04-12 17:36:36 -0400
comments: true
categories: 
---

## Add convenient syntax and reduce db fetches for small lookup tables
<a href="#tl-dr-offline_lookup">tl; dr</a>

A common pattern in many apps is to have a small set of enumerable options in a database table. A good example we have is turnaround_levels, which decsribe various speeds of service customers are pyaing us for. For simplicitly, let's pretend we have the following values: "Two Hour", "Same Day", "Standard", and "Extended". A lot of our code was littered with calls such as `Foo.where(turnaround_level_id: TurnaroundLevel.find_by(name: "Standard").id)`. An alternative could have been `Foo.joins(:turnaround_level).merge(TurnaroundLevel.where(name: "Standard"))`. All of these are equally ugly to me. Further, this itself littered the logs with these tiny lookups of Turnaround Level, which seems silly since there are, short of large policy changes, pretty static.

The existing solution was scaterred between two options:

- hard-coding constants such as `STANDARD_ID`, etc, into TurnaroundLevel
- hard-coding a Hash of the actual rows of the turnaround_levels table into `TURNAROUND_LEVELS`, keyed either on id or name.

I wanted something more dynamic, flexible, and modularizeable. I wanted to say `TurnaroundLevel.standard_id`. I wanted to be able say `TurnaroundLevel.one_hour_id` without thinking about it as soon as "One Hour" was added to our databse. And I wanted to be able to enable this feature in other models easily. So I created OfflineLookup.

My initial motivation was cutting down on db accesses. but with such a small table and indexed properly, it's really not a performance hit. But it has remained popular as it is very convenient syntax, keeping our code and our logs a little cleaner.

This gem was motivated by creating methods such as `:two_hour_id` and `:standard_id`. I assumed the key field of interest was called "id", but imediately saw the need to customize the name of the lookup column. In this case, it was "name". So the stripped down, basic, original implemnetation looked like this:

```ruby offline_id_lookup.rb
module OfflineIDLookup
  extend ActiveSupport::Concern

  module ClassMethods

    def use_offline_id_lookup(field = :name)
      lookup_values = {}
      self.find_each{|row| lookup_values[row.id] = row[field]}

      self.singleton_class.instance_eval do
        lookup_values.each do |id, name|
          define_method "#{name}_id".methodize do
            id
          end
        end
      end
    end

  end
end

ActiveRecord::Base.class_eval { include OfflineIDLookup }
```

When a model calls `use_offline_id_lookup`, it defines class methods `#{name}_id`, for each methodized `name` in the table. This assumes name uniqueness off the bat, which may not be correct. And of course, if the table its operating on is large, it's a pretty bad idea; not just because you're polluting your model with tons of new methods, but because all those values that logically live inside the db are being kept in memory now. But for a table with a handlful of rows, it's perfect.

There were a number of modifications I wanted to make. I quickly learned that whlie `TurnaroundLevel.two_hour_id` was what I wanted most of the time, there were times when I has "Two Hour" as a string. So I created two new methods:

<a name="arg_methods"></a>

```ruby arg_methods
        define_method "#{field}_for_id" do |id|
          lookup_values[id]
        end

        define_method "id_for_#{field}" do |name|
          lookup_values.keys.find{|id| lookup_values[id].methodize == name.to_s.methodize}
        end
```

`TurnaroudnLevel.id_for_name(tuurnaround)` is not hugely more convenient or readable than `TurnaroundLevel.find_by(name: turnaround).try(:id)`, but I still deemed the benefit worth the extra namespace pollution. We already had the lookup data in memory anyway. This became even more true when I moved away from defining these methods in a closure (i.e. a block where I'm referring to variables defined outside the block) because I remain unsure of the overhead of keeping track of large arrays of data define outside a closure. I felt it cleaner and more object=oriented to use a class attribute to store the lookup values on the class itself. So now the root module looks as follows. You'll notice I also started customizing the key field and adding some keyword arg options to the call to what is not simply called `use_offline_lookup`:

```ruby offline_lookup.rb
module OfflineLookup
  module ActiveRecord
    def use_offline_lookup(field = :name, key: :id, lookup_methods: true)
      class_attribute :offline_lookup_values, :offline_lookup_options
      self.offline_lookup_options = {field: field.to_s, key: key.to_s, lookup_methods: lookup_methods}.freeze
      self.offline_lookup_values = self.all.pluck(key, field).to_h.freeze

      include OfflineLookup::Base
    end
  end
end
```

`OfflineLookup::Base` is now free as its own module to define any methods it wants, and will have access to any of the class attributes defined in the call to `use_offline_lookup`.

When all the dust settled, I ended up with the following types of methods for each entry in the table:

* `:two_hour_id`: return the id for the "Two Hour" TurnaroundLevel.
* `:two_hour`: return the TurnaroundaroundLevel instance with name "Two Hour"
* `:two_hour?` (instnace method): return true iff the TurnaroundLevel instance was "Two Hour"

This last one technically violates the gem name: I'm only storing the (id, name) pairs, so this method is not possible with a db lookup. The alternative is to store the full objects in memory, but I'd rather not. And the convenience of having `TurnaroundLevel.two_hour` was in keeping with the spirit of the gem.

As we saw [above](#arg_methods), we also had two extra methods where you could pass in the lookup values as args:

* `:name_for_id(id)`: return the name for the given id.
* `:id_for_name(name)`: return the id for the given name.

<a name="tl-dr-offline_lookup"></a>

The full gem is available at [https://github.com/ozydingo/offline_lookup]

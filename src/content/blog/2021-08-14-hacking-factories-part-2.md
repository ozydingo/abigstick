---
title: "Hacking FactoryBot to build a factory UI (2 of 2)"
description: "Part 2: Hacking around uniqueness validations"
date: 2021-08-14 23:45:00 -0400
tags: [rails, rspec, factory_bot, ruby, gem, rubygems]
---

## Quick Recap

In our [last post](/2021/04/23/hacking-factories-part-1.html), we described most of the back-end basics that allowed us to interact with FactoryBot reliably enough to expose its functionality to a UI. We encountered a problem: any records with uniqueness validations would trigger validation errors when called on subsequent requests. Our quick and dirty solution was to brute-force it:

```rb
def build(factory, traits, attributes)
  resource = insistently do
    FactoryBot.create(factory, *traits, attributes)
  end
  return resource
end

def insistently(tries = 30)
  tries.times do |attempt|
    return yield
  rescue ActiveRecord::RecordInvalid
    raise if attempt >= tries - 1
  end
end
```

In this post, we'll do better.

## Explicit Action

We'll require application developers to decide which sequences to advance, but we'll automatically try to figure out by how much. In a future version, we might automatically detect sequences that are used for fields that have uniqueness validations, but that was a step too far for this iteration. Our current approach will look like the following code in an initializer file at `/config/initializers/factory_burgers.rb`:

```rb
FactoryBurgers::Cheating.advance_sequence(:user_email, User, :email)
```

Wut?

## Hijacking Ruby Blocks

So the strategy for this `advance_sequence` method is quite devious. Say you have a sequence `:user_email` defined like this

```rb
sequence :user_email do |ii|
  "my_email_#{ii}@provider.net"
end
```

What we want to do is find records in the database that match this sequence. But we need to do this automatically without reading the source code behind the block. This is where the real hackery comes in. This block is intended to be used by FactoryBot passing in an integer arg to generate the next sequence output value. But we want to use the same pattern but instead of the next output we want to generate a wildcard SQL query fragment or Regex pattern that will match any value produced by this sequence. To do this, we'll find where this block is stored, then execute the block with a sentinel value that will fill in the wildcard.

For example, in MySQL we want to generate a query like `users WHERE email LIKE 'my_email_%@provider.net'`. Therefore we want to use the block to produce the string `"my_email_%@provider.net"`. For a regex we want to generate a pattern `/my_email_(\d+)@provider.net/`. The most obvious but incomplete solution is to simply pass these strings in directly. To demonstrate:

```rb
proc = Proc.new { |ii| "my_email_#{ii}@provider.net" }
proc.call(1)
# => "my_email_1@provider.net"
proc.call('%')
# => "my_email_%@provider.net"
Regexp.new proc.call('\d')
# => /my_email_\d@provider.net/
```

Three problems remain with this approach.

### The Hacky

The first is: how do we get the block associated with a sequence? This is the hackiest part, since there's no documented or guaranteed API for this. But as it happens, poking around, we can find the block in an instance variable called `@proc` of any `FactoryBot::Sequence`. It's not even exposed as an `attr_reader` or in any public method, so this is of course an extremely fragile implementation, but thanks to Ruby we've got our way in.

```rb
proc = sequence.instance_variable_get(:@proc)
```

And we're in business. Shady business, but business. We can make our SQL query into the database, and find all records that match the sequence.

### The Devious

The second problem is that the block might blow up when you pass in a String such as `"%"` instead of an Integer. For example, consider this sequence

```rb
sequence :even_or_odd do |ii|
  ii.odd? ? "odd" : "even"
end
```

`String` does not have a method `odd?`, so this block will barf on `"%"` as input. Instead of passing in the string directly, then, we're going to be tricksy and pass in a proxy object. This is where it gets devious. Our proxy object will have a `to_s` method that returns the replacement string (e.g. `"%"`), and will otherwise ignore all method calls. It will do this be returning `self` in `method_missing`. Thanks, Ruby!

```rb
module FactoryBurgers
  class SequenceInjector < BasicObject
    def initialize(replacement_value)
      @replacement_value = replacement_value
    end

    def to_s
      @replacement_value
    end

    def method_missing(_name, *_args)
      return self
    end
  end
end
```

To demonstrate this in action, we can play with a `SequenceInjector` instance:

```rb
inj = FactoryBurgers::SequenceInjector.new("%")
# => %
2.6.3 :048 > "Hello, #{inj}"
# => "Hello, %"
 "#{inj.days * 24} hours"
# => "% hours"
 ```

### The Janky

The third problem is that we still need to find the highest number used in the sequence matches we get from the query. However, we don't actually know how the numeric arg is used in the sequence, so we can't just take the max value in the database. For example, this approach would fail to find the highest number for either of the following two sequences:

```rb
sequence :bottles_of_beer do |ii|
  "#{99 - ii} bottles of beer"
end

sequence :psuedo_token do |ii|
  (a..z).to_a.sample + ii.to_s
end
```

This is where the regex pattern comes in. While grabbing all matching records from the database to do additional filtering in memory is less than ideal for many reasons, we're accepting it because (a) we don't ever expect more than hundreds of factory-generate records for even a heavy development use case, and (b) we have to. We'll use a capture group in our regexp wildcard and use that to extract only the interpolated value, ignoring everything else about the string.

```rb
FactoryBurgers::SequenceInjector.new("(\d+)") # numeric match only
```

Note a known current limitation that this approach would work for the `pseudo_token` sequence above, but would not be correct for the `bottles_of_beer`. That said, armed with our sql fragment and regex pattern, here's our current process for finding the highest numeric match:

```ruby
def find_highest_index_value(klass, column, sql_fragment, regex_pattern)
  matches = klass.where(sql_fragment).pluck(column).select { |val| val =~ regex_pattern }
  return matches.map { |value| value =~ regex_pattern && Regexp.last_match(1) }.map(&:to_i).max
end
```

## Tying It All Up

So all that's left, under the assumption that we found a numeric value, is to call the sequence that many times so that the next time it's called using a factory method it will produce a new, non-conflicting value. We can call the sequence the same way we do in tests, using `FactoryBot.generate(sequence_name)`.

```rb
def advance_sequence(name, klass, column, sql: nil, regex: nil)
  sequence = FactoryBot::Internal.sequences.find(name)
  sql ||= sql_condition(sequence, column)
  regex ||= regex_pattern(sequence)

  highest = find_highest_index_value(klass, column, sql, regex) or return nil
  highest&.times { FactoryBot.generate name }
end
```

As promised, the application needs only to include

```rb
FactoryBurgers::Cheating.advance_sequence(:user_email, User, :email)
```

and we've dodged a bullet.

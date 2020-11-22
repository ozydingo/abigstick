---
layout: post
title: "Fun with Enumerators, part 3: Wrapping Enumerators"
description: "It's Enumerators, all the way down."
date: 2020-11-22 07:24:00 -0400
comments: true
tags: [ruby, enumerators]
---

In this post, we'll write wrappers around existing enumerators to give us more complex enumeration behavior all in a single parent enumerator that we can simply `each` over. One example we'll build will limit items taken from each of several source enumerators, but then resume taking items from each enumerator once all limits have been met.

There are two ruby prerequisites you'll need to really understand to synthesize the enumerator wrapping we're going to do.

1. Creating enumerators, internal, and external iteration

```ruby
e = Enumerator.new do |enum|
  enum.yield("first")
  enum.yield("second")
  ["foo", "bar", "baz"].each { |item| enum.yield(item) }
end
```

As you might expect, this enumerator will yield, in order,

```
first
second
foo
bar
baz
```

We could have created effectively the same object using `%w[first second foo bar baz].each`, but here we're illustrating how to build an enumerator from custom logic.

Before we move on, let's point out the usages of an enumerator: the more Ruby-familiar, internal iteration:

```ruby
e.each { |s| puts s.upcase }
# => FIRST
# => SECOND
# => FOO
# => BAR
# => BAZ
```

and external iteration:

```ruby
loop { puts e.next.upcase }
# => FIRST
# => SECOND
# => FOO
# => BAR
# => BAZ
```

What's the difference other than syntax? Try running each of the above again:

```ruby
e.each { |s| puts s.upcase }
# => FIRST
# => SECOND
# => FOO
# => BAR
# => BAZ

loop { puts e.next.upcase }
# (no output)
```

The first we're used to; we expect to get all elements of an `Enumerable` any time we call `each` on it. The second may be more familiar to pythonistas -- enumerators, like Python's generators, keep internal state and don't rewind (unless you explicitly call the `rewind` method). This makes sense here if you think about it; `e.next` needs to be able to take the "next" element every time it's called. It has no idea that it's being called in a "second" `loop`, and will keep yielding nothing until you tell it to rewind.

2. Ruby's `loop` and `StopIteration`

Many rubyists are likely to have raised an eyebrow at by use of `loop` above. In Ruby, you typically use `each`, `times`, or one of the other `Enumerable` methods to iterate. The reason I'm using `loop` here is because it automatically rescues from `StopIteration`, which an `Enumerator` will raise once it's done. Try it now--

```ruby
e.next
# StopIteration (iteration reached an end)
```

Throw it in a `loop`:

```ruby
ii = 0
loop do
  ii += 1
  puts ii
  raise StopIteration if ii == 3
end
puts "I'm done here."
# 1
# 2
# 3
# I'm done here
```

We'll be taking advantage of this behavior.

## Player 1: limited enumeration

Let's start building! First, let's construct two arbitrary sources of data to represent our problem;

```ruby
x = [{amount: 1}, {amount: 2}, {amount: 3}, {amount: 4}, {amount: 5}]
y = [{amount: 10}, {amount: 9}, {amount: 8}, {amount: 7}, {amount: 6}]
```

Our first goal is to build an enumerator that can yield items from one of these sources until a cumulative amount threshold has been reached. By itself, that could be done with [take_while](https://apidock.com/ruby/Array/take_while). However, we *also* want to be able to resume from the same position, and to do this we need to build an Enumerator using external iteration.

```ruby
def threshold_enumerator(source, threshold)
  Enumerator.new do |enum|
    total = 0
    loop do
      item = source.next
      enum.yield(item)
      total += item[:amount]
      raise StopIteration if total >= threshold
    end
  end
end

source_x = x.each
thresholded_x = threshold_enumerator(source_x, 3)
thresholded_x.to_a
# => [{:amount=>1}, {:amount=>2}]
```

Here, we internally track the total `amount`, and stop iteration via `StopIteration` when the threshold has been reached. And here's the key:

```ruby
source.next
# => {:amount=>3}
```

Our enumerator kept its state, and will continue to yield items from its current cursor!

Note: iteration via methods such as `to_a` or `map` will still start iteration from the start, while still not affecting the enumerator's state:

```ruby
source.map { |item| item[:amount] }
# => [1, 2, 3, 4, 5]
 source.next
# => {:amount=>4}
```

Eseentially, using external iteration via `next` lives on a different plane than using internal iteration via `map` and so on.

## Player 2: aggregated enumeration

We have the tools to iterator to a threshold, stop, and continue. Let's put this together with another enumerator wrapper that steps over several source enumerables, stopping at the threshold, then continuing for each where they left off.

```ruby
def stop_and_continue(sources, threshold)
  Enumerator.new do |enum|
    # Convert sources into enumerators in case they are simple, lowly, enumerables.
    enumerators = sources.map(&:each)
    # Create thresholded enumerators from source enumerators.
    thresholded = enumerators.map { |s_enum| threshold_enumerator(s_enum, threshold) }
    # For each thresholded enumerator, yield elements.
    thresholded.each do |t_enum|
      loop { enum.yield t_enum.next }
    end
    # Once we're done with the thresholds, yield elements from the source enumerators.
    # These enumerators will have their cursor state advanced from the above loops.
    enumerators.each do |s_enum|
      loop { enum.yield s_enum.next }
    end
  end
end
```

If this works correctly, we'll get items from x with amounts up to 3 (specifically, 1 then 2), then items from y (just the first item with amount 10). Next, then the remainder from x (3, 4, 5) and the remainder from y (9, 8, 7, 6).

```ruby
all = stop_and_continue([x, y], 3)
all.to_a
# => [{:amount=>1}, {:amount=>2}, {:amount=>10}, {:amount=>3}, {:amount=>4}, {:amount=>5}, {:amount=>9}, {:amount=>8}, {:amount=>7}, {:amount=>6}]
```

Booyah.

## Wrapping up

To recap what we've build:

* `threshold_enumerator` -- takes a source enumerator, returns a new enumerator that yields from the source enumerator, advancing its cursor until the threshold is met.
* `stop_and_continue` -- takes multiple source enumerables (note: every `Enumerator` is also an `Enumerable`), yields up to the threshold from each in turn, then yields from the remainder of each source in turn.

The general pattern we're using here is to take a source enumerator and create a new enumerator that yields from it, but with custom logic. This pattern can be combined, iterated, and recursed -- enumerators all the way down! -- and the result can be quite powerful.

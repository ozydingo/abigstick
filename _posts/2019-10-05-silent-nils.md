---
layout: post
title: "Silent Nils"
description: "Nil, Null, None, and Noel, Born is the King of Code Smell"
date: 2019-10-05 00:30:00 -0400
comments: true
tags: [Ruby, Singleton, nil, null]
---

This is a terrible idea.

I was challenged to make `nil` stop being so whiny in Ruby, as if all `.` operators were `&.` operators.

I mean, that's really quite easy:

```ruby
class NilClass
  def method_missing(*args)
    self
  end
end

nil.something.another_thing
# => nil
```

Don't do that.

## But what if we did that?

Ok, let's not do *exactly* that but what can we do that's similar? Let's start by defined a new thing called "nothing".

```ruby
require 'singleton'

class NothingClass
  include Singleton

  def inspect
    "nothing"
  end

  def method_missing(*args)
    self
  end
end

# Give all objects the ability to know if they are the One True None
module Kernel
  def nothing?
    self.eql?(NothingClass.instance)
  end
end

nothing = NothingClass.instance
# => nothing
nothing.nothing?
# => true
nothing.thing.another_thing
# => nothing
"hello".nothing?
# => false
```

We've defined a method `nothing?` in `Kernel` that operates similarly to `nil?` (also defined on `Kernel`) so we can check for nothingness. But how do we get there?

Remember, our goal is to get as close to auto-safe-navigation (`&.`) as possible. Our first attempt is a method that you can call when you're in danger of being `nil`:

```ruby
module Kernel
  def nothing?
    self.eql?(NothingClass.instance)
  end

  def nothingify
    nil? ? NothingClass.instance : self
  end
end

require 'hashie'
data = Hashie::Mash.new({x: "hello", y: "world"})

data.x.nothingify.upcase.replace(/[eE]/,'3')
# => "H3LLO"
data.a.nothingify.upcase.replace(/[eE]/,'3')
# => nothing
```

Now if we have an object that might be `nil`, we can call `nothingify` on it to be safe from any immediate danger of `NoMethodError`s on `nil`.

But if our `nil` comes anywhere further down the chain, we're still boned:

```ruby
require 'hashie'
response = Hashie::Mash.new({data: {x: "hello", y: "world"}})
response.nothingify.data.x
# => "hello"
response.nothingify.oops.x
# NoMethodError: undefined method `x' for nil:NilClass
```

This happens because while `response.nothingify` would save us if `response` itself were `nil`, `response.oops` still returns `nil`, and therefore `response.nothingify.oop` also returns `nil`, and we're not calling `nothingify` on the resulting return value. So we really want a single call to `nothingify` to perpetually call `nothingify` on any downstream result.

Can we do that?

## Deep Nothing

```ruby
module DeepNothing
  CANT_TOUCH_THIS = [
    :deep_nothing,
    :nil?,
    :methods,
    :nothingify,
    :define_singleton_method,
    :convert_key,
  ]
  def deep_nothing
    methods.each do |method_name|
      next if CANT_TOUCH_THIS.include?(method_name)
      define_singleton_method(method_name) do |*args, &blk|
        super(*args, &blk).nothingify
      end
    end
    return self
  end
end

Object.include(DeepNothing)

module Kernel
  def nothing?
    self.eql?(NothingClass.instance)
  end

  def nothingify
    nil? ? NothingClass.instance : deep_nothing
  end
end

require 'hashie'
response = Hashie::Mash.new({data: {x: "hello", y: "world"}})
response.nothingify
# => #<Hashie::Mash data=#<Hashie::Mash x="hello" y="world">>
response.nothingify.data.x
# => "hello"
response.nothingify.oops.x
# => nothing
```

Ok, a brief explanation. In the mmodule `DeepNothing`, we're defining a single method, `deep_nothing`, that converts our object into our nothing-safe object that we want. It does this by redefining (almost) *all* of its methods with a wrapper that `nothingify`s the result. We wrap *almost* all of the moethods because (1) we can't wrap `nothingify` itself or any methods called in `nothingify` (`nil?` and `deep_nothing`) or we'll get in an infinite loop, and (2) we can't redefine methods that we're trying to use inside our method redefinition such as `define_singleton_method`. Everything else gets wrapped. (Except for `convert_key`, which for some reason causes trouble `puts`ing a `Hashie::Mash` that I cannot figure out).

Now when `response` gets `nothingify`d, any method called on it automatically gets `nothingify`d too. Rinse, call, repeat!

One edge-case issue with this approach is singleton methods don't work:

```ruby
obj = Object.new
def obj.hello
  "world"
end

obj.hello
# => "world"

# Redefined all methods including `hello`, which has no super
obj.nothingify
obj.hello
# NoMethodError: super: no superclass method `hello' for #<Object:0x007fb472243280>
```

We can fix that by using [method binding](2019/09/20/method-madness-chapter-1) instead of `super`:

```ruby
module DeepNothing
  CANT_TOUCH_THIS = [
    :deep_nothing,
    :nil?,
    :methods,
    :method,
    :nothingify,
    :define_singleton_method,
    :convert_key,
  ]
  def deep_nothing
    methods.each do |method_name|
      next if CANT_TOUCH_THIS.include?(method_name)
      saved_method = method(method_name).unbind
      define_singleton_method(method_name) do |*args, &blk|
        saved_method.bind(self).call(*args, &blk).nothingify
      end
    end
    return self
  end
end

obj = Object.new
def obj.hello
  "world"
end

obj.hello
# => "world"

# Redefined all methods including `hello`, which has no super
obj.nothingify
obj.hello
# => "world"
```

Here, when we redefine a method, we first save a copy of the original method, and call it in our redefined method.

But then there's truthiness.

## Nothing is true

One critical missing feature of our `nothing` object is that it evaluates to `true` in a boolean context.

```ruby
print "Something" if nothing
# Something
```

Unfortunately there just isn't a way around this (prove me wrong in the comments, I beg you!). Ruby, for all its flexibility, doesn't let you do some things, and defining truthiness is one of them. In this day and age, perhaps we can take some comfort in that.

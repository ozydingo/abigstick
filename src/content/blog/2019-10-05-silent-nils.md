---
title: "Silent Nils"
description: "Nil, Null, None, and Noel, Born is the King of Code Smell"
date: 2019-10-05 00:30:00 -0400
tags: [Ruby, Singleton, nil, "null"]
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

Ok, let's not do *exactly* that but what can we do that's similar? Obviously we don't want to actually change `nil` for everyone, but what if we could do it just on demand? That is, without breaking the rest of Ruby, what if we could declare a specific object as one for which we currently do not care about further `nil`s?

`nil` is a singleton, so we actually can't modify it unless doing so globally. But we can roll our own. Let's start by establishing a pattern in a new object called "nothing".

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

# Give all objects the ability to know if they are the One True Nothing
module Kernel
  def nothing?
    self.eql?(NothingClass.instance)
  end
end

nothing = NothingClass.instance
# => nothing
```

```ruby
nothing.nothing?
# => true
nothing.thing.another_thing
# => nothing
"hello".nothing?
# => false
```

We've defined a method `nothing?` on `Kernel` that operates similarly to `nil?` (also defined on `Kernel`) so we can check for nothingness. But how do we get there?

Remember, our goal is to mimic safe-navigation (`&.`) automatically. Our first attempt is a method that you can call when you're in danger of being `nil`.

```ruby
module Kernel
  def nothing?
    self.eql?(NothingClass.instance)
  end

  def nothingify
    nil? ? NothingClass.instance : self
  end
end
```

We're going to use the [hashie](https://github.com/intridea/hashie) gem because it gives us a rich set of nested method calls that we might use to probe for data (similar to using ActiveRecord model associations and attributes)

```ruby
require 'hashie'
data = Hashie::Mash.new({x: "hello", y: "world"})
data.x.nothingify.upcase.gsub(/[eE]/,'3')
# => "H3LLO"
data.a.nothingify.upcase.gsub(/[eE]/,'3')
# => nothing
```

Now if we have an object that might be `nil`, we can call `nothingify` on it to be safe from any immediate danger of `NoMethodError`s on `nil`. But as little more than a glorified `try`, if our `nil` comes anywhere further down the chain, we're still boned:

```ruby
require 'hashie'
response = Hashie::Mash.new({data: {x: "hello", y: "world"}})
response.nothingify.data.x
# => "hello"
response.nothingify.oops.x
# NoMethodError: undefined method `x' for nil:NilClass
response.nothingify.oops.nothingify.x
# => nothing
```

The error occurs because `response.nothingify.oops` is still `nil`, since `nothingify` simply returned `self`. We can't call `x` on `nil`.

What we really want is for a single call to `nothingify` to perpetually call `nothingify` on any downstream result.

Can we do that?

## Deep Nothing

```ruby
module DeepNothing
  CANT_TOUCH_THIS = [
    :nothingify,
    :deep_nothing,
    :nil?,
    :methods,
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

Success! (Still a terrible idea.)

Ok, a brief explanation. The method `deep_nothing` nothing-safes our object by redefining (almost) *all* of its methods with a wrapper that `nothingify`s the return value. So a `nil` return gets turned into `nothing`, and any other return value get re-`nothingify`'d.

We only wrap *almost* all of the moethods because

1. We can't wrap `nothingify` itself (or any methods called therein, namely, `nil?` and `deep_nothing`) otherwise we'll get in an infinite loop calling `nothingify` repeatedly
2. We can't redefine methods that we're trying to use inside our method redefinition: `methods` and `define_singleton_method`.

Everything else gets wrapped. (Except for `convert_key`, which causes trouble `puts`ing a `Hashie::Mash` for some reason that I cannot figure out).

Now we can `nothingify` an object once and thereafter be assured to not be bothered by that pesky, no good `NoMethodError` thing.

## Back to the Singleton

One edge-case issue with this approach is singleton methods don't work because they don't have a `super`. Normally, `super` in this context refers to the original instance method defined by the class. For singleton methods, this doesn't exist.

```ruby
obj = Object.new
# define a stingleton method with no relation to the class
def obj.hello
  "world"
end

obj.hello
# => "world"
obj.nothingify.hello
# NoMethodError: super: no superclass method `hello' for #<Object:0x007fb472243280>
```

We can fix that by using [method binding](/2019/09/20/method-madness-chapter-1) instead of `super`:

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
```

Here, when we redefine a method, we first save a reference to the original method. We then call that original method inside our redefined method. No `super`, just the original result.

```ruby
obj = Object.new
def obj.hello
  "world"
end

obj.hello
# => "world"
obj.nothingify.hello
# => "world"
```

And then there's truthiness.

## Nothing is true

One critical missing feature of our `nothing` object is that it evaluates to `true` in a boolean context.

```ruby
print "Something" if nothing
# Something
```

Unfortunately there just isn't a way around this (prove me wrong in the comments, I beg you!). Ruby, for all its flexibility, doesn't let you do some things, and defining truthiness is one of them. Perhaps, in this day and age, we can take some comfort in that.

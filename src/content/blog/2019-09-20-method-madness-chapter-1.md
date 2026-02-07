---
title: "Method Madness: Chapter 1"
description: "Binding and unbinding methods in Ruby"
date: 2019-09-20 06:59:00 -0400
tags: [Ruby, Metaprogramming, Methods, Binding]
---

In this post, we're going to implement an obnoxious `GrammarNazi`  module to force ruby developers to use `is_an?` instead of `is_a?` when the class name starts with a vowel.

```ruby
42.is_a?(Integer)
# GrammarError (Surely you mean 'is_an', right?)
42.is_a?(Float)
# => false
42.is_an?(Integer)
# => true
42.is_an?(Float)
# GrammarError (Surely you mean 'is_a', right?)
```

The way we do so will explore a concept called method binding.

## Method Binding

Method binding is a little-known feature of Ruby, largely because there aren't a ton of use cases for it. In fact, using it is probably a bit of a code smell on its own. But that's what I love to explore, so let's do!

What is method binding? At a high level, it's how you call a method on a specific object. Every time you call a method in Ruby, you're dealing with a bound method. Put in the language of your most recent Ruby tutorial: A method is just a message passed to an object (or "receiver"), and that receiver is exactly the thing that method is bound to.

```ruby
method = "hello".method(:sub)
# => #<Method: String#sub>
method.receiver
# => "hello"
 ```

 You can invoke `call` on a bound method just as if you had called it normally:

```ruby
method.call(/e/, 'E')
# => "hEllo"
```

But you can also switch the receiver by `unbind`ing the method and `bind`ing it to a new receiver:

```ruby
unbound_method = method.unbind
# => #<UnboundMethod: String#sub>
unbound_method.bind("goodbye").call(/e/, 'E')
# => "goodbyE"
```

You can also get an unbound method directly from the class:

```ruby
unbound_method = String.instance_method(:sub)
# => #<UnboundMethod: String#sub>
unbound_method.bind("hello").call(/e/, 'E')
# => "hEllo"
```

Unbound methods know to what class they apply, and if you try to bind a method to an object that is not a instance of the method's owner, you'll get an error

```ruby
string_method = String.instance_method(:sub)
# => #<UnboundMethod: String#sub>
string_method.owner
# => String
string_method.bind(42)
# TypeError (bind argument must be an instance of String)
```

If the method is owned by an ancestor of the class, you can switch the receiver to any valid subclass of the owner.

```ruby
kernel_method = String.instance_method(:is_a?)
# => #<UnboundMethod: String(Kernel)#is_a?>
kernel_method.owner
# => Kernel
kernel_method.bind(42).call(Integer)
# => true
```

We have everything we need. Let's be obnoxious!

## GrammarNazi

We're going to (re)define the methods `is_a?` and `is_an?` to enforce vowel checks. Where is this method defined? We've already seen that above:

```ruby
"something".method(:is_a?).owner
# => Kernel
```

`Kernel` is a module that is included by `Object`, giving almost everything in ruby access to its methods. This being ruby, we could always overwrite the `is_a?` method on `Kernel` itself, but we'd land on some sticky ground because we still need to access the original definition of `is_a?`. I generally despise `:alias_method`, so let's use a different approach. We'll define a `GrammarNazi` module and place it such that any `Object` instance will call our methods from this module, but we will also have access to the `Kernel` method as `super`.

```ruby
module GrammarNazi
  # methods go here
end

Object.include(GrammarNazi)
```

This is all we need; we can confirm by looking at `Object`'s ancestry chain

```ruby
Object.ancestors
# => [Object, GrammarNazi, Kernel, BasicObject]
```

So `Object` will look at `GrammarNazi` for method definitions before `Kernel`, but we can still call `super` to get to `Kernel`. Great!

```ruby
GrammarError = Class.new(StandardError)

module GrammarNazi
  def is_an?(klass)
    raise(GrammarError, "Surely you mean 'is_a', right?") if /[aeiou]/i !~ klass.to_s[0]
    # ...?
  end

  def is_a?(klass)
    raise(GrammarError, "Surely you mean 'is_an', right?") if /[aeiou]/i =~ klass.to_s[0]
    super
  end
end

Object.include(GrammarNazi)
```

This works great for `is_a?`, but now we have a problem! We can't call `super` in `is_an?`, as that method doesn't exist. We can't call `is_a?`, because that will invoke the methtod we justt defined, which will incorrectly apply the `is_a?` check for `is_an?` calls.

How do we get the original `is_a?` method defined by `Kernel` and call it on our object? Sound familiar?

Yup, we'll grab the method right off of `Kernel` and bind it!

```ruby
GrammarError = Class.new(StandardError)

module GrammarNazi
  def is_an?(klass)
    raise(GrammarError, "Surely you mean 'is_a', right?") if /[aeiou]/i !~ klass.to_s[0]
    Kernel.instance_method(:is_a?).bind(self).call(klass)
  end

  def is_a?(klass)
    raise(GrammarError, "Surely you mean 'is_an', right?") if /[aeiou]/i =~ klass.to_s[0]
    super
  end
end

Object.include(GrammarNazi)
```

And the result, as above:

```ruby
42.is_a?(Integer)
# GrammarError (Surely you mean 'is_an', right?)
42.is_a?(Float)
# => false
42.is_an?(Integer)
# => true
42.is_an?(Float)
# GrammarError (Surely you mean 'is_a', right?)
```

## The Smell

I hope modifying `is_a?` for all `Object`s makes you a little uncomfortable. But given that goal, even the use of method binding is questionable. If we wanted to call a `Kernel` method, why wasn't the method correctly defined on `Kernel`? Indeed, we could have simply defined `is_an?` on `Kernel` and used `super` to access it.

When not modifying core Ruby classes, the above principle also applies. If you're unbinding and binding methods of your own classes or modules, it means you've shadowed a method that you still want access to. Maybe you should use a different method name or a different inheritance structure; consider refactoring you can call the methods directly or via `super`.

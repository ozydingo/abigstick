---
layout: post
title: "Method Madness: Chapter 2"
description: "How class methods in Ruby totally explain the \"singleton class\" thing"
date: 2019-09-22 18:11:00 -0400
comments: true
tags: [Ruby, Metaprogramming, Methods]
---

It's happened to many Ruby programmers. Some writing mentions something about a singleton class. You gloss over it, absorbing enough to get done what you need. At some point, you read a blog that totally explained it really well. But a month later, you can't quite recall the details, and you're not sure if it matters.

It doesn't have to be this way. The singleton class may be a bit of a Rubyist's oddity, but it's really not that difficult to understand and, importantly, re-derive on command if you get into the Ruby mentality.

## Everything is an Object

Everything is a object. That is, everything is an instance of a class. A class is an instance of a class (specifically, the `Class` class). Let's really explore what this means. Fire up your ruby interpreter, and let's use the `File` class as an example.

```ruby
File.class
# => Class
File.is_a?(Class)
# => true
```

If `File` is an instance of `Class`, that means a method defined by `Class` can be called by `File`.

```ruby
class Class
  def hello
    "Hello, class!"
  end
end

File.hello
# => "Hello, class!"
```

`File` is an instance of `Class`, but not the only instance. A method defined in `Class` is available to every instance of `Class`. In other words, `hello` is a *class method* for *every* class. (Yes, even `Class` itself.)

``` ruby
class MyClass
end

MyClass.hello
# => "Hello, class!"
```

Classes define methods available to their instances. `Class` is no different; it defines methods for its instances, which is all classes. Class methods are just instance methods for instances of `Class`.

{% include post_image.html name="method-definitions.png" width="700px" alt="Loading token" title="Loading token"%}

So how do we get a class method for *just* `MyClass`? When we define one by putting it on `Class`, it becomes available to every class ever. No good. We need a place to define the method where it can only be accessed by the single instance `MyClass`.

That's where singleton classes come in. Every object in Ruby has a singleton class, which is a class whose *only* instance is that object. So a method defined on a class' singleton class is exactly where its class methods can live without affecting other classes.

## Class Methods

Class methods in Ruby were always little weird. No mention of "static" methods like in other OOP languages. Instances can't call class methods. Defining class methods looks strange. But wrapping your head around this method of doing so unlocks the whole puzzle:

```ruby
class MyClass
  def self.class_method
    "Some class method"
  end
end
```

Above, `self` is equal to `MyClass`. So here's another way of doing the same thing.

```ruby
def MyClass.class_method
  "Some class method"
end
```

If you're familiar enough with Ruby's oddities, you know that this is a way to define a method *only* for a single object. In this case, that object is `MyClass`. Everything is an object.

If you're not that familiaar with this method of defining methods, it goes like this:

```ruby
obj1 = MyClass.new
obj2 = MyClass.new

# define the method `whisper` only for obj1, with no relation to obj2 or MyClass
def obj1.whisper
  "Shhh"
end

obj1.whisper
# => ""Shhh"
obj2.whisper
# NoMethodError (undefined method `whisper' for #<MyClass:0x00007f886c915900>)
MyClass.new.whisper
# NoMethodError (undefined method `whisper' for #<MyClass:0x00007fddad851aa0>)
```

In both cases, using `def something.method` defines a method available only to `something`. When `something` is a class, hey presto you have class method.

Methods are defined on classes. On what class is `whisper` defined such that it applies to just `obj1` and not `obj2` or any other instance of `MyClass`? Same question: where does a class method for `MyClass` live such that it applies only to `MyClass` and no other instace of `Class`?

## The Singleton Class

The solution to the above is how we arrive at singleton classes. `MyClass` may be an instance of `Class`. But it's also an instance -- the singleton instance -- of another class called its singleton class.

```ruby
klass = MyClass.singleton_class
# => #<Class:MyClass>
MyClass.is_a?(klass)
# => true
klass.instance_methods(false)
# => [:class_method]
```

Notice that `class_method` is an *instance method* of `klass`, making it a *class method* of `MyClass`. This is because `MyClass` is an instance of `klass`. Everything is an object.

And that's it -- the singleton class is just a place for these methods to live that allow us to have class methods in Ruby under the mandate that every class is an instance of `Class`.

{% include post_image.html name="singleton-classes.png" width="700px" alt="Loading token" title="Loading token"%}

But wait, this diagram of method lookup seems a little inelegant for Ruby. Keep reading, friend.

## Singleton Classes and Inheritance

There's another critical feature fo singleton classes. If a class gets subclassed, then the singleton class does too. This is how subclasses can call class methods of their parent classes.

```ruby
class MySubclass < MyClass
end

MySubclass.class_method
#  => "Some class method"
```

For this to happen, `MySubClass`'s singleton class must be a subclass of `MyClass`'s singleton class.

```ruby
s1 = MyClass.singleton_class
# => #<Class:MyClass>
s2 = MySubclass.singleton_class.superclass
# => #<Class:MyClass>
s1.equal?(s2)
# => true
```

So when an instance object such as `obj1` or `MySubclass` calls a method, it looks up that method definition first from its singleton class<sup>* </sup>, then from that singleton class' ancestors.

<small><i>* -- including any included modules</i></small>

So when does the method lookup chain switch over to start looking for methods in an object's regular class instead of its singleton class ancestry?

It doesn't have to. An object's class *is* a part of its singleton class ancestry. Let's print the whole thing out.

```ruby
klass = MySubclass.singleton_class
while klass do
  puts klass
  klass = klass.superclass
end
# #<Class:MySubclass>
# #<Class:MyClass>
# #<Class:Object>
# #<Class:BasicObject>
# Class
# Module
# Object
# BasicObject
```

The key to this working is that `BasicObject`'s singleton class (`#<Class:BasicObject>`) is a subclass of `Class`. So method lookup only follows one rule: start at the singleton class, and walk up the ancestry chain until you're done.

What about singleton methods of non-`Class` objects?

```ruby
obj = MySubclass.new
klass = obj.singleton_class
while klass do
  puts klass
  klass = klass.superclass
end
# #<Class:#<MySubclass:0x00007f886e927a18>>
# MySubclass
# MyClass
# Object
# BasicObject
```

`obj`'s singleton class is a subclass of `MySubclass` itself. Same logic: `obj`'s singleton class is a subclass of `obj`'s class (`MySubclass`), just as `BasicObject`'s singleton class is a subclass of `BasicObject`'s class (`Class`).

The only difference Ruby would need to be aware of is that when defining a singleton class for an object, its parent class is the objects's parent class if it has one, or the object's class if it doesn't.

So method lookup is dead simple. Start at the singleton class and go up the chain of ancestry. When we call a method on `obj`, we will eventually look for a definition in `MySubclass` using this rule, but only after first looking at `obj`'s singleton class.

## A final thought: class << self

You'll notice I relied on the `def MyClass.method` way of defining subclasses. You're likely familiar with another. Armed with our understanding of single classes, let's put it back on the table.

```ruby
class MyClass
  class << self
    def class_method
      "Some class method"
    end
  end
end
```

Why, yes, it's the same as this:

```ruby
class << MyClass
  def class_method
    "Some class method"
  end
end
```

Just as `class MyClass` opens up a context for `MyClass`, `class << MyClass` opens up a context for its *singleton class*.

This doesn't just work on instances of `Class`, but on any object at all.

```ruby
class << obj
  def obj_method
    "Obj!"
  end
end

obj.obj_method
# => "Obj!"
```

In both cases, we're just defining methods in a singleton class. The exact same rules apply -- you can even use calls like `attr_reader` and `include`. These are, after all, just methods, and everything, which includes singleton classes, is an object.

That said, it's immediate code smell to start defining methods on a non-`Class` instance and using class constructs on its singleton class. Sure, it's useful for testing and debugging code when you just want to bend objects to your will. Still, I have yet to encounter a single justifiable production-environment use case for handling and modifying a non-`Class` object's singleton class.

Oh, right, there was that [one time](/2016/06/03/secret.html#tl-dr-secret)...

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

That's where singleton classes come in.

## Class Methods

Class methods in Ruby were always little weird. No mention of "static" methods like in other OOP languages. Instances can't call class methods. It's because a class method is really just an instance method for your `Class` instance. Defining class methods looks strange -- and wrapping your head around this method of doing so unlocks the whole puzzle:

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

This is the same thing as another Ruby oddity you may have wondered about: the ability to define methods only for a single object.

```ruby
obj1 = MyClass.new
obj2 = MyClass.new

def obj1.whisper
  "Shhh"
end

obj1.whisper
# => ""Shhh"
obj2.whisper
# NoMethodError (undefined method `whisper' for #<MyClass:0x00007f886c915900>)
```

In both cases, using `def something.method` defines a method available only to `something`. When `something` is a class, hey presto you have class method. But how does this work under Ruby's rules?  Where does that method definition live? Remember, classes contain methods for their instances. So what class is there that can hold a method for just `obj1` or just `MyClass`?

## The Singleton Class

The solution to the above is how we arrive at singleton classes. `MyClass` is not just an instance of `Class`. We'll also define another class that `MyClass` is an instance of and the *only* instance of. `MyClass` is this class' singleton instance, and that's why we call it the singleton class.

```ruby
s = MyClass.singleton_class
# => #<Class:MyClass>
MyClass.is_a?(s)
# => true
s.instance_methods(false)
# => [:class_method]
```

That's it -- the singleton class is just a place for these methods to live that allow us to have class methods in Ruby under the mandate that every class is an instance of `Class`.

{% include post_image.html name="singleton-classes.png" width="700px" alt="Loading token" title="Loading token"%}

And if you think this forked method lookup is a little inelegant for Ruby, well, keep reading.

## Singleton Classes and Inheritance

There's another critical feature fo singleton classes: they are inherited by a class' subclasses.

```ruby
class MySubclass < MyClass
end

MySubclass.class_method
#  => "Some class method"
```

The way this happens is that `MySubclass`'s singleton class is declared as a subclass of `MyClass`'s singleton class.

```ruby
s1 = MyClass.singleton_class
# => #<Class:MyClass>
s2 = MySubclass.singleton_class.superclass
# => #<Class:MyClass>
s1.equal?(s2)
# => true
```

So when an instance object such as `obj1` or `MySubclass` calls a method, it looks up that method definition first from its singleton class<sup>* </sup>, then from that singleton class' ancestors. <small><i>* -- including any included modules</i></small>

So when does the method lookup chain switch and start looking at an instance's class instead of its singleton class's ancestry chain?

It doesn't have to.

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

The key is that `BaseObject`'s singleton class is a subclass of `Class`. So method lookup only follows one rule: start at the singleton class, and walk up the ancestry chain until you're done.

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

`obj`'s singleton class is a subclass of `MySubclass` itself. So using the same singleton rule, a method called on `obj` will get to look in `MySubclass` for a definition, but only after first looking at `obj`'s singleton class.

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

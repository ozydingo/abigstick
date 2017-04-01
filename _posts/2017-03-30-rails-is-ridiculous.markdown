---
layout: post
title: "Rails is Ridiculous"
date: 2017-03-30 17:32:39 -0400
comments: true
categories: 
---

## Part 1 of many to come

"Convention over configuration". So the saying goes.

While often applied to Rails' ability to create a lot of functionality with relatively spares amounts of code, I also take a liking to this saying as synonymous with the principle of least surpise: code design should pack as few surprises as possible while accomplishing its goals. You take advantage of this philosophy every time you assume `to_s` returns a reasonable String representation of any object, or that `.nil?` returns a Boolean value according to whether or not ab object is `nil`. Technically, a codeing ne'er-do-well could easily write the `nil?` class to return a random number. In Ruby, they could just as eaily overwrite the `nil?` method on `Object`, which would of course screw up a lot.

I've already hinted at how [Rails disobeys this principle](/2016/07/28/objectification.html) more than I'm confortable with. However I recently came upon a bug-inducing example that really took be aback. So now I'm going to write about it.

As a convenience, I had written a `lower_bound`, `upper_bound`, and `bound` method into the `Numeric` class in an application -- I could just no longer abide using using the 'min' method to mean upped bound and `max` for lower bound. "But wait," you say, "isn't that doing exactly the objectification that you just said in that post that you hate doing?" I mean, yeah, a little, but this is for convenience in a specific application, not for a gem or framework that will be distributed and imported in other applications. It's just easier and more fun to write `x.upper_bound(3.0)` than something like `Bounder.new(x).upper_bound(3.0)`. But no, I would never be so presumptuous in a gem for distribution, thanks for asking.

Anyway, to the point. I wanted to expand this method to `DateTime` objects as well. So where to put it? Our app uses time zones extensively, so `ActiveSupport::TimeWithZone` as well as plain old `Time` need this method. Luckily:

```ruby
Time.zone.now.is_a?(Time)
# => true
```

Wonderful! Just put it on `Time` and we're set! I do so with a `core_ext/time.rb` file. But then I notice something funny:

```ruby
Time.zone.now
# => Thu, 30 Mar 2017 18:08:29 EDT -04:00
Time.zone.now.lower_bound(1.day.ago)
# => Thu, 30 Mar 2017 18:08:30 EDT -04:00
Time.zone.now.lower_bound(30.minutes.ago)
# => Thu, 30 Mar 2017 17:38:32 EDT -04:00
```

Huh? Lower-bounding by a day ago worked as expected (no change), but lower-bounding by half an hour ago returns half an hour ago? I could have probed further to discover that the 4-hour time zone shift was the cutoff for this weird behavior, but this time I went straight for the pry:

```ruby
2.3.3 :001 > Time.zone.now.lower_bound(30.minutes.ago)

From: /Users/andrew/3p/app3/lib/boundable.rb @ line 7 Boundable#lower_bound:

     6: def lower_bound(bound)
 =>  7:   binding.hpry
     8:   if self < bound
     9:     respond_to?(:coerce) ? coerce(bound).first : bound
    10:   else
    11:     self
    12:   end
    13: end

self
# => 2017-03-30 18:46:45 UTC
bound
# => Thu, 30 Mar 2017 18:16:45 EDT -04:00
self < bound
# => true
self.class
# => Time
bound.class
# => ActiveSupport::TimeWithZone
```

To summarize, "now" is apparently less than "30 minutes ago". More precisely, the object returned by `Time.zone.now` is evaluating as less than `30.minutes.ago`, because when evaluating this line of code, `self` is a regular `Time` object (in UTC), and is being compared against a `ActiveSupport::TimeWithZone` object, but as a regular `Time` object it doesn't know about time zones.

But why did `self` forget about its true identity as a `TimeWithZone`? Let's sanity check how we're getting into this method:

```ruby
Time.zone.now.method(:lower_bound).owner
# => ActiveSupport::TimeWithZone
Time.zone.now.method(:lower_bound).source_location
# => nil
Time.now.method(:lower_bound).source_location
# => ["/Users/andrew/3p/app3/lib/boundable.rb", 6]
```

 So the owner is `ActiveSupport::TimeWithZone`, but there's not source location? Except there is for a regular `Time` object? We need more basic sanity checking:

```ruby
 Time.zone.now.class.superclass
 => Object
 Time.zone.now.class.ancestors.include?(Time)
 => false
```

So `ActiveSupport::TimeWithZone` ingerits directly from `Object`, not from the `Time` class in any way. We already cofirmed that `Time.zone.now.is_a?(Time)`; this appears to contradict that finding. Let's get to the stack trace using `caller` in the pry. Highlighting just the relevant portion, we have:

```
"/Users/andrew/3p/app3/lib/boundable.rb:7:in `lower_bound'",
"/Users/andrew/.rvm/gems/ruby-2.3.3/gems/activesupport-4.2.3/lib/active_support/time_with_zone.rb:371:in `method_missing'",
```

Ah, the dreaded "method_missing" pattern. I have found few valid uses of `method_missing`, and this, in ActiveSupport's very own `time_with_zone.rb`, is **NOT** one of them:

```ruby
    # Send the missing method to +time+ instance, and wrap result in a new
    # TimeWithZone with the existing +time_zone+.
    def method_missing(sym, *args, &block)
      wrap_with_time_zone time.__send__(sym, *args, &block)
    rescue NoMethodError => e
      raise e, e.message.sub(time.inspect, self.inspect), e.backtrace
    end
```

Here, `time`, of class `Time`, is an instance variable belonging to `TimeWithZone`, and this is the object that gave us the bug by not being able to correclty compare itself to `bound`, above. This `method_missing` pattern appears to evaluate the unknown method on the zone-normalized local `Time` object, because the authors thought that would basically be good enough. In a way it's impementing a poor-man's inheritance scheme. It works for the most part, but causes slippery bugs in edge cases such as ours: the `<` method returned the wrong result against a `TimeWithZone` object. Surprise!

More generally, if `sym` here is a method that calls any other method overwritten by `TimeWithZone`, this will not work correctly. Turns out, as much as Rubyists diss inheritance, `method_missing` is not actually a good substitute for it. Who'd have thought?

Edge cases are fine to overlook in an application as a business decision, but the more general and distributed your code gets the more important it should be to have all edge cases make some logical sense. This case does not. In a package as widespread as Rails, decisions like these are just sloppy.

For our use case here, I just slapped the same methods on `ActiveSupport::TimeWithZone` as well, despire them already being included in `Time`, which we're supposed to get for free except for the fact that someone thought `method_missing` was an effective substitute for inheritance.

I wasn't done digging: we still have this hanging fact that `Time.zone.now.is_a?(Time)`. Turns out:

```ruby
Time.zone.now.method(:is_a?).source_location
# => ["/Users/andrew/.rvm/gems/ruby-2.3.3/gems/activesupport-4.2.3/lib/active_support/time_with_zone.rb", 334]
```

You overwrote `is_a?`. You freakin overwrote `is_a?`.

```ruby
    # Say we're a Time to thwart type checking.
    def is_a?(klass)
      klass == ::Time || super
    end
```

Hacktastic.

That cuts deep, Rails. Too bad I just can't quit you...

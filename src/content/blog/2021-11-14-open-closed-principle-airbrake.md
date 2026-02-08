---
title: "SOLID in Rails: An Open/Closed principle example"
description: "Yes, the Open/Closed principle *can* be applied in a Rails app! Here's an example."
date: 2021-11-14 04:43:00 -0400
tags: [rails, ruby, SOLID]
---

## The Open/Closed principle

The "Open/Closed" principle (the "O" in "SOLID") states

> [Code] should be open for extension but closed for modification

Interpreted, this means that if you have extended or modified use cases for existing code, you should be able to do so by extending the code (such as by inheriting or composing higher classes) without needing to modify the original code.

The Rails ecosystem has fighting words for this SOLID principle. The Rails ecosystem has fighting words for SOLID in general. Ruby somewhat encourages this, by making all classes _open for modification_ with little to no effort. Because of this ability, It is far more common in Rails apps to "monkey patch" gems by directly modifying their classes, sometimes defining new methods, sometimes copying the original source code and tweaking it. Rails itself is fond of this, modifying classes as basic as `String`, `Numeric`, `Kernel`, and even `Object`. Credit where credit is due; these modifications by Rails are super convenient, feature-rich, and in many instances have been integrated in ruby core.

## Violating Open/Closed

In a fast-moving development team writing an application code base, it is perfectly acceptable, and indeed common as mentioned above, to violate Open/Closed with intention. If the original code no longer serves a use case, for example, then modification is the right move.

Still, the Open/Closed principle, and SOLID in general has a lot of value even small, fast-moving teams working in a language as open as Ruby. Following them with intention where appropriate can dramatically improve the stability and maintainability of your code base.

Even though Ruby allows all classes to be open for modification, the advantage to viewing code as "closed for modification" is that the underlying code is more stably reusable and there is less risk to new features and refactors. This applies strongly to any code that is intended to be reused or used outside of just a single use case.

To quote a much wiser man than myself

> Your [developers] were so preoccupied with whether or not they could, they didn’t stop to think if they should.

![Jeff Goldblum as Dr. Malcom in Jurassic Park](/images/posts/open-closed-principle-airbrake/jeff_goldblum.jpg "Dr. Malcom")

Speaking of wiser folks than myself, after initially drafting this, Stack Overflow blog came out with a [great rundown of SOLID applied to modern software written in dynamic language](https://stackoverflow.blog/2021/11/01/why-solid-principles-are-still-the-foundation-for-modern-software-architecture/).

## An Open/Closed example

[Airbrake](https://github.com/airbrake/airbrake-ruby) has a decently good example of code that we can apply the Open/Closed principle to. The Airbrake gem reports exceptions to their API by building an `Airbrake::Notice` class from the exception. While the Airbrake service and API supports the concept of "severity", the gem does not expose this. To see why, the Airbrake::Notice class includes the following in its initialization:

```rb
@payload = {
  ...
  context: context,
  ...
}
```

and

```rb
def context
  {
    ...
    severity: DEFAULT_SEVERITY,
    ...
  }
end
```

That is, on initialization of an `Airbrake::Notice`, `@payload` is set to include `context`, which includes a static const `DEFAULT_SEVERITY` (whose value is `"error"`).

Now we want to send `severity: "warning"` message to Airbrake, and would like to use the classes created by the airbrake gem. A common approach in Ruby is to monkey-patch the airbrake gem. However, this violates the Open/Closed principle. It is also dangerous – we are modifying a class that the other Airbrake classes use in ways we don’t fully understand, that other gems may use as well. In many organizations, you'll also have to ensure your changes don't conflict with other teams' changes or usage.

Instead, we will follow the Open/Closed principle and extend the functionality by defining our own subclass of Airbrake::Notice

```rb
module AirbrakeExtension
  class WarningNotice < ::Airbrake::Notice
    SEVERITY = "warning"

    private

    def context
      super.merge(severity: SEVERITY)
    end
  end
end
```

Now, we can use an `AirbrakeExtension::WarningNotice` to report an exception to Airbrake using the `"warning"` severity. We do so without modifying any original source code. We tailor our intended behavior to our specific use case\* using our own code.

\* – One could argue that this use case isn’t all that specific to us, and I would not argue back. But the illustration still stands.

## Wrapping up

It would be annoying to manually construct an `AirbrakeExtension::WarningNotice` manually for every warning error report we wanted to generate. Instead, the usage pattern is simply

```rb
DevOps.report_error(err, severity: "warn")
```

This method wraps another class, `ReportError`, which is designed to allow easy switching out of what error reporting service we are using, including Airbrake, Datadog, or the Rails Logger. (This is the "D" in SOLID, more on that in another post.)

By default, `DevOps.report_error` calls `ReportError` with an Airbrake adapter, which contains

```rb
def handle_error
  Airbrake.notify(notice)
end

def notice
  case severity
  when "info" then AirbrakeExtension::InfoNotice.new(error, meta)
  when "warn" then AirbrakeExtension::WarningNotice.new(error, meta)
  else Airbrake::Notice.new(error, meta)
  end
end
```

This allows us to use the gem-provided functionality by default, but use our extended classes when we want to send other severities. We haven't modified any standard `Airbrake` behavior, so we're not adding any risk to other parts of the code. Instead, we've followed Open/Closed, adding functionality by opening the `Airbrake::Notice` class for extension, not modification.

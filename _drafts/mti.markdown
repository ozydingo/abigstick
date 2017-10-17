---
layout: post
title: "My struggle and abandonment of multiple table inheritance"
date: 2017-10-16 20:00:00 -0400
comments: true
categories: 
---

---
## Summary

As I journeyed through the skill levels of Rails development, I played with the fire of Multiple Table Inheritance and variation on it. It was educational, but here's why I dissaprove of the patterns I tried to be so clever in creating

---

## Single Table Inheritance (In Brief)

I'm not going to spend much time describing [Single Table Inheritance](http://eewang.github.io/blog/2013/03/12/how-and-when-to-use-single-table-inheritance-in-rails/). This is a core Rails-supported feature and lots of guides and blogs have information on this feature, and I don't like writing words that don't contribute something new. The basics are that by creating subclasses of an `ActiveRecord` model and assigning the class name to the `type` field of the corresponding table, you get to load classes with distinct, descendant behaviors using data stored in the same table with the same schema.

We used, and still use, this pattern in a model named `Service`, representing a basic billable unit of work we do for a client. Using STI, we get a simple, non-polymorphic association between `Service` and `InvoiceLineItem`, which is a permanent record of an amount billed for work. We get a consistent schema between all services: A `Service` object has deadline and a price. It has a state and all services share the same basic state machine. For internal optimization, it also has an ops_state and an ops_deadline. All services support a `cancelled` boolean, a `demo` boolean, and sport a `finished_at` field for some very oft-used queries.

So you can see the appeal of keeping all of these columns in a single, easy-to manage table. And at their root, the only difference between the different `Service` subclasses are a basic set of internal instructions on what we need to produce for the client (a class level concept) and different behaviors for their `compute_price` and `compute_deadline` methods.

At least I wish I had made it that simply.

## Multiple Table Inheritance

The idea being multiple table inheritance is that your inherited model may store some of the data specific to its class in a separate table. So while the above model worked great for our `TranscriptionService`, `AsrService`, and `AlignmentServicve`, all of which basically described one or another method of taking a media file and producing a transcript of the spoken content, we quickly needed to store additional data for less similar service types. `TranslationService` needed an output language, and even some additional settings to route the file to the correct translation vendor. `TranscriptReviewService` needed to specify the input transcript.

The way I approached the first few relatively minor occurences of service classes needing additional data, once it was clear that adding additional columns to `services` for small-volume, pilot services was not the path forward, was to create a mini multiple table inheritance gem / lib that allowed me to bind a specific service subclass to an additional model. A simple line: `extended_in :translation_detail` told the `TranslationService` class that it had additional data in the `TranslationService` model. The call would set up the `has_one :translation_detail` association, set up destroy and initialize callbacks, and even accept nested attributes. At first I had even considered adding a preload to the `default_scope` -- this would have made it trurly multiple table inheritance. With this behavior, any `Servicve` object loaded would automatically get its subclass-specific additional models and data. Additional frills like delegation could make that process more seamless. However this was, thankfully, a choice I decided against for uncertainty of performance implications in existing code looping through millions of services across thousands of projects.

## What went wrong

The first regret came with discovering the auto-save aspect of `accepts_nested_attributes_for`. For example, when `Translation accepts_nested_attributes_for :translation_detail`, a `Translation` object will always try to auto-save its `translation_detail`. As soon as we opened up the ability to modify in-progress `TranslationDetail`s in a way that had to call back to the `Service` to modify the price (stores on `services`!), we were in infinite loop city. After much grumbling and playing with hacky ways of stopping the callback from `TranslationDetail` to `Service` if the callback had already occured, I implemented an exception for the nested attributes feature that was used specifically by `TranslationService` so that it would not auto save. This inconsistent behavior is not happymaking.

The next large regret came more slowly, after realizing how this architecture encouraged us to operate internally around service records, awkwardly joining to their extending models using clever filters, joins, and raw SQL. Remember, because each exteding model such as `TranslationDetail` or `TranscriptReviewDetail` is only referenced by the subclass of `Service` it is relevant to, a lot of the `join`s were not available from the base `Service` class or any model that defined an association to `service` rather than a more explicit `translation_service`, and these joins are inherently impossible to do (cleanly) across multiple `Service` subclasses as each is represented in a different table.

We were committed to using our services this way. Service ids had been published, and customers were using them. A lot of code, some more spaghetti than others, were build around the assumptions and bavhiors of this `extended_in` call. Any change would be a huge project with a lot of immediate risk.

## How we backed out

By the time we implemented our next service, `AudioDescriptionService`, I had realized this was definitely a different enough beast that I had to break this pattern. It was a close call, as I can still see the commits in which we created `AudioDescriptionService extended_in :audio_description_detail`. However, we pivoted just in time, and instead created the model `AudioDescription`. By schema, this model was identical to the former `AudioDescriptionDetail`. However, the small pivot revealed a fundamental shift in framing these models that dissolved any illusion of the need for multiple table inheritance to solve our problem.

The `AudioDescription` was a first-class citizen, a model in its own right. It was not subservient to the `Service`, like all the `*Detail` models were. When we were looping through audio description orders, we would search for `AudioDescription.where()`. If we needed price detail in this context, `AudioDescription.joins(:service).where()`. Only if we were doing much more general invoicing or monitoring would we loop starting with `Service`.

And this is really the crux of it. I think I had read a similar warning but didn't quite get its wisdom: when you are thinking about multiple table inheritance, you might really be thinking about separate models. You just don't know it yet.

Perhaps it was because I felt silly creating that first `TranscriptReviewDetail` model as a first class citizen. After all, it only has an `input_transcript_id` data column to distinguish it from a normal `Service`. But that's what it is -- a very simple model whose scope should not be bound up with the genral `Service` model.

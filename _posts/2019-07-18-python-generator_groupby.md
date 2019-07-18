---
layout: post
title: "Fun with Python generators: group_by"
description: "A simple generator demo to build a group_by function"
date: 2019-07-18 06:39:00 -0400
comments: true
tags: [python, iterator, generator]
---

We're going to develop our understanding of Python generators by using one to solve a simple and general problem.

## The problem

Given an array or iterable object, loop over groups of consecutively matching elements.

For example, for `[1, 1, 1, 2, 3, 3]`, we want to process `[1, 1, 1]`, `[2]`, and finally `[3, 3]`

If we had more `1`s at the end, they would be their own group:

`[1, 1, 2, 1]` => `[1, 1]`, `[2]`, `[1]`.

This is already solved by `itertools`:

```python
import itertools
array = [1, 1, 1, 2, 2, 3, 1, 1]
[(val, list(items)) for val, items in itertools.groupby(array)]
#=> [(1, [1, 1, 1]), (2, [2, 2]), (3, [3]), (1, [1, 1])]
```

Let's implement this ourselves using a Python generator!

## The solution

We're going to keep it simple and use a list as input and not bother with other iterators. The same logic will apply, it will just require more bookkeeping to deal with looking at next values and handling `StopIteration` exceptions.

So our approach will be to keep a start and end index in our generator and return each group as a slice of the list according to these indices.

* Start with indices at 0.
* While we have elements left to look at, we'll check the next value, and increment the end index until the value no longer matches (or we've run out of elements).
* We'll then `yield` the array slices by the current start and end indices. `yield`ing is the crux of generators, and each call to `yield` defines the next value you'll get out of your generator.
* Finally, we'll set the start index to the next (non-matching) element and repeat until finished.

```python
def group_generator(array):
    start_i = 0
    end_i = 0
    while start_i < len(array):
        val = array[start_i]
        while end_i < len(array) and array[end_i] == val:
            end_i = end_i + 1
        yield array[start_i:end_i]
        start_i = end_i
```

Result:

```python
array = [1, 1, 1, 2, 2, 3, 1, 1]
groups = group_generator(array)
list(groups)
# => [[1, 1, 1], [2, 2], [3], [1, 1]]
```

It's easy enough to modify the return structure to match the `itertools` function to have a tuple of `(key, values)`, so I won't do so here. And we're return lists instead of the `itertools._grouper` iterator as the values because we're keeping it simple with lists.

## Added feature: group_by key

Let's finish by adding one useful feature to our generator: the ability to group by something other than the element value itself. This is useful if you have more complex data structure with a key, since as timestamp or id, that you want to use to group otherwise non-identical elements.

To do this, we'll define an optional `key` argument, and use it to compare values instead of our current equality check.

```python
def group_generator(array, key=None):
    def _equal(one, two):
        if key == None:
            return one == two
        else:
            return key(one) == key(two)
    ii = 0
    jj = 0
    while ii < len(array):
        val = array[ii]
        while jj < len(array) and _equal(array[jj], val):
            jj = jj + 1
        yield array[ii:jj]
        ii = jj
```

Let's consider the data structure

```python
data = [
    {'k': 1, 'n': 0},
    {'k': 1, 'n': 1},
    {'k': 1, 'n': 2},
    {'k': 2, 'n': 3},
    {'k': 3, 'n': 4},
    {'k': 3, 'n': 5},
    {'k': 2, 'n': 6},
    {'k': 2, 'n': 7},
]
```

Result: without using a key

```python
list(group_generator(data))
#=> [   [{'k': 1, 'n': 0}],
#       [{'k': 1, 'n': 1}],
#       [{'k': 1, 'n': 2}],
#       [{'k': 2, 'n': 3}],
#       [{'k': 3, 'n': 4}],
#       [{'k': 3, 'n': 5}],
#       [{'k': 2, 'n': 6}],
#       [{'k': 2, 'n': 7}]]
[len(group) for group in group_generator(data)]
#=> [1, 1, 1, 1, 1, 1, 1, 1]
```

Result: using a key

```python
list(group_generator(data, key = lambda x: x['k']))
#=> [   [{'k': 1, 'n': 0}, {'k': 1, 'n': 1}, {'k': 1, 'n': 2}],
#       [{'k': 2, 'n': 3}],
#       [{'k': 3, 'n': 4}, {'k': 3, 'n': 5}],
#       [{'k': 2, 'n': 6}, {'k': 2, 'n': 7}]]
[len(group) for group in group_generator(data, key = lambda x: x['k'])]
#=> [3, 1, 2, 2]
```

## In Sum

There you have it, a simple method that uses Python generators to do a simple thing. Hopefully this helps you understand python generators and how to use them just a little bit better.

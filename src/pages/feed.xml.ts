import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog'))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'A Big Stick',
    description: 'Speak softly and carry a big stick: "The exercise of intelligent forethought and of decisive action sufficiently far in advance of any likely crisis."',
    site: context.site!.toString(),
    items: posts.map((post) => {
      const slug = post.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const date = post.data.date;
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return {
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.date,
        link: `/${year}/${month}/${day}/${slug}`,
      };
    }),
  });
}

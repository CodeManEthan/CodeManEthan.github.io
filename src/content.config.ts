import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    tech: z.array(z.string()),
    // 'public'  -> repo link shown
    // 'private' -> Private badge, no repo link
    // 'soon'    -> repo coming soon
    status: z.enum(['public', 'private', 'soon']).default('soon'),
    repo: z.string().url().optional(),
    demo: z.string().url().optional(),
    // A made graphic (not a screenshot); read before `screenshot` by the card and the page.
    image: z.string().optional(),
    screenshot: z.string().optional(),
    // Kept in the schema; the grid ignores it and every card is the same size.
    featured: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(true),
    image: z.string().optional(),
  }),
});

export const collections = { projects, notes };

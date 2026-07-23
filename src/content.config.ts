import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    tech: z.array(z.string()),
    // 'public'  -> repo link shown
    // 'private' -> "source private · demo on request"
    // 'soon'    -> "repo coming soon"
    status: z.enum(['public', 'private', 'soon']).default('soon'),
    repo: z.string().url().optional(),
    demo: z.string().url().optional(),
    screenshot: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

export const collections = { projects };

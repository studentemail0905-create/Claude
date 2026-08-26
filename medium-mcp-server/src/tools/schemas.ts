import { z } from "zod";

/** Shared input shape for anything that creates a Medium post (draft or publish). */
export const articleInputShape = {
  title: z.string().min(1).max(300).describe("The article's title."),
  content: z.string().min(1).describe("The article body, in the format given by contentFormat."),
  contentFormat: z
    .enum(["html", "markdown"])
    .default("markdown")
    .describe("Format of `content`: 'markdown' or 'html'."),
  tags: z
    .array(z.string().min(1).max(25))
    .max(5)
    .optional()
    .describe("Up to 5 tags. Only the first tag affects Medium's topic classification."),
  canonicalUrl: z
    .string()
    .url()
    .optional()
    .describe("Original URL if this content was first published elsewhere (for SEO attribution)."),
  license: z
    .enum([
      "all-rights-reserved",
      "cc-40-by",
      "cc-40-by-sa",
      "cc-40-by-nd",
      "cc-40-by-nc",
      "cc-40-by-nc-nd",
      "cc-40-by-nc-sa",
      "cc-40-zero",
      "public-domain",
    ])
    .optional()
    .describe("License for the post. Defaults to Medium's standard all-rights-reserved."),
  notifyFollowers: z.boolean().optional().describe("Whether to notify followers. Defaults to Medium's own default (false)."),
  publicationId: z
    .string()
    .optional()
    .describe("Publish under this publication instead of the user's own profile. Use list_publications to find ids."),
} as const;

export const articleInputSchema = z.object(articleInputShape);
export type ArticleInput = z.infer<typeof articleInputSchema>;

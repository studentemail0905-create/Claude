import type { MediumClient, CreatePostInput, PublishStatus } from "../mediumClient.js";
import type { ArticleInput } from "../tools/schemas.js";

/**
 * Turns a validated tool-input article payload into a Medium createPost
 * payload, resolving the authenticated user's id when the article isn't
 * targeted at a specific publication.
 */
export async function resolvePostInput(
  mediumClient: MediumClient,
  input: ArticleInput,
  publishStatus: PublishStatus
): Promise<CreatePostInput> {
  const base: CreatePostInput = {
    title: input.title,
    content: input.content,
    contentFormat: input.contentFormat,
    publishStatus,
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.canonicalUrl ? { canonicalUrl: input.canonicalUrl } : {}),
    ...(input.license ? { license: input.license } : {}),
    ...(typeof input.notifyFollowers === "boolean" ? { notifyFollowers: input.notifyFollowers } : {}),
  };

  if (input.publicationId) {
    return { ...base, publicationId: input.publicationId };
  }

  const me = await mediumClient.getMe();
  return { ...base, authorId: me.id };
}

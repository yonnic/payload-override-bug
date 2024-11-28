import type { CollectionConfig } from 'payload'

export const postsSlug = 'posts'

export const PostsCollection: CollectionConfig = {
  slug: postsSlug,
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
    },
    {
      name: 'publishDate',
      label: 'Publish Date',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
    },
  ],
  versions: {
    drafts: true,
  },
}

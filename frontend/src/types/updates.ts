export type UpdateStatus = "GREEN" | "YELLOW" | "RED";

export interface UpdatePostListItem {
  id: string;
  created_at: string;
  title: string;
  slug: string;
  summary: string;
  status: UpdateStatus;
  tags: string[];
  pinned: boolean;
}

export interface UpdatePostDetail extends UpdatePostListItem {
  content_markdown: string;
  chart_urls: string[];
  published: boolean;
}

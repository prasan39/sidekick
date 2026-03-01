/**
 * Notion Publisher — Convert markdown digest to Notion blocks and append to page
 */
import { Client } from '@notionhq/client';
import type { DigestReport } from './types.js';

export class NotionPublisher {
  private client: Client;
  private pageId: string;
  private pageTitle: string | null;

  constructor(apiKey: string, pageId: string, pageTitle?: string) {
    this.client = new Client({ auth: apiKey });
    this.pageId = pageId;
    this.pageTitle = pageTitle?.trim() || null;
  }

  /**
   * Check if Notion connection is valid
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.client.pages.retrieve({ page_id: this.pageId });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Publish a digest report as blocks appended to the Notion page
   */
  async publishDigest(digest: DigestReport): Promise<string | null> {
    const pageId = await this.resolvePageId();
    if (!pageId) {
      console.warn('[Notion] No pageId resolved; skipping publish');
      return null;
    }
    const blocks = this.digestToBlocks(digest);

    try {
      const response = await this.client.blocks.children.append({
        block_id: pageId,
        children: blocks as any[],
      });

      const blockId = response.results[0]?.id || null;
      console.log(`[Notion] Published digest to page, first block: ${blockId}`);
      return blockId;
    } catch (err) {
      console.error('[Notion] Failed to publish digest:', err);
      throw err;
    }
  }

  private digestToBlocks(digest: DigestReport): any[] {
    const blocks: any[] = [];

    // Divider
    blocks.push({ type: 'divider', divider: {} });

    // Header
    blocks.push({
      type: 'heading_2',
      heading_2: {
        rich_text: [{
          type: 'text',
          text: { content: `Daily Substack Digest — ${digest.date} (${digest.newsletterCount} newsletters)` },
        }],
      },
    });

    // TL;DR section
    blocks.push(this.heading3('TL;DR'));
    for (const item of digest.sections.tldr) {
      blocks.push(this.bulletItem(item));
    }

    // Key Insights
    blocks.push(this.heading3('Key Insights'));
    for (const item of digest.sections.keyInsights) {
      blocks.push(this.bulletItem(item));
    }

    // Aha Moments
    blocks.push(this.heading3('Aha Moments'));
    for (const item of digest.sections.ahaMoments) {
      blocks.push(this.bulletItem(item));
    }

    // Action Items
    blocks.push(this.heading3('Action Items'));
    for (const item of digest.sections.actionItems) {
      blocks.push(this.bulletItem(item));
    }

    // Connections
    blocks.push(this.heading3('Connections'));
    if (digest.sections.connections) {
      blocks.push(this.paragraph(digest.sections.connections));
    }

    // Trailing divider
    blocks.push({ type: 'divider', divider: {} });

    return blocks;
  }

  private async resolvePageId(): Promise<string | null> {
    if (this.pageTitle) {
      const resolved = await this.findPageIdByTitle(this.pageTitle);
      if (resolved) {
        this.pageId = resolved;
        return resolved;
      }
      if (this.pageId) {
        console.warn(`[Notion] Page titled "${this.pageTitle}" not found; falling back to NOTION_PAGE_ID`);
        return this.pageId;
      }
      console.warn(`[Notion] Page titled "${this.pageTitle}" not found and no NOTION_PAGE_ID set`);
      return null;
    }
    return this.pageId || null;
  }

  private async findPageIdByTitle(title: string): Promise<string | null> {
    try {
      const result = await this.client.search({
        query: title,
        filter: { property: 'object', value: 'page' },
        page_size: 10,
      });
      for (const item of result.results) {
        if (!('properties' in item)) continue;
        const props = (item as any).properties || {};
        const titleProp = (Object.values(props) as any[]).find((p: any) => p?.type === 'title') as any;
        const text = titleProp?.title?.map((t: any) => t?.plain_text || '').join('').trim();
        if (text && text.toLowerCase() === title.toLowerCase()) {
          return (item as any).id || null;
        }
      }
      return null;
    } catch (err) {
      console.error('[Notion] Failed to search pages by title:', err);
      return null;
    }
  }

  private heading3(text: string): any {
    return {
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: text } }],
      },
    };
  }

  private bulletItem(text: string): any {
    // Notion rich text has a 2000 char limit per block
    const truncated = text.length > 1900 ? text.substring(0, 1900) + '...' : text;
    return {
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: truncated } }],
      },
    };
  }

  private paragraph(text: string): any {
    const truncated = text.length > 1900 ? text.substring(0, 1900) + '...' : text;
    return {
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: truncated } }],
      },
    };
  }
}

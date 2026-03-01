/**
 * BM25 (Best Match 25) - Classic keyword search algorithm
 * No external dependencies, pure TypeScript implementation
 * Handles exact matches that vector search might miss
 */

export interface BM25Document {
  id: string;
  text: string;
  tokens?: string[];
}

export interface BM25Result {
  id: string;
  score: number;
}

// BM25 parameters (standard values)
const K1 = 1.2;  // Term frequency saturation
const B = 0.75;  // Length normalization

/**
 * Tokenize text into searchable terms
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .split(/\s+/)              // Split on whitespace
    .filter(t => t.length > 1); // Remove single chars
}

/**
 * BM25 Index for fast keyword search
 */
export class BM25Index {
  private documents: Map<string, BM25Document> = new Map();
  private documentFrequency: Map<string, number> = new Map();
  private averageDocLength: number = 0;
  private totalDocs: number = 0;

  /**
   * Add or update a document in the index
   */
  addDocument(id: string, text: string): void {
    const tokens = tokenize(text);

    // Remove old doc if exists
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    this.documents.set(id, { id, text, tokens });
    this.totalDocs++;

    // Update document frequency for each unique term
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      this.documentFrequency.set(
        token,
        (this.documentFrequency.get(token) || 0) + 1
      );
    }

    // Update average document length
    this.updateAverageLength();
  }

  /**
   * Remove a document from the index
   */
  removeDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc || !doc.tokens) return false;

    // Update document frequency
    const uniqueTokens = new Set(doc.tokens);
    for (const token of uniqueTokens) {
      const freq = this.documentFrequency.get(token) || 1;
      if (freq <= 1) {
        this.documentFrequency.delete(token);
      } else {
        this.documentFrequency.set(token, freq - 1);
      }
    }

    this.documents.delete(id);
    this.totalDocs--;
    this.updateAverageLength();

    return true;
  }

  /**
   * Update average document length
   */
  private updateAverageLength(): void {
    if (this.totalDocs === 0) {
      this.averageDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const doc of this.documents.values()) {
      totalLength += doc.tokens?.length || 0;
    }
    this.averageDocLength = totalLength / this.totalDocs;
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for a term
   */
  private idf(term: string): number {
    const docFreq = this.documentFrequency.get(term) || 0;
    if (docFreq === 0) return 0;

    // Standard BM25 IDF formula
    return Math.log(
      (this.totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1
    );
  }

  /**
   * Search for documents matching query
   */
  search(query: string, limit: number = 10): BM25Result[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const scores: BM25Result[] = [];

    for (const doc of this.documents.values()) {
      const docTokens = doc.tokens || [];
      const docLength = docTokens.length;

      if (docLength === 0) continue;

      let score = 0;

      for (const queryTerm of queryTokens) {
        // Count term frequency in document
        const termFreq = docTokens.filter(t => t === queryTerm).length;
        if (termFreq === 0) continue;

        const idf = this.idf(queryTerm);

        // BM25 scoring formula
        const numerator = termFreq * (K1 + 1);
        const denominator = termFreq + K1 * (1 - B + B * (docLength / this.averageDocLength));

        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores.push({ id: doc.id, score });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, limit);
  }

  /**
   * Get all document IDs
   */
  getDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Get document count
   */
  get size(): number {
    return this.totalDocs;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.averageDocLength = 0;
    this.totalDocs = 0;
  }

  /**
   * Export index state for persistence
   */
  export(): { documents: [string, BM25Document][]; documentFrequency: [string, number][] } {
    return {
      documents: Array.from(this.documents.entries()),
      documentFrequency: Array.from(this.documentFrequency.entries()),
    };
  }

  /**
   * Import index state from persistence
   */
  import(data: { documents: [string, BM25Document][]; documentFrequency: [string, number][] }): void {
    this.documents = new Map(data.documents);
    this.documentFrequency = new Map(data.documentFrequency);
    this.totalDocs = this.documents.size;
    this.updateAverageLength();
  }
}

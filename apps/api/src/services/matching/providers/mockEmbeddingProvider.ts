import crypto from 'crypto';
import { IEmbeddingProvider } from '../types';

export class MockEmbeddingProvider implements IEmbeddingProvider {
  public readonly name = 'mock_embedding';
  public readonly model = 'mock-embedding-v1';
  private dimensions: number;

  constructor(dimensions: number = 64) {
    this.dimensions = dimensions;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || !text.trim()) {
      throw new Error('Cannot generate embedding for empty text');
    }

    const vector = new Array(this.dimensions).fill(0);
    const lower = text.toLowerCase();

    // 1. Topic clusters to ensure realistic semantic differentiation
    // Dimensions 0 - 9: Backend / Distributed Systems / Engineering
    const backendKeywords = [
      'backend', 'engineer', 'software', 'developer', 'node', 'nodejs', 'typescript',
      'python', 'api', 'database', 'sql', 'postgres', 'mysql', 'distributed',
      'microservices', 'architecture', 'golang', 'rust', 'docker', 'cloud', 'aws'
    ];
    let backendScore = 0;
    for (const kw of backendKeywords) {
      const matches = (lower.match(new RegExp(`\\b${kw}\\b`, 'g')) || []).length;
      backendScore += matches * 2;
    }
    for (let i = 0; i < 10; i++) {
      vector[i] = backendScore * (1.0 + (i % 3) * 0.2);
    }

    // Dimensions 10 - 19: Marketing / Sales / Growth
    const marketingKeywords = [
      'marketing', 'seo', 'campaign', 'sales', 'growth', 'brand', 'content',
      'advertising', 'social media', 'lead generation', 'customer acquisition', 'b2b sales'
    ];
    let marketingScore = 0;
    for (const kw of marketingKeywords) {
      const matches = (lower.match(new RegExp(`\\b${kw}\\b`, 'g')) || []).length;
      marketingScore += matches * 2;
    }
    for (let i = 10; i < 20; i++) {
      vector[i] = marketingScore * (1.0 + (i % 3) * 0.2);
    }

    // Dimensions 20 - 29: Design / UX / Creative
    const designKeywords = [
      'design', 'figma', 'ui', 'ux', 'user experience', 'visual', 'prototype',
      'wireframe', 'photoshop', 'illustrator', 'creative'
    ];
    let designScore = 0;
    for (const kw of designKeywords) {
      const matches = (lower.match(new RegExp(`\\b${kw}\\b`, 'g')) || []).length;
      designScore += matches * 2;
    }
    for (let i = 20; i < 30; i++) {
      vector[i] = designScore * (1.0 + (i % 3) * 0.2);
    }

    // 2. Hash-based semantic projection for the remaining dimensions
    const words = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    for (const word of words) {
      const hash = crypto.createHash('md5').update(word).digest();
      for (let i = 30; i < this.dimensions; i++) {
        const byte = hash[i % hash.length];
        vector[i] += (byte / 255.0) - 0.5;
      }
    }

    // 3. Normalize vector to unit length (L2 norm)
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = Number((vector[i] / norm).toFixed(6));
      }
    } else {
      vector[0] = 1.0;
    }

    return vector;
  }
}

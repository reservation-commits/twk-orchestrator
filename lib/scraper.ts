import axios from 'axios';
import * as cheerio from 'cheerio';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  if (braveKey) {
    try {
      const { data } = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
        params: { q: query, count },
        timeout: 8000,
      });
      return (data.web?.results ?? []).map((r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.description ?? '',
      }));
    } catch {
      // fall through to DuckDuckGo
    }
  }

  // Fallback: DuckDuckGo HTML scrape
  try {
    const { data } = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Bot/1.0)' },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const results: SearchResult[] = [];
    $('.result').each((_, el) => {
      const title = $(el).find('.result__title').text().trim();
      const url = $(el).find('.result__url').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      if (title && url) results.push({ title, url: `https://${url}`, snippet });
    });
    return results.slice(0, count);
  } catch {
    return [];
  }
}

export async function fetchUrl(url: string): Promise<{ text: string; html: string }> {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Bot/1.0)' },
    timeout: 15000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(data);
  $('script, style, noscript, iframe, svg').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { text: text.slice(0, 8000), html: data };
}

export async function findSocialMedia(
  name: string,
  city: string
): Promise<{ instagram?: string; facebook?: string; twitter?: string }> {
  const results = await webSearch(`${name} ${city} restaurant instagram facebook`, 5);
  const social: Record<string, string> = {};

  for (const r of results) {
    if (!social.instagram && r.url.includes('instagram.com')) social.instagram = r.url;
    if (!social.facebook && r.url.includes('facebook.com')) social.facebook = r.url;
    if (!social.twitter && (r.url.includes('twitter.com') || r.url.includes('x.com'))) {
      social.twitter = r.url;
    }
  }
  return social;
}

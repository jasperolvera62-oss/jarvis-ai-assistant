import { z } from "zod";
import type { ToolDefinition } from "../registry.js";
import { getConfig } from "../../shared/config.js";

async function extractText(html: string): Promise<string> {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return stripped
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 10000);
}

const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS-Assistant";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, maxResults = 8): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": WEB_UA },
    signal: AbortSignal.timeout(20000),
  });
  const html = await response.text();
  const results: SearchResult[] = [];
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];
  for (let i = 0; i < links.length && i < maxResults; i++) {
    let href = links[i][1];
    const urlMatch = href.match(/uddg=([^&]+)/);
    if (urlMatch) {
      href = decodeURIComponent(urlMatch[1]);
    }
    const title = await extractText(links[i][2]);
    const snippet = snippets[i] ? await extractText(snippets[i][1]) : "";
    results.push({ title, url: href.replace(/&amp;/g, "&"), snippet });
  }
  return results;
}

export async function fetchPageText(url: string, maxChars = 10000): Promise<{
  url: string;
  title: string;
  text: string;
  length: number;
  finalUrl: string;
}> {
  const response = await fetch(url, {
    headers: { "User-Agent": WEB_UA },
    signal: AbortSignal.timeout(20000),
  });
  const html = await response.text();
  const text = (await extractText(html)).slice(0, maxChars);
  return {
    url,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    text,
    length: text.length,
    finalUrl: response.url,
  };
}

const WMO_WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Light rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export async function getWeather(lat: number, lon: number): Promise<{
  location: string;
  tempC: number;
  feelsLikeC: number;
  condition: string;
  code: number;
  humidity: number;
  windKmh: number;
  station: string;
} > {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { "User-Agent": WEB_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Weather API error ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    current?: {
      temperature_2m: number;
      relative_humidity_2m: number;
      apparent_temperature: number;
      weather_code: number;
      wind_speed_10m: number;
    };
    timezone?: string;
  };
  const cur = payload.current;
  if (!cur) throw new Error("Weather API returned no current data");
  return {
    location: payload.timezone || "unknown",
    tempC: Math.round(cur.temperature_2m),
    feelsLikeC: Math.round(cur.apparent_temperature),
    condition: WMO_WEATHER_CODES[cur.weather_code] || `Weather code ${cur.weather_code}`,
    code: cur.weather_code,
    humidity: Math.round(cur.relative_humidity_2m),
    windKmh: Math.round(cur.wind_speed_10m),
    station: "Open-Meteo",
  };
}

export const webTools: ToolDefinition[] = [
  {
    name: "web_search",
    description: "Search the web for current information using DuckDuckGo",
    category: "web",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      maxResults: z.number().optional().default(8),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 30000,
    cancellable: true,
    execute: async (input) => {
      try {
        const results = await webSearch(input.query as string, (input.maxResults as number) || 8);
        return {
          success: true,
          result: {
            query: input.query,
            results,
            count: results.length,
            performed: true,
          },
        };
      } catch (err) {
        return { success: false, error: `Web search failed: ${err}` };
      }
    },
  },
  {
    name: "fetch_page",
    description: "Fetch a web page and extract its text content",
    category: "web",
    inputSchema: z.object({
      url: z.string().describe("URL to fetch"),
      maxChars: z.number().optional().default(10000),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 30000,
    cancellable: true,
    execute: async (input) => {
      try {
        const page = await fetchPageText(input.url as string, (input.maxChars as number) || 10000);
        return { success: true, result: page };
      } catch (err) {
        return { success: false, error: `Failed to fetch page: ${err}` };
      }
    },
  },
  {
    name: "get_weather",
    description:
      "Get current weather conditions (temperature, condition, humidity, wind) for the user's home location in Guam, or a specific latitude/longitude",
    category: "web",
    inputSchema: z.object({
      latitude: z.number().optional().describe("Optional latitude; defaults to home location (Guam)"),
      longitude: z.number().optional().describe("Optional longitude; defaults to home location (Guam)"),
    }),
    riskLevel: 0,
    requiresConfirmation: false,
    timeout: 30000,
    cancellable: true,
    execute: async (input) => {
      try {
        const home = getConfig().location;
        const lat = (input.latitude as number) ?? home.latitude;
        const lon = (input.longitude as number) ?? home.longitude;
        const weather = await getWeather(lat, lon);
        return {
          success: true,
          result: {
            ...weather,
            place: home.name,
            summary: `${weather.condition}, ${weather.tempC}°C (feels like ${weather.feelsLikeC}°C), humidity ${weather.humidity}%, wind ${weather.windKmh} km/h`,
          },
        };
      } catch (err) {
        return { success: false, error: `Weather lookup failed: ${err}` };
      }
    },
  },
];
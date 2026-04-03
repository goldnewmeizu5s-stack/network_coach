import fs from "fs";
import path from "path";

const API_URL = process.env.API_URL || "https://networkcoach-production.up.railway.app";
const AUTH_PIN = process.env.AUTH_PIN || "";
const FOLDER = process.argv[2];

if (!FOLDER || !AUTH_PIN) {
  console.error("Usage: AUTH_PIN=1234 npx ts-node scripts/import-methodologies.ts /path/to/md/folder");
  process.exit(1);
}

interface Methodology {
  source: string;
  title: string;
  core_principle: string;
  full_text: string;
  application_steps: string | null;
  when_to_use: string | null;
  tags: string[];
}

// Extract tags from content by keyword matching
function extractTags(text: string): string[] {
  const tagMap: Record<string, string[]> = {
    "follow-up": ["follow up", "follow-up", "followup", "reach out", "reconnect"],
    "first-meeting": ["first meeting", "first impression", "introduce yourself", "meeting someone"],
    "conversation": ["conversation", "small talk", "dialogue", "asking questions", "listening"],
    "mindset": ["mindset", "attitude", "confidence", "fear", "anxiety", "comfort zone"],
    "strategy": ["strategy", "plan", "goal", "system", "framework"],
    "giving": ["give", "generosity", "help", "value", "favor"],
    "weak-ties": ["weak ties", "acquaintance", "loose connection", "bridging"],
    "depth": ["deep", "vulnerability", "trust", "authentic", "meaningful"],
    "digital": ["linkedin", "social media", "online", "digital", "email"],
    "introvert": ["introvert", "quiet", "shy", "energy", "recharge"],
    "events": ["event", "conference", "meetup", "networking event"],
    "relationship-building": ["relationship", "rapport", "connection", "bond"],
    "influence": ["influence", "persuasion", "reciprocity", "likability"],
    "connector": ["connector", "broker", "bridge", "introduce", "structural hole"],
    "career": ["career", "job", "opportunity", "professional"],
  };

  const lower = text.toLowerCase();
  const tags: string[] = [];
  for (const [tag, keywords] of Object.entries(tagMap)) {
    if (keywords.some(kw => lower.includes(kw))) {
      tags.push(tag);
    }
  }
  return tags.length > 0 ? tags : ["networking", "research"];
}

// Parse a single .md file into a methodology
function parseMdFile(filePath: string): Methodology {
  const content = fs.readFileSync(filePath, "utf-8");
  const fileName = path.basename(filePath, path.extname(filePath));

  const lines = content.split("\n").filter(l => l.trim());

  // Try to extract title from first heading
  const headingMatch = content.match(/^#\s+(.+)/m);
  const title = headingMatch ? headingMatch[1].trim() : fileName.replace(/[_-]/g, " ").replace(/^\d+\s*/, "");

  // First paragraph as core principle (first non-heading, non-empty block)
  let corePrinciple = "";
  let foundHeading = false;
  for (const line of lines) {
    if (line.startsWith("#")) { foundHeading = true; continue; }
    if (foundHeading || !line.startsWith("#")) {
      corePrinciple = line.trim();
      if (corePrinciple.length > 20) break;
    }
  }
  if (corePrinciple.length > 500) corePrinciple = corePrinciple.slice(0, 500);

  // Full text — truncate to 10000 chars if too long
  const fullText = content.length > 10000 ? content.slice(0, 10000) + "\n\n[truncated]" : content;

  // Extract source from content if possible
  const sourceMatch = content.match(/(?:author|source|by|from|книга|автор)[:\s]+([^\n]+)/i);
  const source = sourceMatch ? sourceMatch[1].trim().slice(0, 200) : "Research Archive";

  return {
    source,
    title: title.slice(0, 200),
    core_principle: corePrinciple || title,
    full_text: fullText,
    application_steps: null,
    when_to_use: null,
    tags: extractTags(content),
  };
}

async function getAuthCookie(): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: AUTH_PIN }),
  });
  const cookieHeader = res.headers.get("set-cookie");
  if (!cookieHeader) throw new Error("Auth failed — no cookie returned");
  return cookieHeader.split(";")[0]; // "auth_session=..."
}

async function uploadBatch(methodologies: Methodology[], cookie: string): Promise<{ imported: number; errors: string[] }> {
  const res = await fetch(`${API_URL}/api/methodologies/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie,
    },
    body: JSON.stringify({ methodologies }),
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  // Read all .md files
  const files = fs.readdirSync(FOLDER)
    .filter(f => f.endsWith(".md") || f.endsWith(".txt"))
    .map(f => path.join(FOLDER, f));

  console.log(`Found ${files.length} files`);

  // Parse all
  const methodologies = files.map(f => {
    try {
      return parseMdFile(f);
    } catch (err) {
      console.error(`Failed to parse ${f}: ${err}`);
      return null;
    }
  }).filter(Boolean) as Methodology[];

  console.log(`Parsed ${methodologies.length} methodologies`);

  // Authenticate
  const cookie = await getAuthCookie();
  console.log("Authenticated");

  // Upload in batches of 50
  const BATCH_SIZE = 50;
  let totalImported = 0;

  for (let i = 0; i < methodologies.length; i += BATCH_SIZE) {
    const batch = methodologies.slice(i, i + BATCH_SIZE);
    console.log(`Uploading batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} items)...`);

    try {
      const result = await uploadBatch(batch, cookie);
      totalImported += result.imported;
      if (result.errors.length > 0) {
        console.warn(`Batch errors:`, result.errors);
      }
      console.log(`Batch done: ${result.imported} imported`);
    } catch (err) {
      console.error(`Batch failed:`, err);
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone! Total imported: ${totalImported}/${methodologies.length}`);
}

main().catch(console.error);

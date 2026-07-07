import { readFile } from "fs/promises";
import path from "path";

const defaultYamlPath = "data/subscription.yaml";
const remoteYamlTimeoutMs = 10000;

export async function getYamlContent(): Promise<string> {
  const inlineYaml = process.env.YAML_CONTENT?.trim();

  if (inlineYaml) {
    return process.env.YAML_CONTENT as string;
  }

  const remoteYamlUrl = process.env.YAML_SOURCE_URL?.trim();

  if (remoteYamlUrl) {
    return fetchYamlFromUrl(remoteYamlUrl);
  }

  const yamlPath = process.env.YAML_FILE_PATH?.trim() || defaultYamlPath;

  return readYamlFromFile(yamlPath);
}

async function readYamlFromFile(yamlPath: string): Promise<string> {
  const resolvedPath = path.isAbsolute(yamlPath) ? yamlPath : path.join(process.cwd(), yamlPath);

  try {
    return await readFile(resolvedPath, "utf8");
  } catch {
    throw new Error(
      "YAML content is not configured. Set YAML_CONTENT, YAML_SOURCE_URL, or create the YAML_FILE_PATH file."
    );
  }
}

async function fetchYamlFromUrl(url: string): Promise<string> {
  assertValidYamlUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remoteYamlTimeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "text/yaml, application/yaml, text/plain, */*"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Remote YAML request failed with HTTP ${response.status}.`);
    }

    const content = await response.text();

    if (!content.trim()) {
      throw new Error("Remote YAML response is empty.");
    }

    return content;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Unable to fetch YAML_SOURCE_URL: ${error.message}`);
    }

    throw new Error("Unable to fetch YAML_SOURCE_URL.");
  } finally {
    clearTimeout(timeout);
  }
}

function assertValidYamlUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error("YAML_SOURCE_URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("YAML_SOURCE_URL must start with http:// or https://.");
  }
}

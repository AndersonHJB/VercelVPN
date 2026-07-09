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
    return fetchYamlFromUrl(remoteYamlUrl, "YAML_SOURCE_URL");
  }

  const yamlPath = process.env.YAML_FILE_PATH?.trim() || defaultYamlPath;

  return readYamlFromFile(yamlPath);
}

async function readYamlFromFile(yamlPath: string): Promise<string> {
  const resolvedPath = path.isAbsolute(yamlPath) ? yamlPath : path.join(process.cwd(), yamlPath);
  let content: string;

  try {
    content = await readFile(resolvedPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(
        `YAML_FILE_PATH file "${yamlPath}" was not found. On Vercel, the file must be committed and redeployed, or use YAML_SOURCE_URL for remote subscriptions.`
      );
    }

    throw new Error(
      `Unable to read YAML_FILE_PATH file "${yamlPath}". Set YAML_CONTENT, YAML_SOURCE_URL, or provide a readable YAML_FILE_PATH file.`
    );
  }

  const linkedYamlUrl = parseLocalYamlUrlFile(content);

  if (linkedYamlUrl) {
    return fetchYamlFromUrl(linkedYamlUrl, `URL in ${yamlPath}`);
  }

  return content;
}

function parseLocalYamlUrlFile(content: string): string | undefined {
  const meaningfulLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (meaningfulLines.length !== 1) {
    return undefined;
  }

  const [line] = meaningfulLines;

  if (!line.startsWith("http://") && !line.startsWith("https://")) {
    return undefined;
  }

  return line;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function fetchYamlFromUrl(url: string, sourceName: string): Promise<string> {
  assertValidYamlUrl(url, sourceName);

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
      throw new Error(`Unable to fetch ${sourceName}: ${error.message}`);
    }

    throw new Error(`Unable to fetch ${sourceName}.`);
  } finally {
    clearTimeout(timeout);
  }
}

function assertValidYamlUrl(url: string, sourceName: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${sourceName} is not a valid URL.`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${sourceName} must start with http:// or https://.`);
  }
}

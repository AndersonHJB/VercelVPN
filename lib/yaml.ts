import { readFile } from "fs/promises";
import path from "path";

export async function getYamlContent(): Promise<string> {
  if (process.env.YAML_CONTENT && process.env.YAML_CONTENT.length > 0) {
    return process.env.YAML_CONTENT;
  }

  const yamlPath = process.env.YAML_FILE_PATH || "data/subscription.yaml";
  const resolvedPath = path.isAbsolute(yamlPath) ? yamlPath : path.join(process.cwd(), yamlPath);

  try {
    return await readFile(resolvedPath, "utf8");
  } catch {
    throw new Error(
      "YAML content is not configured. Set YAML_CONTENT or create the YAML_FILE_PATH file."
    );
  }
}

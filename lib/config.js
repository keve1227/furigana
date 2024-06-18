import fs from "node:fs/promises";
import YAML from "yaml";

export const { sources, furigana } = YAML.parse(await fs.readFile("config.yaml", "utf-8"));

export default { sources, furigana };

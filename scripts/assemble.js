import fs from "node:fs/promises";
import path from "node:path";

import * as prettier from "prettier";
import { minimatch } from "minimatch";

import config from "../lib/config.js";
import { writeFile, hexDigest } from "../lib/utils.js";

const { sources } = config;

for (const sourceInfo of sources) {
    const version = sourceInfo.version;
    const versionHash = hexDigest(version).slice(0, 7);
    const sourcePath = path.join("build", "converted", versionHash);
    const resourcePath = "resources";

    try {
        var sourceDir = await fs.opendir(sourcePath, { recursive: true });
    } catch {
        throw new Error(`No converted sources found for version ${version}`);
    }

    const compiledFiles = [];

    for await (const file of sourceDir) {
        if (!file.isFile()) continue;

        const srcPath = path.join(file.parentPath, file.name);
        const relativePath = path.relative(sourcePath, srcPath);

        if (minimatch(relativePath, "**/ja_*.json")) {
            const outputPath = path.join(
                path.dirname(relativePath),
                path.basename(relativePath, ".json") + "_rubi.json"
            );

            const translation = JSON.parse(await fs.readFile(srcPath, "utf-8"));
            const compiled = {};

            for (const [key, parts] of Object.entries(translation)) {
                compiled[key] = "";

                for (const part of parts) {
                    if (typeof part === "string") {
                        compiled[key] += part;
                    } else {
                        compiled[key] += `§^${part.surface}(${part.reading})`;
                    }
                }
            }

            const json = await prettier.format(JSON.stringify(compiled), {
                filepath: srcPath,
                tabWidth: 4,
                printWidth: 120,
            });

            compiledFiles.push({
                file: outputPath,
                data: json,
            });
        } else {
            compiledFiles.push({
                file: relativePath,
                data: await fs.readFile(srcPath),
            });
        }
    }

    for (const output of sourceInfo.outputs) {
        const { name, ...packProperties } = output;
        const outputPath = path.join("build", "out", output.name);

        for await (const file of await fs.opendir(resourcePath, { recursive: true })) {
            if (!file.isFile()) continue;

            const srcPath = path.join(file.parentPath, file.name);
            const relativePath = path.relative(resourcePath, srcPath);
            const dstPath = path.join(outputPath, relativePath);

            let src = await fs.readFile(srcPath);

            if (relativePath === "pack.mcmeta") {
                const mcmeta = JSON.parse(src.toString("utf-8"));
                Object.assign(mcmeta.pack, packProperties);

                src = await prettier.format(JSON.stringify(mcmeta), {
                    filepath: srcPath,
                    parser: "json",
                    tabWidth: 4,
                    printWidth: 120,
                });
            }

            await writeFile(dstPath, src);
        }

        for (const { file, data } of compiledFiles) {
            const dstPath = path.join(outputPath, file);
            await writeFile(dstPath, data);
        }
    }
}

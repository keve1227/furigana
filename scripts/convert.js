import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { minimatch } from "minimatch";
import * as prettier from "prettier";

import config from "../lib/config.js";
import * as furigana from "../lib/furigana.js";
import { hexDigest, fileURL, writeFile } from "../lib/utils.js";

const {
    sources,
    furigana: { combinators, supplements, overrides },
} = config;

process.once("beforeExit", async () => {
    console.log("Done!");
});

for (const sourceInfo of sources) {
    const version = sourceInfo.version;
    const versionHash = hexDigest(version).slice(0, 7);
    const sourcePath = path.join("build", "sources", versionHash);
    const outputPath = path.join("build", "converted", versionHash);

    (async () => {
        try {
            var sourceDir = await fs.opendir(sourcePath, { recursive: true });
        } catch {
            throw new Error(`No sources found for version ${version}`);
        }

        for await (const file of sourceDir) {
            if (!file.isFile()) continue;

            const srcPath = path.join(file.parentPath, file.name);
            const relativePath = path.relative(sourcePath, srcPath);

            const dstPath = path.join(outputPath, relativePath);

            (async () => {
                if (minimatch(relativePath, "**/ja_*.json")) {
                    console.log(`[${version}] Converting ${fileURL(srcPath)}`);

                    const translation = JSON.parse(await fs.readFile(srcPath, "utf-8"));
                    const converted = {};
                    const errors = [];

                    for (const [key, text] of Object.entries(translation)) {
                        const combinatorOverrides = overrides[key]?.combinators;
                        const supplementOverrides = overrides[key]?.supplements;

                        try {
                            converted[key] = await furigana.convert(
                                text,
                                { ...combinators, ...combinatorOverrides },
                                { ...supplements, ...supplementOverrides }
                            );
                        } catch (e) {
                            errors.push(Object.assign(e, { key }));
                        }
                    }

                    if (errors.length) {
                        throw new AggregateError(errors, "Errors converting keys");
                    }

                    const sorted = Object.fromEntries(Object.entries(converted).sort(([a], [b]) => a.localeCompare(b)));
                    const json = await prettier.format(JSON.stringify(sorted), {
                        filepath: dstPath,
                        tabWidth: 4,
                        printWidth: 120,
                    });

                    await writeFile(dstPath, json);
                } else {
                    console.log(`[${version}] Copying ${fileURL(srcPath)}`);
                    await writeFile(dstPath, await fs.readFile(srcPath));
                }
            })();
        }
    })();
}

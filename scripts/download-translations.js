import os from "node:os";
import fs from "node:fs/promises";
import posix from "node:path/posix";
import process from "node:process";
import { join } from "node:path";
import { inspect } from "node:util";

import { minimatch } from "minimatch";
import * as semver from "semver";

import config from "../lib/config.js";
import { hexDigest, fetchJson, writeFile, detailedError } from "../lib/utils.js";

const { sources } = config;
const versionManifest = await fetchJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");

const cacheDir = await fs.mkdtemp(join(os.tmpdir(), ".cache-"));

process.once("beforeExit", async () => {
    await fs.rm(cacheDir, { recursive: true });
    console.log("Done!");
});

for (const sourceInfo of sources) {
    const versionRange = sourceInfo.version;

    const matchingVersions = versionManifest.versions.filter(({ id }) =>
        semver.satisfies(semver.coerce(id, { includePrerelease: true }), versionRange)
    );

    if (matchingVersions.length === 0) {
        throw new Error(`No versions matching ${versionRange} could be found`);
    }

    (async () => {
        const combinedAssetIndex = {};

        await Promise.all(
            matchingVersions.map(async (versionInfo) => {
                const clientInfo = await fetchJsonCached(versionInfo.url);
                const { objects: assetIndex } = await fetchJsonCached(clientInfo.assetIndex.url);

                for (const [path, object] of Object.entries(assetIndex)) {
                    object.path = path;

                    combinedAssetIndex[path] ??= [];
                    const existingObject = combinedAssetIndex[path].find((entry) => entry.hash === object.hash);

                    if (!existingObject) {
                        combinedAssetIndex[path].push({ ...object, versions: [versionInfo.id] });
                    } else {
                        existingObject.versions.push(versionInfo.id);
                        existingObject.versions.sort((a, b) =>
                            semver.compare(
                                semver.coerce(a, { includePrerelease: true }),
                                semver.coerce(b, { includePrerelease: true })
                            )
                        );
                    }
                }
            })
        );

        await fetchTranslations(combinedAssetIndex, versionRange);
    })();
}

async function fetchTranslations(combinedAssetIndex, versionRange) {
    const paths = Object.keys(combinedAssetIndex).filter((path) => minimatch(path, "**/ja_*.json"));

    if (paths.length === 0) {
        throw new Error(`No Japanese translations found for version ${versionRange}`);
    }

    const versionHash = hexDigest(versionRange).slice(0, 7);
    const sourcePath = posix.join("build", "sources", versionHash);

    await Promise.all(
        paths.map(async (path) => {
            const objects = combinedAssetIndex[path];

            if (objects.length > 1) {
                throw detailedError(`Conflicting translations found for ${versionRange}`, { objects });
            }

            await fetchTranslation(objects[0], versionRange, sourcePath);
        })
    );
}

async function fetchTranslation(object, versionRange, sourcePath) {
    const objectHash = object.hash;
    const objectUrl = `https://resources.download.minecraft.net/${objectHash.substring(0, 2)}/${objectHash}`;

    console.log(`[${versionRange}] Downloading ${inspect(object.path)} from ${inspect(objectUrl)}`);
    const translation = await fetchJsonCached(objectUrl);

    const savePath = posix.join(sourcePath, "assets", object.path);
    await writeFile(savePath, JSON.stringify(translation));

    console.log(`[${versionRange}] Saved ${inspect(object.path)} to ${inspect(savePath)}`);
}

async function fetchJsonCached(url) {
    const urlHash = hexDigest(url);
    const cachePath = join(cacheDir, urlHash);

    try {
        return JSON.parse(await fs.readFile(cachePath, "utf-8"));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    const data = await fetchJson(url);
    await writeFile(cachePath, JSON.stringify(data));

    return data;
}

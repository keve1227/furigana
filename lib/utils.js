import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const KANJI = "[^\\P{Script_Extensions=Han}\\p{P}]";
const KANA = "[\\p{Script_Extensions=Hiragana}\\p{Script_Extensions=Katakana}]";

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasKanji(text) {
    return new RegExp(KANJI, "u").test(text);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasKana(text) {
    return new RegExp(KANA, "u").test(text);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasJapanese(text) {
    return new RegExp(`${KANJI}|${KANA}`, "u").test(text);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function hasTrappedKana(text) {
    return new RegExp(`${KANJI}${KANA}+${KANJI}`, "u").test(text);
}

/**
 * @param {string} text
 * @returns {string}
 */
export function katakanaToHiragana(text) {
    return text.replace(/[ァ-ヶヽヾヿ]/g, (char) => String.fromCodePoint(char.codePointAt(0) - 0x60));
}

/**
 * @param {string} [message]
 * @param {Record<PropertyKey, unknown> & ErrorOptions} [options]
 * @returns {Error}
 */
export function detailedError(message, options = {}) {
    const { cause, ...details } = options;
    return Object.assign(new Error(message, options), {
        ...cause,
        ...details,
    });
}

/**
 * @param {crypto.BinaryLike} data
 * @returns {string}
 */
export function hexDigest(data) {
    return crypto.createHash("sha1").update(data).digest("hex");
}

export function fileURL(path) {
    return pathToFileURL(path).href;
}

/**
 * @param {string | URL} url
 * @returns {Promise<unknown>}
 */
export async function fetchJson(url) {
    if (typeof url === "string") {
        url = new URL(url);
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }

    return response.json();
}

/** @type {typeof fs.writeFile} */
export const writeFile = async function (file, data, options) {
    const dirname = path.dirname(file);
    await fs.mkdir(dirname, { recursive: true });
    await fs.writeFile(file, data, options);
};

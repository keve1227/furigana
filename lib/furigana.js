import * as kuromojin from "kuromojin";
import { hasKanji, hasKana, hasJapanese, katakanaToHiragana, detailedError } from "./utils.js";

/**
 * @typedef {kuromojin.KuromojiToken} KuromojiToken
 * @typedef {{ surface: string, reading: string }} Word
 */

/** @type {Map<string, Word[]>} */
const wordCache = new Map();

Array.prototype.pack = function () {
    let end = 0;

    for (let i = 0; i < this.length; i++) {
        if (i in this) {
            this[end++] = this[i];
        }
    }

    this.length = end;
};

/**
 * @param {string} text
 * @param {Partial<Record<string, string>>} combinators
 * @param {Partial<Record<string, string>>} supplements
 * @returns {Promise<(string | Word)[]>}
 */
export async function convert(text, combinators, supplements) {
    if (!hasJapanese(text)) return [text];

    const tokens = await kuromojin.tokenize(text);

    let words = tokens.map(tokenToWord);
    words = applyCombinators(words, combinators);

    /** @type {(string | Word)[]} */
    const result = [];

    for (const word of words) {
        const cacheKey = [word.surface, word.reading].join("\0");

        /** @type {(string | Word)[]} */
        let parts = [word];

        if (wordCache.has(cacheKey)) {
            parts = wordCache.get(cacheKey);
        } else if (word.surface in supplements) {
            parts[0].reading = supplements[word.surface];
        } else if (hasKanji(word.surface)) {
            try {
                if (!word.reading) throw new Error("Unknown word");

                if (hasKana(word.surface)) {
                    parts = correlateReading(word);
                }
            } catch (e) {
                const context = words.map(({ surface }) => surface);
                const index = words.indexOf(word);

                throw detailedError("Unresolved kanji reading", {
                    context,
                    index,
                    word,
                    cause: e,
                });
            }
        } else {
            parts[0] = word.surface;
        }

        wordCache.set(cacheKey, parts);
        result.push(...parts);
    }

    return result.reduceRight(
        ([prev, ...rest], part) => {
            if (typeof prev === "string" && typeof part === "string") {
                return [part + prev, ...rest];
            } else if (typeof prev === typeof part) {
                return [{ surface: part.surface + prev.surface, reading: part.reading + prev.reading }, ...rest];
            } else {
                return [part, prev, ...rest];
            }
        },
        [result.pop()]
    );
}

/**
 * @param {KuromojiToken} token
 * @returns {Word}
 */
function tokenToWord(token) {
    return {
        surface: token.surface_form,
        reading: katakanaToHiragana(token.reading ?? token.pronunciation ?? ""),
    };
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeRegExp(string) {
    return string.replace(/[$()*+\-.?[\\\]^{|}]/g, (char) => "\\" + char.codePointAt(0).toString(16).padStart(4, "0"));
}

/**
 * @param {Word[]} words
 * @param {Partial<Record<string, string>>} combinators
 */
function applyCombinators(words, combinators) {
    const result = [];

    const maxLength = Math.max(...Object.keys(combinators).map((key) => key.length));

    for (let i = 0; i < words.length; i++) {
        let surface = "";
        let reading = "";
        let skip = 0;

        for (let j = 0, s = ""; i + j < words.length; j++) {
            s += words[i + j].surface;
            if (s.length > maxLength) break;

            if (s in combinators) {
                surface = s;
                reading = combinators[s];
                skip = j;
            }
        }

        if (!reading) {
            result.push(words[i]);
            continue;
        }

        result.push({ surface, reading });
        i += skip;
    }

    return result;
}

/**
 * @param {Word} word
 * @returns {(string | Word)[]}
 */
function correlateReading(word) {
    // Split around kanji sequences
    const groups = word.surface.split(/([^\P{Script_Extensions=Han}\p{P}]+)/u).filter(Boolean);

    let greedyPattern = "";
    let lazyPattern = "";
    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        if (group.length === 0) continue;

        if (hasKanji(group)) {
            greedyPattern += "(.+)";
            lazyPattern += "(.+?)";
        } else {
            const groupHiragana = katakanaToHiragana(group);
            const escaped = escapeRegExp(groupHiragana);

            greedyPattern += `(${escaped})`;
            lazyPattern += `(${escaped})`;
        }
    }

    const greedyMatch = word.reading.match(`^${greedyPattern}$`);
    const lazyMatch = word.reading.match(`^${lazyPattern}$`);
    if (!greedyMatch || !lazyMatch) {
        throw new Error("The reading contains kana that don't match the surface form.");
    }

    /** @type {(string | Word)[]} */
    const result = [];
    for (let i = 0; i < groups.length; i++) {
        if (greedyMatch[i + 1] !== lazyMatch[i + 1]) {
            throw new Error("The reading may correlate with the surface form in multiple ways.");
        }

        if (hasKanji(groups[i])) {
            result.push({
                surface: groups[i],
                reading: greedyMatch[i + 1],
            });
        } else {
            result.push(groups[i]);
        }
    }

    return result;
}

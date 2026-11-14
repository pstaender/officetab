// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/symspell/implementation/EditDistance.java faithful
// The upstream file is under the MIT License (notice below). int[] are Int32Arrays (zero-filled
// as in Java).
//        MIT License
//
//        Copyright (c) 2018 Hampus Londögård
//
//        Permission is hereby granted, free of charge, to any person obtaining a copy
//        of this software and associated documentation files (the "Software"), to deal
//        in the Software without restriction, including without limitation the rights
//        to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//        copies of the Software, and to permit persons to whom the Software is
//        furnished to do so, subject to the following conditions:
//
//        The above copyright notice and this permission notice shall be included in all
//        copies or substantial portions of the Software.
//
//        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//        IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//        FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//        AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//        LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//        OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//        SOFTWARE.

export const DistanceAlgorithm = {
  Damerau: 'Damerau',
} as const;
export type DistanceAlgorithm = typeof DistanceAlgorithm[keyof typeof DistanceAlgorithm];

export class EditDistance {
    static readonly DistanceAlgorithm = DistanceAlgorithm;
    private baseString: string | null;
    private algorithm: DistanceAlgorithm;
    private v0!: Int32Array;
    private v2!: Int32Array;
    /// <summary>Create a new EditDistance object.</summary>
    /// <param name="baseString">The base string to which other strings will be compared.</param>
    /// <param name="algorithm">The desired edit distance algorithm.</param>
    constructor(baseString: string, algorithm: DistanceAlgorithm)
    {
        this.baseString = baseString;
        this.algorithm = algorithm;
        if (this.baseString.length === 0) {
            this.baseString = null;
            return;
        }
        if (algorithm === DistanceAlgorithm.Damerau) {
            this.v0 = new Int32Array(baseString.length);
            this.v2 = new Int32Array(baseString.length); // stores one level further back (offset by +1 position)
        }
    }
    // <summary>compare a string to the base string to determine the edit distance,
    /// using the previously selected algorithm.</summary>
    /// <param name="string2">The string to compare.</param>
    /// <param name="maxDistance">The maximum distance allowed.</param>
    /// <returns>The edit distance (or -1 if maxDistance exceeded).</returns>
    compare(string2: string | null, maxDistance: number): number {
        switch (this.algorithm) {
            case DistanceAlgorithm.Damerau: return this.DamerauLevenshteinDistance(string2, maxDistance);
        }
        throw new Error('IllegalArgumentException: unknown DistanceAlgorithm');
    }
    // stores one level further back (offset by +1 position)
    /// <param name="string1">String being compared for distance.</param>
    /// <param name="string2">String being compared against other string.</param>
    /// <param name="maxDistance">The maximum edit distance of interest.</param>
    /// <returns>int edit distance, >= 0 representing the number of edits required
    /// to transform one string to the other, or -1 if the distance is greater than the specified maxDistance.</returns>
    DamerauLevenshteinDistance(string2: string | null, maxDistance: number): number {
        const baseString = this.baseString;
        if (baseString == null) return string2 == null ? 0 : string2.length; //string2 ?? "").Length;
        if (string2 == null || string2.length === 0) return baseString.length;
        if (maxDistance === 0) return baseString === string2 ? 0 : -1;

        // if strings of different lengths, ensure shorter string is in string1. This can result in a little
        // faster speed by spending more time spinning just the inner loop during the main processing.
        let string1: string;
        if (baseString.length > string2.length) {
            string1 = string2;
            string2 = baseString;
        } else {
            string1 = baseString;
        }
        let sLen = string1.length; // this is also the minimum length of the two strings
        let tLen = string2.length;

        // suffix common to both strings can be ignored
        while ((sLen > 0) && (string1.charAt(sLen - 1) === string2.charAt(tLen - 1))) { sLen--; tLen--; }

        let start = 0;
        if ((string1.charAt(0) === string2.charAt(0)) || (sLen === 0)) { // if there'string1 a shared prefix, or all string1 matches string2'string1 suffix
            // prefix common to both strings can be ignored
            while ((start < sLen) && (string1.charAt(start) === string2.charAt(start))) start++;
            sLen -= start; // length of the part excluding common prefix and suffix
            tLen -= start;

            // if all of shorter string matches prefix and/or suffix of longer string, then
            // edit distance is just the delete of additional characters present in longer string
            if (sLen === 0) return tLen;

            string2 = string2.substring(start, start + tLen); // faster than string2[start+j] in inner loop below
        }
        const lenDiff = tLen - sLen;
        if ((maxDistance < 0) || (maxDistance > tLen)) {
            maxDistance = tLen;
        } else if (lenDiff > maxDistance) return -1;

        if (tLen > this.v0.length)
        {
            this.v0 = new Int32Array(tLen);
            this.v2 = new Int32Array(tLen);
        } else {
            for (let i = 0; i < tLen; i++) this.v2[i] = 0;    // Substituting Array.clear(v2, 0, tLen)
        }
        const v0 = this.v0;
        const v2 = this.v2;
        let j: number;
        for (j = 0; j < maxDistance; j++) v0[j] = j + 1;
        for (; j < tLen; j++) v0[j] = maxDistance + 1;

        const jStartOffset = maxDistance - (tLen - sLen);
        const haveMax = maxDistance < tLen;
        let jStart = 0;
        let jEnd = maxDistance;
        let sChar = string1.charAt(0);
        let current = 0;
        for (let i = 0; i < sLen; i++) {
            const prevsChar = sChar;
            sChar = string1.charAt(start + i);
            let tChar = string2.charAt(0);
            let left = i;
            current = left + 1;
            let nextTransCost = 0;
            // no need to look beyond window of lower right diagonal - maxDistance cells (lower right diag is i - lenDiff)
            // and the upper left diagonal + maxDistance cells (upper left is i)
            jStart += (i > jStartOffset) ? 1 : 0;
            jEnd += (jEnd < tLen) ? 1 : 0;
            for (j = jStart; j < jEnd; j++) {
                const above = current;
                let thisTransCost = nextTransCost;
                nextTransCost = v2[j]!;
                v2[j] = current = left; // cost of diagonal (substitution)
                left = v0[j]!;    // left now equals current cost (which will be diagonal at next iteration)
                const prevtChar = tChar;
                tChar = string2.charAt(j);
                if (sChar !== tChar) {
                    if (left < current) current = left;   // insertion
                    if (above < current) current = above; // deletion
                    current++;
                    if ((i !== 0) && (j !== 0)
                            && (sChar === prevtChar)
                            && (prevsChar === tChar)) {
                        thisTransCost++;
                        if (thisTransCost < current) current = thisTransCost; // transposition
                    }
                }
                v0[j] = current;
            }
            if (haveMax && (v0[i + lenDiff]! > maxDistance)) return -1;
        }
        return (current <= maxDistance) ? current : -1;
    }
}

import { expect, test } from 'vitest';
import { parseStream } from '../src';
import * as fs from 'node:fs';
import { createReadableStreamFromReadable } from 'node-readable-stream';

test('should parse sample archive', async function () {
    const archive = await parseStream(
        (
            createReadableStreamFromReadable(
                fs.createReadStream('./test/sample.psarchive'),
            ) as ReadableStream
        ).pipeThrough(new DecompressionStream('gzip')),
    );
    const quizCount = 11;
    const framePerQuiz = 2;
    expect(archive.content.length).toBe(quizCount);
    expect(
        archive.content.reduce((acc, curr) => acc + curr.frames.length, 0),
    ).toBe(quizCount * framePerQuiz);
});

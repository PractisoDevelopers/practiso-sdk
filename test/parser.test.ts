import { expect, test } from 'vitest';
import { Parser } from '../src';
import * as fs from 'node:fs';
import { createReadableStreamFromReadable } from 'node-readable-stream';

test('should parse sample archive', async function () {
    const parser = new Parser();
    await (
        createReadableStreamFromReadable(
            fs.createReadStream('./test/sample.psarchive'),
        ) as ReadableStream
    )
        .pipeThrough(new DecompressionStream('gzip'))
        .pipeTo(parser.sink);
    const archive = await parser.result();
    const quizCount = 11;
    const framePerQuiz = 2;
    expect(archive.content.length).toBe(quizCount);
    expect(
        archive.content.reduce((acc, curr) => acc + curr.frames.length, 0),
    ).toBe(quizCount * framePerQuiz);
});

import { expect, test } from 'vitest';
import { Parser } from '../src';
import * as fs from 'node:fs';
import { createReadableStreamFromReadable } from 'node-readable-stream';

async function parseFile(file: string) {
    const parser = new Parser();
    await (
        createReadableStreamFromReadable(
            fs.createReadStream(file),
        ) as ReadableStream
    )
        .pipeThrough(new DecompressionStream('gzip'))
        .pipeTo(parser.sink);
    return await parser.result();
}

test('should parse sample archive', async function () {
    const archive = await parseFile('./test/sample.psarchive');
    const quizCount = 11;
    const framePerQuiz = 2;
    expect(archive.content.length).toBe(quizCount);
    expect(
        archive.content.reduce((acc, curr) => acc + curr.frames.length, 0),
    ).toBe(quizCount * framePerQuiz);
});

test('should parse image archive', async function () {
    const archive = await parseFile('./test/sample.image.psarchive');
    expect(archive.content.length).toBe(1);
    expect(archive.resources.size).toBe(1);
});

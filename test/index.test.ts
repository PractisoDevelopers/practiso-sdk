import { describe, expect, it } from 'vitest';
import { Composer, Parser } from '../src';
import * as fs from 'node:fs';
import { createReadableStreamFromReadable } from 'node-readable-stream';
import { Archive, PractisoArchive, QuizArchive } from '../src/model';
import * as crypto from 'node:crypto';

const sampleArchiveName = './test/sample.psarchive',
    sampleImageArchiveName = './test/sample.image.psarchive';

describe('parser test', () => {
    it('should parse sample archive', async () => {
        const archive = await parseFile(sampleArchiveName);
        const quizCount = 11;
        const framePerQuiz = 2;
        expect(archive.content.length).toBe(quizCount);
        expect(
            archive.content.reduce((acc, curr) => acc + curr.frames.length, 0),
        ).toBe(quizCount * framePerQuiz);
    });

    it('should parse image archive', async function () {
        const archive = await parseFile(sampleImageArchiveName);
        expect(archive.content.length).toBe(1);
        expect(archive.resources.size).toBe(1);
    });
});

describe('composer test', () => {
    it('should compose simple archive', async () => {
        const archive = new PractisoArchive([
            new QuizArchive('Simple Quiz', {
                frames: [
                    new Archive.Text(
                        "It's so sad that Steve Jobs died of ligma. What is ligma?",
                    ),
                    new Archive.Options('Ligma definitions', [
                        new Archive.Option(
                            new Archive.Text('A type of cancer'),
                        ),
                        new Archive.Option(
                            new Archive.Text('A serious mental disorder'),
                        ),
                        new Archive.Option(new Archive.Text('Ligma balls'), {
                            isKey: true,
                        }),
                    ]),
                ],
            }),
        ]);
        archive.resources.put(
            'new resource',
            new Blob([new Uint8Array([1, 1, 2, 69, 42, 0])]),
        );
        const composer = new Composer(archive);
        const parser = new Parser();
        await composer.source.pipeTo(parser.sink);
        expect(await parser.result()).toEqual(archive);
    });

    it('should compose image archive', async () => {
        const archive = await parseFile(sampleImageArchiveName);
        const composer = new Composer(archive);
        const parser = new Parser();
        await composer.source.pipeTo(parser.sink);
        const parsed = await parser.result();
        expect(parsed.content, 'content mismatch').toEqual(archive.content);
        expect(parsed.resources.size, 'resource size mismatch').toEqual(
            archive.resources.size,
        );
        for await (const [name, content] of parsed.resources) {
            const originalBytes = await (await archive.resources.get(
                name,
            ))!.bytes();
            expect(
                sha1(await content.bytes()),
                `${name} content mismatch`,
            ).toEqual(sha1(originalBytes));
        }
    });
});

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

function sha1(buffer: crypto.BinaryLike) {
    const hash = crypto.createHash('sha1');
    hash.update(buffer);
    return hash.digest();
}

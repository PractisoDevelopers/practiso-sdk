import * as model from './model';
import {
    Archive,
    ArchiveParseError,
    DimensionArchive,
    FrameArchive,
    PractisoArchive,
    QuizArchive,
    ResourceArchive,
} from './model';
import * as magic from './magic';

function allowElementOrEmptyText(value: ChildNode[]): Element[] {
    for (const [index, node] of value.entries()) {
        if (!(node instanceof Element)) {
            if (node instanceof Text) {
                if (node.wholeText.trim().length > 0) {
                    throw new ArchiveParseError(
                        `unexpected text "${node.textContent}"`,
                        null,
                        index,
                    );
                }
            } else {
                throw new ArchiveParseError(
                    `unexpected element ${node.nodeName}`,
                    null,
                    index,
                );
            }
        }
    }
    return value as Element[];
}

export async function parseStream(
    stream: ReadableStream<Blob | Uint8Array>,
): Promise<PractisoArchive> {
    const reader = stream.getReader();
    try {
        let read = await reader.read();
        let xmlContent = '';
        while (!read.done) {
            const blob =
                read.value instanceof Blob
                    ? read.value
                    : new Blob([read.value]);
            const buffer = await blob.bytes();
            const terminatorIndex = buffer.indexOf(0);
            if (terminatorIndex >= 0) {
                read = {
                    done: false,
                    value: blob.slice(terminatorIndex + 1),
                };
                break;
            } else {
                xmlContent += await blob.text();
            }

            read = await reader.read();
        }

        const xml = new DOMParser();
        const archiveDoc = xml.parseFromString(xmlContent, 'application/xml');
        const archive = parseXmlObj(archiveDoc);

        const resourceBlocks = new Array<BlobPart>();
        while (!read.done) {
            resourceBlocks.push(read.value);
            read = await reader.read();
        }
        archive.resources = await parseResources(new Blob(resourceBlocks));
        return archive;
    } finally {
        await reader.cancel();
    }
}

function parseXmlObj(xmlDoc: Document): PractisoArchive {
    const archive = xmlDoc.documentElement;
    if (archive?.localName !== magic.archiveSerialName) {
        throw new ArchiveParseError(
            `missing <${magic.archiveSerialName}> as document element`,
        );
    }

    if (archive.namespaceURI && archive.namespaceURI != magic.namespace) {
        throw new ArchiveParseError(
            `unexpected xml namespace: ${archive.lookupNamespaceURI('')}`,
            null,
            `<${magic.archiveSerialName}>`,
        );
    }

    const creation = (() => {
        const str = archive.getAttribute('creation');
        if (!str) {
            throw new ArchiveParseError(
                'missing attribute "creation"',
                null,
                `<${magic.archiveSerialName}>`,
            );
        }
        return Date.parse(str);
    })();

    let elements: Element[];
    try {
        elements = allowElementOrEmptyText(Array.from(archive.childNodes));
    } catch (e) {
        if (e instanceof ArchiveParseError) {
            throw new ArchiveParseError(
                e.message,
                null,
                `<${magic.archiveSerialName}>`,
                ...e.location,
            );
        }
        throw e;
    }
    const quizzes = elements
        .map((quiz, index) => {
            const name = quiz.getAttribute('name'),
                quizCreationStr = quiz.getAttribute('creation'),
                quizModificationStr = quiz.getAttribute('modification');
            if (name == null) {
                throw new ArchiveParseError(
                    `missing name attribute`,
                    null,
                    `<${magic.archiveSerialName}>`,
                    `<${magic.quizSerialName}#${index}>`,
                );
            }
            if (!quizCreationStr) {
                throw new ArchiveParseError(
                    `missing creation attribute`,
                    null,
                    `<${magic.archiveSerialName}>`,
                    `<${magic.quizSerialName}#${index}>`,
                );
            }

            const framesElements = Array.from(
                quiz.getElementsByClassName(magic.framesSerialName),
            );
            if (framesElements.length <= 0) {
                throw new ArchiveParseError(
                    `missing <${magic.framesSerialName}>`,
                    null,
                    `<${magic.archiveSerialName}>`,
                    `<${magic.quizSerialName}#${index}>`,
                );
            }
            if (framesElements.length > 1) {
                throw new ArchiveParseError(
                    `too many <${magic.framesSerialName}>`,
                    null,
                    `<${magic.archiveSerialName}>`,
                    `<${magic.quizSerialName}#${index}>`,
                );
            }
            const dimensions = Array.from(
                quiz.getElementsByClassName(magic.dimensionSerialName),
            ).map((ele, dIndex) => {
                try {
                    return parseXmlDimension(ele);
                } catch (e) {
                    if (e instanceof ArchiveParseError) {
                        throw new ArchiveParseError(
                            e.message,
                            e,
                            `<${magic.archiveSerialName}>`,
                            `<${magic.quizSerialName}#${index}>`,
                            `<${magic.dimensionSerialName}#${dIndex}>`,
                            ...e.location,
                        );
                    } else {
                        throw e;
                    }
                }
            });

            const frames = allowElementOrEmptyText(
                framesElements.flatMap((f) => Array.from(f.children)),
            ).map((ele, fIndex) => {
                try {
                    return parseXmlFrame(ele);
                } catch (e) {
                    if (e instanceof ArchiveParseError) {
                        throw new ArchiveParseError(
                            e.message,
                            e,
                            `<${magic.archiveSerialName}>`,
                            `<${magic.quizSerialName}#${index}>`,
                            `<${magic.framesSerialName}>`,
                            fIndex,
                        );
                    }
                    throw e;
                }
            });
            return new QuizArchive(
                name,
                new Date(quizCreationStr),
                quizModificationStr ? new Date(quizModificationStr) : undefined,
                frames,
                dimensions,
            );
        })
        .filter((quiz) => typeof quiz !== 'undefined');
    return new PractisoArchive(new Date(creation), quizzes);
}

async function parseResources(blob: Blob): Promise<ResourceArchive> {
    const buffer = await blob.bytes();
    const textDecoder = new TextDecoder();
    let i = 0;
    const resMap = new Map<string, Blob>();

    while (i < buffer.length) {
        const nameTermination = buffer.indexOf(0, i);
        const name = textDecoder.decode(buffer.slice(i, nameTermination));
        i = nameTermination + 1;
        const sizeView = new DataView(buffer.buffer, i, 4);
        const size = sizeView.getInt32(0, false);
        i += sizeView.byteLength;
        resMap.set(name, new Blob([buffer.slice(i, i + size)]));
        i += size;
    }

    return new ResourceArchive(resMap);
}

function parseXmlFrame(xmlEle: Element): FrameArchive {
    switch (xmlEle.localName) {
        case magic.textFrameSerialName:
            if (!xmlEle.textContent) {
                throw new ArchiveParseError(
                    'unexpected empty text content',
                    null,
                    `<${magic.textFrameSerialName}>`,
                );
            }
            return new Archive.Text(xmlEle.textContent);
        case magic.imageFrameSerialName:
            const width = xmlEle.getAttribute('width'),
                height = xmlEle.getAttribute('height'),
                alt = xmlEle.getAttribute('alt'),
                src = xmlEle.getAttribute('src');
            if (!width || !height) {
                throw new ArchiveParseError(
                    'unexpected image of unknown size',
                    null,
                    `<${magic.imageFrameSerialName}>`,
                );
            }
            if (!src) {
                throw new ArchiveParseError(
                    'unexpected image of empty or no resource names',
                    null,
                    `<${magic.imageFrameSerialName}>`,
                );
            }
            return new Archive.Image(
                src,
                parseInt(width),
                parseInt(height),
                alt,
            );
        case magic.optionsFrameSerialName:
            const items = allowElementOrEmptyText(
                Array.from(xmlEle.childNodes),
            ).map((itemEle, index) => {
                if (itemEle.localName !== 'item') {
                    throw new ArchiveParseError(
                        `unexpected node, only <item> expected`,
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        index,
                        `<${itemEle.nodeName}>`,
                    );
                }
                const innerEle = itemEle.firstElementChild;
                if (!innerEle) {
                    throw new ArchiveParseError(
                        `empty item`,
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        `<${itemEle.nodeName}#${index}>`,
                    );
                }
                const priorityStr = itemEle.getAttribute('priority');
                if (!priorityStr) {
                    throw new ArchiveParseError(
                        'missing priority attribute',
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        `<${itemEle.nodeName}#${index}>`,
                    );
                }
                const priority = parseInt(priorityStr);
                if (Number.isNaN(priority)) {
                    throw new ArchiveParseError(
                        `unexpected priority value ${priorityStr}`,
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        `<${itemEle.nodeName}#${index}>`,
                    );
                }
                const isKey = itemEle.getAttribute('key') === 'true';

                let innerFrame: FrameArchive;
                try {
                    innerFrame = parseXmlFrame(innerEle);
                } catch (e) {
                    if (e instanceof ArchiveParseError) {
                        throw new ArchiveParseError(
                            e.message,
                            e,
                            `<${magic.optionsFrameSerialName}>`,
                            `<${itemEle.nodeName}#${index}>`,
                            ...e.location
                        )
                    }
                    throw e
                }
                return new Archive.Option(isKey, priority, innerFrame);
            });
            const name = xmlEle.getAttribute('name');
            return new Archive.Options(name, items);
        default:
            throw new ArchiveParseError(
                'unexpected frame type',
                null,
                `<${xmlEle.nodeName}>`,
            );
    }
}

function parseXmlDimension(xmlEle: Element): DimensionArchive {
    const name = xmlEle.getAttribute('name')
    if (!name) {
        throw new ArchiveParseError('missing name attribute')
    }
    if (!xmlEle.textContent) {
        throw new ArchiveParseError('unexpected dimension of empty intensity')
    }
    const intensity = parseFloat(xmlEle.textContent)
    if (Number.isNaN(intensity)) {
        throw new ArchiveParseError(`unexpected intensity of ${xmlEle.textContent}`)
    }
    try {
        return new DimensionArchive(name, intensity)
    } catch (e) {
        if (e instanceof RangeError) {
            throw new ArchiveParseError(e.message, e)
        }
        throw e
    }
}

export { model };

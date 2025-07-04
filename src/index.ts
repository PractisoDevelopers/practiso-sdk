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
import DomHandler, {
    ChildNode,
    Document,
    Element,
    isDirective,
    isText,
} from 'domhandler';
import { Parser as XmlParser } from 'htmlparser2';
import render from 'dom-serializer';

function allowElementOrEmptyText(value: ChildNode[]): Element[] {
    const elements = [];
    for (const [index, node] of value.entries()) {
        if (!(node instanceof Element)) {
            if (isText(node)) {
                if (node.data.trim().length > 0) {
                    throw new ArchiveParseError(
                        `unexpected text "${node.data}"`,
                        null,
                        index,
                    );
                }
            } else {
                throw new ArchiveParseError(
                    `unexpected element ${node.type}`,
                    null,
                    index,
                );
            }
        } else {
            elements.push(node);
        }
    }
    return elements;
}

function firstElementChild(parent: Element): Element | null {
    for (const child of parent.children) {
        if (child instanceof Element) {
            return child;
        }
    }
    return null;
}

export class Parser {
    readonly sink: WritableStream;
    private readonly xmlParts = new Array<BlobPart>();
    private readonly resourceParts = new Array<BlobPart>();

    constructor() {
        let readHead: 'xml' | 'resource' = 'xml';

        this.sink = new WritableStream<ArrayBufferLike>({
            write: async (chunk) => {
                const blob = chunk instanceof Blob ? chunk : new Blob([chunk]);
                const buffer = await blob.bytes();
                switch (readHead) {
                    case 'xml':
                        const terminatorIndex = buffer.indexOf(0);
                        if (terminatorIndex >= 0) {
                            this.xmlParts.push(blob.slice(0, terminatorIndex));
                            this.resourceParts.push(
                                blob.slice(terminatorIndex + 1),
                            );
                            readHead = 'resource';
                        } else {
                            this.xmlParts.push(blob);
                        }
                        break;
                    case 'resource':
                        this.resourceParts.push(blob);
                        break;
                }
            },
        });
    }

    async result() {
        const xmlContent = await new Blob(this.xmlParts).text();

        const domHandler = new DomHandler();
        const xml = new XmlParser(domHandler);
        xml.write(xmlContent);

        const archive = parseXmlArchive(domHandler.root);
        archive.resources = await parseResources(new Blob(this.resourceParts));

        return archive;
    }
}

export function parseXmlArchive(xmlDoc: Document): PractisoArchive {
    const archive = allowElementOrEmptyText(
        xmlDoc.children.filter((n) => !isDirective(n)),
    )[0];
    if (archive?.tagName !== magic.archiveSerialName) {
        throw new ArchiveParseError(
            `missing <${magic.archiveSerialName}> as document element`,
        );
    }

    if (archive.namespace && archive.namespace != magic.namespace) {
        throw new ArchiveParseError(
            `unexpected xml namespace: ${archive.namespace}`,
            null,
            `<${magic.archiveSerialName}>`,
        );
    }

    const creation = (() => {
        const str = archive.attribs['creation'];
        if (!str) {
            throw new ArchiveParseError(
                'missing attribute "creation"',
                null,
                `<${magic.archiveSerialName}>`,
            );
        }
        return Date.parse(str);
    })();

    let elements: (typeof archive)[];
    try {
        elements = allowElementOrEmptyText(Array.from(archive.children));
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
            const name = quiz.attribs['name'],
                quizCreationStr = quiz.attribs['creation'],
                quizModificationStr = quiz.attribs['modification'];
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

            const framesElements = quiz.children.filter(
                (c) =>
                    c instanceof Element &&
                    c.tagName === magic.framesSerialName,
            ) as Element[];
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
            const dimensions = quiz.children
                .filter(
                    (c) =>
                        c instanceof Element &&
                        c.tagName === magic.dimensionSerialName,
                )
                .map((ele, dIndex) => {
                    try {
                        return parseXmlDimension(ele as Element);
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
                framesElements[0].children,
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
            return new QuizArchive(name, {
                creationTime: new Date(quizCreationStr),
                modificationTime: quizModificationStr
                    ? new Date(quizModificationStr)
                    : undefined,
                frames,
                dimensions,
            });
        })
        .filter((quiz) => typeof quiz !== 'undefined');
    return new PractisoArchive(quizzes, { creationTime: new Date(creation) });
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

export function parseXmlFrame(xmlEle: Element): FrameArchive {
    switch (xmlEle.tagName) {
        case magic.textFrameSerialName:
            if (!xmlEle.children) {
                throw new ArchiveParseError(
                    'unexpected empty text content',
                    null,
                    `<${magic.textFrameSerialName}>`,
                );
            }
            if (xmlEle.children.length > 1 || !isText(xmlEle.children[0])) {
                throw new ArchiveParseError(
                    'unexpected manifold tag content',
                    null,
                    `<${magic.textFrameSerialName}>`,
                );
            }
            return new Archive.Text(xmlEle.children[0].data);
        case magic.imageFrameSerialName:
            const width = xmlEle.attribs['width'],
                height = xmlEle.attribs['height'],
                alt = xmlEle.attribs['alt'],
                src = xmlEle.attribs['src'];
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
                if (itemEle.tagName !== 'item') {
                    throw new ArchiveParseError(
                        `unexpected node, only <item> expected`,
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        index,
                        `<${itemEle.tagName}>`,
                    );
                }
                const innerEle = firstElementChild(itemEle);
                if (!innerEle) {
                    throw new ArchiveParseError(
                        `empty item`,
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        `<${itemEle.tagName}#${index}>`,
                    );
                }
                const priorityStr = itemEle.attribs['priority'];
                if (!priorityStr) {
                    throw new ArchiveParseError(
                        'missing priority attribute',
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        `<${itemEle.tagName}#${index}>`,
                    );
                }
                const priority = parseInt(priorityStr);
                if (Number.isNaN(priority)) {
                    throw new ArchiveParseError(
                        `unexpected priority value ${priorityStr}`,
                        null,
                        `<${magic.optionsFrameSerialName}>`,
                        `<${itemEle.tagName}#${index}>`,
                    );
                }
                const isKey = itemEle.attribs['key'] === 'true';

                let innerFrame: FrameArchive;
                try {
                    innerFrame = parseXmlFrame(innerEle);
                } catch (e) {
                    if (e instanceof ArchiveParseError) {
                        throw new ArchiveParseError(
                            e.message,
                            e,
                            `<${magic.optionsFrameSerialName}>`,
                            `<${itemEle.tagName}#${index}>`,
                            ...e.location,
                        );
                    }
                    throw e;
                }
                return new Archive.Option(innerFrame, { isKey, priority });
            });
            const name = xmlEle.attribs['name'];
            return new Archive.Options(name, items);
        default:
            throw new ArchiveParseError(
                'unexpected frame type',
                null,
                `<${xmlEle.tagName}>`,
            );
    }
}

function parseXmlDimension(xmlEle: Element): DimensionArchive {
    const name = xmlEle.attribs['name'];
    if (!name) {
        throw new ArchiveParseError('missing name attribute');
    }
    if (!xmlEle.children) {
        throw new ArchiveParseError('unexpected dimension of empty intensity');
    }
    const content = xmlEle.children[0];
    if (xmlEle.children.length > 1 || !isText(content)) {
        throw new ArchiveParseError('unexpected manifold dimension');
    }
    const intensity = parseFloat(content.data);
    if (Number.isNaN(intensity)) {
        throw new ArchiveParseError(`unexpected intensity of ${content.data}`);
    }
    try {
        return new DimensionArchive(name, intensity);
    } catch (e) {
        if (e instanceof RangeError) {
            throw new ArchiveParseError(e.message, e);
        }
        throw e;
    }
}

export class Composer {
    archive: PractisoArchive;

    constructor(archive: PractisoArchive) {
        this.archive = archive;
    }

    get source() {
        return new ReadableStream({
            start: async (controller) => {
                const xml = render(this.archive.toXmlElement(), {
                    encodeEntities: true,
                    selfClosingTags: false,
                });
                const textEncoder = new TextEncoder();
                controller.enqueue(textEncoder.encode(xml));
                if (this.archive.resources.size > 0) {
                    controller.enqueue(new Uint8Array([0]));
                    for await (const [name, content] of this.archive.resources) {
                        controller.enqueue(textEncoder.encode(name));
                        controller.enqueue(new Uint8Array([0]))
                        const sizeMarker = new Uint8Array(4);
                        new DataView(sizeMarker.buffer).setInt32(
                            0,
                            content.size,
                            false,
                        );
                        controller.enqueue(sizeMarker)
                        controller.enqueue(await content.bytes());
                    }
                }
                controller.close();
            },
        });
    }
}

export { model, Archive, ArchiveParseError };

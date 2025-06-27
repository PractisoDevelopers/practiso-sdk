import { readAllFromStream } from './helper';
import { Element, Text as XmlText } from 'domhandler';
import { namespace } from './magic';

export class QuizArchive {
    name: string;
    creationTime: Date;
    modificationTime?: Date;
    frames: FrameArchive[];
    dimensions: DimensionArchive[];

    constructor(
        name: string,
        args?: {
            creationTime?: Date;
            modificationTime?: Date;
            frames?: FrameArchive[];
            dimensions?: DimensionArchive[];
        },
    ) {
        this.name = name;
        this.creationTime = args?.creationTime ?? new Date();
        this.modificationTime = args?.modificationTime;
        this.frames = args?.frames ?? [];
        this.dimensions = args?.dimensions ?? [];
    }

    toXmlElement() {
        return new Element(
            'quiz',
            {
                name: this.name,
                creation: this.creationTime.toISOString(),
                ...(this.modificationTime
                    ? { modification: this.modificationTime.toISOString() }
                    : {}),
            },
            [
                new Element(
                    'frames',
                    {},
                    this.frames.map((f) => f.toXmlElement()),
                ),
                ...this.dimensions.map((d) => d.toXmlElement()),
            ],
        );
    }
}

export class PractisoArchive {
    creationTime: Date;
    content: QuizArchive[];
    resources: ResourceArchive;

    constructor(
        content: QuizArchive[] = [],
        args?: {
            creationTime?: Date;
            resources?: ResourceArchive;
        },
    ) {
        this.creationTime = args?.creationTime ?? new Date();
        this.content = content;
        this.resources = args?.resources ?? new ResourceArchive();
    }

    toXmlElement() {
        const ele = new Element(
            'archive',
            {
                creation: this.creationTime.toISOString(),
            },
            this.content.map((quiz) => quiz.toXmlElement()),
        );
        ele.namespace = namespace;
        return ele;
    }
}

export class ResourceArchive {
    private readonly source: Map<string, () => Promise<Blob>>;

    constructor(
        source:
            | { [key: string]: Blob | ReadableStream }
            | Map<string, Blob | ReadableStream> = {},
    ) {
        this.source = new Map();
        let entries: [string, ReadableStream | Blob][];
        if (source instanceof Map) {
            entries = Array.from(source.entries());
        } else {
            entries = Object.entries(source);
        }
        for (const [key, value] of entries) {
            if (value instanceof Blob) {
                this.source.set(key, async () => value);
            } else {
                this.source.set(key, () => readAllFromStream(value));
            }
        }
    }

    async get(name: string): Promise<Blob | undefined> {
        if (this.source.has(name)) {
            return await this.source.get(name)!();
        } else {
            return undefined;
        }
    }

    put(
        name: string,
        futureBytes:
            | (() => Promise<BlobPart[] | Blob>)
            | Promise<BlobPart[] | Blob>
            | BlobPart[]
            | Blob,
    ) {
        function reduce(bytesLike: BlobPart[] | Blob) {
            if (bytesLike instanceof Blob) {
                return bytesLike;
            } else {
                return new Blob(bytesLike);
            }
        }

        if (futureBytes instanceof Promise) {
            this.source.set(name, () => futureBytes.then(reduce));
        } else if (typeof futureBytes === 'function') {
            this.source.set(name, () => futureBytes().then(reduce));
        } else {
            this.source.set(name, async () => reduce(futureBytes));
        }
    }

    remove(name: string): (() => Promise<Blob>) | undefined {
        const removed = this.source.get(name);
        this.source.delete(name);
        return removed;
    }

    get size() {
        return this.source.size;
    }

    keys() {
        return this.source.keys();
    }

    async *[Symbol.asyncIterator](): AsyncGenerator<[string, Blob]> {
        for (const [name, generator] of this.source) {
            const content = await generator();
            yield [name, content];
        }
    }
}

export interface FrameArchive {
    name: string | null;

    toXmlElement(): Element;
}

export namespace Archive {
    export class Text implements FrameArchive {
        content: string;

        constructor(content: string) {
            this.content = content;
        }

        get name() {
            return null;
        }

        toXmlElement(): Element {
            return new Element('text', {}, [new XmlText(this.content)]);
        }
    }

    export class Image implements FrameArchive {
        filename: string;
        width: number;
        height: number;
        altText: string | null;

        constructor(
            filename: string,
            width: number = -1,
            height: number = -1,
            altText: string | null = null,
        ) {
            this.filename = filename;
            this.width = width;
            this.height = height;
            this.altText = altText;
        }

        get name() {
            return this.altText;
        }

        toXmlElement(): Element {
            return new Element('image', {
                src: this.filename,
                width: this.width.toString(),
                height: this.height.toString(),
                ...(this.altText ? { alt: this.altText } : {}),
            });
        }
    }

    export class Options implements FrameArchive {
        name: string | null;
        content: Option[];

        constructor(name: string | null = null, content: Option[] = []) {
            this.name = name;
            this.content = content;
        }

        toXmlElement(): Element {
            return new Element(
                'options',
                this.name ? { name: this.name } : {},
                this.content.map((option) => option.toXmlElement()),
            );
        }
    }

    export class Option {
        isKey: boolean;
        priority: number;
        content: FrameArchive;

        constructor(
            content: FrameArchive,
            args?: {
                isKey?: boolean;
                priority?: number;
            },
        ) {
            this.isKey = args?.isKey ?? false;
            this.priority = args?.priority ?? 0;
            this.content = content;
        }

        toXmlElement(): Element {
            return new Element(
                'item',
                {
                    priority: this.priority.toString(),
                    ...(this.isKey ? { key: 'true' } : {}),
                },
                [this.content.toXmlElement()],
            );
        }
    }
}

export class DimensionArchive {
    name: string;
    intensity: number;

    constructor(name: string, intensity: number = 1) {
        if (intensity < 0 || intensity > 1) {
            throw new RangeError(
                `an intensity of ${intensity} is out of bound`,
            );
        }
        this.name = name;
        this.intensity = intensity;
    }

    toXmlElement() {
        return new Element('dimension', { name: this.name }, [
            new XmlText(this.intensity.toString()),
        ]);
    }
}

export class ArchiveParseError extends Error {
    location: string[];
    cause: Error | null;

    constructor(
        message: string,
        cause: Error | null = null,
        ...location: any[]
    ) {
        location = location.map((e) => e.toString());
        if (location.length > 0) {
            super(`${message} at ${location.join('/')}`);
        } else {
            super(message);
        }
        this.cause = cause;
        this.location = location;
        this.name = 'ArchiveParseError';
    }
}

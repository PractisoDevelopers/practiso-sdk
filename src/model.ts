import { readAllFromStream } from './helper';

export class QuizArchive {
    name: string;
    creationTime: Date;
    modificationTime?: Date;
    frames: FrameArchive[];
    dimensions: DimensionArchive[];

    constructor(
        name: string,
        creationTime?: Date,
        modificationTime?: Date,
        frames: FrameArchive[] = [],
        dimensions: DimensionArchive[] = [],
    ) {
        this.name = name;
        this.creationTime = creationTime ?? new Date();
        this.modificationTime = modificationTime;
        this.frames = frames;
        this.dimensions = dimensions;
    }
}

export class PractisoArchive {
    creationTime: Date;
    content: QuizArchive[];
    resources: ResourceArchive;

    constructor(
        creationTime?: Date,
        content: QuizArchive[] = [],
        resources: ResourceArchive = new ResourceArchive(),
    ) {
        this.creationTime = creationTime ?? new Date();
        this.content = content;
        this.resources = resources;
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

    remove(name: string): (() => Promise<Blob>) | undefined {
        const removed = this.source.get(name);
        this.source.delete(name);
        return removed;
    }

    get size() {
        return this.source.size
    }

    keys() {
        return this.source.keys()
    }

    [Symbol.iterator]() {
        return this.source[Symbol.iterator]();
    }
}

export interface FrameArchive {
    name: string | null;
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
    }

    export class Options implements FrameArchive {
        name: string | null;
        content: Option[];

        constructor(name: string | null = null, content: Option[] = []) {
            this.name = name;
            this.content = content;
        }
    }

    export class Option {
        isKey: boolean;
        priority: number;
        content: FrameArchive;

        constructor(
            isKey: boolean = false,
            priority: number = 0,
            content: FrameArchive,
        ) {
            this.isKey = isKey;
            this.priority = priority;
            this.content = content;
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
}

export class ArchiveParseError extends Error {
    location: string[];
    cause: Error | null

    constructor(message: string, cause: Error | null = null, ...location: any[]) {
        location = location.map((e) => e.toString());
        if (location.length > 0) {
            super(`${message} at ${location.join('/')}`);
        } else {
            super(message);
        }
        this.cause = cause
        this.location = location;
        this.name = 'ArchiveParseError';
    }
}

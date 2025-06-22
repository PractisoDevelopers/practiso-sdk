export async function readAllFromStream(stream: ReadableStream): Promise<Blob> {
    const parts = [];
    const reader = stream.getReader();
    let read = await reader.read();
    while (!read.done) {
        parts.unshift(read.value);
        read = await reader.read();
    }
    return new Blob(parts);
}


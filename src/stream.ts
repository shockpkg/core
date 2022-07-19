import {WriteStream, createWriteStream} from 'fs';

/**
 * Extends WriteStream.
 * Adds the missing wrote event to monitor write progress.
 */
export class WriterStream extends WriteStream {
	// eslint-disable-next-line @typescript-eslint/naming-convention, jsdoc/require-jsdoc
	public _write(
		chunk: any,
		encoding: BufferEncoding,
		callback: (error?: Error | null | undefined) => void
	): void {
		return super._write(chunk, encoding, err => {
			this.emit('wrote');
			callback(err);
		});
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention, jsdoc/require-jsdoc
	public _writev(
		chunks: {
			chunk: any;
			encoding: BufferEncoding;
		}[],
		callback: (error?: Error | null) => void
	): void {
		// Never undefined for WriteStream.
		return (super._writev as NonNullable<WriteStream['_writev']>)(
			chunks,
			err => {
				this.emit('wrote');
				callback(err);
			}
		);
	}
}

/**
 * Like createWriteStream but for creating WriterStream.
 *
 * @param path Same as createWriteStream.
 * @param options Same as createWriteStream.
 * @returns A WriterStream.
 */
export function createWriterStream(
	path: Parameters<typeof createWriteStream>[0],
	options?: Parameters<typeof createWriteStream>[1]
): WriterStream {
	// This nonsense is to work around the incorrect @types/node WriteStream.
	return new (WriterStream as new (
		path: Parameters<typeof createWriteStream>[0],
		options: Parameters<typeof createWriteStream>[1]
	) => WriterStream)(path, options);
}

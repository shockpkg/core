import {WriteStream, createWriteStream} from 'fs';

/**
 * Extends WriteStream.
 * Adds the missing wrote event to monitor write progress.
 */
export class WriterStream extends WriteStream {
	/**
	 * A flag to hook _write methods only once.
	 */
	protected _writing = false;

	/**
	 * @inheritDoc
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _write(
		chunk: any,
		encoding: BufferEncoding,
		callback: (error?: Error | null | undefined) => void
	): void {
		if (this._writing) {
			return super._write(chunk, encoding, callback);
		}
		this._writing = true;
		return super._write(chunk, encoding, err => {
			this._writing = false;
			this.emit('wrote');
			return err ? callback(err) : callback();
		});
	}

	/**
	 * @inheritDoc
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _writev(
		chunks: {
			chunk: any;
			encoding: BufferEncoding;
		}[],
		callback: (error?: Error | null) => void
	): void {
		// Do not hook a write within a write.
		if (this._writing) {
			return (super._writev as NonNullable<WriteStream['_writev']>)(
				chunks,
				callback
			);
		}
		this._writing = true;
		return (super._writev as NonNullable<WriteStream['_writev']>)(
			chunks,
			err => {
				this._writing = false;
				this.emit('wrote');
				return err ? callback(err) : callback();
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

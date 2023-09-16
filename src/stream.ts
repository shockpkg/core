/* eslint-disable max-classes-per-file */
import {WriteStream, createWriteStream} from 'node:fs';
import {Readable, Transform, TransformCallback} from 'node:stream';

/**
 * Extends WriteStream.
 * Adds the missing wrote event to monitor write progress.
 */
export class WriterStream extends WriteStream {
	/**
	 * A flag to hook _write methods only once, ignoring write within write.
	 */
	protected _writing = false;

	/**
	 * WriterStream constructor.
	 *
	 * @param path Same as createWriteStream.
	 * @param options Same as createWriteStream.
	 */
	constructor(
		path: Parameters<typeof createWriteStream>[0],
		options?: Parameters<typeof createWriteStream>[1]
	) {
		// @ts-expect-error Ignore incorrect @types/node types.
		super(path, options);
	}

	/**
	 * @inheritDoc
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _write(
		chunk: unknown,
		encoding: BufferEncoding,
		callback: (error?: Error | null) => void
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
			chunk: unknown;
			encoding: BufferEncoding;
		}[],
		callback: (error?: Error | null) => void
	): void {
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
 * Gets buffer slice out of a readable stream.
 */
export class SliceStream extends Transform {
	/**
	 * Slice start.
	 */
	public readonly start: number;

	/**
	 * Slice size.
	 */
	public readonly size: number;

	/**
	 * Amount processed.
	 */
	protected _transformed = 0;

	/**
	 * SliceStream constructor.
	 *
	 * @param start Start offset.
	 * @param size Total Size.
	 */
	constructor(start = 0, size = -1) {
		super();

		this.start = start;
		this.size = size;
	}

	/**
	 * @inheritDoc
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _transform(
		chunk: unknown,
		encoding: BufferEncoding,
		callback: TransformCallback
	): void {
		const {start, size} = this;
		let c =
			encoding && (encoding as string) !== 'buffer'
				? Buffer.from(chunk as string, encoding)
				: (chunk as Buffer);

		// If size is 0, then nothing to do.
		if (size === 0) {
			this._transformed += c.length;
			return callback();
		}

		// If size is less than 0, from start to infinity.
		if (size < 0) {
			// Find index from start.
			const i = this._transformed - start;

			// Discard if all before start.
			if (i + c.length <= 0) {
				this._transformed += c.length;
				return callback();
			}

			// Skip over any data before start.
			if (i < 0) {
				this._transformed -= i;
				c = c.subarray(-i);
			}

			this._transformed += c.length;
			this.push(c.subarray());
			return callback();
		}

		// Discard if all past end.
		if (this._transformed >= start + size) {
			this._transformed += c.length;
			return callback();
		}

		// Find index from start.
		let i = this._transformed - start;

		// Discard if all before start.
		if (i + c.length <= 0) {
			this._transformed += c.length;
			return callback();
		}

		// Skip over any data before start.
		if (i < 0) {
			this._transformed -= i;
			c = c.subarray(-i);
			i = 0;
		}

		// If chunk length more than remaining.
		const r = size - i;
		if (c.length > r) {
			this._transformed += r;
			this.push(c.subarray(0, r));
			this._transformed += c.length - r;
			return callback();
		}

		this._transformed += c.length;
		this.push(c.subarray());
		return callback();
	}
}

/**
 * An empty read stream.
 */
export class EmptyStream extends Readable {
	/**
	 * @inheritDoc
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _read(_size: number) {
		this.push(null);
	}
}

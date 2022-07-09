/* eslint-disable max-classes-per-file */

import {Readable} from 'stream';

import yauzl from 'yauzl';

import {ZipItter, ZipStreamer} from './types';

const openOpts = {lazyEntries: true};

/**
 * Streamer Random Access Read wrapper class.
 */
class StreamerRAR extends yauzl.RandomAccessReader {
	/**
	 * Streamer instance.
	 */
	private readonly _streamer_: ZipStreamer;

	/**
	 * Streamer Random Access Read wrapper constructor.
	 *
	 * @param streamer ZipStreamer function.
	 */
	constructor(streamer: ZipStreamer) {
		super();
		this._streamer_ = streamer;
	}

	/**
	 * Read stream from range.
	 *
	 * @param start Range start.
	 * @param end Range end.
	 * @returns Readable stream.
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _readStreamForRange(start: number, end: number) {
		const streamer = this._streamer_(start, end);

		// Method needed in Node 14+ but not present on a request stream.
		const streamerAny = streamer as {unpipe: () => void};
		if (!streamerAny.unpipe) {
			/**
			 * Dummy function.
			 */
			streamerAny.unpipe = function () {
				// Do nothing.
			};
		}

		return streamer;
	}
}

/**
 * Zip file reader class.
 */
export class Zip extends Object {
	/**
	 * The zipfile instance, generic type to avoid dependency.
	 */
	protected _zipfile: any = null;

	/**
	 * File file reader constructor.
	 */
	constructor() {
		super();
	}

	/**
	 * Open with a file.
	 *
	 * @param file File path.
	 */
	public async openFile(file: string) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this._zipfile = await new Promise((resolve, reject) => {
			yauzl.open(file, openOpts, (err, zipfile) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(zipfile);
			});
		});
	}

	/**
	 * Open with a streamer.
	 *
	 * @param streamer Streamer function.
	 * @param totalSize Total size of file.
	 */
	public async openStreamer(streamer: ZipStreamer, totalSize: number) {
		const reader = new StreamerRAR(streamer);

		this._zipfile = await new Promise((resolve, reject) => {
			yauzl.fromRandomAccessReader(
				reader,
				totalSize,
				openOpts,
				(err, zipfile) => {
					if (err) {
						reject(err);
						return;
					}
					resolve(zipfile);
				}
			);
		});
	}

	/**
	 * Read zip file entries.
	 * To stop reading and close file, return false from itter.
	 *
	 * @param itter Callback function.
	 */
	public async read(itter: ZipItter) {
		const zipfile = this._zipfile as yauzl.ZipFile | null;
		if (!zipfile) {
			throw new Error('Zip instance not opened');
		}
		this._zipfile = null;

		await new Promise<void>((resolve, reject) => {
			let error: Error | null = null;

			/**
			 * Next callback.
			 *
			 * @param err Error object or null.
			 */
			const next = (err: Error | null) => {
				if (err) {
					error = err;
					zipfile.close();
					return;
				}
				zipfile.readEntry();
			};
			zipfile.on('error', next);
			zipfile.on('entry', (entry: yauzl.Entry) => {
				const path = entry.fileName.replace(/\\/g, '/');
				const dir = path.endsWith('/');
				const {crc32} = entry;
				const sizeC = entry.compressedSize;
				const sizeD = entry.uncompressedSize;

				/**
				 * Open stream.
				 *
				 * @returns Open entry.
				 */
				const stream = async () => {
					const stream = new Promise<Readable>((resolve, reject) => {
						zipfile.openReadStream(entry, (err, stream) => {
							if (err) {
								reject(err);
								return;
							}
							resolve(stream as Readable);
						});
					});
					return stream;
				};

				itter({
					path,
					dir,
					crc32,
					sizeC,
					sizeD,
					stream
				})
					.then(done => {
						if (done) {
							zipfile.close();
						} else {
							next(null);
							return;
						}
					})
					.catch(next);
			});
			zipfile.on('close', () => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
			next(null);
		});
	}
}

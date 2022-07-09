/* eslint-disable max-classes-per-file */

import {promisify as utilPromisify} from 'util';

import yauzl from 'yauzl';

import {ZipItter, ZipStreamer} from './types';

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const yauzlOpen = yauzl.open.bind(yauzl);
const yauzlOpenP = utilPromisify(yauzlOpen);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const yauzlFromRAR = yauzl.fromRandomAccessReader.bind(yauzl);
const yauzlFromRARP = utilPromisify(yauzlFromRAR);
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
		this._zipfile = await yauzlOpenP(file, openOpts);
	}

	/**
	 * Open with a streamer.
	 *
	 * @param streamer Streamer function.
	 * @param totalSize Total size of file.
	 */
	public async openStreamer(streamer: ZipStreamer, totalSize: number) {
		const reader = new StreamerRAR(streamer);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this._zipfile = await yauzlFromRARP(reader, totalSize, openOpts);
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
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const open = zipfile.openReadStream.bind(zipfile);
					const openP = utilPromisify(open);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const r = await openP(entry);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-return
					return r;
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

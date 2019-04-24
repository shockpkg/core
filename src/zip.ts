// tslint:disable max-classes-per-file

import {promisify as utilPromisify} from 'util';
import yauzl from 'yauzl';

import {property} from './decorators';
import {
	ZipItter,
	ZipStreamer
} from './types';

const yauzlOpen = yauzl.open.bind(yauzl);
const yauzlOpenP = utilPromisify(yauzlOpen);
const yauzlFromRAR = yauzl.fromRandomAccessReader.bind(yauzl);
const yauzlFromRARP = utilPromisify(yauzlFromRAR);
const openOpts = {lazyEntries: true};

/**
 * Streamer Random Access Read wrapper class.
 *
 * @param streamer ZipStreamer function.
 */
class StreamerRAR extends yauzl.RandomAccessReader {

	/**
	 * Streamer instance.
	 */
	private readonly _streamer: ZipStreamer;

	constructor(streamer: ZipStreamer) {
		super();
		this._streamer = streamer;
	}

	/**
	 * Read stream from range.
	 *
	 * @param start Range start.
	 * @param end Range end.
	 * @return Readable stream.
	 */
	public _readStreamForRange(start: number, end: number) {
		return this._streamer(start, end);
	}
}

/**
 * Zip file reader class.
 */
export class Zip extends Object {
	/**
	 * The zipfile instance, generic type to avoid dependency.
	 */
	@property(false)
	protected _zipfile: any = null;

	constructor() {
		super();
	}

	/**
	 * Open with a file.
	 *
	 * @param file File path.
	 */
	public async openFile(file: string) {
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

		await new Promise((resolve, reject) => {
			let error: Error | null = null;
			const next = (err: Error | null) => {
				if (err) {
					error = err;
					zipfile.close();
					return;
				}
				zipfile.readEntry();
			};
			zipfile.on('error', next);
			zipfile.on('entry', async entry => {
				const path = entry.fileName.replace(/\\/g, '/');
				const dir = path.endsWith('/');
				const crc32 = entry.crc32;
				const sizeC = entry.compressedSize;
				const sizeD = entry.uncompressedSize;
				const stream = async () => {
					const open = zipfile.openReadStream.bind(zipfile);
					const openP = utilPromisify(open);
					const r = await openP(entry);
					return r;
				};

				let done = false;
				try {
					done = await itter({
						path,
						dir,
						crc32,
						sizeC,
						sizeD,
						stream
					});
				}
				catch (err) {
					next(err);
					return;
				}

				if (done) {
					zipfile.close();
				}
				else {
					next(null);
				}
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
